/*
curl -s --user 'api:YOUR_API_KEY' \
    https://api.mailgun.net/v3/YOUR_DOMAIN_NAME/messages \
    -F from='Excited User <mailgun@YOUR_DOMAIN_NAME>' \
    -F to=YOU@YOUR_DOMAIN_NAME \
    -F to=bar@example.com \
    -F subject='Hello' \
    -F text='Testing some Mailgun awesomeness!'
*/
var _auths = module.exports._auths = {};
module.exports.authenticate = function (opts) {
  console.log("It's auth'n time!");
  var util = require('util');
  var requestAsync = util.promisify(require('request'));
  var state = opts.state;
  var jwtoken = opts.auth;
  var auth;
  var mailer = {
    user: 'wizard@telebit.cloud'
  , secret: 'fbbf21d73c9d2f480bd0e71f5f18494e'
  };
  var crypto = require('crypto');

  console.log('[DEBUG] ext auth', jwtoken);
  auth = jwtoken;
  if ('object' === typeof auth && /^.+@.+\..+$/.test(auth.subject)) {
    console.log('parsed');
    var id = crypto.randomBytes(16).toString('base64').replace(/\+/,'-').replace(/\//g,'_').replace(/=/g,'');
    console.log("[DEBUG] gonna send email");
    return requestAsync({
      url: 'https://api.mailgun.net/v3/telebit.cloud/messages'
    , method: 'POST'
    , auth: { user: 'api', pass: 'key-70ef48178081df19783ecfbe6fed5e9a' }
    , formData: {
        from: 'Telebit Wizard <wizard@telebit.cloud>'
      , to: auth.subject
      , subject: 'Telebit: Magic Link Login'
      , text: "Here's your magic login link. Just click to confirm your login attempt:\n\n"
          + '    https://www.telebit.cloud/login/?magic=' + id + '\n\n'
          + "The login request came from '" + auth.hostname + "'\n "
          + "(" + auth.os_arch + " " + auth.os_platform + " " + auth.os_release + ")\n"
      }
    }).then(function (resp) {
      console.log("[DEBUG] email was sent, or so they say");
      console.log(resp.body);
      return new state.Promise(function (resolve, reject) {
        // TODO use global interval whenever the number of active links is high
        var t = setTimeout(function () {
          console.log("the moon lady wins :-/");
          delete _auths[id];
          var err = new Error("Login Failure: Magic Link was not clicked within 5 minutes");
          err.code = 'E_LOGIN_TIMEOUT';
          reject();
        }, 300 * 1000);

        function authorize() {
          console.log("mighty auth'n ranger!");
          clearTimeout(t);
          delete _auths[id];
          var hri = require('human-readable-ids').hri;
          var hrname = hri.random() + '.telebit.cloud';
          var jwt = require('jsonwebtoken');
          var tokenData = {
            domains: [ hrname ]
          , ports: [ 1024 + Math.round(Math.random() * 6300) ]
          , aud: 'telebit.cloud'
          , iss: Math.round(Date.now() / 1000)
          , id: id
          , hostname: auth.hostname
          };
          tokenData.jwt = jwt.sign(tokenData, state.secret);
          resolve(tokenData);
          return tokenData;
        }

        _auths[id] = {
          dt: Date.now()
        , resolve: authorize
        , reject: reject
        };

      });
    });
  }

  console.log("just trying a normal token...");
  try {
    decoded = jwt.decode(jwtoken, { complete: true });
  } catch(e) {
    decoded = null;
  }

  return state.defaults.authenticate(opts.auth);
};
//var loaded = false;
var path = require('path');
var express = require('express');
var app = express();
app.use('/', express.static(path.join(__dirname, 'extensions/admin')));
app.use('/login', function (req, res) {
  var tokenData;
  var magic = req.query.magic;
  if (_auths[magic]) {
    tokenData = _auths[magic].resolve();
    res.send("<h1>Your device is authorized for the following:</h1><pre><code>" + JSON.stringify(tokenData, null, 2) + "</code></pre>");
  } else {
    res.send("<h1>Invalid Magic Link</h1>"
    + "<pre><code>'" + magic + "' isn't a valid link.\nLinks are only good for 5 minutes, so act fast.\n"
    + "(" + new Date(1000*((_auths[magic]||{}).dt||0)).toISOString() + ")</code></pre>\n"
    );
  }
});
module.exports.webadmin = function (state, req, res) {
  //if (!loaded) { loaded = true; app.use('/', state.defaults.webadmin); }
  console.log('[DEBUG] extensions webadmin');
  app(req, res);
};
