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

require('cluster-store').create().then(function (store) {
  var remotes = {};
  var selfname = 'pokemap.hellabit.com';
  var secret = 'shhhhh';

  var httpServer = http.createServer(function (req, res) {
    res.end('Hello, World!');
  });
  var wss = new WebSocketServer({ server: httpServer });
  var tcp3000 = net.createServer();

	wss.on('connection', function connection(ws) {
		var location = url.parse(ws.upgradeReq.url, true);
    //var token = jwt.decode(location.query.access_token);
    var token = jwt.verify(location.query.access_token, secret);

    if (!token) {
      ws.send({ error: { message: "invalid access token", code: "E_INVALID_TOKEN" } });
      ws.close();
      return;
    }

    if (!token.name) {
      ws.send({ error: { message: "invalid server name", code: "E_INVALID_NAME" } });
      ws.close();
      return;
    }

    ws.on('close', function () {
      console.log("TODO cleanup");
    });

    remotes[token.name] = remotes[token.name] || {};
    // TODO allow more than one remote per servername
    remotes[token.name].ws = ws;
    // TODO allow tls to be decrypted by server if client is actually a browser
    // and we haven't implemented tls in the browser yet
    remotes[token.name].decrypt = token.decrypt;
    // TODO how to allow a child process to communicate with this one?
    remotes[token.name].handle = { address: null, handle: null };
    store.set(token.name, remotes[token.name].handle);
	});


  tcp3000.listen(3000, function () {
    console.log('listening on 3000');
  });


  var tls3000 = tls.createServer(tlsOpts, function (tlsSocket) {
    httpServer.emit('connection', tlsSocket);
    /*
    tlsSocket.on('data', function (chunk) {
      console.log('chunk', chunk.byteLength);
    });
    */
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

  tcp3000.on('connection', function (socket) {
    // this works when I put it here, but I don't know if it's tls yet here
    // httpsServer.emit('connection', socket);
    //tls3000.emit('connection', socket);

    //var tlsSocket = new tls.TLSSocket(socket, { secureContext: tls.createSecureContext(tlsOpts) });
    //tlsSocket.on('data', function (chunk) {
    //  console.log('dummy', chunk.byteLength);
    //});

    //return;
    socket.once('data', function (firstChunk) {
      // BUG XXX: this assumes that the packet won't be chunked smaller
      // than the 'hello' or the point of the 'Host' header.
      // This is fairly reasonable, but there are edge cases where
      // it does not hold (such as manual debugging with telnet)
      // and so it should be fixed at some point in the future

      // defer after return (instead of being in many places)
      process.nextTick(function () {
        socket.unshift(firstChunk);
      });

      var service = 'tcp';
      var servername;
      var str;
      var m;

      function connectHttps() {
        // none of these methods work:
        // httpsServer.emit('connection', socket);  // this didn't work
        // tlsServer.emit('connection', socket);    // this didn't work either
        //console.log('chunkLen', firstChunk.byteLength);

        var myDuplex = new Duplex();

        myDuplex.__my_socket = socket;
        myDuplex._write = Dup.write;
        myDuplex._read = Dup.read;
        socket.on('data', function (chunk) {
          //console.log('[' + Date.now() + '] socket data', chunk.byteLength);
          myDuplex.push(chunk);
        });

        tls3000.emit('connection', myDuplex);
      }

      function pipeWs(socket, ws) {
        socket.on('data', function (chunk) {
          // TODO XXX pack
          // var chunk = socket.read();
          ws.send(chunk, { binary: true });
        });
        ws.on('message', function (chunk) {
          // TODO XXX pack
          socket.write(chunk);
        });
      }

      function tryTls() {
        if (!servername || selfname === servername) {
          connectHttps();
          return;
        }

        if (remotes[servername]) {
          pipeWs(socket, remotes[servername].ws);
          return;
        }

        store.get(servername, function (remote) {
          if (!remote) {
            connectHttps();
            return;
          }

          if (!remote.address) {
            console.error("connecting to a socket in a sibling process is not yet implemented");
            connectHttps();
            return;
          }

          console.error("connecting to a socket in a sibling process is not yet implemented");
          connectHttps();
        });
      }

      // https://github.com/mscdex/httpolyglot/issues/3#issuecomment-173680155
      if (22 === firstChunk[0]) {
        // TLS
        service = 'https';
        servername = (sni(firstChunk)||'').toLowerCase();
        tryTls();
        return;
      }

      if (firstChunk[0] > 32 && firstChunk[0] < 127) {
        str = firstChunk.toString();
        m = str.match(/^Host: ([^\r\n]+)[\r\n]+/);
        servername = m && m[1].toLowerCase() || '';
        if (/HTTP\//i.test(str)) {
          service = 'http';
          if (/\/\.well-known\//.test(str)) {
            // HTTP
            httpServer.emit('connection', socket);
          }
          else {
            // redirect to https
            httpServer.emit('connection', socket);
          }
          return;
        }
      }

      console.error("Got unexpected connection", str);
      socket.write(JSON.stringify({ error: {
        message: "not sure what you were trying to do there..."
      , code: 'E_INVALID_PROTOCOL' }
      }));
      socket.end();
    });

  });
});
