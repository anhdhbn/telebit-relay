'use strict';

var http = require('http');
var tls = require('tls');
var packerStream = require('tunnel-packer').Stream;
var redirectHttps = require('redirect-https')();

module.exports.create = function (program) {
  program.httpServer = http.createServer(function (req, res) {
    console.log('req.socket.encrypted', req.socket.encrypted);
    res.end("Look! I can do a thing!");
  });

  program.httpInsecureServer = http.createServer(function (req, res) {
    res.setHeader('Connection', 'close');
    redirectHttps(req, res);
  });
  program.httpTunnelServer = http.createServer(function (req, res) {
    console.log('req.socket.encrypted', req.socket.encrypted);
    res.end('Hello, World!');
  });
  program.httpInvalidSniServer = http.createServer(function (req, res) {
    res.end("You're doing strange things that make me feel uncomfortable. Please don't touch me there any more.");
  });
  program.tlsTunnelServer = tls.createServer(program.tlsOptions, function (tlsSocket) {
    console.log('tls connection');
    // things get a little messed up here
    (program.httpTunnelServer || program.httpServer).emit('connection', tlsSocket);
  });
  program.tlsInvalidSniServer = tls.createServer(program.tlsOptions, function (tlsSocket) {
    console.log('tls connection');
    // things get a little messed up here
    program.httpInvalidSniServer.emit('connection', tlsSocket);
  });
  program.handleInsecureHttp = function (servername, socket) {
    console.log("handleInsecureHttp('" + servername + "', socket)");
    socket.__my_servername = servername;
    program.httpInsecureServer.emit('connection', socket);
  };
  program.httpsInvalid = function (servername, socket) {
    // none of these methods work:
    // httpsServer.emit('connection', socket);  // this didn't work
    // tlsServer.emit('connection', socket);    // this didn't work either
    //console.log('chunkLen', firstChunk.byteLength);

    var myDuplex = packerStream.create(socket);

    console.log('httpsInvalid servername', servername);
    program.tlsInvalidSniServer.emit('connection', myDuplex);

    socket.on('data', function (chunk) {
      console.log('[' + Date.now() + '] socket data', chunk.byteLength);
      myDuplex.push(chunk);
    });
    socket.on('error', function (err) {
      console.error('[error] httpsInvalid TODO close');
      console.error(err);
    });
  };
  program.httpsTunnel = function (servername, socket) {
    // none of these methods work:
    // httpsServer.emit('connection', socket);  // this didn't work
    // tlsServer.emit('connection', socket);    // this didn't work either
    //console.log('chunkLen', firstChunk.byteLength);

    var myDuplex = packerStream.create(socket);

    console.log('httpsTunnel servername', servername);
    program.tlsTunnelServer.emit('connection', myDuplex);

    socket.on('data', function (chunk) {
      console.log('[' + Date.now() + '] socket data', chunk.byteLength);
      myDuplex.push(chunk);
    });
    socket.on('error', function (err) {
      console.error('[error] httpsTunnel TODO close');
      console.error(err);
    });
  };
};
