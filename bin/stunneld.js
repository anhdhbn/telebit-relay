#!/usr/bin/env node
(function () {
'use strict';

var pkg = require('../package.json');

var program = require('commander');
var url = require('url');
var stunneld = require('../wstunneld.js');
var greenlock = require('greenlock');

function collectServernames(val, memo) {
  val.split(/,/).forEach(function (servername) {
    memo.push(servername.toLowerCase());
  });

  return memo;
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
  memo = memo.concat(val.split(/,/g).filter(Boolean));
  return memo;
}

program
  .version(pkg.version)
  //.command('jsurl <url>')
  .arguments('<url>')
  .action(function (url) {
    program.url = url;
  })
  .option('--agree-tos', "Accept the Daplie and Let's Encrypt Terms of Service")
  .option('--email <EMAIL>', "Email to use for Daplie and Let's Encrypt accounts")
  .option('--serve <URL>', 'comma separated list of <proto>:<//><servername>:<port> to which matching incoming http and https should forward (reverse proxy). Ex: https://john.example.com,tls:*:1337', collectProxies, [ ])
  .option('--ports <PORT>', 'comma separated list of ports on which to listen. Ex: 80,443,1337', collectPorts, [ ])
  .option('--servernames <STRING>', 'comma separated list of servernames to use for the admin interface. Ex: tunnel.example.com,tunnel.example.net', collectServernames, [ ])
  .option('--secret <STRING>', 'the same secret used by stunneld (used for JWT authentication)')
  .parse(process.argv)
  ;

program.stunneld = program.stunneld || 'wss://tunnel.daplie.com';

var jwt = require('jsonwebtoken');
var domainsMap = {};
var tokenData = { name: null, domains: null };
var location = url.parse(program.stunneld);

if (!location.protocol || /\./.test(location.protocol)) {
  program.stunneld = 'wss://' + program.stunneld;
  location = url.parse(program.stunneld);
}
program.stunneld = location.protocol + '//' + location.hostname + (location.port ? ':' + location.port : '');

program.serve.forEach(function (proxy) {
  domainsMap[proxy.hostname] = true;
});
tokenData.domains = Object.keys(domainsMap);
tokenData.name = tokenData.domains[0];

if (!program.ports.length) {
  program.ports = [ 80, 443 ];
}
program.services = {};
program.portsMap = {};
program.servernamesMap = {};
program.serve.forEach(function (proxy) {
  //program.services = { 'ssh': 22, 'http': 80, 'https': 443 };
  program.servernamesMap[proxy.hostname] = true;
  program.services[proxy.protocol] = proxy.port;
  if (proxy.port) {
    program.portsMap[proxy.port] = true;
  }
});
program.servernames = Object.keys(program.servernamesMap);
program.ports = program.ports.concat(Object.keys(program.portsMap));
program.token = program.token || jwt.sign(tokenData, program.secret || 'shhhhh');

if (!program.serve.length) {
  throw new Error("must specify at least on server");
}

if (!program.secret) {
  // TODO randomly generate and store in file?
  console.warn("[SECURITY] you must provide --secret '" + require('crypto').randomBytes(16).toString('hex') + "'");
  process.exit(1);
  return;
}

// TODO letsencrypt
program.tlsOptions = require('localhost.daplie.com-certificates').merge({});

function approveDomains(opts, certs, cb) {
  // This is where you check your database and associated
  // email addresses with domains and agreements and such

  // The domains being approved for the first time are listed in opts.domains
  // Certs being renewed are listed in certs.altnames
  if (certs) {
    opts.domains = certs.altnames;
  }
  else {
    if (-1 !== program.servernames.indexOf(opts.domain)) {
      opts.email = program.email;
      opts.agreeTos = program.agreeTos;
    }
  }

  // NOTE: you can also change other options such as `challengeType` and `challenge`
  // opts.challengeType = 'http-01';
  // opts.challenge = require('le-challenge-fs').create({});

  cb(null, { options: opts, certs: certs });
}

if (!program.email || !program.agreeTos) {
  console.error("You didn't specify --email <EMAIL> and --agree-tos");
  console.error("(required for ACME / Let's Encrypt / Greenlock TLS/SSL certs)");
  console.error("");
  process.exit(1);
}
program.greenlock = greenlock.create({

  //server: 'staging'
  server: 'https://acme-v01.api.letsencrypt.org/directory'

, challenges: {
		// TODO dns-01
		'http-01': require('le-challenge-fs').create({ webrootPath: '/tmp/acme-challenges' })
	}

, store: require('le-store-certbot').create({ webrootPath: '/tmp/acme-challenges' })

, email: program.email

, agreeTos: program.agreeTos

, approveDomains: approveDomains

//, approvedDomains: program.servernames

});
//program.tlsOptions.SNICallback = program.greenlock.SNICallback;
/*
program.middleware = program.greenlock.middleware(function (req, res) {
  res.end('Hello, World!');
});
*/

require('../handlers').create(program); // adds directly to program for now...

//require('cluster-store').create().then(function (store) {
  //program.store = store;

  var net = require('net');
  var netConnHandlers = stunneld.create(program); // { tcp, ws }
  var WebSocketServer = require('ws').Server;
  var wss = new WebSocketServer({ server: (program.httpTunnelServer || program.httpServer) });
	wss.on('connection', netConnHandlers.ws);
  program.ports.forEach(function (port) {
    var tcp3000 = net.createServer();
    tcp3000.listen(port, function () {
      console.log('listening on ' + port);
    });
    tcp3000.on('connection', netConnHandlers.tcp);
  });
//});

}());
