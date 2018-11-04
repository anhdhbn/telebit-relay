'use strict';

var sni = require('sni');
var pipeWs = require('./pipe-ws.js');
var ago = require('./ago.js').AGO;
var up = Date.now();

function fromUptime(ms) {
  if (ms) {
    return ago(Date.now() - ms);
  } else {
    return "Not seen since relay restarted, " + ago(Date.now() - up);
  }
}

module.exports.createTcpConnectionHandler = function (state) {
  var Devices = state.Devices;

  return function onTcpConnection(conn, serviceport) {
    serviceport = serviceport || conn.localPort;
    // this works when I put it here, but I don't know if it's tls yet here
    // httpsServer.emit('connection', socket);
    //tls3000.emit('connection', socket);

    //var tlsSocket = new tls.TLSSocket(socket, { secureContext: tls.createSecureContext(tlsOpts) });
    //tlsSocket.on('data', function (chunk) {
    //  console.log('dummy', chunk.byteLength);
    //});

    //return;
    //conn.once('data', function (firstChunk) {
    //});
    conn.once('readable', function () {
      var firstChunk = conn.read();
      var service = 'tcp';
      var servername;
      var str;
      var m;

      if (!firstChunk) {
        try {
          conn.end();
        } catch(e) {
          console.error("[lib/unwrap-tls.js] Error:", e);
          conn.destroy();
        }
        return;
      }

      //conn.pause();
      conn.unshift(firstChunk);

      // BUG XXX: this assumes that the packet won't be chunked smaller
      // than the 'hello' or the point of the 'Host' header.
      // This is fairly reasonable, but there are edge cases where
      // it does not hold (such as manual debugging with telnet)
      // and so it should be fixed at some point in the future

      // defer after return (instead of being in many places)
      function deferData(fn) {
        if ('httpsInvalid' === fn) {
          state[fn]({
            servername: servername
          , ago: fromUptime(Devices.lastSeen(state.deviceLists, servername))
          }, conn);
        } else if (fn) {
          state[fn](servername, conn);
        } else {
          console.error("[SANITY ERROR] '" + fn + "' doesn't have a state handler");
        }
        /*
        process.nextTick(function () {
          conn.resume();
        });
        */
      }

      var httpOutcomes = {
        missingServername: function () {
          console.log("[debug] [http] missing servername");
          // TODO use a more specific error page
          deferData('handleInsecureHttp');
        }
      , requiresSetup: function () {
          console.log("[debug] [http] requires setup");
          // TODO Insecure connections for setup will not work on secure domains (i.e. .app)
          state.httpSetupServer.emit('connection', conn);
        }
      , isInternal: function () {
          console.log("[debug] [http] is known internally (admin)");
          if (/well-known/.test(str)) {
            deferData('handleHttp');
          } else {
            deferData('handleInsecureHttp');
          }
        }
      , isVhost: function () {
          console.log("[debug] [http] is vhost (normal server)");
          if (/well-known/.test(str)) {
            deferData('handleHttp');
          } else {
            deferData('handleInsecureHttp');
          }
        }
      , assumeExternal: function () {
          console.log("[debug] [http] assume external");
          var service = 'http';

          if (!Devices.exist(state.deviceLists, servername)) {
            // It would be better to just re-read the host header rather
            // than creating a whole server object, but this is a "rare"
            // case and I'm feeling lazy right now.
            console.log("[debug] [http] no device connected");
            state.createHttpInvalid({
              servername: servername
            , ago: fromUptime(Devices.lastSeen(state.deviceLists, servername))
            }).emit('connection', conn);
            return;
          }

          // TODO make https redirect configurable on a per-domain basis
          // /^\/\.well-known\/acme-challenge\//.test(str)
          if (/well-known/.test(str)) {
            // HTTP
            console.log("[debug] [http] passthru");
            pipeWs(servername, service, Devices.next(state.deviceLists, servername), conn, serviceport);
            return;
          } else {
            console.log("[debug] [http] redirect to https");
            deferData('handleInsecureHttp');
          }
        }
      };
      var tlsOutcomes = {
        missingServername: function () {
          if (state.debug) { console.log("No SNI was given, so there's nothing we can do here"); }
          deferData('httpsInvalid');
        }
      , requiresSetup: function () {
          console.info("[Setup] https => admin => setup => (needs bogus tls certs to start?)");
          deferData('httpsSetupServer');
        }
      , isInternal: function () {
          if (state.debug) { console.log("[Admin]", servername); }
          deferData('httpsTunnel');
        }
      , isVhost: function (vhost) {
          if (state.debug) { console.log("[tcp] [vhost]", state.config.vhost, "=>", vhost); }
          deferData('httpsVhost');
        }
      , assumeExternal: function () {
         var nextDevice = Devices.next(state.deviceLists, servername);
          if (!nextDevice) {
            if (state.debug) { console.log("No devices match the given servername"); }
            deferData('httpsInvalid');
            return;
          }

          if (state.debug) { console.log("pipeWs(servername, service, deviceLists['" + servername + "'], socket)"); }
          pipeWs(servername, service, nextDevice, conn, serviceport);
        }
      };

      function handleConnection(outcomes) {
        var vhost;

        // No routing information available
        if (!servername) { outcomes.missingServername(); return; }
        // Server needs to be set up
        if (!state.servernames.length) { outcomes.requiresSetup(); return; }
        // This is one of the admin domains
        if (-1 !== state.servernames.indexOf(servername)) { outcomes.isInternal(); return; }

        // TODO don't run an fs check if we already know this is working elsewhere
        //if (!state.validHosts) { state.validHosts = {}; }
        if (state.config.vhost) {
          vhost = state.config.vhost.replace(/:hostname/, servername);
          require('fs').readdir(vhost, function (err, nodes) {
            if (state.debug && err) { console.log("VHOST error", err); }
            if (err || !nodes) { outcomes.assumeExternal(); return; }
            outcomes.isVhost(vhost);
          });
          return;
        }

        outcomes.assumeExternal();
      }

      // https://github.com/mscdex/httpolyglot/issues/3#issuecomment-173680155
      if (22 === firstChunk[0]) {
        // TLS
        service = 'https';
        servername = (sni(firstChunk)||'').toLowerCase().trim();
        if (state.debug) { console.log("[tcp] tls hello from '" + servername + "'"); }
        handleConnection(tlsOutcomes);
        return;
      }

      if (firstChunk[0] > 32 && firstChunk[0] < 127) {
        // (probably) HTTP
        str = firstChunk.toString();
        m = str.match(/(?:^|[\r\n])Host: ([^\r\n]+)[\r\n]*/im);
        servername = (m && m[1].toLowerCase() || '').split(':')[0];
        if (state.debug) { console.log("[tcp] http hostname '" + servername + "'"); }

        if (/HTTP\//i.test(str)) {
          handleConnection(httpOutcomes);
          return;
        }
      }

      console.error("Got unexpected connection", str);
      conn.write(JSON.stringify({ error: {
        message: "not sure what you were trying to do there..."
      , code: 'E_INVALID_PROTOCOL' }
      }));
      conn.end();
    });
    conn.on('error', function (err) {
      console.error('[error] tcp socket raw TODO forward and close');
      console.error(err);
    });
  };
};
