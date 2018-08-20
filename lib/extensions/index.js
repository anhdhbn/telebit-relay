'use strict';

var PromiseA;
try {
  PromiseA = require('bluebird');
} catch(e) {
  PromiseA = global.Promise;
}

var fs = require('fs');
var sfs = require('safe-replace').create({ tmp: 'tmp', bak: 'bak' });
var path = require('path');
var util = require('util');
var crypto = require('crypto');
var escapeHtml = require('escape-html');
var jwt = require('jsonwebtoken');
var requestAsync = util.promisify(require('@coolaj86/urequest'));
//var readFileAsync = util.promisify(fs.readFile);
var mkdirpAsync = util.promisify(require('mkdirp'));
var TRUSTED_ISSUERS = [ 'oauth3.org' ];
var DB = require('./db.js');
var Devices = require('../device-tracker');
var Claims = {};
Claims.publicize = function publicizeClaim(claim) {
  if (!claim) {
    return null;
  }
  var result = { type: claim.type, value: claim.value, verifiedAt: claim.verifiedAt, createdAt: claim.createdAt };
  if ('dns' === claim.type) { result.challenge = claim.challenge; }
  return result;
};

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

var sfs = require('safe-replace');
var Accounts = {};
Accounts._getTokenId = function (auth) {
  return auth.data.sub + '@' + (auth.data.iss||'').replace(/\/|\\/g, '-');
};
Accounts._accPath = function (req, accId) {
  return path.join(req._state.config.accountsDir, 'self', accId);
};
Accounts._subPath = function (req, id) {
  return path.join(req._state.config.accountsDir, 'oauth3', id);
};
Accounts._setSub = function (req, id, subData) {
  var subpath = Accounts._subPath(req, id);
  return mkdirpAsync(subpath).then(function () {
    return sfs.writeFileAsync(path.join(subpath, 'index.json'), JSON.stringify(subData));
  });
};
Accounts._setAcc = function (req, accId, acc) {
  var accpath = Accounts._accPath(req, accId);
  return mkdirpAsync(accpath).then(function () {
    return sfs.writeFileAsync(path.join(accpath, 'index.json'), JSON.stringify(acc));
  });
};
Accounts.create = function (req) {
  var id = Accounts._getTokenId(req.auth);
  var acc = {
    sub: crypto.randomBytes(16).toString('hex')
         // TODO use something from the request to know which of the domains to use
  , iss: req._state.config.webminDomain
  , contacts: []
  };
  var accId = Accounts._getTokenId(acc);
  acc.id = accId;

  // TODO notify any non-authorized accounts that they've been added?
  return Accounts.getBySub(req).then(function (subData) {
    subData.accounts.push({ type: 'self', id: accId });
    acc.contacts.push({ type: 'oauth3', id: subData.id, sub: subData.sub, iss: subData.iss });
    return Accounts._setSub(req, id, subData).then(function () {
      return Accounts._setAcc(req, accId, acc).then(function () {
        return acc;
      });
    });
  });
};
Accounts._associateEmails = function (req) {
  if (-1 === (req._state.config.trustedIssuers||TRUSTED_ISSUERS).indexOf(req.auth.data.iss)) {
    // again, make sure that untrusted issuers do not get
    return null;
  }

  // oauth3.org, issuer@oauth3.org, profile
  return OAUTH3.request({
    url: "https://api." + req.auth.data.iss + "/api/issuer@oauth3.org/acl/profile"
  , session: { accessToken: req.auth.jwt, token: req.auth.data }
  }).then(function (resp) {
    var email;
    var err;
    (resp.data.nodes||[]).some(function (/*node*/) {
      // TODO use verified email addresses
      return true;
    });
    // back-compat for current way email is stored
    if (!email && /@/.test(resp.data.username)) {
      email = resp.data.username;
    }
    if (!email) {
      err = new Error ("could not find a verified email address in profile settings");
      err.code = "E_NO_EMAIL";
      return PromiseA.reject(err);
    }

    return [ { scheme: 'mailto', type: 'email', name: email } ];
  });
};

