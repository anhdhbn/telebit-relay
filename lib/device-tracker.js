'use strict';

var Devices = module.exports;
Devices.add = function (store, servername, newDevice) {
  var devices = store[servername] || [];
  devices.push(newDevice);
  store[servername] = devices;
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
  if (store[servername] && store[servername].length) {
    return store[servername];
  }
  // There wasn't an exact match so check any of the wildcard domains, sorted longest
  // first so the one with the biggest natural match with be found first.
  var deviceList = [];
  Object.keys(store).filter(function (pattern) {
    return pattern[0] === '*' && store[pattern].length;
  }).sort(function (a, b) {
    return b.length - a.length;
  }).some(function (pattern) {
    var subPiece = pattern.slice(1);
    if (subPiece === servername.slice(-subPiece.length)) {
      console.log('"'+servername+'" matches "'+pattern+'"');
      deviceList = store[pattern];
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
