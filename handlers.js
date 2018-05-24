'use strict';

var http = require('http');
var tls = require('tls');
var wrapSocket = require('tunnel-packer').wrapSocket;
var redirectHttps = require('redirect-https')();

function noSniCallback(tag) {
  return function _noSniCallback(servername, cb) {
    var err = new Error("[noSniCallback] no handler set for '" + tag + "':'" + servername + "'");
    console.error(err.message);
    cb(new Error(err));
  }
}

module.exports.create = function (state) {
  var tunnelAdminTlsOpts = {};
  var setupSniCallback;
  var setupTlsOpts = {
    SNICallback: function (servername, cb) {
      if (!setupSniCallback) {
        console.error("No way to get https certificates...");
        cb(new Error("telebitd sni setup fail"));
        return;
      }
      setupSniCallback(servername, cb);
    }
  };

  // Probably a reverse proxy on an internal network (or ACME challenge)
  function notFound(req, res) {
    console.log('req.socket.encrypted', req.socket.encrypted);
    res.statusCode = 404;
    res.end("File not found.\n");
  }
  state.httpServer = http.createServer(
    state.greenlock && state.greenlock.middleware(notFound)
    || notFound
  );
  state.handleHttp = function (servername, socket) {
    console.log("handleHttp('" + servername + "', socket)");
    socket.__my_servername = servername;
    state.httpServer.emit('connection', socket);
  };

  // Probably something that needs to be redirected to https
  function redirectHttpsAndClose(req, res) {
    res.setHeader('Connection', 'close');
    redirectHttps(req, res);
  }
  state.httpInsecureServer = http.createServer(
    state.greenlock && state.greenlock.middleware(redirectHttpsAndClose)
    || redirectHttpsAndClose
  );
  state.handleInsecureHttp = function (servername, socket) {
    console.log("handleInsecureHttp('" + servername + "', socket)");
    socket.__my_servername = servername;
    state.httpInsecureServer.emit('connection', socket);
  };


  //
  // SNI is not recogonized / cannot be handled
  //
  state.httpInvalidSniServer = http.createServer(function (req, res) {
    res.end("This is an old error message that shouldn't be actually be acessible anymore. If you get this please tell AJ so that he finds where it was still referenced and removes it");
  });
  state.tlsInvalidSniServer = tls.createServer(state.tlsOptions, function (tlsSocket) {
    console.log('tls connection');
    // things get a little messed up here
    state.httpInvalidSniServer.emit('connection', tlsSocket);
  });
  state.tlsInvalidSniServer.on('tlsClientError', function () {
    console.error('tlsClientError InvalidSniServer');
  });
  state.httpsInvalid = function (servername, socket) {
    // none of these methods work:
    // httpsServer.emit('connection', socket);  // this didn't work
    // tlsServer.emit('connection', socket);    // this didn't work either
    //console.log('chunkLen', firstChunk.byteLength);

    console.log('httpsInvalid servername', servername);
    //state.tlsInvalidSniServer.emit('connection', wrapSocket(socket));
    var tlsInvalidSniServer = tls.createServer(state.tlsOptions, function (tlsSocket) {
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
    tlsInvalidSniServer.on('tlsClientError', function () {
      console.error('tlsClientError InvalidSniServer httpsInvalid');
    });
    tlsInvalidSniServer.emit('connection', wrapSocket(socket));
  };

  //
  // To ADMIN / CONTROL PANEL of the Tunnel Server Itself
  //
  var serveAdmin = require('serve-static')(__dirname + '/admin', { redirect: true });
  var finalhandler = require('finalhandler');
  state.httpTunnelServer = http.createServer(function (req, res) {
    console.log('req.socket.encrypted', req.socket.encrypted);
    serveAdmin(req, res, finalhandler(req, res));
  });
  Object.keys(state.tlsOptions).forEach(function (key) {
    tunnelAdminTlsOpts[key] = state.tlsOptions[key];
  });
  if (state.greenlock && state.greenlock.tlsOptions) {
    console.log('greenlock tlsOptions for SNICallback');
    tunnelAdminTlsOpts.SNICallback = function (servername, cb) {
      console.log("time to handle '" + servername + "'");
      state.greenlock.tlsOptions.SNICallback(servername, cb);
    };
  } else {
    console.log('custom or null tlsOptions for SNICallback');
    tunnelAdminTlsOpts.SNICallback = tunnelAdminTlsOpts.SNICallback || noSniCallback('admin');
  }
  state.tlsTunnelServer = tls.createServer(tunnelAdminTlsOpts, function (tlsSocket) {
    console.log('(Admin) tls connection');
    // things get a little messed up here
    (state.httpTunnelServer || state.httpServer).emit('connection', tlsSocket);
  });
  state.tlsTunnelServer.on('tlsClientError', function () {
    console.error('tlsClientError TunnelServer client error');
  });
  state.httpsTunnel = function (servername, socket) {
    // none of these methods work:
    // httpsServer.emit('connection', socket);  // this didn't work
    // tlsServer.emit('connection', socket);    // this didn't work either
    //console.log('chunkLen', firstChunk.byteLength);

    console.log('httpsTunnel (Admin) servername', servername);
    state.tlsTunnelServer.emit('connection', wrapSocket(socket));
  };

  //
  // First time setup
  //
  var serveSetup = require('serve-static')(__dirname + '/admin/setup', { redirect: true });
  var finalhandler = require('finalhandler');
  state.httpSetupServer = http.createServer(function (req, res) {
    console.log('req.socket.encrypted', req.socket.encrypted);
    if (req.socket.encrypted) {
      serveSetup(req, res, finalhandler(req, res));
      return;
    }
    console.log('try greenlock middleware');
    (state.greenlock && state.greenlock.middleware(redirectHttpsAndClose)
      || redirectHttpsAndClose)(req, res, function () {
      console.log('fallthrough to setup ui');
      serveSetup(req, res, finalhandler(req, res));
    });
  });
  state.tlsSetupServer = tls.createServer(setupTlsOpts, function (tlsSocket) {
    console.log('tls connection');
    // things get a little messed up here
    state.httpSetupServer.emit('connection', tlsSocket);
  });
  state.tlsSetupServer.on('tlsClientError', function () {
    console.error('tlsClientError SetupServer');
  });
  state.httpsSetupServer = function (servername, socket) {
    console.log('httpsTunnel (Setup) servername', servername);
    state._servernames = [servername];
    state.config.agreeTos = true; // TODO: BUG XXX BAD, make user accept
    setupSniCallback = state.greenlock.tlsOptions.SNICallback || noSniCallback('setup');
    state.tlsSetupServer.emit('connection', wrapSocket(socket));
  };

  //
  // vhost
  //
  state.httpVhost = http.createServer(function (req, res) {
    console.log('httpVhost (local)');
    console.log('req.socket.encrypted', req.socket.encrypted);

    var finalhandler = require('finalhandler');
    // TODO compare SNI to hostname?
    var host = (req.headers.host||'').toLowerCase().trim();
    var serveSetup = require('serve-static')(state.config.vhost.replace(/:hostname/g, host), { redirect: true });

    if (req.socket.encrypted) { serveSetup(req, res, finalhandler(req, res)); return; }

    console.log('try greenlock middleware for vhost');
    (state.greenlock && state.greenlock.middleware(redirectHttpsAndClose)
      || redirectHttpsAndClose)(req, res, function () {
      console.log('fallthrough to vhost serving???');
      serveSetup(req, res, finalhandler(req, res));
    });
  });
  state.tlsVhost = tls.createServer(
    { SNICallback: function (servername, cb) {
        console.log('tlsVhost debug SNICallback', servername);
        tunnelAdminTlsOpts.SNICallback(servername, cb);
      }
    }
  , function (tlsSocket) {
      console.log('tlsVhost (local)');
      state.httpVhost.emit('connection', tlsSocket);
    }
  );
  state.tlsVhost.on('tlsClientError', function () {
    console.error('tlsClientError Vhost');
  });
  state.httpsVhost = function (servername, socket) {
    console.log('httpsVhost (local)', servername);
    state.tlsVhost.emit('connection', wrapSocket(socket));
  };
};
