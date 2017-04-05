'use strict';

var http = require('http');
var tls = require('tls');
var packerStream = require('tunnel-packer').Stream;
var redirectHttps = require('redirect-https')();

module.exports.create = function (program) {
  var tunnelAdminTlsOpts = {};

  // Probably a reverse proxy on an internal network
  program.httpServer = http.createServer(program.greenlock.middleware(function (req, res) {
    console.log('req.socket.encrypted', req.socket.encrypted);
    res.statusCode = 404;
    res.end("File not found.\n");
  }));
  program.handleHttp = function (servername, socket) {
    console.log("handleHttp('" + servername + "', socket)");
    socket.__my_servername = servername;
    program.httpServer.emit('connection', socket);
  };

  // Probably something that needs to be redirected to https
  program.httpInsecureServer = http.createServer(program.greenlock.middleware(function (req, res) {
    res.setHeader('Connection', 'close');
    redirectHttps(req, res);
  }));
  program.handleInsecureHttp = function (servername, socket) {
    console.log("handleInsecureHttp('" + servername + "', socket)");
    socket.__my_servername = servername;
    program.httpInsecureServer.emit('connection', socket);
  };


  //
  // SNI is not recogonized / cannot be handled
  //
  program.httpInvalidSniServer = http.createServer(function (req, res) {
    res.end("You're doing strange things that make me feel uncomfortable. Please don't touch me there any more.");
  });
  program.tlsInvalidSniServer = tls.createServer(program.tlsOptions, function (tlsSocket) {
    console.log('tls connection');
    // things get a little messed up here
    program.httpInvalidSniServer.emit('connection', tlsSocket);
  });
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

  //
  // To ADMIN / CONTROL PANEL of the Tunnel Server Itself
  //
  program.httpTunnelServer = http.createServer(function (req, res) {
    console.log('req.socket.encrypted', req.socket.encrypted);
    res.end('Hello, World!');
  });
  Object.keys(program.tlsOptions).forEach(function (key) {
    tunnelAdminTlsOpts[key] = program.tlsOptions[key];
  });
  tunnelAdminTlsOpts.SNICallback = (program.greenlock && program.greenlock.httpsOptions && function (servername, cb) {
    console.log("time to handle '" + servername + "'");
    program.greenlock.httpsOptions.SNICallback(servername, cb);
  }) || tunnelAdminTlsOpts.SNICallback;
  program.tlsTunnelServer = tls.createServer(tunnelAdminTlsOpts, function (tlsSocket) {
    console.log('tls connection');
    // things get a little messed up here
    (program.httpTunnelServer || program.httpServer).emit('connection', tlsSocket);
  });
  program.httpsTunnel = function (servername, socket) {
    // none of these methods work:
    // httpsServer.emit('connection', socket);  // this didn't work
    // tlsServer.emit('connection', socket);    // this didn't work either
    //console.log('chunkLen', firstChunk.byteLength);

    var myDuplex = packerStream.create(socket);

    console.log('httpsTunnel (Admin) servername', servername);
    program.tlsTunnelServer.emit('connection', myDuplex);

    socket.on('data', function (chunk) {
      console.log('[' + Date.now() + '] socket data', chunk.byteLength);
      myDuplex.push(chunk);
    });
    socket.on('error', function (err) {
      console.error('[error] httpsTunnel (Admin) TODO close');
      console.error(err);
    });
  };
};
