(function () {
'use strict';

function app(req, res) {
  console.log('hello');
  res.send({ msg: "hello" });
}

var tlsOpts = require('localhost.daplie.com-certificates').merge({});
var url = require('url');
var WebSocketServer = require('ws').Server;
var server = require('https').createServer(tlsOpts, app);
var wss = new WebSocketServer({ server: server });
//var express = require('express');
//var app = express();
var port = 3000;

wss.on('connection', function connection(ws) {
	console.log('connection');
  var location = url.parse(ws.upgradeReq.url, true);

	console.log('location.query.access_token');
	console.log(location.query.access_token);
  // you might use location.query.access_token to authenticate or share sessions
  // or ws.upgradeReq.headers.cookie (see http://stackoverflow.com/a/16395220/151312)

  ws.on('message', function incoming(message) {
    console.log('received: %s', message);
  });

  //ws.send('something');
});

server.listen(port, function () { console.log('Listening on ' + server.address().port); });

}());
