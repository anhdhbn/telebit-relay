'use strict';

var crypto = require('crypto');
var net = require('net');
var sni = require('sni');
var jwt = require('jsonwebtoken');

var Transform = require('stream').Transform;
var util = require('util');

function pad(str, len, ch) {
  var x = '';

  while (str.length < len) {
    x += (ch || ' ');
  }

  return x;
}

function MyTransform(options) {
  if (!(this instanceof MyTransform)) {
    return new MyTransform(options);
  }
  this.__my_id = options.id;
  this.__my_addr = options.address;
  Transform.call(this, options);
}
util.inherits(MyTransform, Transform);
MyTransform.prototype._transform = function (data, encoding, callback) {
  var id = this.__my_id;
  var address = this.__my_addr;

  this.push('<');
  this.push(id);
  if ('IPv4' === address.family) {
    this.push('IPv4:' + pad(address.address, 11, ' ') + ':' + pad(address.port, 5));  // 11 ch
  }
  else {
    this.push('IPv6:' + pad(address.address, 39, ' ') + ':' + pad(address.port, 5));  // ipv6 39-ch
  }
  //client.socket.write('IPv5:2001:0db8:85a3:0000:0000:ffff:80fe:fefe:00:00');    // ipv4 in ipv6 45-ch
  this.push(data);
  this.push(id);
  this.push('>');

  callback();
};

require('cluster-store').create().then(function (store) {
  // initialization is now complete
  //store.set('foo', 'bar');

  var remotes = {};
  var server443 = net.createServer(function (socket) {
    socket.once(function (hello) {
      var servername = sni(hello);
      var client = remotes[servername];
      if (!client) {
        socket.end();
        return;
      }
      //var id = crypto.randomBytes(16).toString('hex');
      var id = client.id;
      var address = client.socket.address();
      var transform = new MyTransform({ id: id, address: address });

      client.socket.unshift(hello);

      socket.pipe(transform).pipe(client.socket, { end: true });

      client.clients[id] = socket;
      socket.on('error', function () {
        transform.write('|_ERROR_|');
        delete client.clients[id];
      });
      socket.on('end', function () {
        delete client.clients[id];
      });
    });
  });

  server443.listen(443, function () {
    console.log('listening on 443');
  });

  var server5443 = net.createServer(function (socket) {
    socket.once(function (hello) {
      var token;
      try {
        token = jwt.decode(hello.toString('utf8'));
        console.log(token);
      } catch(e) {
        socket.end();
      }
      var id = crypto.randomBytes(16).toString('hex');

      socket.write(id, function () {
        remotes[token.name] = {
          socket: socket
        , id: id
        , clients: {}
        };
      });
    });
  });

  server5443.listen(5443, function () {
    console.log('listening on 5443');
  });
});
