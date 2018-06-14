'use strict';
module.exports = function (pkg, root, cb) {
  process.nextTick(function () {
    cb(null, { message: "upgrade complete" });
  });
  return { message: "placeholder upgrade: nothing to do yet" };
};
