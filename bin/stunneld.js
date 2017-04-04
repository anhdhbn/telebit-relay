#!/usr/bin/env node
(function () {
'use strict';

var pkg = require('../package.json');

var program = require('commander');
var stunneld = require('../wstunneld.js');

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
  .option('--serve <URL>', 'comma separated list of <proto>:<//><servername>:<port> to which matching incoming http and https should forward (reverse proxy). Ex: https://john.example.com,tls:*:1337', collectProxies, [ ])
  .option('--ports <PORT>', 'comma separated list of ports on which to listen. Ex: 80,443,1337', collectPorts, [ ])
  .option('--secret <STRING>', 'the same secret used by stunneld (used for JWT authentication)')
  .parse(process.argv)
  ;

if (!program.serve.length) {
  throw new Error("must specify at least one server");
}

var portsMap = {};
var servernamesMap = {};
program.serve.forEach(function (proxy) {
  servernamesMap[proxy.hostname] = true;
  if (proxy.port) {
    portsMap[proxy.port] = true;
  }
});
program.ports.forEach(function (port) {
  portsMap[port] = true;
});

var opts = {};
opts.servernames = Object.keys(servernamesMap);
opts.ports = Object.keys(portsMap);
if (!opts.ports.length) {
  opts.ports = [ 80, 443 ];
}

if (program.secret) {
  opts.secret = program.secret;
} else {
  // TODO randomly generate and store in file?
  console.warn("[SECURITY] using default --secret 'shhhhh'");
  opts.secret = 'shhhhh';
}

// TODO letsencrypt
opts.tlsOptions = require('localhost.daplie.com-certificates').merge({});

stunneld.create(opts);
}());
