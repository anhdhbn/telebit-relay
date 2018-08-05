'use strict';

var fs = require('fs');
var path = require('path');
var basedir = path.join(__dirname, 'emails');
var files = fs.readdirSync(basedir)

var emails = {};
files.forEach(function (fname) {
  var fpath = path.join(basedir, fname);
  var data;
  var email;
  var iat;
  var mdata;
  if (!/\.data$/.test(fname)) {
    return;
  }
  data = JSON.parse(fs.readFileSync(fpath));
  email = fname.replace('\.' + data.domains.join('') + '\.data', '');
  mdata = JSON.parse(fs.readFileSync(path.join(basedir, email)));
  if (data.iat) {
    iat = new Date(data.iat).toISOString();
  }
  if (!emails[email]) {
    emails[email] = {
      domains: []
    , ports: []
    , nodes: [ { createdAt: iat, scheme: 'mailto', type: 'email', name: email } ]
    , jtis: []
    };
  }
  emails[email].jtis.push(data.id);
  data.domains.forEach(function (d) {
    emails[email].domains.push({ createdAt: iat, name: d, wildcard: true, hostname: mdata.hostname
      , os: mdata.os_type, arch: mdata.os_arch });
  });
  data.ports.forEach(function (p) {
    emails[email].ports.push({ createdAt: iat, number: p, hostname: mdata.hostname
      , os: mdata.os_type, arch: mdata.os_arch });
  });
});
console.log('[\n' + Object.keys(emails).map(function (k) { return JSON.stringify(emails[k]); }).join(',\n') + '\n]');
