'use strict';

var Packer = require('proxy-packer');

module.exports = function pipeWs(servername, service, conn, remote, serviceport) {
  var browserAddr = Packer.socketToAddr(conn);
  var cid = Packer.addrToId(browserAddr);
  browserAddr.service = service;
  browserAddr.serviceport = serviceport;
  browserAddr.name = servername;
  conn.tunnelCid = cid;
  var rid = Packer.socketToId(remote.upgradeReq.socket);

  //if (state.debug) { console.log('[pipeWs] client', cid, '=> remote', rid, 'for', servername, 'via', service); }

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
        console.warn('[pipeWs] remote', rid, ' => client', cid, 'error sending websocket message', err);
      }
    }
  }

  remote.clients[cid] = conn;

  conn.on('data', function (chunk) {
    //if (state.debug) { console.log('[pipeWs] client', cid, ' => remote', rid, chunk.byteLength, 'bytes'); }
    sendWs(chunk);
  });

  conn.on('error', function (err) {
    console.warn('[pipeWs] client', cid, 'connection error:', err);
  });

  conn.on('close', function (hadErr) {
    //if (state.debug) { console.log('[pipeWs] client', cid, 'closing'); }
    sendWs(null, hadErr ? 'error': 'end');
    delete remote.clients[cid];
  });

};
