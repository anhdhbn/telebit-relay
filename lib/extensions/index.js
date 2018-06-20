'use strict';

var fs = require('fs');
var path = require('path');
var util = require('util');
var crypto = require('crypto');
var escapeHtml = require('escape-html');
var jwt = require('jsonwebtoken');
var requestAsync = util.promisify(require('request'));

var _auths = module.exports._auths = {};

function sendMail(state, auth) {
  console.log('[DEBUG] ext auth', auth);
  /*
  curl -s --user 'api:YOUR_API_KEY' \
      https://api.mailgun.net/v3/YOUR_DOMAIN_NAME/messages \
      -F from='Excited User <mailgun@YOUR_DOMAIN_NAME>' \
      -F to=YOU@YOUR_DOMAIN_NAME \
      -F to=bar@example.com \
      -F subject='Hello' \
      -F text='Testing some Mailgun awesomeness!'
  */
  var subj = 'Confirm New Device Connection';
  var text = "You tried connecting with '{{hostname}}' for the first time. Confirm to continue connecting:\n"
        + '\n'
        + '    https://' + state.config.webminDomain + '/login/#/magic={{secret}}\n'
        + '\n'
        + "({{os_arch}} {{os_platform}} {{os_release}})\n"
        + '\n'
        ;
  var html = "You tried connecting with '{{hostname}}' for the first time. Confirm to continue connecting:<br>"
        + '<br>'
        + '&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;    <a href="https://' + state.config.webminDomain + '/login/#/magic={{secret}}">Confirm Device</a><br>'
        + '<br>'
        + '&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;    <small>or copy and paste this link:</small><br>'
        + '&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;    <small>https://' + state.config.webminDomain + '/login/#/magic={{secret}}</small><br>'
        + '<br>'
        + "({{os_arch}} {{os_platform}} {{os_release}})<br>"
        + '<br>'
        ;
  [ 'id', 'secret', 'hostname', 'os_arch', 'os_platform', 'os_release' ].forEach(function (key) {
    var val = escapeHtml(auth[key]);
    subj = subj.replace(new RegExp('{{' + key + '}}', 'g'), val);
    text = text.replace(new RegExp('{{' + key + '}}', 'g'), val);
    html = html.replace(new RegExp('{{' + key + '}}', 'g'), val);
  });

  return requestAsync({
    url: state.config.mailer.url
  , method: 'POST'
  , auth: { user: 'api', pass: state.config.mailer.apiKey }
  , formData: {
      from: state.config.mailer.from
    , to: auth.subject
    , subject: subj
    , text: text
    , html: html
    }
  }).then(function (resp) {
    fs.writeFile(path.join(__dirname, 'emails', auth.subject), JSON.stringify(auth), function (err) {
      if (err) {
        console.error('[ERROR] in writing auth details');
        console.error(err);
      }
    });
    console.log("[DEBUG] email was sent, or so they say");
    console.log(resp.body);
  });
}

module.exports.pairRequest = function (opts) {
  console.log("It's auth'n time!");
  var state = opts.state;
  var auth = opts.auth;
  var jwt = require('jsonwebtoken');

  auth.id = crypto.randomBytes(12).toString('hex');
  auth.secret = crypto.randomBytes(12).toString('hex');
  //var id = crypto.randomBytes(16).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');

  console.log("[DEBUG] !!state", !!state);
  console.log("[DEBUG] !!auth", !!auth);
  return sendMail(state, auth).then(function () {
    var now = Date.now();
    var authnToken = {
      domains: []
    , ports: []
    , aud: state.config.webminDomain
    , iss: Math.round(now / 1000)
    , id: auth.id
    , pin: auth.otp
    , hostname: auth.hostname
    };
    _auths[auth.id] = _auths[auth.secret] = {
      dt: now
    , authn: jwt.sign(authnToken, state.secret)
    , pin: auth.otp
    , id: auth.id
    , secret: auth.secret
    };
    authnToken.jwt = _auths[auth.id].authn;
    // return empty token which will receive grants upon authorization
    return authnToken;
  });
};
module.exports.pairPin = function (opts) {
  var state = opts.state;
  return state.Promise.resolve().then(function () {
    var pin = opts.pin;
    var secret = opts.secret;
    var auth = _auths[secret];

    if (!auth || auth.secret !== opts.secret) {
      throw new Error("I can't even right now - bad magic link id");
    }

    // XXX security, we want to check the pin if it's supported serverside,
    // regardless of what the client sends. This bad logic is just for testing.
    if (pin && auth.pin && pin !== auth.pin) {
      throw new Error("I can't even right now - bad device pair pin");
    }

    auth._paired = true;
    //delete _auths[auth.id];
    var hri = require('human-readable-ids').hri;
    var hrname = hri.random() + '.' + state.config.sharedDomain;
    var authzToken = {
      domains: [ hrname ]
    , ports: [ (1024 + 1) + Math.round(Math.random() * 6300) ]
    , aud: state.config.webminDomain
    , iss: Math.round(Date.now() / 1000)
    , id: auth.id
    , hostname: auth.hostname
    };
    authzToken.jwt = jwt.sign(authzToken, state.secret);
    fs.writeFile(path.join(__dirname, 'emails', auth.subject + '.data'), JSON.stringify(authzToken), function (err) {
      if (err) {
        console.error('[ERROR] in writing token details');
        console.error(err);
      }
    });
    return authzToken;
  });
};
module.exports.pairState = function (opts) {
  var state = opts.state;
  var auth = opts.auth;
  var resolve = opts.resolve;
  var reject = opts.reject;

  // TODO use global interval whenever the number of active links is high
  var t = setTimeout(function () {
    console.log("[Magic Link] Timeout for '" + auth.subject + "'");
    delete _auths[auth.id];
    var err = new Error("Login Failure: Magic Link was not clicked within 5 minutes");
    err.code = 'E_LOGIN_TIMEOUT';
    reject();
  }, 2 * 60 * 60 * 1000);

  function authorize(pin) {
    console.log("mighty auth'n ranger!");
    clearTimeout(t);
    return module.exports.pairPin({ secret: auth.secret, pin: pin }).then(function (tokenData) {
      // TODO call state object with socket info rather than resolve
      resolve(tokenData);
      return tokenData;
    }, function (err) {
      reject(err);
      return state.Promise.reject(err);
    });
  }

  _auths[auth.id].resolve = authorize;
  _auths[auth.id].reject = reject;
};

