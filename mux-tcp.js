'use strict';

var net = require('net');
var tls = require('tls');
var http = require('http');
var tlsOpts = require('localhost.daplie.com-certificates').merge({});
var Duplex = require('stream').Duplex;
var httpServer = http.createServer(function (req, res) {
  res.end('Hello, World!');
});
var tcp3000 = net.createServer();

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


tcp3000.on('connection', function (socket) {
  // this works when I put it here, but I don't know if it's tls yet here
  // httpsServer.emit('connection', socket);
  //tls3000.emit('connection', socket);

  //var tlsSocket = new tls.TLSSocket(socket, { secureContext: tls.createSecureContext(tlsOpts) });
  //tlsSocket.on('data', function (chunk) {
  //  console.log('dummy', chunk.byteLength);
  //});

  //return;
  socket.once('data', function (chunk) {
    if (/http\/1/i.test(chunk.toString())) {

      console.log("looks like http, continue");

      // this works as expected
      httpServer.emit('connection', socket);

    } else {

      console.log("doesn't look like http, try tls");

      // none of these methods work:
      // httpsServer.emit('connection', socket);  // this didn't work
      // tlsServer.emit('connection', socket);    // this didn't work either
      var myDuplex = new Duplex();
      myDuplex._write = function (chunk, encoding, cb) {
        console.log('_write', chunk.byteLength);
        socket.write(chunk, encoding);
        cb();
      };
      myDuplex._read = function (size) {
        console.log('_read');
        var x = socket.read(size);
        if (x) {
          console.log('_read', size);
          this.push(x);
        }
      };
      socket.on('data', function (chunk) {
        console.log('socket data', chunk.byteLength);
        myDuplex.push(chunk);
      });

      tls3000.emit('connection', myDuplex);
      //var tlsSocket = new tls.TLSSocket(myDuplex, { secureContext: tls.createSecureContext(tlsOpts) });
      /*
      var tlsSocket = new tls.TLSSocket(socket, { secureContext: tls.createSecureContext(tlsOpts) });
      tlsSocket.on('data', function (chunk) {
        console.log('tls chunk', chunk.byteLength);
      });
      */


    }

    socket.unshift(chunk);
  });

});
