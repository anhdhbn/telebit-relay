#!/usr/bin/env node
(function () {
'use strict';

var pkg = require('../package.json');

var program = require('commander');
var url = require('url');
var stunneld = require('../wstunneld.js');

function collectProxies(val, memo) {
  var vals = val.split(/,/g);
  vals.map(function (location) {
    // http:john.example.com:3000
    // http://john.example.com:3000
    var parts = location.split(':');
    parts[0] = parts[0].toLowerCase();
    parts[1] = parts[1].toLowerCase().replace(/(\/\/)?/, '') || '*';
    parts[2] = parseInt(parts[2], 10) || 0;
    if (!parts[2]) {
      // TODO grab OS list of standard ports?
      if ('http' === parts[0]) {
        parts[2] = 80;
      }
      else if ('https' === parts[0]) {
        parts[2] = 443;
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

program
  .version(pkg.version)
  //.command('jsurl <url>')
  .arguments('<url>')
  .action(function (url) {
    program.url = url;
  })
  .option('--serve <LINE>', 'comma separated list of <proto>:<//><servername>:<port> to which matching incoming http and https should forward (reverse proxy). Ex: https://john.example.com,tls:*:1337', collectProxies, [ ]) // --reverse-proxies
  .option('--serve <URL>', 'the domain (or ip address) at which you are running stunneld.js (the proxy)') // --proxy
  .option('--secret <STRING>', 'the same secret used by stunneld (used for JWT authentication)')
  .parse(process.argv)
  ;

program.stunneld = program.stunneld || 'wss://pokemap.hellabit.com:3000';

var jwt = require('jsonwebtoken');
var domainsMap = {};
var tokenData = {
  name: null
, domains: null
};
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

program.services = {};
program.serve.forEach(function (proxy) {
  //program.services = { 'ssh': 22, 'http': 80, 'https': 443 };
  program.services[proxy.protocol] = proxy.port;
});
program.token = program.token || jwt.sign(tokenData, program.secret || 'shhhhh');


// TODO letsencrypt
program.tlsOptions = require('localhost.daplie.com-certificates').merge({});
if (!program.secret) {
  // TODO randomly generate and store in file?
  console.warn("[SECURITY] using default --secret 'shhhhh'");
  program.secret = 'shhhhh';
}

require('cluster-store').create().then(function (store) {
  program.store = store;

  stunneld.connect(program);
});

}());
