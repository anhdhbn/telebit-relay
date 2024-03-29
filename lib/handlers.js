'use strict';

var http = require('http');
var tls = require('tls');
var wrapSocket = require('proxy-packer').wrapSocket;
var redirectHttps = require('redirect-https')();

function noSniCallback(tag) {
  return function _noSniCallback(servername, cb) {
    var err = new Error("[noSniCallback] no handler set for '" + tag + "':'" + servername + "'");
    console.error(err.message);
    cb(new Error(err));
  };
}

module.exports.create = function (state) {
  var tunnelAdminTlsOpts = {};
  var setupSniCallback;
  var setupTlsOpts = {
    SNICallback: function (servername, cb) {
      if (!setupSniCallback) {
        console.error("[setup.SNICallback] No way to get https certificates...");
        cb(new Error("telebit-relay sni setup fail"));
        return;
      }
      setupSniCallback(servername, cb);
    }
  };

  // Probably a reverse proxy on an internal network (or ACME challenge)
  function notFound(req, res) {
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
    console.log("[handlers] insecure http for '" + servername + "'");
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
  state.createHttpInvalid = function (opts) {
    return http.createServer(function (req, res) {
      if (!opts.servername) {
        res.statusCode = 422;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end(
          "3. An inexplicable temporal shift of the quantum realm... that makes me feel uncomfortable.\n\n"
        + "[ERROR] No SNI header was sent. I can only think of two possible explanations for this:\n"
        + "\t1. You really love Windows XP and you just won't let go of Internet Explorer 6\n"
        + "\t2. You're writing a bot and you forgot to set the servername parameter\n"
        );
        return;
      }

      // TODO use req.headers.host instead of servername (since domain fronting is disabled anyway)
      res.statusCode = 502;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(
        "<h1>Oops!</h1>"
      + "<p>It looks like '" + encodeURIComponent(opts.servername) + "' isn't connected right now.</p>"
      + "<p><small>Last seen: " + opts.ago + "</small></p>"
      + "<p><small>Error: 502 Bad Gateway</small></p>"
      );
    });
  };
  state.httpsInvalid = function (opts, socket) {
    // none of these methods work:
    // httpsServer.emit('connection', socket);  // this didn't work
    // tlsServer.emit('connection', socket);    // this didn't work either
    //console.log('chunkLen', firstChunk.byteLength);

    console.log('[httpsInvalid] servername', opts.servername);
    //state.tlsInvalidSniServer.emit('connection', wrapSocket(socket));
    var tlsInvalidSniServer = tls.createServer(state.tlsOptions, function (tlsSocket) {
      console.log('[tlsInvalid] tls connection');
      // We create an entire http server object because it's difficult to figure out
      // how to access the original tlsSocket to get the servername
      state.createHttpInvalid(opts).emit('connection', tlsSocket);
    });
    tlsInvalidSniServer.on('tlsClientError', function () {
      console.error('tlsClientError InvalidSniServer httpsInvalid');
    });
    tlsInvalidSniServer.emit('connection', wrapSocket(socket));
  };

  //
  // To ADMIN / CONTROL PANEL of the Tunnel Server Itself
  //
  var serveAdmin = require('serve-static')(__dirname + '/../admin', { redirect: true });
  var finalhandler = require('finalhandler');
  state.defaults.webadmin = function (req, res) {
    serveAdmin(req, res, finalhandler(req, res));
  };
  state.httpTunnelServer = http.createServer(function (req, res) {
    res.setHeader('connection', 'close');
    if (state.extensions.webadmin) {
      state.extensions.webadmin(state, req, res);
    } else {
      state.defaults.webadmin(req, res);
    }
  });
  Object.keys(state.tlsOptions).forEach(function (key) {
    tunnelAdminTlsOpts[key] = state.tlsOptions[key];
  });
  if (state.greenlock && state.greenlock.tlsOptions) {
    tunnelAdminTlsOpts.SNICallback = state.greenlock.tlsOptions.SNICallback;
  } else {
    console.log('[Admin] custom or null tlsOptions for SNICallback');
    tunnelAdminTlsOpts.SNICallback = tunnelAdminTlsOpts.SNICallback || noSniCallback('admin');
  }
  var MPROXY = Buffer.from("MPROXY");
  state.tlsTunnelServer = tls.createServer(tunnelAdminTlsOpts, function (tlsSocket) {
    if (state.debug) { console.log('[Admin] new tls-terminated connection'); }
    tlsSocket.once('readable', function () {
      var firstChunk = tlsSocket.read();
      tlsSocket.unshift(firstChunk);

      if (0 === MPROXY.compare(firstChunk.slice(0, 4))) {
        tlsSocket.end("MPROXY isn't supported yet");
        return;
      }

      // things get a little messed up here
      (state.httpTunnelServer || state.httpServer).emit('connection', tlsSocket);
    });
  });
  state.tlsTunnelServer.on('tlsClientError', function () {
    console.error('tlsClientError TunnelServer client error');
  });
  state.httpsTunnel = function (servername, socket) {
    // none of these methods work:
    // httpsServer.emit('connection', socket);  // this didn't work
    // tlsServer.emit('connection', socket);    // this didn't work either
    //console.log('chunkLen', firstChunk.byteLength);

    if (state.debug) { console.log('[Admin] new raw tls connection for', servername); }
    state.tlsTunnelServer.emit('connection', wrapSocket(socket));
  };

  //
  // First time setup
  //
  var serveSetup = require('serve-static')(__dirname + '/../admin/setup', { redirect: true });
  var finalhandler = require('finalhandler');
  state.httpSetupServer = http.createServer(function (req, res) {
    if (req.socket.encrypted) {
      serveSetup(req, res, finalhandler(req, res));
      return;
    }
    (state.greenlock && state.greenlock.middleware(redirectHttpsAndClose)
      || redirectHttpsAndClose)(req, res, function () {
      console.log('[Setup] fallthrough to setup ui');
      serveSetup(req, res, finalhandler(req, res));
    });
  });
  state.tlsSetupServer = tls.createServer(setupTlsOpts, function (tlsSocket) {
    console.log('[Setup] terminated tls connection');
    // things get a little messed up here
    state.httpSetupServer.emit('connection', tlsSocket);
  });
  state.tlsSetupServer.on('tlsClientError', function () {
    console.error('[Setup] tlsClientError SetupServer');
  });
  state.httpsSetupServer = function (servername, socket) {
    console.log('[Setup] raw tls connection for', servername);
    state._servernames = [servername];
    state.config.agreeTos = true; // TODO: BUG XXX BAD, make user accept
    setupSniCallback = state.greenlock.tlsOptions.SNICallback || noSniCallback('setup');
    state.tlsSetupServer.emit('connection', wrapSocket(socket));
  };

  //
  // vhost
  //
  state.httpVhost = http.createServer(function (req, res) {
    if (state.debug) { console.log('[vhost] encrypted?', req.socket.encrypted); }

    var finalhandler = require('finalhandler');
    // TODO compare SNI to hostname?
    var host = (req.headers.host||'').toLowerCase().trim();
    var serveVhost = require('serve-static')(state.config.vhost.replace(/:hostname/g, host), { redirect: true });

    if (req.socket.encrypted) { serveVhost(req, res, finalhandler(req, res)); return; }

    if (!state.greenlock) {
      console.error("Cannot vhost without greenlock options");
      res.end("Cannot vhost without greenlock options");
    }

    state.greenlock.middleware(redirectHttpsAndClose);
  });
  state.tlsVhost = tls.createServer(
    { SNICallback: function (servername, cb) {
        if (state.debug) { console.log('[vhost] SNICallback for', servername); }
        tunnelAdminTlsOpts.SNICallback(servername, cb);
      }
    }
  , function (tlsSocket) {
      if (state.debug) { console.log('tlsVhost (local)'); }
      state.httpVhost.emit('connection', tlsSocket);
    }
  );
  state.tlsVhost.on('tlsClientError', function (e) {
    console.error('tlsClientError Vhost', e);
  });
  state.httpsVhost = function (servername, socket) {
    if (state.debug) { console.log('[vhost] httpsVhost (local) for', servername); }
    state.tlsVhost.emit('connection', wrapSocket(socket));
  };
};
