'use strict';

var net = require('net');
var tls = require('tls');
var http = require('http');
var sni = require('sni');
var url = require('url');
var jwt = require('jsonwebtoken');
//var packer = require('tunnel-packer');
//var Transform = require('stream').Transform;
var tlsOpts = require('localhost.daplie.com-certificates').merge({});
var Duplex = require('stream').Duplex;
var WebSocketServer = require('ws').Server;





/*
 *
 * Tunnel Packer
 *
 */
var packer = require('tunnel-packer');

var Transform = require('stream').Transform;
var util = require('util');

function MyTransform(options) {
  if (!(this instanceof MyTransform)) {
    return new MyTransform(options);
  }
  this.__my_addr = options.address;
  this.__my_service = options.service;
  Transform.call(this, options);
}
util.inherits(MyTransform, Transform);
function transform(me, data, encoding, callback) {
  var address = me.__my_addr;

  address.service = address.service || me.__my_service;
  me.push(packer.pack(address, data));
  callback();
}
MyTransform.prototype._transform = function (data, encoding, callback) {
  return transform(this, data, encoding, callback);
};

function socketToAddr(socket) {
  return {
    family: socket.remoteFamily || socket._remoteFamily
  , address: socket.remoteAddress || socket._remoteAddress
  , port: socket.remotePort || socket._remotePort
  };
}

function addrToId(address) {
  return address.family + ',' + address.address + ',' + address.port;
}

function socketToId(socket) {
  return addrToId(socketToAddr(socket));
}





require('cluster-store').create().then(function (store) {
  var remotes = {};
  var selfname = 'pokemap.hellabit.com';
  var secret = 'shhhhh';

  var httpServer = http.createServer(function (req, res) {
    console.log('req.socket.encrypted', req.socket.encrypted);
    res.end('Hello, World!');
  });
  var wss = new WebSocketServer({ server: httpServer });
  var tcp3000 = net.createServer();

	wss.on('connection', function (ws) {
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

    if (!token.name) {
      ws.send(JSON.stringify({ error: { message: "invalid server name", code: "E_INVALID_NAME" } }));
      ws.close();
      return;
    }

    var remote = remotes[token.name] = remotes[token.name] || {};
    var handlers = {
      onmessage: function (opts) {
        // opts.data
        var cid = addrToId(opts);
        var cstream = remote.clients[cid];

        console.log("remote '" + remote.servername + " : " + remote.id + "' has data for '" + cid + "'", opts.data.byteLength);

        if (!cstream) {
          remote.ws.send(packer.pack(opts, null, 'error'));
          return;
        }

        cstream.browser.write(opts.data);
      }
    , onend: function (opts) {
        var cid = addrToId(opts);
        console.log('[TunnelEnd]', cid);
        handlers._onend(cid);
      }
    , onerror: function (opts) {
        var cid = addrToId(opts);
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
    remote.servername = token.name;
    remote.id = socketToId(ws.upgradeReq.socket);
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

    store.set(token.name, remote.handle);
	});


  tcp3000.listen(3000, function () {
    console.log('listening on 3000');
  });

  var tls3000 = tls.createServer(tlsOpts, function (tlsSocket) {
    console.log('tls connection');

    tlsSocket._remoteFamily = tlsSocket._handle._parentWrap._handle.owner.stream.remoteFamily;
    tlsSocket._remoteAddress = tlsSocket._handle._parentWrap._handle.owner.stream.remoteAddress;
    tlsSocket._remotePort = tlsSocket._handle._parentWrap._handle.owner.stream.remotePort;
    // TODO BUG XXX
    // https://github.com/nodejs/node/issues/8854
    // tlsSocket.remoteAddress = remoteAddress; // causes core dump
    // console.log(tlsSocket.remoteAddress);
    console.log('s', tlsSocket._remoteAddress);
    httpServer.emit('connection', tlsSocket);
  });

  var Dup = {
    write: function (chunk, encoding, cb) {
      //console.log('_write', chunk.byteLength);
      this.__my_socket.write(chunk, encoding);
      cb();
    }
  , read: function (size) {
      //console.log('_read');
      var x = this.__my_socket.read(size);
      if (x) {
        console.log('_read', size);
        this.push(x);
      }
    }
  };

  function connectHttp(servername, socket) {
    console.log("connectHttp('" + servername + "', socket)");
    socket.__my_servername = servername;
    httpServer.emit('connection', socket);
  }

  function connectHttps(servername, socket) {
    // none of these methods work:
    // httpsServer.emit('connection', socket);  // this didn't work
    // tlsServer.emit('connection', socket);    // this didn't work either
    //console.log('chunkLen', firstChunk.byteLength);

    var myDuplex = new Duplex();

    myDuplex.__my_socket = socket;
    myDuplex._write = Dup.write;
    myDuplex._read = Dup.read;
    console.log('plainSocket.*Address');
    console.log('remote:', socket.remoteAddress);
    console.log('local:', socket.localAddress);
    console.log('address():', socket.address());
    myDuplex.remoteFamily = socket.remoteFamily;
    myDuplex.remoteAddress = socket.remoteAddress;
    myDuplex.remotePort = socket.remotePort;
    myDuplex.localFamily = socket.localFamily;
    myDuplex.localAddress = socket.localAddress;
    myDuplex.localPort = socket.localPort;

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
    //var address = socketToAddr(ws.upgradeReq.socket);
    var baddress = socketToAddr(browser);
    var cid = addrToId(baddress);
    console.log('servername:', servername);
    console.log('service:', service);
    baddress.service = service;
    var wrapForRemote = new MyTransform({
      id: cid
    //, remoteId: remote.id
    , address: baddress
    , servername: servername
    , service: service
    });
    console.log('home-cloud is', socketToId(remote));
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
      ws.send(pchunk, { binary: true });
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

  tcp3000.on('connection', function (browser) {
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
        if (!servername || selfname === servername || !remotes[servername]) {
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
          if (/\/\.well-known\//.test(str)) {
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

  });
});
