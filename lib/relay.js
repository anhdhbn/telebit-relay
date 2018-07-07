'use strict';

var url = require('url');
var sni = require('sni');
var Packer = require('proxy-packer');
var PortServers = {};
var PromiseA;
try {
  PromiseA = require('bluebird');
} catch(e) {
  PromiseA = global.Promise;
}

function timeoutPromise(duration) {
  return new PromiseA(function (resolve) {
    setTimeout(resolve, duration);
  });
}

var Devices = require('./device-tracker');
var pipeWs = require('./pipe-ws.js');

var Server = {
  _initCommandHandlers: function (state, srv) {
    var commandHandlers = {
      add_token: function addToken(newAuth) {
        return Server.addToken(state, srv, newAuth);
      }
    , delete_token: function (token) {
        return state.Promise.resolve(function () {
          var err;

          if (token !== '*') {
            err = Server.removeToken(state, srv, token);
            if (err) { return state.Promise.reject(err); }
          }

          Object.keys(srv.grants).some(function (jwtoken) {
            err = Server.removeToken(state, srv, jwtoken);
            return err;
          });
          if (err) { return state.Promise.reject(err); }

          return null;
        });
      }
    };
    commandHandlers.auth = commandHandlers.add_token;
    commandHandlers.authn = commandHandlers.add_token;
    commandHandlers.authz = commandHandlers.add_token;
    srv._commandHandlers = commandHandlers;
  }
, _initPackerHandlers: function (state, srv) {
    var packerHandlers = {
      oncontrol: function (tun) {
        var cmd;
        try {
          cmd = JSON.parse(tun.data.toString());
        } catch (e) {}
        if (!Array.isArray(cmd) || typeof cmd[0] !== 'number') {
          var msg = 'received bad command "' + tun.data.toString() + '"';
          console.warn(msg, 'from websocket', srv.socketId);
          Server.sendTunnelMsg(srv, null, [0, {message: msg, code: 'E_BAD_COMMAND'}], 'control');
          return;
        }

        if (cmd[0] < 0) {
          // We only ever send one command and we send it once, so we just hard coded the ID as 1.
          if (cmd[0] === -1) {
            if (cmd[1]) {
              console.warn('received error response to hello from', srv.socketId, cmd[1]);
            }
          }
          else {
            console.warn('received response to unknown command', cmd, 'from', srv.socketId);
          }
          return;
        }

        if (cmd[0] === 0) {
          console.warn('received dis-associated error from', srv.socketId, cmd[1]);
          return;
        }

        function onSuccess() {
          Server.sendTunnelMsg(srv, null, [-cmd[0], null], 'control');
        }
        function onError(err) {
          Server.sendTunnelMsg(srv, null, [-cmd[0], err], 'control');
        }

        if (!srv._commandHandlers[cmd[1]]) {
          onError({ message: 'unknown command "'+cmd[1]+'"', code: 'E_UNKNOWN_COMMAND' });
          return;
        }

        console.log('command:', cmd[1], cmd.slice(2));
        return srv._commandHandlers[cmd[1]].apply(null, cmd.slice(2)).then(onSuccess, onError);
      }

    , onmessage: function (tun) {
        var cid = Packer.addrToId(tun);
        if (state.debug) { console.log("remote '" + Server.logName(state, srv) + "' has data for '" + cid + "'", tun.data.byteLength); }

        var browserConn = Server.getBrowserConn(state, srv, cid);
        if (!browserConn) {
          Server.sendTunnelMsg(srv, tun, {message: 'no matching connection', code: 'E_NO_CONN'}, 'error');
          return;
        }

        browserConn.write(tun.data);
        // tunnelRead is how many bytes we've read from the tunnel, and written to the browser.
        browserConn.tunnelRead = (browserConn.tunnelRead || 0) + tun.data.byteLength;
        // If we have more than 1MB buffered data we need to tell the other side to slow down.
        // Once we've finished sending what we have we can tell the other side to keep going.
        // If we've already sent the 'pause' message though don't send it again, because we're
        // probably just dealing with data queued before our message got to them.
        if (!browserConn.remotePaused && browserConn.bufferSize > 1024*1024) {
          Server.sendTunnelMsg(srv, tun, browserConn.tunnelRead, 'pause');
          browserConn.remotePaused = true;

          browserConn.once('drain', function () {
            Server.sendTunnelMsg(srv, tun, browserConn.tunnelRead, 'resume');
            browserConn.remotePaused = false;
          });
        }
      }

    , onpause: function (tun) {
        var cid = Packer.addrToId(tun);
        console.log('[TunnelPause]', cid);
        var browserConn = Server.getBrowserConn(state, srv, cid);
        if (browserConn) {
          browserConn.manualPause = true;
          browserConn.pause();
        } else {
          Server.sendTunnelMsg(srv, tun, {message: 'no matching connection', code: 'E_NO_CONN'}, 'error');
        }
      }

    , onresume: function (tun) {
        var cid = Packer.addrToId(tun);
        console.log('[TunnelResume]', cid);
        var browserConn = Server.getBrowserConn(state, srv, cid);
        if (browserConn) {
          browserConn.manualPause = false;
          browserConn.resume();
        } else {
          Server.sendTunnelMsg(srv, tun, {message: 'no matching connection', code: 'E_NO_CONN'}, 'error');
        }
      }

    , onend: function (tun) {
        var cid = Packer.addrToId(tun);
        console.log('[TunnelEnd]', cid);
        Server.closeBrowserConn(state, srv, cid);
      }
    , onerror: function (tun) {
        var cid = Packer.addrToId(tun);
        console.warn('[TunnelError]', cid, tun.message);
        Server.closeBrowserConn(state, srv, cid);
      }
    };
    srv._packerHandlers = packerHandlers;
    srv.unpacker = Packer.create(srv._packerHandlers);
  }
, _initSocketHandlers: function (state, srv) {
    function refreshTimeout() {
      srv.lastActivity = Date.now();
    }

    function checkTimeout() {
      // Determine how long the connection has been "silent", ie no activity.
      var silent = Date.now() - srv.lastActivity;

      // If we have had activity within the last activityTimeout then all we need to do is
      // call this function again at the soonest time when the connection could be timed out.
      if (silent < state.activityTimeout) {
        srv.timeoutId = setTimeout(checkTimeout, state.activityTimeout - silent);
      }

      // Otherwise we check to see if the pong has also timed out, and if not we send a ping
      // and call this function again when the pong will have timed out.
      else if (silent < state.activityTimeout + state.pongTimeout) {
        if (state.debug) { console.log('pinging', Server.logName(state, srv)); }
        try {
          srv.ws.ping();
        } catch (err) {
          console.warn('failed to ping home cloud', Server.logName(state, srv));
        }
        srv.timeoutId = setTimeout(checkTimeout, state.pongTimeout);
      }

      // Last case means the ping we sent before didn't get a response soon enough, so we
      // need to close the websocket connection.
      else {
        console.warn('home cloud', Server.logName(state, srv), 'connection timed out');
        srv.ws.close(1013, 'connection timeout');
      }
    }

    function forwardMessage(chunk) {
      refreshTimeout();
      if (state.debug) { console.log('[ws] device => client : demultiplexing message ', chunk.byteLength, 'bytes'); }
      //console.log(chunk.toString());
      srv.unpacker.fns.addChunk(chunk);
    }

    function hangup() {
      clearTimeout(srv.timeoutId);
      console.log('[ws] device hangup', Server.logName(state, srv), 'connection closing');
      Object.keys(srv.grants).forEach(function (jwtoken) {
        Server.removeToken(state, srv, jwtoken);
      });
      srv.ws.terminate();
    }

    srv.lastActivity = Date.now();
    srv.timeoutId = null;
    srv.timeoutId = setTimeout(checkTimeout, state.activityTimeout);

    // Note that our websocket library automatically handles pong responses on ping requests
    // before it even emits the event.
    srv.ws.on('ping', refreshTimeout);
    srv.ws.on('pong', refreshTimeout);
    srv.ws.on('message', forwardMessage);
    srv.ws.on('close', hangup);
    srv.ws.on('error', hangup);
  }
, init: function init(state, srv) {
    Server._initCommandHandlers(state, srv);
    Server._initPackerHandlers(state, srv);
    Server._initSocketHandlers(state, srv);

    // Status Code '1' for Status 'hello'
    Server.sendTunnelMsg(srv, null, [1, 'hello', [srv.unpacker._version], Object.keys(srv._commandHandlers)], 'control');
  }
, sendTunnelMsg: function sendTunnelMsg(srv, addr, data, service) {
    srv.ws.send(Packer.pack(addr, data, service), {binary: true});
  }
, logName: function logName(state, srv) {
    var result = Object.keys(srv.grants).map(function (jwtoken) {
      return srv.grants[jwtoken].currentDesc;
    }).join(';');

    return result || srv.socketId;
  }
, onAuth: function onAuth(state, srv, rawAuth, grant) {
    console.log('\n[relay.js] onAuth');
    console.log(rawAuth);
    //console.log(grant);
    //var stringauth;
    var err;
    if (!grant || 'object' !== typeof grant) {
      console.log('[relay.js] invalid token', grant);
      err = new Error("invalid access token");
      err.code = "E_INVALID_TOKEN";
      return state.Promise.reject(err);
    }

    if ('string' !== typeof rawAuth) {
      rawAuth = JSON.stringify(rawAuth);
    }

    // TODO don't fire the onAuth event on non-authz updates
    if (!grant.jwt && !(grant.domains||[]).length && !(grant.ports||[]).length) {
      console.log("[onAuth] nothing to offer at all");
      return null;
    }

    console.log('[onAuth] check for upgrade token');
    //console.log(grant);
    if (grant.jwt) {
      if (rawAuth !== grant.jwt) {
        console.log('[onAuth] new token to send back');
      }
      // TODO only send token when new
      if (true) {
        // Access Token
        Server.sendTunnelMsg(
          srv
        , null
        , [ 3
          , 'access_token'
          , { jwt: grant.jwt }
          ]
        , 'control'
        );
        // these aren't needed internally once they're sent
        grant.jwt = null;
      }
    }

    /*
    if (!Array.isArray(grant.domains) || !grant.domains.length) {
      err = new Error("invalid domains array");
      err.code = "E_INVALID_NAME";
      return state.Promise.reject(err);
    }
    */
    if (grant.domains.some(function (name) { return typeof name !== 'string'; })) {
      console.log('bad domain names');
      err = new Error("invalid domain name(s)");
      err.code = "E_INVALID_NAME";
      return state.Promise.reject(err);
    }

    console.log('[onAuth] strolling through pleasantries');
    // Add the custom properties we need to manage this remote, then add it to all the relevant
    // domains and the list of all this websocket's grants.
    grant.domains.forEach(function (domainname) {
      console.log('add', domainname, 'to device lists');
      srv.domainsMap[domainname] = true;
      Devices.add(state.deviceLists, domainname, srv);
      // TODO allow subs to go to individual devices
      Devices.alias(state.deviceLists, domainname, '*.' + domainname);
    });
    srv.domains = Object.keys(srv.domainsMap);
    srv.currentDesc = (grant.device && (grant.device.id || grant.device.hostname)) || srv.domains.join(',');
    grant.currentDesc = (grant.device && (grant.device.id || grant.device.hostname)) || grant.domains.join(',');
    //grant.srv = srv;
    //grant.ws = srv.ws;
    //grant.upgradeReq = srv.upgradeReq;
    grant.clients = {};

    if (!grant.ports) { grant.ports = []; }

    function openPort(serviceport) {
      function tcpListener(conn) {
        Server.onDynTcpConn(state, srv, srv.portsMap[serviceport], conn);
      }
      serviceport = parseInt(serviceport, 10) || 0;
      if (!serviceport) {
        // TODO error message about bad port
        return;
      }
      if (PortServers[serviceport]) {
        console.log('reuse', serviceport, 'for this connection');
        //grant.ports = [];
        srv.portsMap[serviceport] = PortServers[serviceport];
        srv.portsMap[serviceport].on('connection', tcpListener);
        srv.portsMap[serviceport].tcpListener = tcpListener;
        Devices.add(state.deviceLists, serviceport, srv);
      } else {
        try {
          console.log('use new', serviceport, 'for this connection');
          srv.portsMap[serviceport] = PortServers[serviceport] = require('net').createServer(tcpListener);
          srv.portsMap[serviceport].tcpListener = tcpListener;
          srv.portsMap[serviceport].listen(serviceport, function () {
            console.info('[DynTcpConn] Port', serviceport, 'now open for', grant.currentDesc);
            Devices.add(state.deviceLists, serviceport, srv);
          });
          srv.portsMap[serviceport].on('error', function (e) {
            // TODO try again with random port
            console.error("Server Error assigning a dynamic port to a new connection:", e);
          });
        } catch(e) {
          // what a wonderful problem it will be the day that this bug needs to be fixed
          // (i.e. there are enough users to run out of ports)
          console.error("Error assigning a dynamic port to a new connection:", e);
        }
      }
    }
    grant.ports.forEach(openPort);

    srv.grants[rawAuth] = grant;
    console.info("[ws] authorized", srv.socketId, "for", grant.currentDesc);

    console.log('notify of grants', grant.domains, grant.ports);
    Server.sendTunnelMsg(
      srv
    , null
    , [ 2
      , 'grant'
      , [ ['ssh+https', grant.domains[0], 443 ]
        , ['ssh', 'ssh.' + state.config.sharedDomain, grant.ports ]
        , ['tcp', 'tcp.' + state.config.sharedDomain, grant.ports ]
        , ['https', grant.domains[0] ]
        ]
      ]
    , 'control'
    );
    return null;
  }
, onDynTcpConn: function onDynTcpConn(state, srv, server, conn) {
    var serviceport = server.address().port;
    console.log('[DynTcpConn] new connection on', serviceport);
    var nextDevice = Devices.next(state.deviceLists, serviceport);

    if (!nextDevice) {
      conn.write("[Sanity Error] I've got a blank space baby, but nowhere to write your name.");
      conn.end();
      try {
        server.close();
      } catch(e) {
        console.error("[DynTcpConn] failed to close server:", e);
      }
      return;
    }

    conn.once('data', function (firstChunk) {
      if (state.debug) { console.log("[DynTcp]", serviceport, "examining firstChunk from", Packer.socketToId(conn)); }
      conn.pause();
      //conn.unshift(firstChunk);
      conn._handle.onread(firstChunk.length, firstChunk);

      var servername;
      var hostname;
      var str;
      var m;

      if (22 === firstChunk[0]) {
        servername = (sni(firstChunk)||'').toLowerCase();
      } else if (firstChunk[0] > 32 && firstChunk[0] < 127) {
        str = firstChunk.toString();
        m = str.match(/(?:^|[\r\n])Host: ([^\r\n]+)[\r\n]*/im);
        hostname = (m && m[1].toLowerCase() || '').split(':')[0];
      }

      if (servername || hostname) {
        if (servername) {
          conn.write("TLS with sni is allowed only on standard ports. If you've registered '" + servername + "' use port 443.");
        } else {
          conn.write("HTTP with Host headers is not allowed on dynamic ports. If you've registered '" + hostname + "' use port 80.");
        }
        conn.end();
        return;
      }

      // pipeWs(servername, servicename, srv, client, serviceport)
      // remote.clients is managed as part of the piping process
      if (state.debug) { console.log("[DynTcp]", serviceport, "piping to srv (via loadbal)"); }
      pipeWs(null, 'tcp', nextDevice, conn, serviceport);

      process.nextTick(function () { conn.resume(); });
    });
  }
, addToken: function addToken(state, srv, rawAuth) {
    console.log("[addToken]", rawAuth);
    if (srv.grants[rawAuth]) {
      console.log("addToken - duplicate");
      // return { message: "token sent multiple times", code: "E_TOKEN_REPEAT" };
      return state.Promise.resolve(null);
    }

    return state.authenticate({ auth: rawAuth }).then(function (validatedTokenData) {
      console.log('\n[relay.js] rawAuth');
      console.log(rawAuth);

      console.log('\n[relay.js] authnToken');
      console.log(validatedTokenData);

      // For tracking state between token exchanges
      // and tacking on extra attributes (i.e. for extensions)
      // TODO close on delete
      if (!state.srvs[validatedTokenData.id]) {
        state.srvs[validatedTokenData.id] = {};
      }
      if (!state.srvs[validatedTokenData.id].updateAuth) {
        // be sure to always pass latest srv since the connection may change
        // and reuse the same token
        state.srvs[validatedTokenData.id].updateAuth = function (srv, validatedTokenData) {
          return Server.onAuth(state, srv, rawAuth, validatedTokenData);
        };
      }
      state.srvs[validatedTokenData.id].updateAuth(srv, validatedTokenData);
    });
  }
, removeToken: function removeToken(state, srv, jwtoken) {
    var grant = srv.grants[jwtoken];
    if (!grant) {
      return { message: 'specified token not present', code: 'E_INVALID_TOKEN'};
    }

    // Prevent any more browser connections for this grant being sent to this srv,
    // and any existing connections from trying to send more data across the connection.
    grant.domains.forEach(function (domainname) {
      Devices.remove(state.deviceLists, domainname, srv);
    });
    grant.ports.forEach(function (portnumber) {
      Devices.remove(state.deviceLists, portnumber, srv);
      if (!srv.portsMap[portnumber]) { return; }
      try {
        srv.portsMap[portnumber].close(function () {
          console.log("[DynTcpConn] closing server for ", portnumber);
          delete srv.portsMap[portnumber];
          delete PortServers[portnumber];
        });
      } catch(e) { /*ignore*/ }
    });

    // Close all of the existing browser connections associated with this websocket connection.
    Object.keys(grant.clients).forEach(function (cid) {
      Server.closeBrowserConn(state, srv, cid);
    });
    delete srv.grants[jwtoken];
    console.log("[ws] removed token '" + grant.currentDesc + "' from", srv.socketId);
    return null;
  }
, getBrowserConn: function getBrowserConn(state, srv, cid) {
    return srv.clients[cid];
  }
, closeBrowserConn: function closeBrowserConn(state, srv, cid) {
    if (!srv.clients[cid]) {
      return;
    }

    PromiseA.resolve().then(function () {
      var conn = srv.clients[cid];
      conn.tunnelClosing = true;
      conn.end();

      // If no data is buffered for writing then we don't need to wait for it to drain.
      if (!conn.bufferSize) {
        return timeoutPromise(500);
      }
      // Otherwise we want the connection to be able to finish, but we also want to impose
      // a time limit for it to drain, since it shouldn't have more than 1MB buffered.
      return new PromiseA(function (resolve) {
        var timeoutId = setTimeout(resolve, 60*1000);
        conn.once('drain', function () {
          clearTimeout(timeoutId);
          setTimeout(resolve, 500);
        });
      });
    }).then(function () {
      if (srv.clients[cid]) {
        console.warn(cid, 'browser connection still present after calling `end`');
        srv.clients[cid].destroy();
        return timeoutPromise(500);
      }
    }).then(function () {
      if (srv.clients[cid]) {
        console.error(cid, 'browser connection still present after calling `destroy`');
        delete srv.clients[cid];
      }
    }).catch(function (err) {
      console.warn('failed to close browser connection', cid, err);
    });
  }
, parseAuth: function parseAuth(state, srv) {
    var authn = (srv.upgradeReq.headers.authorization||'').split(/\s+/);
    if (authn[0] && 'basic' === authn[0].toLowerCase()) {
      try {
        authn = new Buffer(authn[1], 'base64').toString('ascii').split(':');
        return authn[1];
      } catch (err) { }
    }
    return url.parse(srv.upgradeReq.url, true).query.access_token;
  }
};

module.exports.store = { Devices: Devices };
module.exports.create = function (state) {
  state.deviceLists = {};
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
    srv.socketId = Packer.socketToId(srv.upgradeReq.socket);
    srv.grants = {};
    srv.clients = {};
    srv.domainsMap = {};
    srv.portsMap = {};
    srv.pausedConns = [];

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
