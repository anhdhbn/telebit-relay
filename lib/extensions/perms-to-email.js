'use strict';

var perms = require('./permissions.json');
var emails = {};
perms.forEach(function (p) {
  p.nodes.forEach(function (n) {
    if ('email' === n.type) {
      emails[n.name] = true;
    }
  });
});
console.log(Object.keys(emails).join(', '));
