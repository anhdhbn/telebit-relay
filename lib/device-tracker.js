'use strict';

var Devices = module.exports;
Devices.add = function (store, servername, newDevice) {
  if (!store[servername]) {
    store[servername] = [];
  }
  var devices = store[servername];
  devices.push(newDevice);
};
Devices.alias = function (store, servername, alias) {
  if (!store[servername]) {
    store[servername] = [];
  }
  if (!store[servername]._primary) {
    store[servername]._primary = servername;
  }
  if (!store[servername].aliases) {
    store[servername].aliases = {};
  }
  store[alias] = store[servername];
  store[servername].aliases[alias] = true;
};
Devices.remove = function (store, servername, device) {
  var devices = store[servername] || [];
  var index = devices.indexOf(device);

  if (index < 0) {
    console.warn('attempted to remove non-present device', device.deviceId, 'from', servername);
    return null;
  }
  return devices.splice(index, 1)[0];
};
Devices.list = function (store, servername) {
  // efficient lookup first
  if (store[servername] && store[servername].length) {
    return store[servername]._primary && store[store[servername]._primary] || store[servername];
  }

  // There wasn't an exact match so check any of the wildcard domains, sorted longest
  // first so the one with the biggest natural match with be found first.
  var deviceList = [];
  Object.keys(store).filter(function (pattern) {
    return pattern[0] === '*' && store[pattern].length;
  }).sort(function (a, b) {
    return b.length - a.length;
  }).some(function (pattern) {
    // '.example.com' = '*.example.com'.split(1)
    var subPiece = pattern.slice(1);
    // '.com' = 'sub.example.com'.slice(-4)
    // '.example.com' = 'sub.example.com'.slice(-12)
    if (subPiece === servername.slice(-subPiece.length)) {
      console.log('[Devices.list] "'+servername+'" matches "'+pattern+'"');
      deviceList = store[pattern];

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