/*
// TODO an owner of an asset can give permission to another entity
// but that does not mean that that owner has access to that entity's things
// Example:
//   A 3rd party login's email verification cannot be trusted for auth
//   Only 1st party verifications can be trusted for authorization
Accounts.link = function (req) {
};
*/

Accounts.getOrCreate = function (req) {
  var id = Accounts._getTokenId(req.auth);
  var idNode = { createdAt: new Date().toISOString(), type: 'ppid', name: id };

  return DB.accounts.get(idNode).then(function (acc) {
    if (acc) { return acc; }
    acc = { createdAt: idNode.createdAt, id: id, sub: req.auth.sub, iss: req.auth.iss,
      domains: [], ports: [], nodes: [ idNode ] };
    return DB.accounts.add(acc).then(function () {
      // intentionally not returned to the promise chain
      DB.save().catch(function (err) {
        console.error('DB.save() failed:');
        console.error(err);
      });
      return acc;
    });
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
  var subj = "Confirm New Device for Your Telebit Account";
  var text = "Hello!\n"
        + '\n'
        + "Want to use '{{hostname}}' with Telebit?\n"
        + "Just confirm your email address by clicking the link below:\n"
        + '\n'
        + '    https://' + state.config.webminDomain + '/login/#/magic={{secret}}\n'
        + '\n'
        + "({{os_arch}} {{os_platform}} {{os_release}})\n"
        + '\n'
        ;
  var html = "<h3>Hello!</h3>"
        + '<br>'
        + "Want to use '{{hostname}}' with Telebit?<br>"
        + "Just confirm your email address by clicking the link below:<br>"
        + '<br>'
        + '&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;    <a href="https://' + state.config.webminDomain + '/login/#/magic={{secret}}">Confirm Email Address</a><br>'
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
    // anything in the 200 range
    if (2 === Math.floor(resp.statusCode / 100)) {
      console.log("[DEBUG] email was sent, or so they say");
    } else {
      console.error("[Error] email failed to send, or so they say:");
      console.error(resp.headers);
      console.error(resp.statusCode, resp.body);
      return PromiseA.reject(new Error("Error sending email: " + resp.statusCode + " " + resp.body));
    }
  });
}

