'use strict';

var sni = require('sni');
var url = require('url');
var jwt = require('jsonwebtoken');
var packer = require('tunnel-packer');

var Devices = {};
Devices.add = function (store, servername, newDevice) {
  var devices = Devices.list(store, servername);
  devices.push(newDevice);
  store[servername] = devices;
};
Devices.remove = function (store, servername, device) {
  var devices = Devices.list(store, servername);
  var index = devices.indexOf(device);

  if (index < 0) {
    var id = device.deviceId || device.servername || device.id;
    console.warn('attempted to remove non-present device', id, 'from', servername);
    return null;
  }
  return devices.splice(index, 1)[0];
};
Devices.list = function (store, servername) {
  return store[servername] || [];
};
Devices.exist = function (store, servername) {
  return (store[servername] || []).length;
};
Devices.next = function (store, servername) {
  var devices = Devices.list(store, servername);
  var device;

  if (devices._index >= devices.length) {
    devices._index = 0;
  }
  device = devices[devices._index || 0];
  devices._index = (devices._index || 0) + 1;

  return device;
};

module.exports.store = { Devices: Devices };
module.exports.create = function (copts) {
  var deviceLists = {};
  var activityTimeout = copts.activityTimeout || 2*60*1000;
  var pongTimeout = copts.pongTimeout || 10*1000;

  function onWsConnection(ws) {
    var location = url.parse(ws.upgradeReq.url, true);
    var authn = (ws.upgradeReq.headers.authorization||'').split(/\s+/);
    var jwtoken;
    var token;

    try {
      if (authn[0]) {
        if ('basic' === authn[0].toLowerCase()) {
          authn = new Buffer(authn[1], 'base64').toString('ascii').split(':');
        }
        /*
        if (-1 !== [ 'bearer', 'jwk' ].indexOf(authn[0].toLowerCase())) {
          jwtoken = authn[1];
        }
        */
      }
      jwtoken = authn[1] || location.query.access_token;
    } catch(e) {
      jwtoken = null;
    }

    try {
      token = jwt.verify(jwtoken, copts.secret);
    } catch(e) {
      token = null;
    }

    /*
    if (!token || !token.name) {
      console.log('location, token');
      console.log(location.query.access_token);
      console.log(token);
    }
    */

    if (!token) {
      ws.send(JSON.stringify({ error: { message: "invalid access token", code: "E_INVALID_TOKEN" } }));
      ws.close();
      return;
    }

    //console.log('[wstunneld.js] DEBUG', token);

    if (!Array.isArray(token.domains)) {
      if ('string' === typeof token.name) {
        token.domains = [ token.name ];
      }
    }

    if (!Array.isArray(token.domains)) {
      ws.send(JSON.stringify({ error: { message: "invalid server name", code: "E_INVALID_NAME" } }));
      ws.close();
      return;
    }

    var remote = {};
    remote.ws = ws;
    remote.servername = (token.device && token.device.hostname) || token.domains.join(',');
    remote.deviceId = (token.device && token.device.id) || null;
    remote.id = packer.socketToId(ws.upgradeReq.socket);
    console.log("remote.id", remote.id);
    remote.domains = token.domains;
    remote.clients = {};
    // TODO allow tls to be decrypted by server if client is actually a browser
    // and we haven't implemented tls in the browser yet
    // remote.decrypt = token.decrypt;

    var handlers = {
      onmessage: function (opts) {
        // opts.data
        var cid = packer.addrToId(opts);
        var cstream = remote.clients[cid];

        console.log("remote '" + remote.servername + " : " + remote.id + "' has data for '" + cid + "'", opts.data.byteLength);

        if (!cstream) {
          remote.ws.send(packer.pack(opts, null, 'error'));
          return;
        }

        cstream.browser.write(opts.data);
      }
    , onend: function (opts) {
        var cid = packer.addrToId(opts);
        console.log('[TunnelEnd]', cid);
        handlers._onend(cid);
      }
    , onerror: function (opts) {
        var cid = packer.addrToId(opts);
        console.log('[TunnelError]', cid);
        handlers._onend(cid);
      }
    , _onend: function (cid) {
        var c = remote.clients[cid];
        delete remote.clients[cid];
        try {
          c.browser.end();
        } catch(e) {
          // ignore
        }
        try {
          c.wrapped.end();
        } catch(e) {
          // ignore
        }
      }
    };
    remote.unpacker = packer.create(handlers);

    // Now that we have created our remote object we need to store it in the deviceList for
    // each domainname we are supposed to be handling.
    token.domains.forEach(function (domainname) {
      console.log('domainname', domainname);
      Devices.add(deviceLists, domainname, remote);
    });

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
        console.log('pinging', remote.deviceId || remote.servername);
        try {
          remote.ws.ping();
        } catch (err) {
          console.warn('failed to ping home cloud', remote.deviceId || remote.servername);
        }
        timeoutId = setTimeout(checkTimeout, pongTimeout);
      }

      // Last case means the ping we sent before didn't get a response soon enough, so we
      // need to close the websocket connection.
      else {
        console.log('home cloud', remote.deviceId || remote.servername, 'connection timed out');
        remote.ws.close(1013, 'connection timeout');
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
      remote.unpacker.fns.addChunk(chunk);
    });

    function hangup() {
      clearTimeout(timeoutId);
      console.log('home cloud', remote.deviceId || remote.servername, 'connection closing');
      // the remote will handle closing its local connections
      Object.keys(remote.clients).forEach(function (cid) {
        try {
          remote.clients[cid].browser.end();
        } catch(e) {
          // ignore
        }
      });
      token.domains.forEach(function (domainname) {
        Devices.remove(deviceLists, domainname, remote);
      });
    }

    ws.on('close', hangup);
    ws.on('error', hangup);
  }

  function pipeWs(servername, service, browser, remote) {
    console.log('pipeWs');

    //var remote = deviceLists[servername];
    var ws = remote.ws;
    //var address = packer.socketToAddr(ws.upgradeReq.socket);
    var baddress = packer.socketToAddr(browser);
    var cid = packer.addrToId(baddress);
    console.log('servername:', servername);
    console.log('service:', service);
    baddress.service = service;
    var wrapForRemote = packer.Transform.create({
      id: cid
    //, remoteId: remote.id
    , address: baddress
    , servername: servername
    , service: service
    });
    console.log('home-cloud is', packer.socketToId(remote.ws.upgradeReq.socket));
    console.log('browser is', cid);
    var bstream = remote.clients[cid] = {
      wrapped: browser.pipe(wrapForRemote)
    , browser: browser
    , address: baddress
    };
    //var bstream = remote.clients[cid] = wrapForRemote.pipe(browser);
    bstream.wrapped.on('data', function (pchunk) {
      // var chunk = socket.read();
      console.log('[bstream] data from browser to tunneler', pchunk.byteLength);
      //console.log(JSON.stringify(pchunk.toString()));
      try {
        ws.send(pchunk, { binary: true });
      } catch(e) {
        try {
          bstream.browser.end();
        } catch(e) {
          // ignore
        }
      }
    });
    bstream.wrapped.on('error', function (err) {
      console.error('[error] bstream.wrapped.error');
      console.error(err);
      try {
        ws.send(packer.pack(baddress, null, 'error'), { binary: true });
      } catch(e) {
        // ignore
      }
      try {
        bstream.browser.end();
      } catch(e) {
        // ignore
      }
      delete remote.clients[cid];
    });
    bstream.wrapped.on('end', function () {
      try {
        ws.send(packer.pack(baddress, null, 'end'), { binary: true });
      } catch(e) {
        // ignore
      }
      try {
        bstream.browser.end();
      } catch(e) {
        // ignore
      }
      delete remote.clients[cid];
    });
  }

  function onTcpConnection(browser) {
    // this works when I put it here, but I don't know if it's tls yet here
    // httpsServer.emit('connection', socket);
    //tls3000.emit('connection', socket);

    //var tlsSocket = new tls.TLSSocket(socket, { secureContext: tls.createSecureContext(tlsOpts) });
    //tlsSocket.on('data', function (chunk) {
    //  console.log('dummy', chunk.byteLength);
    //});

    //return;
    browser.once('data', function (firstChunk) {
      // BUG XXX: this assumes that the packet won't be chunked smaller
      // than the 'hello' or the point of the 'Host' header.
      // This is fairly reasonable, but there are edge cases where
      // it does not hold (such as manual debugging with telnet)
      // and so it should be fixed at some point in the future

      // defer after return (instead of being in many places)
      process.nextTick(function () {
        browser.unshift(firstChunk);
      });

      var service = 'tcp';
      var servername;
      var str;
      var m;

      function tryTls() {
        if (-1 !== copts.servernames.indexOf(servername)) {
          console.log("Lock and load, admin interface time!");
          copts.httpsTunnel(servername, browser);
          return;
        }

        if (!servername) {
          console.log("No SNI was given, so there's nothing we can do here");
          copts.httpsInvalid(servername, browser);
          return;
        }

        var nextDevice = Devices.next(deviceLists, servername);
        if (!nextDevice) {
          console.log("No devices match the given servername");
          copts.httpsInvalid(servername, browser);
          return;
        }

        console.log("pipeWs(servername, service, socket, deviceLists['" + servername + "'])");
        pipeWs(servername, service, browser, nextDevice);
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
          service = 'http';
          // TODO disallow http entirely
          // /^\/\.well-known\/acme-challenge\//.test(str)
          if (/well-known/.test(str)) {
            // HTTP
            if (Devices.exist(deviceLists, servername)) {
              pipeWs(servername, service, browser, Devices.next(deviceLists, servername));
              return;
            }
            copts.handleHttp(servername, browser);
          }
          else {
            // redirect to https
            copts.handleInsecureHttp(servername, browser);
          }
          return;
        }
      }

      console.error("Got unexpected connection", str);
      browser.write(JSON.stringify({ error: {
        message: "not sure what you were trying to do there..."
      , code: 'E_INVALID_PROTOCOL' }
      }));
      browser.end();
    });
    browser.on('error', function (err) {
      console.error('[error] tcp socket raw TODO forward and close');
      console.error(err);
    });

  }

  return { tcp: onTcpConnection, ws: onWsConnection };
};