module.exports.authenticate = function (opts) {
  var jwt = require('jsonwebtoken');
  var jwtoken = opts.auth;
  var auth = opts.auth;
  var state = opts.state;

  if ('object' === typeof auth && /^.+@.+\..+$/.test(auth.subject)) {
    return module.exports.pairRequest(opts).then(function () {
      return new state.Promise(function (resolve, reject) {
        opts.resolve = resolve;
        opts.reject = reject;
        module.exports.pairState(opts);
      });
    });
  }

  console.log("just trying a normal token...");
  var decoded;
  try {
    decoded = jwt.decode(jwtoken, { complete: true });
  } catch(e) {
    decoded = null;
  }

  return state.defaults.authenticate(opts.auth);
};

//var loaded = false;
var express = require('express');
var app = express();
var staticApp = express();
var nowww = require('nowww')();
var CORS = require('connect-cors');
var bodyParser = require('body-parser');
var urls = {
  pairState: '/api/telebit.cloud/pair_state/:id'
};
staticApp.use('/', express.static(path.join(__dirname, 'admin')));
app.use('/api', CORS({}));
app.use('/api', function (req, res, next) {
  next();
  req.on('data', function (chunk) {
    console.log('chunk', chunk.toString());
  });
  req.on('end', function () {
    console.log('end');
  });
});
app.use('/api', bodyParser.json());
// From Device
app.post('/api/telebit.cloud/pair_request', function (req, res) {
  var auth = req.body;
  console.log('[ext] pair_request (request)', req.headers);
  console.log('[ext] pair_request (request)', req.body);
  module.exports.pairRequest({ state: req._state, auth: auth }).then(function (tokenData) {
    console.log('[ext] pair_request (response)', tokenData);
    // res.send({ success: true, message: "pair request sent" });
    var stateUrl = 'https://' + req._state.config.apiDomain + urls.pairState.replace(/:id/g, tokenData.id);
    res.statusCode = 201;
    res.setHeader('Location',  stateUrl);
    res.setHeader('Link', '<' + stateUrl + '>;rel="next"');
    res.send(tokenData);
  }, function (err) {
    console.error(err);
    res.send({ error: { code: err.code, message: err.toString() } });
  });
});
// From Browser
app.post('/api/telebit.cloud/pair_code', function (req, res) {
  var auth = req.body;
  return module.exports.pairPin({ secret: auth.magic, pin: auth.pin }).then(function (tokenData) {
    res.send(tokenData);
  }, function (err) {
    res.send({ error: err });
  });
});
// From Device (polling)
app.get(urls.pairState, function (req, res) {
  // check if pair is complete
  // respond immediately if so
  // wait for a little bit otherwise
  // respond if/when it completes
  // or respond after time if it does not complete
  var auth = _auths[req.params.id];
  if (!auth) {
    res.send({ status: 'invalid' });
    return;
  }

  if (true === auth.paired) {
    res.send({
      status: 'ready', access_token: _auths[req.params.id].jwt
    , grant: { domains: auth.domains || [], ports: auth.ports || [] }
    });
  } else if (false === _auths[req.params.id].paired) {
    res.send({ status: 'failed', error: { message: "device pairing failed" } });
  } else {
    res.send({ status: 'pending' });
  }
});
// From Browser
app.get('/api/telebit.cloud/magic/:magic/:pin?', function (req, res) {
  console.log("DEBUG telebit.cloud magic");
  var tokenData;
  var magic = req.params.magic || req.query.magic;
  var pin = req.params.pin || req.query.pin;
  console.log("DEBUG telebit.cloud magic 1a", magic);
  if (_auths[magic] && magic === _auths[magic].secret) {
    console.log("DEBUG telebit.cloud magic 1b");
    tokenData = _auths[magic].resolve(pin);
    console.log("DEBUG telebit.cloud magic 1c");
    res.send(tokenData);
  } else {
    console.log("DEBUG telebit.cloud magic 2");
    res.send({ error: { code: "E_TOKEN", message: "Invalid or expired magic link. (" + magic + ")" } });
    console.log("DEBUG telebit.cloud magic 2b");
  }
});
module.exports.webadmin = function (state, req, res) {
  //if (!loaded) { loaded = true; app.use('/', state.defaults.webadmin); }
  console.log('[DEBUG] extensions webadmin');
  var host = (req.headers.host || '').toLowerCase().split(':')[0];
  if (state.config.webminDomain === host) {
    console.log("DEBUG going to static");
    staticApp(req, res);
    return;
  }
  if ((state.config.apiDomain || ('api.' + state.config.webminDomain )) === host) {
    console.log("DEBUG going to api");
    req._state = state;
    app(req, res);
    return;
  }
  if ('www.' + state.config.webminDomain === host) {
    console.log("DEBUG going to www");
    nowww(req, res);
    return;
  }
  res.end("Didn't recognize '" + escapeHtml(host) + "'. Not sure what to do.");
};