// TODO replace with OAuth3 function
function oauth3Auth(req, res, next) {
  var jwt = require('jsonwebtoken');
  var verifyJwt = util.promisify(jwt.verify);
  var token = (req.headers.authorization||'').replace(/^bearer /i, '');
  var auth;
  var authData;

  if (!token) {
    res.send({
      error: {
        code: "E_NOAUTH"
      , message: "no authorization header"
      }
    });
    return;
  }

  try {
    authData = jwt.decode(token, { complete: true });
  } catch(e) {
    authData = null;
  }

  if (!authData) {
    res.send({
      error: {
        code: "E_PARSEAUTH"
      , message: "could not parse authorization header as JWT"
      }
    });
    return;
  }

  auth = authData.payload;
  if (!auth.sub && ('*' === auth.aud || '*' === auth.azp)) {
    res.send({
      error: {
        code: "E_NOIMPL"
      , message: "missing 'sub' and a wildcard 'azp' or 'aud' indicates that this is an exchange token,"
         + " however, this app has not yet implemented opaque token exchange"
      }
    });
    return;
  }

  if ([ 'sub', 'iss' ].some(function (key) {
    if ('string' !== typeof auth[key]) {
      res.send({
        error: {
          code: "E_PARSEAUTH"
        , message: "could not read property '" + key + "' of authorization token"
        }
      });
      return true;
    }
  })) { return; }
  if ([ 'kid' ].some(function (key) {
    if (/\/|\\/.test(authData.header[key])) {
      res.send({
        error: {
          code: "E_PARSESUBJECT"
        , message: "'" + key + "' `" + JSON.stringify(authData.header[key]) + "' contains invalid characters"
        }
      });
      return true;
    }
  })) { return; }
  if ([ 'sub', 'kid' ].some(function (key) {
    if (/\/|\\/.test(auth[key])) {
      res.send({
        error: {
          code: "E_PARSESUBJECT"
        , message: "'" + key + "' `" + JSON.stringify(auth[key]) + "' contains invalid characters"
        }
      });
      return true;
    }
  })) { return; }

  // TODO needs to work with app:// and custom://
  function prefixHttps(str) {
    return (str||'').replace(/^(https?:\/\/)?/i, 'https://');
  }

  var url = require('url');
  var discoveryUrl = url.resolve(prefixHttps(auth.iss), '_apis/oauth3.org/index.json');
  console.log('discoveryUrl: ', discoveryUrl, auth.iss);
  return requestAsync({
    url: discoveryUrl
  , json: true
  }).then(function (resp) {

    // TODO
    // it may be necessary to exchange the token,

    if (200 !== resp.statusCode || 'object' !== typeof resp.body || !resp.body.retrieve_jwk
        || 'string' !== typeof resp.body.retrieve_jwk.url || 'string' !== typeof resp.body.api) {
      res.send({
        error: {
          code: "E_NOTFOUND"
        , message: resp.statusCode + ": issuer `" + JSON.stringify(auth.iss)
            + "' does not declare 'api' & 'retrieve_key' and hence the token you provided cannot be verified."
        , _status: resp.statusCode
        , _url: discoveryUrl
        , _body: resp.body
        }
      });
      return;
    }
    var keyUrl = url.resolve(
        prefixHttps(resp.body.api).replace(/:hostname/g, auth.iss)
      , resp.body.retrieve_jwk.url
          .replace(/:hostname/g, auth.iss)
          .replace(/:sub/g, auth.sub)
          // TODO
          .replace(/:kid/g, authData.header.kid || auth.iss)
    );
    console.log('keyUrl: ', keyUrl);
    return requestAsync({
      url: keyUrl
    , json: true
    }).then(function (resp) {
      var jwk = resp.body;
      console.log('Retrieved token\'s JWK: ', resp.body);
      if (200 !== resp.statusCode || 'object' !== typeof resp.body) {
        //headers.authorization
        res.send({
          error: {
            code: "E_NOTFOUND"
          , message: resp.statusCode + ": did not retrieve public key from `" + JSON.stringify(auth.iss)
              + "' for token validation and hence the token you provided cannot be verified."
          , _status: resp.statusCode
          , _url: keyUrl
          , _body: resp.body
          }
        });
        return;
      }

      var pubpem;
      try {
        pubpem = require('jwk-to-pem')(jwk, { private: false });
      } catch(e) {
        console.error("jwk-to-pem", e);
        pubpem = null;
      }
			return verifyJwt(token, pubpem, {
				algorithms: [ 'RS256', 'RS384', 'RS512', 'ES256', 'ES384', 'ES512' ]
			}).then(function (decoded) {
        if (!decoded) {
          res.send({
            error: {
              code: "E_UNVERIFIED"
            , message: "retrieved jwk does not verify provided token."
            , _jwk: jwk
            }
          });
        }
        req.auth = {};
        req.auth.jwt = token;
        req.auth.data = auth;
        next();
			});
    });
  }).catch(function (err) {
    res.send({
      error: {
        code: err.code || "E_GENERIC"
      , message: err.toString()
      }
    });
  });
}
var OAUTH3 = require('oauth3.js').create({ pathname: process.cwd() });
/*
// TODO all of the above should be replace with the official lib
return OAUTH3.jwk.verifyToken(req.auth.jwt).then(function (token) {
}).catch(function (err) {
});
*/

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
    , os_type: authReq.os_type
    , os_platform: authReq.os_platform
    , os_release: authReq.os_release
    , os_arch: authReq.os_arch
    };
    auth = {
      id: authReq.id
    , secret: authReq.secret
    , subject: authReq.subject
    , pin: pin
    , dt: now
    , exp: now + (2 * 60 * 60 * 1000)
    , request: authReq
    };

    // Setting extra authnData
    auth.authn = jwt.sign(authnData, state.secret);
    authnData.jwt = auth.authn;
    auth.authnData = authnData;
    Auths.set(auth, authReq.id, authReq.secret);
    return authnData;
  });
};
DB.getDomainAndPort = function (state) {
  var domainCount = 0;
  var portCount = 0;

  function chooseDomain() {
    var err;
    if (domainCount >= 3) {
      err = new Error("there too few unallocated domains left");
      err.code = "E_DOMAINS_EXHAUSTED";
      return PromiseA.reject(err);
    }
    domainCount += 1;
    var hri = require('human-readable-ids').hri;
    var i = Math.floor(Math.random() * state.config.sharedDomains.length);
    var hrname = hri.random() + '.' + state.config.sharedDomains[i];
    return DB.domains.available(hrname).then(function (available) {
      if (!available) { return chooseDomain(); }
      return hrname;
    });
  }
  function choosePort() {
    var err;
    if (portCount >= 3) {
      err = new Error("there too few unallocated ports left");
      err.code = "E_PORTS_EXHAUSTED";
      return PromiseA.reject(err);
    }
    portCount += 1;
    var portnumber = (1024 + 1) + Math.round(Math.random() * 65535);
    return DB.ports.available(portnumber).then(function (available) {
      if (!available) { return choosePort(); }
      return portnumber;
    });
  }
  return PromiseA.all([
    chooseDomain()
  , choosePort()
  ]).then(function (two) {
    return {
      domain: two[0]
    , port: two[1]
    };
  });
};
module.exports.pairPin = function (opts) {
  var state = opts.state;
  return state.Promise.resolve().then(function () {
    var pin = opts.pin;
    var secret = opts.secret;
    var auth = Auths.getBySecret(secret);

    console.log('[pairPin] validating secret and pin');
    if (!auth) {
      throw new Error("Invalid magic link token '" + secret + "'");
    }
    auth = Auths.getBySecretAndPin(secret, pin);
    if (!auth) {
      throw new Error("Invalid pairing code '" + pin + "' for magic link token '" + secret + "'");
    }

    if (auth._offered) {
      console.log('[pairPin] already has offer to return');
      return auth._offered;
    }

    console.log('[pairPin] generating offer');
    return DB.getDomainAndPort(state).then(function (grantable) {
      var emailNode = { scheme: 'mailto', type: 'email', name: auth.subject };

      return DB.accounts.get(emailNode).then(function (_acc) {
        var acc = _acc;
        if (!acc) {
          acc = { email: true, domains: [], ports: [], nodes: [ emailNode ] };
        }
        return PromiseA.all([
          DB.domains._add(acc, { domain: grantable.domain, wildcard: true, hostname: auth.authnData.hostname,
            os: auth.authnData.os_type, arch: auth.authnData.os_arch })
        , DB.ports._add(acc, { port: grantable.port, hostname: auth.authnData.hostname,
            os: auth.authnData.os_type, arch: auth.authnData.os_arch })
        ]).then(function () {
          var authzData = {
            id: auth.id
          , domains: [ grantable.domain ]
          , ports: [ grantable.port ]
          , aud: state.config.webminDomain
          , iat: Math.round(Date.now() / 1000)
            // of the client's computer
          , hostname: auth.hostname
          };
          auth.authz = jwt.sign(authzData, state.secret);
          auth.authzData = authzData;
          authzData.jwt = auth.authz;
          auth._offered = authzData;
          if (auth.resolve) {
            console.log('[pairPin] resolving');
            auth.resolve(auth);
          } else {
            console.log('[pairPin] not resolvable');
          }

          if (!_acc) {
            return DB.accounts.add(acc).then(function () {
              // intentionally not returned to the promise chain
              DB.save().catch(function (err) {
                console.error('DB.save() failed:');
                console.error(err);
              });
              return authzData;
            });
          } else {
            return authzData;
          }
        });
      });

      /*
      var pathname = path.join(__dirname, 'emails', auth.subject + '.' + hrname + '.data');
      fs.writeFile(pathname, JSON.stringify(authzData), function (err) {
        if (err) {
          console.error('[ERROR] in writing token details');
          console.error(err);
        }
      });
      */
    });
  });
};

