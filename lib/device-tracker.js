'use strict';

var Devices = module.exports;
Devices.addPort = function (store, serverport, newDevice) {
  // TODO make special
  return Devices.add(store, serverport, newDevice, true);
};
Devices.add = function (store, servername, newDevice, isPort) {
  if (isPort) {
    if (!store._ports) { store._ports = {}; }
  }

  // add domain (also handles ports at the moment)
  if (!store._domains) { store._domains = {}; }
  if (!store._domains[servername]) { store._domains[servername] = []; }
  store._domains[servername].push(newDevice);

  // add device
  // TODO only use a device id 
  var devId = newDevice.id || servername;
  if (!newDevice.__servername) {
    newDevice.__servername = servername;
  }
  if (!store._devices) { store._devices = {}; }
  if (!store._devices[devId]) {
    store._devices[devId] = newDevice;
    if (!store._devices[devId].domainsMap) { store._devices[devId].domainsMap = {}; }
    if (!store._devices[devId].domainsMap[servername]) { store._devices[devId].domainsMap[servername] = true; }
  }
};
Devices.alias = function (store, servername, alias) {
  if (!store._domains[servername]) {
    store._domains[servername] = [];
  }
  if (!store._domains[servername]._primary) {
    store._domains[servername]._primary = servername;
  }
  if (!store._domains[servername].aliases) {
    store._domains[servername].aliases = {};
  }
  store._domains[alias] = store._domains[servername];
  store._domains[servername].aliases[alias] = true;
};
Devices.remove = function (store, servername, device) {
  // Check if this domain has an active device
  var devices = store._domains[servername] || [];
  var index = devices.indexOf(device);

  if (index < 0) {
    console.warn('attempted to remove non-present device', device.deviceId, 'from', servername);
    return null;
  }

  // unlink this domain from this device
  var domainsMap = store._devices[devices[index].id || servername].domainsMap;
  delete domainsMap[servername];
  /*
  // remove device if no domains remain
  // nevermind, a device can hang around in limbo for a bit
  if (!Object.keys(domains).length) {
    delete store._devices[devices[index].id || servername];
  }
  */

  // unlink this device from this domain
  return devices.splice(index, 1)[0];
};
Devices.close = function (store, device) {
  var dev = store._devices[device.id || device.__servername];
  // because we're actually using names rather than  don't have reliable deviceIds yet
  if (!dev) {
    Object.keys(store._devices).some(function (key) {
      if (store._devices[key].socketId === device.socketId) {
        // TODO double check that all domains are removed
        delete store._devices[key];
        return true;
      }
    });
  }
};
Devices.bySocket = function (store, socketId) {
  var dev;
  Object.keys(store._devices).some(function (k) {
    if (store._devices[k].socketId === socketId) {
      dev = store._devices[k];
      return dev;
    }
  });
  return dev;
};
Devices.list = function (store, servername) {
  console.log('[dontkeepme] servername', servername);
  // efficient lookup first
  if (store._domains[servername] && store._domains[servername].length) {
    // aliases have ._primary which is the name of the original
    return store._domains[servername]._primary && store._domains[store._domains[servername]._primary] || store._domains[servername];
  }

  // There wasn't an exact match so check any of the wildcard domains, sorted longest
  // first so the one with the biggest natural match with be found first.
  var deviceList = [];
  Object.keys(store._domains).filter(function (pattern) {
    return pattern[0] === '*' && store._domains[pattern].length;
  }).sort(function (a, b) {
    return b.length - a.length;
  }).some(function (pattern) {
    // '.example.com' = '*.example.com'.split(1)
    var subPiece = pattern.slice(1);
    // '.com' = 'sub.example.com'.slice(-4)
    // '.example.com' = 'sub.example.com'.slice(-12)
    if (subPiece === servername.slice(-subPiece.length)) {
      console.log('[Devices.list] "'+servername+'" matches "'+pattern+'"');
      deviceList = store._domains[pattern];

      // Devices.alias(store, '*.example.com', 'sub.example.com'
      // '*.example.com' retrieves a reference to 'example.com'
      // and this reference then also referenced by 'sub.example.com'
      // Hence this O(n) check is replaced with the O(1) check above
      Devices.alias(store, pattern, servername);
      return true;
    }
  });

  return deviceList;
};
/*
Devices.active = function (store, id) {
  var dev = store._devices[id];
  return !!dev;
};
*/
Devices.exist = function (store, servername) {
  return !!(Devices.list(store, servername).length);
};
Devices.next = function (store, servername) {
  var devices = Devices.list(store, servername);
  var device;

  if (devices._index >= devices.length) {
    devices._index = 0;
  }
  device = devices[devices._index || 0];
  devices._index = (devices._index || 0) + 1;

  return device;
};
