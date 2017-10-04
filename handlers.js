'use strict';

var http = require('http');
var tls = require('tls');
var wrapSocket = require('tunnel-packer').wrapSocket;
var redirectHttps = require('redirect-https')();

module.exports.create = function (program) {
  var tunnelAdminTlsOpts = {};

  // Probably a reverse proxy on an internal network (or ACME challenge)
  function notFound(req, res) {
    console.log('req.socket.encrypted', req.socket.encrypted);
    res.statusCode = 404;
    res.end("File not found.\n");
  }
  program.httpServer = http.createServer(
    program.greenlock && program.greenlock.middleware(notFound)
    || notFound
  );
  program.handleHttp = function (servername, socket) {
    console.log("handleHttp('" + servername + "', socket)");
    socket.__my_servername = servername;
    program.httpServer.emit('connection', socket);
  };

  // Probably something that needs to be redirected to https
  function redirectHttpsAndClose(req, res) {
    res.setHeader('Connection', 'close');
    redirectHttps(req, res);
  }
  program.httpInsecureServer = http.createServer(
    program.greenlock && program.greenlock.middleware(redirectHttpsAndClose)
    || redirectHttpsAndClose
  );
  program.handleInsecureHttp = function (servername, socket) {
    console.log("handleInsecureHttp('" + servername + "', socket)");
    socket.__my_servername = servername;
    program.httpInsecureServer.emit('connection', socket);
  };


  //
  // SNI is not recogonized / cannot be handled
  //
  program.httpInvalidSniServer = http.createServer(function (req, res) {
    res.end("This is an old error message that shouldn't be actually be acessible anymore. If you get this please tell AJ so that he finds where it was still referenced and removes it");
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

    console.log('httpsInvalid servername', servername);
    //program.tlsInvalidSniServer.emit('connection', wrapSocket(socket));
    var tlsInvalidSniServer = tls.createServer(program.tlsOptions, function (tlsSocket) {
      console.log('tls connection');
      // things get a little messed up here
      var httpInvalidSniServer = http.createServer(function (req, res) {
        if (!servername) {
          res.statusCode = 422;
          res.end(
            "3. An inexplicable temporal shift of the quantum realm... that makes me feel uncomfortable.\n\n"
          + "[ERROR] No SNI header was sent. I can only think of two possible explanations for this:\n"
          + "\t1. You really love Windows XP and you just won't let go of Internet Explorer 6\n"
          + "\t2. You're writing a bot and you forgot to set the servername parameter\n"
          );
          return;
        }

        res.end(
          "You came in hot looking for '" + servername + "' and, granted, the IP address for that domain"
        + " must be pointing here (or else how could you be here?), nevertheless either it's not registered"
        + " in the internal system at all (which Seth says isn't even a thing) or there is no device"
        + " connected on the south side of the network which has informed me that it's ready to have traffic"
        + " for that domain forwarded to it (sorry I didn't check that deeply to determine which).\n\n"
        + "Either way, you're doing strange things that make me feel uncomfortable... Please don't touch me there any more.");
      });
      httpInvalidSniServer.emit('connection', tlsSocket);
    });
    tlsInvalidSniServer.emit('connection', wrapSocket(socket));
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

    console.log('httpsTunnel (Admin) servername', servername);
    program.tlsTunnelServer.emit('connection', wrapSocket(socket));
  };
};
