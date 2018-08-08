'use strict';

var Packer = require('proxy-packer');

module.exports = function pipeWs(servername, service, srv, conn, serviceport) {
  var browserAddr = Packer.socketToAddr(conn);
  var cid = Packer.addrToId(browserAddr);
  browserAddr.service = service;
  browserAddr.serviceport = serviceport;
  browserAddr.name = servername;
  conn.tunnelCid = cid;
  var rid = Packer.socketToId(srv.upgradeReq.socket);

  //if (state.debug) { console.log('[pipeWs] client', cid, '=> remote', rid, 'for', servername, 'via', service); }

  function sendWs(data, serviceOverride) {
    if (srv.ws && (!conn.tunnelClosing || serviceOverride)) {
      try {
        if (data && !Buffer.isBuffer(data)) {
          data = Buffer.from(JSON.stringify(data));
        }
        srv.ws.send(Packer.packHeader(browserAddr, data, serviceOverride), { binary: true });
        if (data) {
          srv.ws.send(data, { binary: true });
        }
        // If we can't send data over the websocket as fast as this connection can send it to us
        // (or there are a lot of connections trying to send over the same websocket) then we
        // need to pause the connection for a little. We pause all connections if any are paused
        // to make things more fair so a connection doesn't get stuck waiting for everyone else
        // to finish because it got caught on the boundary. Also if serviceOverride is set it
        // means the connection is over, so no need to pause it.
        if (!serviceOverride && (srv.pausedConns.length || srv.ws.bufferedAmount > 1024*1024)) {
          // console.log('pausing', cid, 'to allow web socket to catch up');
          conn.pause();
          srv.pausedConns.push(conn);
        }
      } catch (err) {
        console.warn('[pipeWs] srv', rid, ' => client', cid, 'error sending websocket message', err);
      }
    }
  }

  srv.clients[cid] = conn;
  conn.servername = servername;
  conn.serviceport = serviceport;
  conn.service = service;

  // send peek at data too?
  srv.ws.send(Packer.packHeader(browserAddr, null, 'connection'), { binary: true });

  // TODO convert to read stream?
  conn.on('data', function (chunk) {
    //if (state.debug) { console.log('[pipeWs] client', cid, ' => srv', rid, chunk.byteLength, 'bytes'); }
    sendWs(chunk);
  });

  conn.on('error', function (err) {
    console.warn('[pipeWs] client', cid, 'connection error:', err);
  });

  conn.on('close', function (hadErr) {
    //if (state.debug) { console.log('[pipeWs] client', cid, 'closing'); }
    sendWs(null, hadErr ? 'error': 'end');
    delete srv.clients[cid];
  });

};