// From a WS connection
module.exports.authHelper = function (meta) {
  console.log('[authHelper] 1');
  var state = meta.state;
  console.log('[authHelper] 2');
  return state.Promise.resolve().then(function () {
    console.log('[authHelper] 3');
    var auth = meta.session;
    console.log('[authHelper] 4', auth);
    if (!auth || 'string' !== typeof auth.authz || 'object' !== typeof auth.authzData) {
      console.log('[authHelper] 5');
      console.error("[SANITY FAIL] should not complete auth without authz data and access_token");
      console.error(auth);
      return;
    }
    console.log("[authHelper] passing authzData right along", auth.authzData);
    return auth.authzData;
  });
};
// opts = { state: state, auth: auth_request OR access_token }
module.exports.authenticate = function (opts) {
  var jwt = require('jsonwebtoken');
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
        auth.resolve = null;
        auth.reject = null;
        // NOTE XXX: This is premature in the sense that we can't be 100% sure
        // that the client is still on the other end. We'll need to implement some
        // sort of check that the client actually received the token
        // (i.e. when the grant event gets an ack)
        auth._claimed = true;
        // this is probably not necessary anymore
        opts.auth = auth.authz;
        return module.exports.authHelper({
          state: state
        , session: auth
        }).then(resolve);
      };
      auth.reject = function (err) {
        auth.resolve = null;
        auth.reject = null;
        reject(err);
      };
    });

    return auth.promise;
  }

  // Promise Authz on Auth Creds
  // TODO: remove
  if ('object' === typeof opts.auth && /^.+@.+\..+$/.test(opts.auth.subject)) {
    console.log("[wss.ext.authenticate] [1] Request Pair for Credentials");
    return module.exports.pairRequest(opts).then(function (authnData) {
      console.log("[wss.ext.authenticate] [2] Promise Authz on Pair Complete");
      var auth = Auths.get(authnData.id);
      return getPromise(auth);
      //getPromise(auth);
      //return state.defaults.authenticate(authnData.jwt);
    });
  }

  try {
    decoded = jwt.decode(opts.auth, { complete: true });
    auth = Auths.get(decoded.payload.id);
  } catch(e) {
    console.log("[wss.ext.authenticate] [Error] could not parse token");
    decoded = null;
  }
  console.log("[wss.ext.authenticate] incoming token decoded:");
  console.log(decoded);

  if (!auth) {
    console.log("[wss.ext.authenticate] no session / auth handshake. Pass to default auth");
    return state.defaults.authenticate(opts.auth);
  }

  // TODO technically this could leak the token through a timing attack
  // but it would require already knowing the semi-secret id and having
  // completed the pair code
  if (auth.authn === opts.auth || auth.authz === opts.auth) {
    if (!auth.authz) {
      console.log("[wss.ext.authenticate] Create authz promise and passthru");
      return getPromise(auth);
    }

    // If they used authn but now authz is available, use authz
    // (i.e. connects, but no domains or ports)
    opts.auth = auth.authz;
    // The browser may poll for this value
    // otherwise we could also remove the auth at this time
    auth._claimed = true;
  }

  console.log("[wss.ext.authenticate] Already using authz, skipping promise");
  return module.exports.authHelper({ state: state, session: auth });
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
app.use('/api', CORS({
  credentials: true
, headers: [ 'Authorization', 'X-Requested-With', 'X-HTTP-Method-Override', 'Content-Type', 'Accept' ]
}));
app.use('/api', bodyParser.json());

