'use strict';

var url = require('url');
var PromiseA = require('bluebird');
var jwt = require('jsonwebtoken');
var Packer = require('proxy-packer');

function timeoutPromise(duration) {
  return new PromiseA(function (resolve) {
    setTimeout(resolve, duration);
  });
}

var Devices = require('./lib/device-tracker');

module.exports.store = { Devices: Devices };
module.exports.create = function (state) {
  state.deviceLists = {};
  //var deviceLists = {};
  var activityTimeout = state.activityTimeout || 2*60*1000;
  var pongTimeout = state.pongTimeout || 10*1000;
  state.Devices = Devices;
  var onTcpConnection = require('./lib/unwrap-tls').createTcpConnectionHandler(state);

  function onWsConnection(ws, upgradeReq) {
    console.log(ws);
    var socketId = Packer.socketToId(upgradeReq.socket);
    var remotes = {};

    function logName() {
      var result = Object.keys(remotes).map(function (jwtoken) {
        return remotes[jwtoken].deviceId;
      }).join(';');

      return result || socketId;
    }
    function sendTunnelMsg(addr, data, service) {
      ws.send(Packer.pack(addr, data, service), {binary: true});
    }

    function getBrowserConn(cid) {
      var browserConn;
      Object.keys(remotes).some(function (jwtoken) {
        if (remotes[jwtoken].clients[cid]) {
          browserConn = remotes[jwtoken].clients[cid];
          return true;
        }
      });

      return browserConn;
    }
    function closeBrowserConn(cid) {
      var remote;
      Object.keys(remotes).some(function (jwtoken) {
        if (remotes[jwtoken].clients[cid]) {
          remote = remotes[jwtoken];
          return true;
        }
      });
      if (!remote) {
        return;
      }

      PromiseA.resolve().then(function () {
        var conn = remote.clients[cid];
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
        if (remote.clients[cid]) {
          console.warn(cid, 'browser connection still present after calling `end`');
          remote.clients[cid].destroy();
          return timeoutPromise(500);
        }
      }).then(function () {
        if (remote.clients[cid]) {
          console.error(cid, 'browser connection still present after calling `destroy`');
          delete remote.clients[cid];
        }
      }).catch(function (err) {
        console.warn('failed to close browser connection', cid, err);
      });
    }

    function addToken(jwtoken) {
      if (remotes[jwtoken]) {
        // return { message: "token sent multiple times", code: "E_TOKEN_REPEAT" };
        return null;
      }

      var token;
      try {
        token = jwt.verify(jwtoken, state.secret);
      } catch (e) {
        token = null;
      }

      if (!token) {
        return { message: "invalid access token", code: "E_INVALID_TOKEN" };
      }

      if (!Array.isArray(token.domains)) {
        if ('string' === typeof token.name) {
          token.domains = [ token.name ];
        }
      }

      if (!Array.isArray(token.domains) || !token.domains.length) {
        return { message: "invalid server name", code: "E_INVALID_NAME" };
      }
      if (token.domains.some(function (name) { return typeof name !== 'string'; })) {
        return { message: "invalid server name", code: "E_INVALID_NAME" };
      }

      // Add the custom properties we need to manage this remote, then add it to all the relevant
      // domains and the list of all this websocket's remotes.
      token.deviceId = (token.device && (token.device.id || token.device.hostname)) || token.domains.join(',');
      token.ws = ws;
      token.upgradeReq = upgradeReq;
      token.clients = {};

      token.pausedConns = [];
      ws._socket.on('drain', function () {
        // the websocket library has it's own buffer apart from node's socket buffer, but that one
        // is much more difficult to watch, so we watch for the lower level buffer to drain and
        // then check to see if the upper level buffer is still too full to write to. Note that
        // the websocket library buffer has something to do with compression, so I'm not requiring
        // that to be 0 before we start up again.
        if (ws.bufferedAmount > 128*1024) {
          return;
        }

        token.pausedConns.forEach(function (conn) {
          if (!conn.manualPause) {
            // console.log('resuming', conn.tunnelCid, 'now that the web socket has caught up');
            conn.resume();
          }
        });
        token.pausedConns.length = 0;
      });

      token.domains.forEach(function (domainname) {
        console.log('domainname', domainname);
        Devices.add(state.deviceLists, domainname, token);
      });
      remotes[jwtoken] = token;
      console.log("added token '" + token.deviceId + "' to websocket", socketId);
      return null;
    }

    function removeToken(jwtoken) {
      var remote = remotes[jwtoken];
      if (!remote) {
        return { message: 'specified token not present', code: 'E_INVALID_TOKEN'};
      }

      // Prevent any more browser connections being sent to this remote, and any existing
      // connections from trying to send more data across the connection.
      remote.domains.forEach(function (domainname) {
        Devices.remove(state.deviceLists, domainname, remote);
      });
      remote.ws = null;
      remote.upgradeReq = null;

      // Close all of the existing browser connections associated with this websocket connection.
      Object.keys(remote.clients).forEach(function (cid) {
        closeBrowserConn(cid);
      });
      delete remotes[jwtoken];
      console.log("removed token '" + remote.deviceId + "' from websocket", socketId);
      return null;
    }

    var firstToken;
    var authn = (upgradeReq.headers.authorization||'').split(/\s+/);
    if (authn[0] && 'basic' === authn[0].toLowerCase()) {
      try {
        authn = new Buffer(authn[1], 'base64').toString('ascii').split(':');
        firstToken = authn[1];
      } catch (err) { }
    }
    if (!firstToken) {
      firstToken = url.parse(upgradeReq.url, true).query.access_token;
    }
    if (firstToken) {
      var err = addToken(firstToken);
      if (err) {
        sendTunnelMsg(null, [0, err], 'control');
        ws.close();
        return;
      }
    }

    var commandHandlers = {
      add_token: addToken
    , delete_token: function (token) {
        if (token !== '*') {
          return removeToken(token);
        }
        var err;
        Object.keys(remotes).some(function (jwtoken) {
          err = removeToken(jwtoken);
          return err;
        });
        return err;
      }
    };

    var packerHandlers = {
      oncontrol: function (tun) {
        var cmd, err;
        try {
          cmd = JSON.parse(tun.data.toString());
        } catch (err) {}
        if (!Array.isArray(cmd) || typeof cmd[0] !== 'number') {
          var msg = 'received bad command "' + tun.data.toString() + '"';
          console.warn(msg, 'from websocket', socketId);
          sendTunnelMsg(null, [0, {message: msg, code: 'E_BAD_COMMAND'}], 'control');
          return;
        }

        if (cmd[0] < 0) {
          // We only ever send one command and we send it once, so we just hard coded the ID as 1.
          if (cmd[0] === -1) {
            if (cmd[1]) {
              console.log('received error response to hello from', socketId, cmd[1]);
            }
          }
          else {
            console.warn('received response to unknown command', cmd, 'from', socketId);
          }
          return;
        }

        if (cmd[0] === 0) {
          console.warn('received dis-associated error from', socketId, cmd[1]);
          return;
        }

        if (commandHandlers[cmd[1]]) {
          err = commandHandlers[cmd[1]].apply(null, cmd.slice(2));
        }
        else {
          err = { message: 'unknown command "'+cmd[1]+'"', code: 'E_UNKNOWN_COMMAND' };
        }

        sendTunnelMsg(null, [-cmd[0], err], 'control');
      }

    , onmessage: function (tun) {
        var cid = Packer.addrToId(tun);
        console.log("remote '" + logName() + "' has data for '" + cid + "'", tun.data.byteLength);

        var browserConn = getBrowserConn(cid);
        if (!browserConn) {
          sendTunnelMsg(tun, {message: 'no matching connection', code: 'E_NO_CONN'}, 'error');
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
          sendTunnelMsg(tun, browserConn.tunnelRead, 'pause');
          browserConn.remotePaused = true;

          browserConn.once('drain', function () {
            sendTunnelMsg(tun, browserConn.tunnelRead, 'resume');
            browserConn.remotePaused = false;
          });
        }
      }

    , onpause: function (tun) {
        var cid = Packer.addrToId(tun);
        console.log('[TunnelPause]', cid);
        var browserConn = getBrowserConn(cid);
        if (browserConn) {
          browserConn.manualPause = true;
          browserConn.pause();
        } else {
          sendTunnelMsg(tun, {message: 'no matching connection', code: 'E_NO_CONN'}, 'error');
        }
      }

    , onresume: function (tun) {
        var cid = Packer.addrToId(tun);
        console.log('[TunnelResume]', cid);
        var browserConn = getBrowserConn(cid);
        if (browserConn) {
          browserConn.manualPause = false;
          browserConn.resume();
        } else {
          sendTunnelMsg(tun, {message: 'no matching connection', code: 'E_NO_CONN'}, 'error');
        }
      }

    , onend: function (tun) {
        var cid = Packer.addrToId(tun);
        console.log('[TunnelEnd]', cid);
        closeBrowserConn(cid);
      }
    , onerror: function (tun) {
        var cid = Packer.addrToId(tun);
        console.log('[TunnelError]', cid, tun.message);
        closeBrowserConn(cid);
      }
    };
    var unpacker = Packer.create(packerHandlers);

    var lastActivity = Date.now();
    var timeoutId;
    function refreshTimeout() {
      lastActivity = Date.now();
    }
    function checkTimeout() {
      // Determine how long the connection has been "silent", ie no activity.
      var silent = Date.now() - lastActivity;

      // If we have had activity within the last activityTimeout then all we need to do is
      // call this function again at the soonest time when the connection could be timed out.
      if (silent < activityTimeout) {
        timeoutId = setTimeout(checkTimeout, activityTimeout-silent);
      }

      // Otherwise we check to see if the pong has also timed out, and if not we send a ping
      // and call this function again when the pong will have timed out.
      else if (silent < activityTimeout + pongTimeout) {
        console.log('pinging', logName());
        try {
          ws.ping();
        } catch (err) {
          console.warn('failed to ping home cloud', logName());
        }
        timeoutId = setTimeout(checkTimeout, pongTimeout);
      }

      // Last case means the ping we sent before didn't get a response soon enough, so we
      // need to close the websocket connection.
      else {
        console.log('home cloud', logName(), 'connection timed out');
        ws.close(1013, 'connection timeout');
      }
    }
    timeoutId = setTimeout(checkTimeout, activityTimeout);

    // Note that our websocket library automatically handles pong responses on ping requests
    // before it even emits the event.
    ws.on('ping', refreshTimeout);
    ws.on('pong', refreshTimeout);
    ws.on('message', function forwardMessage(chunk) {
      refreshTimeout();
      console.log('message from home cloud to tunneler to browser', chunk.byteLength);
      //console.log(chunk.toString());
      unpacker.fns.addChunk(chunk);
    });

    function hangup() {
      clearTimeout(timeoutId);
      console.log('home cloud', logName(), 'connection closing');
      Object.keys(remotes).forEach(function (jwtoken) {
        removeToken(jwtoken);
      });
      ws.terminate();
    }

    ws.on('close', hangup);
    ws.on('error', hangup);

    // We only ever send one command and we send it once, so we just hard code the ID as 1
    sendTunnelMsg(null, [1, 'hello', [unpacker._version], Object.keys(commandHandlers)], 'control');
  }

  return {
    tcp: onTcpConnection
  , ws: onWsConnection
  , isClientDomain: Devices.exist.bind(null, state.deviceLists)
  };
};
