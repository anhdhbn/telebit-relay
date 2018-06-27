'use strict';

var fs = require('fs');
var path = require('path');
var util = require('util');
var crypto = require('crypto');
var escapeHtml = require('escape-html');
var jwt = require('jsonwebtoken');
var requestAsync = util.promisify(require('request'));

var _auths = module.exports._auths = {};
var Auths = {};
Auths._no_pin = {
  toString: function () {
    return Math.random().toString();
  }
};
Auths.get = function (idOrSecret) {
  var auth = _auths[idOrSecret];
  if (!auth) { return; }
  if (auth.exp && auth.exp < Date.now()) { return; }
  return auth;
};
Auths.getBySecret = function (secret) {
  var auth = Auths.get(secret);
  if (!auth) { return; }
  if (!crypto.timingSafeEqual(
      Buffer.from(auth.secret.padStart(127, ' '))
    , Buffer.from((secret || '').padStart(127, ' '))
  )) {
    return;
  }
  return auth;
};
Auths.getBySecretAndPin = function (secret, pin) {
  var auth = Auths.getBySecret(secret);
  if (!auth) { return; }

  // TODO v1.0.0 : Security XXX : clients must define a pin

  // 1. Check if the client defined a pin (it should)
  if (auth.pin === Auths._no_pin) {
    // 2. If the browser defined a pin, it should be some variation of 000 000
    if (pin && 0 !== parseInt(pin, 10)) { return; }

  } else if (!crypto.timingSafeEqual(
      Buffer.from(auth.pin.toString().padStart(127, ' '))
    , Buffer.from((pin || '').padStart(127, ' '))
  )) {
    // 3. The client defined a pin and it doesn't match what the browser defined
    return;
  }

  return auth;
};
Auths.set = function (auth, id, secret) {
  auth.id = auth.id || id || crypto.randomBytes(12).toString('hex');
  auth.secret = auth.secret || secret || crypto.randomBytes(12).toString('hex');
  _auths[auth.id] = auth;
  _auths[auth.secret] = auth;
  return auth;
};
Auths._clean = function () {
  Object.keys(_auths).forEach(function (key) {
    var err;
    if (_auths[key]) {
      if (_auths[key].exp < Date.now()) {
        if ('function' === typeof _auths[key].reject) {
          err = new Error("Login Failure: Magic Link was not clicked within 5 minutes");
          err.code = 'E_LOGIN_TIMEOUT';
          _auths[key].reject(err);
        }
        _auths[key] = null;
        delete _auths[key];
      }
    }
  });
};

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
    var pathname = path.join(__dirname, 'emails', auth.subject);
    fs.writeFile(pathname, JSON.stringify(auth), function (err) {
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
  var authReq = opts.auth;
  var jwt = require('jsonwebtoken');
  var auth;

  authReq.id = crypto.randomBytes(12).toString('hex');
  authReq.secret = crypto.randomBytes(12).toString('hex');

  return sendMail(state, authReq).then(function () {
    var now = Date.now();
    var pin = (authReq.otp || '').toString().replace(/\s\+/g, '') || Auths._no_pin;
    var authnData = {
      domains: []
    , ports: []
    , aud: state.config.webminDomain
    , iat: Math.round(now / 1000)
    , id: authReq.id
    , sub: authReq.subject
    , pin: pin
    , hostname: authReq.hostname
    };
    auth = {
      id: authReq.id
    , secret: authReq.secret
    , subject: authReq.subject
    , pin: pin
    , dt: now
    , exp: now + (2 * 60 * 60 * 1000)
    , authnData: authnData
    , authn: jwt.sign(authnData, state.secret)
    , request: authReq
    };
    authnData.jwt = auth.authn;
    Auths.set(auth, authReq.id, authReq.secret);
    return authnData;
  });
};
module.exports.pairPin = function (opts) {
  var state = opts.state;
  return state.Promise.resolve().then(function () {
    var pin = opts.pin;
    var secret = opts.secret;
    var auth = Auths.getBySecret(secret);

    if (!auth) {
      throw new Error("Invalid magic link token '" + secret + "'");
    }
    auth = Auths.getBySecretAndPin(secret, pin);
    if (!auth) {
      throw new Error("Invalid pairing code '" + pin + "' for magic link token '" + secret + "'");
    }

    if (auth._offered) {
      return auth._offered;
    }

    var hri = require('human-readable-ids').hri;
    var hrname = hri.random() + '.' + state.config.sharedDomain;
    // TODO check used / unused names and ports
    var authzData = {
      id: auth.id
    , domains: [ hrname ]
    , ports: [ (1024 + 1) + Math.round(Math.random() * 65535) ]
    , aud: state.config.webminDomain
    , iat: Math.round(Date.now() / 1000)
    , hostname: auth.hostname
    };
    var pathname = path.join(__dirname, 'emails', auth.subject + '.' + hrname + '.data');
    auth.authz = jwt.sign(authzData, state.secret);
    authzData.jwt = auth.authz;
    if (auth.resolve) {
      auth.resolve(auth);
    }
    fs.writeFile(pathname, JSON.stringify(authzData), function (err) {
      if (err) {
        console.error('[ERROR] in writing token details');
        console.error(err);
      }
    });
    auth._offered = authzData;
    return authzData;
  });
};

// From a WS connection
module.exports.authenticate = function (opts) {
  var jwt = require('jsonwebtoken');
  var jwtoken = opts.auth;
  var authReq = opts.auth;
  var state = opts.state;
  var auth;
  var decoded;

  function getPromise(auth) {
    if (auth.promise) { return auth.promise; }

    auth.promise = new state.Promise(function (resolve, reject) {

      // Resolve
      // this should resolve when the magic link is clicked in the email
      // and the pair code is entered in successfully

      // Reject
      // this should reject when the pair code is entered incorrectly
      // multiple times (or something else goes wrong)
      // this will cause the websocket to disconnect

      auth.resolve = function (auth) {
        opts.auth = auth.authz;
        auth.resolve = null;
        auth.reject = null;
        // NOTE XXX: This is premature in the sense that we can't be 100% sure
        // that the client is still on the other end. We'll need to implement some
        // sort of check that the client actually received the token
        // (i.e. when the grant event gets an ack)
        auth._claimed = true;
        return state.defaults.authenticate(opts.auth).then(resolve);
      };
      auth.reject = function (err) {
        auth.resolve = null;
        auth.reject = null;
        reject(err);
      };
    });

    return auth.promise;
  }

  if ('object' === typeof authReq && /^.+@.+\..+$/.test(authReq.subject)) {
    console.log("[ext token] Looks Like Auth Object");
    return module.exports.pairRequest(opts).then(function (authnData) {
      console.log("[ext token] Promises Like Auth Object");
      var auth = Auths.get(authnData.id);
      return getPromise(auth);
    });
  }

  console.log("[ext token] Trying Token Parse");
  try {
    decoded = jwt.decode(jwtoken, { complete: true });
    auth = Auths.get(decoded.payload.id);
  } catch(e) {
    console.log("[ext token] Token Did Not Parse");
    decoded = null;
  }

  console.log("[ext token] decoded auth token:");
  console.log(decoded);

  if (!auth) {
    console.log("[ext token] did not find auth object");
  }

  // TODO technically this could leak the token through a timing attack
  // but it would require already knowing the semi-secret id and having
  // completed the pair code
  if (auth && (auth.authn === jwtoken || auth.authz === jwtoken)) {
    if (!auth.authz) {
      console.log("[ext token] Promise Authz");
      return getPromise(auth);
    }

    console.log("[ext token] Use Available Authz");
    // If they used authn but now authz is available, use authz
    // (i.e. connects, but no domains or ports)
    opts.auth = auth.authz;
    // The browser may poll for this value
    // otherwise we could also remove the auth at this time
    auth._claimed = true;
  }

  console.log("[ext token] Continue With Auth Token");
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
app.use('/api', bodyParser.json());

// From Device (which knows id, but not secret)
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

// From Browser (which knows secret, but not pin)
app.get('/api/telebit.cloud/pair_request/:secret', function (req, res) {
  var secret = req.params.secret;
  var auth = Auths.getBySecret(secret);
  var crypto = require('crypto');
  var response = {};


  if (!auth) {
    res.send({ error: { message: "Invalid" } });
    return;
  }

  auth.referer = req.headers.referer;
  auth.user_agent = req.headers['user-agent'];

  response.id = auth.id;
  // do not reveal email or otp
  [ 'scope', 'hostname', 'os_type', 'os_platform', 'os_release', 'os_arch' ].forEach(function (key) {
    response[key] = auth.request[key];
  });
  res.send(response);
});

// From User (which has entered pin)
function pairCode(req, res) {
  console.log("DEBUG telebit.cloud magic");
  console.log(req.body || req.params);

  var magic;
  var pin;

  if (req.body) {
    magic = req.body.magic;
    pin = req.body.pin;
  } else {
    magic = req.params.magic || req.query.magic;
    pin = req.params.pin || req.query.pin;
  }

  return module.exports.pairPin({
    state: req._state
  , secret: magic
  , pin: pin
  }).then(function (tokenData) {
    res.send(tokenData);
  }, function (err) {
    res.send({ error: { message: err.toString() } });
    //res.send(tokenData || { error: { code: "E_TOKEN", message: "Invalid or expired magic link. (" + magic + ")" } });
  });
}
app.post('/api/telebit.cloud/pair_code', pairCode);
// Alternate From User (TODO remove in favor of the above)
app.get('/api/telebit.cloud/magic/:magic/:pin?', pairCode);

// From Device and Browser (polling)
app.get(urls.pairState, function (req, res) {
  // check if pair is complete
  // respond immediately if so
  // wait for a little bit otherwise
  // respond if/when it completes
  // or respond after time if it does not complete
  var auth = Auths.get(req.params.id); // id or secret accepted
  if (!auth) {
    res.send({ status: 'invalid' });
    return;
  }

  function check(i) {
    if (auth._claimed) {
      res.send({
        status: 'complete'
      });
    } else if (auth._offered) {
      res.send({
        status: 'ready', access_token: auth.authz
      , grant: { domains: auth.domains || [], ports: auth.ports || [] }
      });
    } else if (false === auth._offered) {
      res.send({ status: 'failed', error: { message: "device pairing failed" } });
    } else if (i >= 5) {
      var stateUrl = 'https://' + req._state.config.apiDomain + urls.pairState.replace(/:id/g, auth.id);
      res.statusCode = 200;
      res.setHeader('Location',  stateUrl);
      res.setHeader('Link', '<' + stateUrl + '>;rel="next"');
      res.send({ status: 'pending' });
    } else {
      setTimeout(check, 3 * 1000, i + 1);
    }
  }
  check(0);
});

module.exports.webadmin = function (state, req, res) {
  //if (!loaded) { loaded = true; app.use('/', state.defaults.webadmin); }
  var host = (req.headers.host || '').toLowerCase().split(':')[0];
  if (state.config.webminDomain === host) {
    console.log("[static] " + req.headers.host + req.url);
    staticApp(req, res);
    return;
  }
  if ((state.config.apiDomain || ('api.' + state.config.webminDomain )) === host) {
    console.log("[api] " + req.headers.host + req.url);
    req._state = state;
    app(req, res);
    return;
  }
  if ('www.' + state.config.webminDomain === host) {
    console.log("[nowww] " + req.headers.host + req.url);
    nowww(req, res);
    return;
  }
  console.warn("[unhandled] " + req.headers.host + req.url);
  res.end("Didn't recognize '" + escapeHtml(host) + "'. Not sure what to do.");
};