app.use('/api/telebit.cloud/account', oauth3Auth);
app.get('/api/telebit.cloud/account', function (req, res) {
  return Accounts.getOrCreate(req).then(function (acc) {
    var hasEmail = acc.nodes.some(function (node) {
      return 'email' === node.type;
    });
    function getAllGrants() {
      return PromiseA.all(acc.nodes.map(function (node) {
        //console.log('XXXX node', node);
        return DB.accounts.get(node);
      })).then(function (grants) {
        //console.log('XXXX grants');
        //console.log(grants);
        var domainsMap = {};
        var portsMap = {};
        var claimsMap = {};
        var devsMap = {};
        var result = JSON.parse(JSON.stringify(acc));
        result.domains.length = 0;
        result.ports.length = 0;
        grants.forEach(function (account) {
          if (!account) { return; }
          //console.log('XXXX grants.forEach.account: ', account);
          account.domains.forEach(function (d) {
            domainsMap[d.name] = d;
          });
          account.ports.forEach(function (p) {
            portsMap[p.number] = p;
          });
          DB.authorizations.checkAll({ id: account.id }).filter(function (claim) {
            return !claim.verifiedAt;
          }).forEach(function (claim) {
            claimsMap[claim.challenge] = claim;
          });
        });
        result.domains = Object.keys(domainsMap).map(function (k) {
          return domainsMap[k];
        });
        result.ports = Object.keys(portsMap).map(function (k) {
          return portsMap[k];
        });
        result.claims = Object.keys(claimsMap).map(function (k) {
          return Claims.publicize(claimsMap[k]);
        });

        // TODO assign devices by public key, not domain name
        result.domains.map(function (domain) {
          console.log("[debug] Domain", domain);
          var devs = Devices.list(req._state.deviceLists, domain.name);
          console.log("[debug] Devs", devs.map(function (d) { return d.socketId; }));
          if (!devs.length) { return null; }
          devs.forEach(function (dev) {
            // eventually we should implement so that a new connection
            // with the same public key results in booting the prior session
            // then we could use device.id instead of socketId
            if (!devsMap[dev.socketId]) {
              devsMap[dev.socketId] = {
                id: dev.id
              , socketId: dev.socketId
              , active: true
              , names: []
              };
            }
            devsMap[dev.socketId].names.push(domain.name);
            return devsMap[dev.socketId];
          });
        }).filter(Boolean);
        result.devices = Object.keys(devsMap).map(function (sid) {
          return devsMap[sid];
        });

        // Help the garbage collector out a little
        domainsMap = null;
        portsMap = null;
        claimsMap = null;
        devsMap = null;

        // The data is useful! Send it away!
        return result;
      });
    }
    if (!hasEmail) {
      return Accounts._associateEmails(req).then(function (nodes) {
        nodes.forEach(function (node) {
          acc.nodes.push(node);
        });
        return getAllGrants();
      });
    } else {
      return getAllGrants();
    }
  }).then(function (result) {
    res.send(result);
  }).catch(function (err) {
    return res.send({
      error: {
        code: err.code || "E_GENERIC"
      , message: err.toString()
      , _stack: err.stack
      }
    });
  });
});
app.post('/api/telebit.cloud/account', function (req, res) {
  return Accounts.create(req).then(function (acc) {
    res.send({
      success: true
    , id: acc.id
    , sub: acc.sub
    , iss: acc.iss
    });
  });
});

