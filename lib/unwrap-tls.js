'use strict';

var sni = require('sni');
var pipeWs = require('./pipe-ws.js');

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

      //conn.pause();
      conn.unshift(firstChunk);

      // BUG XXX: this assumes that the packet won't be chunked smaller
      // than the 'hello' or the point of the 'Host' header.
      // This is fairly reasonable, but there are edge cases where
      // it does not hold (such as manual debugging with telnet)
      // and so it should be fixed at some point in the future

      // defer after return (instead of being in many places)
      function deferData(fn) {
        if (fn) {
          state[fn](servername, conn);
        }
        /*
        process.nextTick(function () {
          conn.resume();
        });
        */
      }

      function tryTls() {
        var vhost;

        if (!state.servernames.length) {
          console.info("[Setup] https => admin => setup => (needs bogus tls certs to start?)");
          deferData('httpsSetupServer');
          return;
        }

        if (-1 !== state.servernames.indexOf(servername)) {
          if (state.debug) { console.log("[Admin]", servername); }
          deferData('httpsTunnel');
          return;
        }

        if (state.config.nowww && /^www\./i.test(servername)) {
          console.log("TODO: use www bare redirect");
        }

        if (!servername) {
          if (state.debug) { console.log("No SNI was given, so there's nothing we can do here"); }
          deferData('httpsInvalid');
          return;
        }

        function run() {
          var nextDevice = Devices.next(state.deviceLists, servername);
          if (!nextDevice) {
            if (state.debug) { console.log("No devices match the given servername"); }
            deferData('httpsInvalid');
            return;
          }

          if (state.debug) { console.log("pipeWs(servername, service, deviceLists['" + servername + "'], socket)"); }
          deferData();
          pipeWs(servername, service, nextDevice, conn, serviceport);
        }

        // TODO don't run an fs check if we already know this is working elsewhere
        //if (!state.validHosts) { state.validHosts = {}; }
        if (state.config.vhost) {
          vhost = state.config.vhost.replace(/:hostname/, (servername||'reallydoesntexist'));
          if (state.debug) { console.log("[tcp] [vhost]", state.config.vhost, "=>", vhost); }
          //state.httpsVhost(servername, conn);
          //return;
          require('fs').readdir(vhost, function (err, nodes) {
            if (state.debug && err) { console.log("VHOST error", err); }
            if (err || !nodes) { run(); return; }
            //if (nodes) { deferData('httpsVhost'); return; }
            deferData('httpsVhost');
          });
          return;
        }

        run();
      }

      // https://github.com/mscdex/httpolyglot/issues/3#issuecomment-173680155
      if (22 === firstChunk[0]) {
        // TLS
        service = 'https';
        servername = (sni(firstChunk)||'').toLowerCase().trim();
        if (state.debug) { console.log("[tcp] tls hello from '" + servername + "'"); }
        tryTls();
        return;
      }

      if (firstChunk[0] > 32 && firstChunk[0] < 127) {
        str = firstChunk.toString();
        m = str.match(/(?:^|[\r\n])Host: ([^\r\n]+)[\r\n]*/im);
        servername = (m && m[1].toLowerCase() || '').split(':')[0];
        if (state.debug) { console.log("[tcp] http hostname '" + servername + "'"); }

        if (/HTTP\//i.test(str)) {
          if (!state.servernames.length) {
            console.info("[tcp] No admin servername. Entering setup mode.");
            deferData();
            state.httpSetupServer.emit('connection', conn);
            return;
          }

          service = 'http';
          // TODO make https redirect configurable
          // /^\/\.well-known\/acme-challenge\//.test(str)
          if (/well-known/.test(str)) {
            // HTTP
            if (Devices.exist(state.deviceLists, servername)) {
              deferData();
              pipeWs(servername, service, Devices.next(state.deviceLists, servername), conn, serviceport);
              return;
            }
            deferData('handleHttp');
            return;
          }

          // redirect to https
          deferData('handleInsecureHttp');
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
