'use strict';

var net = require('net');
var tls = require('tls');
var http = require('http');
var sni = require('sni');
var https = require('https');
var tlsOpts = require('localhost.daplie.com-certificates').merge({});

var http80 = http.createServer(function (req, res) {
  res.end('Hello, World!');
});

var https443 = https.createServer(tlsOpts, function (req, res) {
  res.end('Hello, Encrypted World!');
});

var tcp3000 = net.createServer(function (socket) {

  socket.once('data', function (chunk) {

    if (/http\/1/i.test(chunk.toString())) {
      console.log("looks like http, continue");
      http80.emit('connection', socket);
    } else {
      console.log("doesn't look like http, try tls");
      https443.emit('connection', socket);
      var tlsSocket = new tls.TLSSocket(socket, { secureContext: tls.createSecureContext(tlsOpts) });
      tlsSocket.on('data', function (chunk) {
        console.log('chunk', chunk);
      });
      socket.emit('connect');
      //http80.emit('connection', socket);
    }

    socket.pause();
    process.nextTick(function () {
      socket.emit('data', chunk);
      socket.resume();
    });
  });

});

tcp3000.listen(3000, function () {
  console.log('listening on 3000');
});
