'use strict';

var timeago = require('./ago.js').AGO;

function test() {
  [ 1.5 * 1000 // a moment ago
  , 4.5 * 1000 // moments ago
  , 10  * 1000 // 10 seconds ago
  , 59  * 1000 // a minute ago
  , 60  * 1000 // a minute ago
  , 61  * 1000 // a minute ago
  , 119  * 1000 // a minute ago
  , 120  * 1000 // 2 minutes ago
  , 121 * 1000 // 2 minutes ago
  , (60 * 60 * 1000) - 1000 // 59 minutes ago
  , 1 * 60 * 60 * 1000 // an hour ago
  , 1.5 * 60 * 60 * 1000 // an hour ago
  , 2.5 * 60 * 60 * 1000 // 2 hours ago
  , 1.5 * 24 * 60 * 60 * 1000 // a day ago
  , 2.5 * 24 * 60 * 60 * 1000 // 2 days ago
  , 7 * 24 * 60 * 60 * 1000 // a week ago
  , 14 * 24 * 60 * 60 * 1000 // 2 weeks ago
  , 27 * 24 * 60 * 60 * 1000 // 3 weeks ago
  , 28 * 24 * 60 * 60 * 1000 // 4 weeks ago
  , 29 * 24 * 60 * 60 * 1000 // 4 weeks ago
  , 1.5 * 30 * 24 * 60 * 60 * 1000 // a month ago
  , 2.5 * 30 * 24 * 60 * 60 * 1000 // 2 months ago
  , (12 * 30 * 24 * 60 * 60 * 1000) + 1000 // 12 months ago
  , 13 * 30 * 24 * 60 * 60 * 1000 // over a year ago
  ].forEach(function (d) {
    console.log(d, '=', timeago(d));
  });
}

test();