// Challenge Nodes / Email, Domains / DNS
app.post('/api/telebit.cloud/account/authorizations/new', function (req, res) {
  // Send email via SMTP, confirm client's chosen pin
  var accId = Accounts._getTokenId(req.auth);
  var typ = req.body.type;
  var val = req.body.value;
  var wild = req.body.wildcard;
  var claim;

  if ('dns' === typ && /^[a-z0-9\-\.]+.[a-z]+$/i.test(val)) {
    claim = DB.authorizations.create({ id: accId }, { type: typ, value: val, wildcard: wild });
    // MUST RETURN PUBLIC VALUES ONLY!
    // (challenge is public with dns because the verification is internal)
    res.send({ success: true, claim: claim });
  } else if ('email' === typ) {
    //claim = DB.authorizations.create({ type: dns, claim: claim });
    // MUST RETURN PUBLIC VALUES ONLY!
    // (challenge is private with email because the verification is external)
    //claim.challenge = undefined;;
    // TODO send email
    res.statusCode = 501;
    res.send({ error: { code: "E_NO_IMPL", message: "authz '" + typ + "' understood but not implemented" } });
  } else {
    res.statusCode = 501;
    res.send({ error: { code: "E_NO_IMPL", message: "unknown authz type '" + typ + "'" } });
  }
});
app.get('/api/telebit.cloud/account/authorizations/status/:value?', function (req, res) {
  // For client to check on status
  var accId = Accounts._getTokenId(req.auth);
  var val = req.params.value;
  var result;

  if (val) {
    result = Claims.publicize(DB.authorizations.check({ id: accId }, { value: val }));
    // MUST RETURN PUBLIC VALUES ONLY!
    res.send({ success: true, claim: result });
  } else {
    result = DB.authorizations.checkAll({ id: accId }).map(Claims.publicize);
    // MUST RETURN PUBLIC VALUES ONLY!
    res.send({ success: true, claims: result });
  }
});
app.get('/api/telebit.cloud/account/authorizations/meta/:secret', function (req, res) {
  // For agent to retrieve metadata
  res.statusCode = 500;
  res.send({ error: { code: "E_NO_IMPL", message: "not implemented" } });
});
app.post('/api/telebit.cloud/account/authorizations/verify/:magic/:pin', function (req, res) {
  // For agent to confirm user's intent
  res.statusCode = 500;
  res.send({ error: { code: "E_NO_IMPL", message: "not implemented" } });
});
app.post('/api/telebit.cloud/account/authorizations/new/:value/:challenge?', function (req, res) {
  // For agent to confirm user's intent
  var dns = require('dns');
  var accId = Accounts._getTokenId(req.auth);
  var val = req.params.value;
  var ch = req.params.challenge;
  var claim = DB.authorizations.check({ id: accId }, { challenge: ch, value: val });

  function notFound() {
    res.send({ error: {
      code: "E_PENDING"
    , message: "Did not find '" + claim.challenge + "' among records at '_claim-challenge." + claim.value + "'"
    } });
  }

  function grantDnsClaim() {
    return Accounts.getOrCreate(req).then(function (acc) {
      return DB.domains._add(acc, { domain: claim.value, wildcard: claim.wildcard }).then(function (result) {
        if (!DB.authorizations.verify({ id: accId }, claim)) {
          var err = new Error("'_claim-challenge." + claim.value + "' matched, but final verification failed");
          err.code = "E_UNKNOWN";
          return PromiseA.reject(err);
        }
        return result;
      });
    });
  }

  function checkDns() {
    dns.resolveTxt('_claim-challenge.' + claim.value, function (err, records) {
      if (err) {
        notFound();
        return;
      }

      if (!records.some(function (txts) {
        return txts.some(function (txt) {
          console.log('TXT', txt);
          return claim.challenge === txt;
        });
      })) {
        notFound();
        return;
      }

      grantDnsClaim().then(function () {
        res.send({ success: true });
      }).catch(function (err) {
        res.send({ error: { code: err.code, message: err.toString(), _stack: err.stack } }); 
      });
    });
  }

  console.log('claim', claim);

  if ('dns' === claim.type) {
    checkDns();
  } else if ('email' === claim.type) {
    res.statusCode = 500;
    res.send({ error: { code: "E_NO_IMPL", message: "'" + claim.type + "' not implemented yet" } });
  } else {
    res.statusCode = 500;
    res.send({ error: { code: "E_NO_IMPL", message: "'" + claim.type + "' not understood" } });
  }
});


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
  //var crypto = require('crypto');
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
    console.error('[error] pairCode:');
    console.error(err);
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
    console.log("[pair_state] invalid (bad state id)", req.params.id);
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
    } else if (i >= 7) {
      var stateUrl = 'https://' + req._state.config.apiDomain + urls.pairState.replace(/:id/g, auth.id);
      res.statusCode = 200;
      res.setHeader('Location',  stateUrl);
      res.setHeader('Link', '<' + stateUrl + '>;rel="next"');
      res.send({ status: 'pending' });
    } else {
      setTimeout(check, 250, i + 1);
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
