'use strict';
module.exports = function (opts, cb) {
  var pkg = opts.package;
  var root = opts.root;

  //console.log('DEBUG pkg', pkg);
  //console.log('DEBUG root', root);
  process.nextTick(function () {
    cb(null, { message: "upgrade complete" });
  });
  return { message: "placeholder upgrade: nothing to do yet" };
};
