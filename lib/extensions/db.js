'use strict';

var PromiseA;
try {
  PromiseA = require('bluebird');
} catch(e) {
  PromiseA = global.Promise;
}

var path = require('path');
var sfs = require('safe-replace');

var DB = module.exports = {};
DB._savefile = path.join(__dirname, 'permissions.json');
DB._load = function () {
  try {
    DB._perms = require(DB._savefile);
  } catch(e) {
    try {
      DB._perms = require(DB._savefile + '.bak');
    } catch(e) {
      DB._perms = [];
    }
  }
  DB._byDomain = {};
  DB._byPort = {};
  DB._byEmail = {};
  DB._byPpid = {};
  DB._byId = {};
  DB._grants = {};
  DB._grantsMap = {};
  DB._perms.forEach(function (acc) {
    if (acc.id) {
      // if account has an id
      DB._byId[acc.id] = acc;
      if (!DB._grants[acc.id]) {
        DB._grantsMap[acc.id] = {};
        DB._grants[acc.id] = [];
      }
      acc.domains.forEach(function (d) {
        DB._grants[d.name + '|id|' + acc.id] = true;
        if (!DB._grantsMap[acc.id][d.name]) {
          DB._grantsMap[acc.id][d.name] = d;
          DB._grants[acc.id].push(d);
        }
      });
      acc.ports.forEach(function (p) {
        DB._grants[p.number + '|id|' + acc.id] = true;
        if (!DB._grantsMap[acc.id][p.number]) {
          DB._grantsMap[acc.id][p.number] = p;
          DB._grants[acc.id].push(p);
        }
      });
    } else if (acc.nodes[0] && 'email' === acc.nodes[0].type) {
      // if primary (first) node is email
      //console.log("XXXX email", acc.nodes[0].name);
      if (!DB._byEmail[acc.nodes[0].name]) {
        DB._byEmail[acc.nodes[0].name] = {
          account: acc
        , node: acc.nodes[0]
        };
      }
    }
    // map domains to all nodes that have permission
    // (which permission could be granted by more than one account)
    acc.nodes.forEach(function (node) {
      if ('mailto' === node.scheme || 'email' === node.type) {
        if (!DB._grants[node.name]) {
          DB._grantsMap[node.name] = {};
          DB._grants[node.name] = [];
        }
        acc.domains.forEach(function (d) {
          DB._grants[d.name + '|' + (node.scheme||node.type) + '|' + node.name] = true;
          if (!DB._grantsMap[node.name][d.name]) {
            DB._grantsMap[node.name][d.name] = d;
            DB._grants[node.name].push(d);
          }
        });
        acc.ports.forEach(function (p) {
          DB._grants[p.number + '|' + (node.scheme||node.type) + '|' + node.name] = true;
          if (!DB._grantsMap[node.name][p.number]) {
            DB._grantsMap[node.name][p.number] = p;
            DB._grants[node.name].push(p);
          }
        });
      }
    });
    // TODO this also should be maps/arrays (... or just normal database)
    acc.domains.forEach(function (domain) {
      if (DB._byDomain[domain.name]) {
        console.warn("duplicate domain '" + domain.name + "'");
        console.warn("::existing account '" + acc.nodes.map(function (node) { return node.name; }) + "'");
        console.warn("::new account '" + DB._byDomain[domain.name].account.nodes.map(function (node) { return node.name; }) + "'");
      }
      DB._byDomain[domain.name] = {
        account: acc
      , domain: domain
      };
    });
    acc.ports.forEach(function (port) {
      if (DB._byPort[port.number]) {
        console.warn("duplicate port '" + port.number + "'");
        console.warn("::existing account '" + acc.nodes.map(function (node) { return node.name; }) + "'");
        console.warn("::new account '" + DB._byPort[port.number].account.nodes.map(function (node) { return node.name; }) + "'");
      }
      DB._byPort[port.number] = {
        account: acc
      , port: port
      };
    });
  });
};
DB._load();
DB.accounts = {};
DB.accounts.get = function (obj) {
  return PromiseA.resolve().then(function () {
    //console.log('XXXX obj.name', DB._byEmail[obj.name]);
    return DB._byId[obj.name] || (DB._byEmail[obj.name] || {}).account || null;
  });
};
DB.accounts.add = function (obj) {
  return PromiseA.resolve().then(function () {
    if (obj.id) {
      // TODO more checks
      DB._perms.push(obj);
    } else if ('email' === obj.nodes[0].type || obj.email) {
      obj.email = undefined;
      DB._perms.push(obj);
    }
  });
};
DB.domains = {};
DB.domains.available = function (name) {
  return PromiseA.resolve().then(function () {
    return !DB._byDomain[name];
  });
};
DB.domains._add = function (acc, opts) {
  // TODO verifications to change ownership of a domain
  return PromiseA.resolve().then(function () {
    var err;
    //var acc = DB._byId[aid];
    var domain = {
      name: (opts.domain || opts.name)
    , hostname: opts.hostname
    , os: opts.os
    , createdAt: new Date().toISOString()
    , wildcard: opts.wildcard
    };
    var pdomain;
    var parts = (opts.domain || domain.name).split('.').map(function (el, i, arr) {
      return arr.slice(i).join('.');
    }).reverse();
    parts.shift();
    parts.pop();
    if (parts.some(function (part) {
      if (DB._byDomain[part]) {
        pdomain = part;
        return true;
      }
    })) {
      err = new Error("'" + domain.name + "' exists as '" + pdomain + "' and therefore requires an admin to review and approve");
      err.code = "E_REQ_ADMIN";
      throw err;
    }
    if (DB._byDomain[domain.name]) {
      if (acc !== DB._byDomain[domain.name].account) {
        throw new Error("domain '" + domain.name + "' exists");
      }
      // happily ignore non-change
      return;
    }
    DB._byDomain[domain.name] = {
      account: acc
    , domain: domain
    };
    acc.domains.push(domain);
  });
};
DB.ports = {};
DB.ports.available = function (number) {
  return PromiseA.resolve().then(function () {
    return !DB._byPort[number];
  });
};
DB.ports._add = function (acc, opts) {
  return PromiseA.resolve().then(function () {
    //var acc = DB._byId[aid];
    var port = {
      number: opts.port || opts.number
    , hostname: opts.hostname
    , os: opts.os
    , createdAt: new Date().toISOString()
    };
    if (DB._byPort[port.number]) {
      // TODO verifications
      throw new Error("port '" + port.number + "' exists");
    }
    DB._byPort[port.number] = {
      account: acc
    , port: port
    };
    acc.ports.push(port);
  });
};
DB._save = function () {
  return sfs.writeFileAsync(DB._savefile, JSON.stringify(DB._perms));
};
DB._saveToken = null;
DB._savePromises = [];
DB._savePromise = PromiseA.resolve();
DB.save = function () {
  clearTimeout(DB._saveToken);
  return new PromiseA(function (resolve, reject) {
    function doSave() {
      DB._savePromise = DB._savePromise.then(function () {
        return DB._save().then(function (yep) {
          DB._savePromises.forEach(function (p) {
            p.resolve(yep);
          });
          DB._savePromises.length = 1;
        }, function (err) {
          DB._savePromises.forEach(function (p) {
            p.reject(err);
          });
          DB._savePromises.length = 1;
        });
      });
      return DB._savePromise;
    }

    DB._saveToken = setTimeout(doSave, 2500);
    DB._savePromises.push({ resolve: resolve, reject: reject });
  });
};
