'use strict';

var net = require('net');
var tls = require('tls');
var http = require('http');
var sni = require('sni');
var url = require('url');
var jwt = require('jsonwebtoken');
var packer = require('tunnel-packer');
var WebSocketServer = require('ws').Server;

module.exports.create = function (copts) {

  function onWsConnection(ws) {
		var location = url.parse(ws.upgradeReq.url, true);
    //var token = jwt.decode(location.query.access_token);
    var token;

    try {
      token = jwt.verify(location.query.access_token, secret);
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

    var remote;
    token.domains.some(function (domainname) {
      remote = remotes[domainname];
      return remote;
    });
    remote = remote || {};
    token.domains.forEach(function (domainname) {
      console.log('domainname', domainname);
      remotes[domainname] = remote;
    });
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
    // TODO allow more than one remote per servername
    remote.ws = ws;
    remote.servername = token.domains.join(',');
    remote.id = packer.socketToId(ws.upgradeReq.socket);
    console.log("remote.id", remote.id);
    // TODO allow tls to be decrypted by server if client is actually a browser
    // and we haven't implemented tls in the browser yet
    remote.decrypt = token.decrypt;
    // TODO how to allow a child process to communicate with this one?
    remote.clients = {};
    remote.handle = { address: null, handle: null };
    remote.unpacker = packer.create(handlers);
    ws.on('message', function (chunk) {
      console.log('message from home cloud to tunneler to browser', chunk.byteLength);
      //console.log(chunk.toString());
      remote.unpacker.fns.addChunk(chunk);
    });
    ws.on('close', function () {
      // the remote will handle closing its local connections
      Object.keys(remote.clients).forEach(function (cid) {
        try {
          remote.clients[cid].browser.end();
        } catch(e) {
          // ignore
        }
      });
    });
    ws.on('error', function () {
      // ignore
      // the remote will retry if it wants to
    });

    //store.set(token.name, remote.handle);
	}

  function connectHttp(servername, socket) {
    console.log("connectHttp('" + servername + "', socket)");
    socket.__my_servername = servername;
    redirectServer.emit('connection', socket);
  }

  function connectHttps(servername, socket) {
    // none of these methods work:
    // httpsServer.emit('connection', socket);  // this didn't work
    // tlsServer.emit('connection', socket);    // this didn't work either
    //console.log('chunkLen', firstChunk.byteLength);

    var myDuplex = packer.Stream.create(socket);

    console.log('connectHttps servername', servername);
    tls3000.emit('connection', myDuplex);

    socket.on('data', function (chunk) {
      console.log('[' + Date.now() + '] socket data', chunk.byteLength);
      myDuplex.push(chunk);
    });
    socket.on('error', function (err) {
      console.error('[error] connectHttps TODO close');
      console.error(err);
    });
  }

  function pipeWs(servername, service, browser, remote) {
    console.log('pipeWs');

    //var remote = remotes[servername];
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
        if (!servername || (-1 !== selfnames.indexOf(servername)) || !remotes[servername]) {
          console.log('this is a server or an unknown');
          connectHttps(servername, browser);
          return;
        }

        console.log("pipeWs(servername, service, socket, remotes['" + servername + "'])");
        pipeWs(servername, service, browser, remotes[servername]);
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
          if (/^\/\.well-known\/acme-challenge\//.test(str)) {
            // HTTP
            if (remotes[servername]) {
              pipeWs(servername, service, browser, remotes[servername]);
              return;
            }
            connectHttp(servername, browser);
          }
          else {
            // redirect to https
            connectHttp(servername, browser);
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

  var tlsOpts = copts.tlsOptions;
  //var store = copts.store;

  var remotes = {};
  var selfnames = copts.servernames;
  var secret = copts.secret;
  var redirectHttps = require('redirect-https')();

  var redirectServer = http.createServer(function (req, res) {
    res.setHeader('Connection', 'close');
    redirectHttps(req, res);
  });
  var httpServer = http.createServer(function (req, res) {
    console.log('req.socket.encrypted', req.socket.encrypted);
    res.end('Hello, World!');
  });
  var tls3000 = tls.createServer(tlsOpts, function (tlsSocket) {
    console.log('tls connection');
    // things get a little messed up here
    httpServer.emit('connection', tlsSocket);
  });
  var wss = new WebSocketServer({ server: httpServer });

	wss.on('connection', onWsConnection);

  copts.ports.forEach(function (port) {
    var tcp3000 = net.createServer();
    tcp3000.listen(port, function () {
      console.log('listening on ' + port);
    });
    tcp3000.on('connection', onTcpConnection);
  });

};
