#!/usr/bin/env node
(function () {
'use strict';

var pkg = require('../package.json');

var argv = process.argv.slice(2);
var telebitd = require('../telebitd.js');
var Greenlock = require('greenlock');

var confIndex = argv.indexOf('--config');
var confpath;
if (-1 === confIndex) {
  confIndex = argv.indexOf('-c');
}
confpath = argv[confIndex + 1];

function help() {
  console.info('');
  console.info('Usage:');
  console.info('');
  console.info('\ttelebitd --config <path>');
  console.info('');
  console.info('Example:');
  console.info('');
  console.info('\ttelebitd --config /etc/telebit/telebitd.yml');
  console.info('');
  console.info('Config:');
  console.info('');
  console.info('\tSee https://git.coolaj86.com/coolaj86/telebitd.js');
  console.info('');
  console.info('');
  process.exit(0);
}

if (-1 === confIndex || -1 !== argv.indexOf('-h') || -1 !== argv.indexOf('--help')) {
  help();
}
if (!confpath || /^--/.test(confpath)) {
  help();
}

function applyConfig(config) {
  var state = { ports: [ 80, 443 ], tcp: {} };
  state.tlsOptions = {}; // TODO just close the sockets that would use this early? or use the admin servername
  state.config = config;
  state.servernames = config.servernames || [];
  state.secret = state.config.secret;
  if (!state.secret) {
    state.secret = require('crypto').randomBytes(16).toString('hex');
    console.info("");
    console.info("Secret for this session:");
    console.info("");
    console.info("\t" + state.secret);
    console.info("");
    console.info("");
  }
  if (!state.config.greenlock) {
    state.config.greenlock = {};
  }
  if (!state.config.greenlock.configDir) {
    state.config.greenlock.configDir = require('os').homedir() + require('path').sep + 'acme';
  }

  function approveDomains(opts, certs, cb) {
    console.log('[debug] approveDomains', opts.domains);
    // This is where you check your database and associated
    // email addresses with domains and agreements and such

    // The domains being approved for the first time are listed in opts.domains
    // Certs being renewed are listed in certs.altnames
    if (certs) {
      opts.domains = certs.altnames;
      cb(null, { options: opts, certs: certs });
      return;
    }

    if (state.config.vhost) {
      console.log('[sni] vhost checking is turned on');
      var vhost = state.config.vhost.replace(/:hostname/, opts.domains[0]);
      require('fs').readdir(vhost, function (err, nodes) {
        console.log('[sni] checking fs vhost');
        if (err) { check(); return; } 
        if (nodes) { approve(); }
      });
      return;
    }

    function approve() {
      opts.email = state.config.email;
      opts.agreeTos = state.config.agreeTos;
      opts.challenges = {
        // TODO dns-01
        'http-01': require('le-challenge-fs').create({ webrootPath: '/tmp/acme-challenges' })
      };
      opts.communityMember = state.config.communityMember;
      cb(null, { options: opts, certs: certs });
    }

    function check() {
      console.log('[sni] checking servername');
      if (-1 !== state.servernames.indexOf(opts.domain) || -1 !== (state._servernames||[]).indexOf(opts.domain)) {
        approve();
      } else {
        cb(new Error("failed the approval chain '" + opts.domains[0] + "'"));
      }
      console.log('Approve Domains cb');
    }
    check();
  }

/*
  if (!config.email || !config.agreeTos) {
    console.error("You didn't specify --email <EMAIL> and --agree-tos");
    console.error("(required for ACME / Let's Encrypt / Greenlock TLS/SSL certs)");
    console.error("");
    process.exit(1);
  }
*/

  state.greenlock = Greenlock.create({

    version: state.config.greenlock.version || 'draft-11'
  , server: state.config.greenlock.server || 'https://acme-v02.api.letsencrypt.org/directory'
  //, server: 'https://acme-staging-v02.api.letsencrypt.org/directory'

  , store: require('le-store-certbot').create({ debug: true, webrootPath: '/tmp/acme-challenges' })

  , approveDomains: approveDomains

  , configDir: state.config.greenlock.configDir
  , debug: state.config.debug || state.config.greenlock.debug

  //, approvedDomains: program.servernames

  });

  require('../handlers').create(state); // adds directly to config for now...

  //require('cluster-store').create().then(function (store) {
    //program.store = store;

    var net = require('net');
    var netConnHandlers = telebitd.create(state); // { tcp, ws }
    var WebSocketServer = require('ws').Server;
    var wss = new WebSocketServer({ server: (state.httpTunnelServer || state.httpServer) });
    wss.on('connection', netConnHandlers.ws);
    state.ports.forEach(function (port) {
      if (state.tcp[port]) {
        console.error("skipping previously added port " + port);
        return;
      }
      state.tcp[port] = net.createServer();
      state.tcp[port].listen(port, function () {
        console.log('listening plain TCP on ' + port);
      });
      //state.tcp[port].on('connection', function (conn) { netConnHandlers.tcp(conn, port); });
      state.tcp[port].on('connection', netConnHandlers.tcp);
    });
  //});
}

require('fs').readFile(confpath, 'utf8', function (err, text) {
  var config;

  var recase = require('recase').create({});
  var camelCopy = recase.camelCopy.bind(recase);

  if (err) {
    console.error("\nCouldn't load config:\n\n\t" + err.message + "\n");
    process.exit(1);
    return;
  }

  try {
    config = JSON.parse(text);
  } catch(e1) {
    try {
      config = require('js-yaml').safeLoad(text);
    } catch(e2) {
      console.error(e1.message);
      console.error(e2.message);
      process.exit(1);
      return;
    }
  }

  applyConfig(camelCopy(config));
});



function adjustArgs() {
  function collectServernames(val, memo) {
    var lowerCase = val.split(/,/).map(function (servername) {
      return servername.toLowerCase();
    });

    return memo.concat(lowerCase);
  }

  function collectProxies(val, memo) {
    var vals = val.split(/,/g);
    vals.map(function (location) {
      // http:john.example.com:3000
      // http://john.example.com:3000
      var parts = location.split(':');
      if (1 === parts.length) {
        parts[1] = parts[0];
        parts[0] = 'wss';
      }
      if (2 === parts.length) {
        if (/\./.test(parts[0])) {
          parts[2] = parts[1];
          parts[1] = parts[0];
          parts[0] = 'wss';
        }
        if (!/\./.test(parts[1])) {
          throw new Error("bad --serve option Example: wss://tunnel.example.com:1337");
        }
      }
      parts[0] = parts[0].toLowerCase();
      parts[1] = parts[1].toLowerCase().replace(/(\/\/)?/, '') || '*';
      parts[2] = parseInt(parts[2], 10) || 0;
      if (!parts[2]) {
        // TODO grab OS list of standard ports?
        if (-1 !== [ 'ws', 'http' ].indexOf(parts[0])) {
          //parts[2] = 80;
        }
        else if (-1 !== [ 'wss', 'https' ].indexOf(parts[0])) {
          //parts[2] = 443;
        }
        else {
          throw new Error("port must be specified - ex: tls:*:1337");
        }
      }

      return {
        protocol: parts[0]
      , hostname: parts[1]
      , port: parts[2]
      };
    }).forEach(function (val) {
      memo.push(val);
    });

    return memo;
  }

  function collectPorts(val, memo) {
    return memo.concat(val.split(/,/g).map(Number).filter(Boolean));
  }

  program
    .version(pkg.version)
    .option('--agree-tos', "Accept the Daplie and Let's Encrypt Terms of Service")
    .option('--email <EMAIL>', "Email to use for Daplie and Let's Encrypt accounts")
    .option('--serve <URL>', 'comma separated list of <proto>:<//><servername>:<port> to which matching incoming http and https should forward (reverse proxy). Ex: https://john.example.com,tls:*:1337', collectProxies, [ ])
    .option('--ports <PORT>', 'comma separated list of ports on which to listen. Ex: 80,443,1337', collectPorts, [ ])
    .option('--servernames <STRING>', 'comma separated list of servernames to use for the admin interface. Ex: tunnel.example.com,tunnel.example.net', collectServernames, [ ])
    .option('--secret <STRING>', 'the same secret used by telebitd (used for JWT authentication)')
    .parse(process.argv)
    ;

  var portsMap = {};
  var servernamesMap = {};
  program.serve.forEach(function (proxy) {
    servernamesMap[proxy.hostname] = true;
    if (proxy.port) {
      portsMap[proxy.port] = true;
    }
  });
  program.servernames.forEach(function (name) {
    servernamesMap[name] = true;
  });
  program.ports.forEach(function (port) {
    portsMap[port] = true;
  });

  program.servernames = Object.keys(servernamesMap);
  if (!program.servernames.length) {
    throw new Error('You must give this server at least one servername for its admin interface. Example:\n\n\t--servernames tunnel.example.com,tunnel.example.net');
  }

  program.ports = Object.keys(portsMap);
  if (!program.ports.length) {
    program.ports = [ 80, 443 ];
  }

  if (!program.secret) {
    // TODO randomly generate and store in file?
    console.warn("[SECURITY] you must provide --secret '" + require('crypto').randomBytes(16).toString('hex') + "'");
    process.exit(1);
    return;
  }

  //program.tlsOptions.SNICallback = program.greenlock.httpsOptions.SNICallback;
  /*
  program.middleware = program.greenlock.middleware(function (req, res) {
    res.end('Hello, World!');
  });
  */
}

//adjustArgs();

}());
