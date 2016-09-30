'use strict';

var net = require('net');
var tls = require('tls');
var http = require('http');
var https = require('https');
var sni = require('sni');

var http80 = http.createServer(function (req, res) {
  res.end('Happy Day!');
});

var tcp80 = net.createServer(function (client) {
  http80.emit('connection', client);
});

tcp80.listen(80, function () {
  console.log('listening on 80');
});

var tlsOpts = require('localhost.daplie.com-certificates').merge({});
var https443 = https.createServer(tlsOpts, function (req, res) {
  res.end('Happy Encrypted Day!');
});

var tls443 = tls.createServer(tlsOpts, function (socket) {
  socket.on('data', function (chunk) {
    console.log('chunk', chunk.toString());
  });
});

var tcp443 = net.createServer(function (client) {
  //tls443.emit('connection', client); // no go
  //return;

  client.once('data', function (chunk) {
    var servername = sni(chunk);

    console.log('servername:', servername);

    //client.push(chunk);

    https443.emit('connection', client);
    //tls443.emit('connection', client); // no go
    //client.pause();
    process.nextTick(function () {
      //client.emit('data', chunk);
      client.push(chunk);
      client.emit('readable', chunk);
      //client.resume();
    });

    //client.resume();
  });
});

tcp443.listen(443, function () {
  console.log('listening on 443');
});
