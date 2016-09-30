'use strict';

var net = require('net');
var sni = require('sni');
var jwt = require('jsonwebtoken');
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

//require('cluster-store').create().then(function (/*store*/) {
  // initialization is now complete
  //store.set('foo', 'bar');

  var remotes = {};

  setInterval(function () {
    Object.keys(remotes).forEach(function (id) {
      var remote = remotes[id];

      console.log('Remote ', id, 'has', Object.keys(remote.clients).length, 'clients', remote.socket.bytesRead, remote.socket.bytesWritten);
      /*
      forEach(function (cid) {
        var client = remote.clients[cid];
      });
      */
    });
  }, 5000);

  var server443 = net.createServer(function (browser) {
    browser.once('data', function (hello) {
      //require('fs').writeFileSync('/tmp/sni.hello.bin', hello);
      var servername = sni(hello);
      var remote = remotes[servername];
      if (!remote) {
        console.log("no remote for '" + servername + "'");
        browser.end();
        return;
      }
      var address = socketToAddr(browser);
      var id = addrToId(address);
      var wrapForRemote = new MyTransform({ id: id, remoteId: remote.id, address: address, servername: servername });

      //socket.unshift(hello);

      //remote.socket/*.pipe(transform)*/.pipe(socket, { end: false });
      var bstream = browser.pipe(wrapForRemote);
      /*
      function write() {
        console.log("client '" + address.address + "' writing to '" + servername + "'");
        var bytes = browser.read();
        if (bytes) {
          console.log("wrote ", bytes.byteLength);
          remote.socket.write(bytes, write);
        }
        else {
          console.log("nothing to write right now");
        }
      }
      bstream.on('readable', write);
      */
      bstream.on('data', function (chunk) {
        console.log("client '" + address.address + "' writing to '" + servername + "'", chunk.byteLength);
        remote.socket.write(chunk);
      });

      var data = packer.pack(address, hello);
      console.log("client '" + address.address + "' greeting '" + servername + "'", hello.byteLength, data.byteLength);
      remote.socket.write(data);

      remote.clients[id] = browser;
      bstream.on('error', function () {
        console.error("browser has erred");
        //wrapForRemote.write('|_ERROR_|');
        delete remote.clients[id];
      });
      bstream.on('end', function () {
        console.log("browser has closed the socket");
        //wrapForRemote.write('|_END_|');
        delete remote.clients[id];
      });
    });
  });

  server443.listen(443, function () {
    console.log('listening on 443');
  });

  var server5443 = net.createServer(function (rserver) {
    rserver.once('data', function (hello) {
      var token;
      try {
        token = jwt.decode(hello.toString('utf8'));
        console.log(token);
      } catch(e) {
        rserver.end();
        return;
      }

      if (!token.name) {
        console.log("no 'name' in token");
        rserver.end();
        return;
      }

      var remote = {
        socket: rserver
      , id: socketToId(rserver)
      , clients: {}
      };
      var unpacker = packer.create({ onMessage: function (opts) {
        // opts.data
        var id = addrToId(opts);

        console.log("remote '" + remote.id + "' has data for '" + id + "'", opts.data.byteLength);

        if (!remote.clients[id]) {
          console.log('no client for', id, opts.data.toString('utf8').substr(0, 100));
          //remote.socket.write(packer.pack(opts, Buffer.from('|__END__|')));
          return;
        }

        remote.clients[id].write(opts.data);
      } });

      console.log('new remote:', token.name);
      /*
      var data = packer.pack({ family: 'IPv4', address: '254.254.254.1', port: 443 }, Buffer.from(remote.id));

      rserver.write(data, function () {
        remotes[token.name] = remote;
      });
      */

      remotes[token.name] = remote;
      rserver.on('data', function (chunk) {
        unpacker.fns.addChunk(chunk);
      });

      function closeEm() {
        console.log("closing connection to '" + token.name + "'");
        delete remotes[token.name];

        Object.keys(remote.clients).forEach(function (cid) {
          remote.clients[cid].end();
          delete remote.clients[cid];
        });

        //remote = null;
        //rserver = null;
        //unpacker = null;
      }

      rserver.on('end', closeEm);
      rserver.on('error', closeEm);
    });
  });

  server5443.listen(5443, function () {
    console.log('listening on 5443');
  });


  var http80 = require('http').createServer();
  http80.on('request', function (req, res) {
    res.end('Happy Day!');
  });

  var server80 = net.createServer(function (client) {
    http80.emit('connection', client);
  });
  server80.listen(80, function () {
    console.log('listening on 80');
  });
//});
