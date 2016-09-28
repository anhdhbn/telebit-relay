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
  Transform.call(this, options);
}
util.inherits(MyTransform, Transform);
function transform(me, data, encoding, callback) {
  var address = me.__my_addr;

  me.push(packer.pack(address, data));
  callback();
}
MyTransform.prototype._transform = function (data, encoding, callback) {
  return transform(this, data, encoding, callback);
};

function socketToAddr(socket) {
  return { family: socket.remoteFamily, address: socket.remoteAddress, port: socket.remotePort };
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
    console.log('todo connection');

		var location = url.parse(ws.upgradeReq.url, true);
    //var token = jwt.decode(location.query.access_token);
    var token = jwt.verify(location.query.access_token, secret);

    console.log('location, token');
    console.log(location.query.access_token);
    console.log(token);

    if (!token) {
      ws.send({ error: { message: "invalid access token", code: "E_INVALID_TOKEN" } });
      ws.close();
      return;
    }

    console.log('token.name');
    console.log(token.name);

    if (!token.name) {
      ws.send({ error: { message: "invalid server name", code: "E_INVALID_NAME" } });
      ws.close();
      return;
    }

    ws.on('close', function () {
      console.log("TODO cleanup");
    });

    var remote = remotes[token.name] = remotes[token.name] || {};
    // TODO allow more than one remote per servername
    remote.ws = ws;
    remote.id = socketToId(ws.upgradeReq.socket);
    // TODO allow tls to be decrypted by server if client is actually a browser
    // and we haven't implemented tls in the browser yet
    remote.decrypt = token.decrypt;
    // TODO how to allow a child process to communicate with this one?
    remote.clients = {};
    remote.handle = { address: null, handle: null };



    store.set(token.name, remote.handle);
	});


  tcp3000.listen(3000, function () {
    console.log('listening on 3000');
  });


  var tls3000 = tls.createServer(tlsOpts, function (tlsSocket) {
    console.log('tls connection');

    /*
    tlsSocket.on('data', function (chunk) {
      console.log('secure chunk');
      console.log('');
      console.log(chunk.toString());
      console.log('');
    });
    */

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

    console.log('connectHttps servername', servername);
    tls3000.emit('connection', myDuplex);

    socket.on('data', function (chunk) {
      console.log('[' + Date.now() + '] socket data', chunk.byteLength);
      myDuplex.push(chunk);
    });
  }

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
        console.log('unshift firstChunk', firstChunk.byteLength);
        console.log(firstChunk.toString());
        socket.unshift(firstChunk);
      });

      var service = 'tcp';
      var servername;
      var str;
      var m;

      function pipeWs(socket, remote) {
        //var remote = remotes[servername];
        var ws = remote.ws;
        //var address = socketToAddr(ws.upgradeReq.socket);
        var address = socketToAddr(socket);
        var id = addrToId(address);
        var wrapForRemote = new MyTransform({
          id: id
        //, remoteId: remote.id
        , address: address
        , servername: servername
        });

        var unpacker = packer.create({ onMessage: function (opts) {
          // opts.data
          var cid = addrToId(opts);
          var cstream = remote.clients[cid];

          console.log("remote '" + remote.id + "' has data for '" + id + "'", opts.data.byteLength);

          if (!cstream) {
            console.log('no client for', cid, opts.data.toString('utf8').substr(0, 100));
            //remote.socket.write(packer.pack(opts, Buffer.from('|__END__|')));
            return;
          }

          cstream.write(opts.data);
        } });
        //socket.unshift(hello);

        //remote.socket/*.pipe(transform)*/.pipe(socket, { end: false });
        var bstream = remote.clients[id] = socket.pipe(wrapForRemote);
        bstream.on('data', function (pchunk) {
          // var chunk = socket.read();
          ws.send(pchunk, { binary: true });
        });
        ws.on('message', function (chunk) {
          unpacker.fns.addChunk(chunk);
        });
      }

      function tryTls() {
        if (!servername || selfname === servername) {
          console.log('this is a server or an unknown');
          connectHttps(servername, socket);
          return;
        }

        if (remotes[servername]) {
          console.log("pipeWs(socket, remotes['" + servername + "'])");
          pipeWs(socket, remotes[servername]);
          return;
        }

        /*
        store.get(servername, function (remote) {
          if (!remote) {
            connectHttps(servername, socket);
            return;
          }

          if (!remote.address) {
            console.error("connecting to a socket in a sibling process is not yet implemented");
            connectHttps(servername, socket);
            return;
          }

          console.error("connecting to a socket in a sibling process is not yet implemented");
          connectHttps(servername, socket);
        });
        */
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
        m = str.match(/^Host: ([^\r\n]+)[\r\n]+/i);
        servername = m && m[1].toLowerCase() || '';
        if (/HTTP\//i.test(str)) {
          service = 'http';
          if (/\/\.well-known\//.test(str)) {
            // HTTP
            if (remotes[servername]) {
              pipeWs(socket, remotes[servername]);
              return;
            }
            connectHttp(servername, socket);
          }
          else {
            // redirect to https
            connectHttp(servername, socket);
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
