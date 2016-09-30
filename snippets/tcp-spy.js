'use strict';

var net = require('net');
var http = require('http');

var http80 = http.createServer(function (req, res) {
  res.end('Hello, World!');
});

var tcp80 = net.createServer(function (socket) {

  socket.once('data', function (chunk) {

    if (/http\/1/i.test(chunk.toString())) {
      console.log("looks like http, continue");
      http80.emit('connection', socket);
    } else {
      console.log("looks like tcp, die");
      socket.end();
    }

    socket.pause();
    process.nextTick(function () {
      socket.emit('data', chunk);
      socket.resume();
    });
  });

});

tcp80.listen(80, function () {
  console.log('listening on 80');
});
