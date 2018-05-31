'use strict';

var Packer = require('proxy-packer');
var sni = require('sni');

function pipeWs(servername, service, conn, remote) {
  console.log('[pipeWs] servername:', servername, 'service:', service);

  var browserAddr = Packer.socketToAddr(conn);
  browserAddr.service = service;
  var cid = Packer.addrToId(browserAddr);
  conn.tunnelCid = cid;
  console.log('[pipeWs] browser is', cid, 'home-cloud is', Packer.socketToId(remote.upgradeReq.socket));

  function sendWs(data, serviceOverride) {
    if (remote.ws && (!conn.tunnelClosing || serviceOverride)) {
      try {
        remote.ws.send(Packer.pack(browserAddr, data, serviceOverride), { binary: true });
        // If we can't send data over the websocket as fast as this connection can send it to us
        // (or there are a lot of connections trying to send over the same websocket) then we
        // need to pause the connection for a little. We pause all connections if any are paused
        // to make things more fair so a connection doesn't get stuck waiting for everyone else
        // to finish because it got caught on the boundary. Also if serviceOverride is set it
        // means the connection is over, so no need to pause it.
        if (!serviceOverride && (remote.pausedConns.length || remote.ws.bufferedAmount > 1024*1024)) {
          // console.log('pausing', cid, 'to allow web socket to catch up');
          conn.pause();
          remote.pausedConns.push(conn);
        }
      } catch (err) {
        console.warn('[pipeWs] error sending websocket message', err);
      }
    }
  }

  remote.clients[cid] = conn;
  conn.on('data', function (chunk) {
    console.log('[pipeWs] data from browser to tunneler', chunk.byteLength);
    sendWs(chunk);
  });
  conn.on('error', function (err) {
    console.warn('[pipeWs] browser connection error', err);
  });
  conn.on('close', function (hadErr) {
    console.log('[pipeWs] browser connection closing');
    sendWs(null, hadErr ? 'error': 'end');
    delete remote.clients[cid];
  });
}

module.exports.createTcpConnectionHandler = function (copts) {
  var Devices = copts.Devices;

  return function onTcpConnection(conn) {
    // this works when I put it here, but I don't know if it's tls yet here
    // httpsServer.emit('connection', socket);
    //tls3000.emit('connection', socket);

    //var tlsSocket = new tls.TLSSocket(socket, { secureContext: tls.createSecureContext(tlsOpts) });
    //tlsSocket.on('data', function (chunk) {
    //  console.log('dummy', chunk.byteLength);
    //});

    //return;
    conn.once('data', function (firstChunk) {
      conn.pause();
      conn.unshift(firstChunk);

      // BUG XXX: this assumes that the packet won't be chunked smaller
      // than the 'hello' or the point of the 'Host' header.
      // This is fairly reasonable, but there are edge cases where
      // it does not hold (such as manual debugging with telnet)
      // and so it should be fixed at some point in the future

      // defer after return (instead of being in many places)
      function deferData(fn) {
        if (fn) {
          copts[fn](servername, conn)
        }
        process.nextTick(function () {
          conn.resume();
        });
      }

      var service = 'tcp';
      var servername;
      var str;
      var m;

      function tryTls() {
        var vhost;

        console.log("");

        if (!copts.servernames.length) {
          console.log("https => admin => setup => (needs bogus tls certs to start?)");
          deferData('httpsSetupServer');
          return;
        }

        if (-1 !== copts.servernames.indexOf(servername)) {
          console.log("Lock and load, admin interface time!");
          deferData('httpsTunnel');
          return;
        }

        if (copts.config.nowww && /^www\./i.test(servername)) {
          console.log("TODO: use www bare redirect");
        }

        function run() {
          if (!servername) {
            console.log("No SNI was given, so there's nothing we can do here");
            deferData('httpsInvalid');
            return;
          }

          var nextDevice = Devices.next(copts.deviceLists, servername);
          if (!nextDevice) {
            console.log("No devices match the given servername");
            deferData('httpsInvalid');
            return;
          }

          console.log("pipeWs(servername, service, socket, deviceLists['" + servername + "'])");
          deferData();
          pipeWs(servername, service, conn, nextDevice);
        }

        if (copts.config.vhost) {
          console.log("VHOST path", copts.config.vhost);
          vhost = copts.config.vhost.replace(/:hostname/, (servername||''));
          console.log("VHOST name", vhost);
          //copts.httpsVhost(servername, conn); 
          //return;
          require('fs').readdir(vhost, function (err, nodes) {
            console.log("VHOST error?", err);
            if (err) { run(); return; } 
            if (nodes) { deferData('httpsVhost'); }
          });
          return;
        }

        run();
      }

      // https://github.com/mscdex/httpolyglot/issues/3#issuecomment-173680155
      if (22 === firstChunk[0]) {
        // TLS
        service = 'https';
        servername = (sni(firstChunk)||'').toLowerCase();
        console.log("tls hello servername:", servername);
        tryTls();
        return;
      }

      if (firstChunk[0] > 32 && firstChunk[0] < 127) {
        str = firstChunk.toString();
        m = str.match(/(?:^|[\r\n])Host: ([^\r\n]+)[\r\n]*/im);
        servername = (m && m[1].toLowerCase() || '').split(':')[0];
        console.log('servername', servername);

        if (/HTTP\//i.test(str)) {
          if (!copts.servernames.length) {
            console.log('copts.httpSetupServer', copts.httpSetupServer);
            deferData();
            copts.httpSetupServer.emit('connection', conn);
            return;
          }

          service = 'http';
          // TODO make https redirect configurable
          // /^\/\.well-known\/acme-challenge\//.test(str)
          if (/well-known/.test(str)) {
            // HTTP
            if (Devices.exist(copts.deviceLists, servername)) {
              deferData();
              pipeWs(servername, service, conn, Devices.next(copts.deviceLists, servername));
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
