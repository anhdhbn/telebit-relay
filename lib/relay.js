'use strict';

var Packer = require('proxy-packer');
var Devices = require('./device-tracker');
var Server = require('./server.js');

module.exports.store = { Devices: Devices };
module.exports.create = function (state) {
  state.deviceLists = { _domains: {}, _devices: {} };
  state.deviceCallbacks = {};
  state.srvs = {};

  if (!parseInt(state.activityTimeout, 10)) {
    state.activityTimeout = 2 * 60 * 1000;
  }
  if (!parseInt(state.pongTimeout, 10)) {
    state.pongTimeout = 10 * 1000;
  }
  state.Devices = Devices;

  // TODO Use a Single TCP Handler
  // Issues:
  //   * dynamic ports are dedicated to a device or cluster
  //   * servernames could come in on ports that belong to a different device
  //   * servernames could come in that belong to no device
  //   * this could lead to an attack / security vulnerability with ACME certificates
  // Solutions
  //   * Restrict dynamic ports to a particular device
  //   * Restrict the use of servernames

  function onWsConnection(_ws, _upgradeReq) {
    var srv = {};
    var initToken;
    srv.ws = _ws;
    srv.upgradeReq = _upgradeReq;
    // TODO use device's ECDSA thumbprint as device id
    srv.id  = null;
    srv.socketId = Packer.socketToId(srv.upgradeReq.socket);
    srv.grants = {};
    srv.clients = {};
    srv.domainsMap = {};
    srv.portsMap = {};
    srv.pausedConns = [];
    srv.domains = [];
    srv.ports = [];

    if (state.debug) { console.log('[ws] connection', srv.socketId); }

    initToken = Server.parseAuth(state, srv);

    srv.ws._socket.on('drain', function () {
      // the websocket library has it's own buffer apart from node's socket buffer, but that one
      // is much more difficult to watch, so we watch for the lower level buffer to drain and
      // then check to see if the upper level buffer is still too full to write to. Note that
      // the websocket library buffer has something to do with compression, so I'm not requiring
      // that to be 0 before we start up again.
      if (srv.ws.bufferedAmount > 128*1024) {
        return;
      }

      srv.pausedConns.forEach(function (conn) {
        if (!conn.manualPause) {
          // console.log('resuming', conn.tunnelCid, 'now that the web socket has caught up');
          conn.resume();
        }
      });
      srv.pausedConns.length = 0;
    });

    if (initToken) {
      console.log('[wss.onConnection] token provided in http headers');
      return Server.addToken(state, srv, initToken).then(function () {
        Server.init(state, srv);
      }).catch(function (err) {
        Server.sendTunnelMsg(srv, null, [0, err], 'control');
        srv.ws.close();
      });
    } else {
      return Server.init(state, srv);
    }
  }

  return {
    tcp: require('./unwrap-tls').createTcpConnectionHandler(state)
  , ws: onWsConnection
  , isClientDomain: Devices.exist.bind(null, state.deviceLists)
  };
};
