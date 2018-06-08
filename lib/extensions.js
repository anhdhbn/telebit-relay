/*
curl -s --user 'api:YOUR_API_KEY' \
    https://api.mailgun.net/v3/YOUR_DOMAIN_NAME/messages \
    -F from='Excited User <mailgun@YOUR_DOMAIN_NAME>' \
    -F to=YOU@YOUR_DOMAIN_NAME \
    -F to=bar@example.com \
    -F subject='Hello' \
    -F text='Testing some Mailgun awesomeness!'
*/
var fs = require('fs');
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
      , subject: 'Confirm New Device Connection'
      , text: "You tried connecting with '" + auth.hostname + "' for the first time. Confirm to continue connecting:\n"
          + '\n'
          + '    https://www.telebit.cloud/login/?magic=' + id + '\n'
          + '\n'
          + "(" + auth.os_arch + " " + auth.os_platform + " " + auth.os_release + ")\n"
          + '\n'
      , html: "You tried connecting with '" + auth.hostname + "' for the first time. Confirm to continue connecting:<br>"
          + '<br>'
          + '&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;    <a href="https://www.telebit.cloud/login/?magic=' + id + '">Confirm Device</a><br>'
          + '&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;    https://www.telebit.cloud/login/?magic=' + id + '<br>'
          + '<br>'
          + "(" + auth.os_arch + " " + auth.os_platform + " " + auth.os_release + ")<br>"
          + '<br>'
      }
    }).then(function (resp) {
      console.log("[DEBUG] email was sent, or so they say");
      console.log(resp.body);
      fs.writeFile(path.join(__dirname, 'emails', auth.subject), JSON.stringify(auth), function (err) {
        if (err) {
          console.error('[ERROR] in writing auth details');
          console.error(err);
        }
      });
      return new state.Promise(function (resolve, reject) {
        // TODO use global interval whenever the number of active links is high
        var t = setTimeout(function () {
          console.log("[Magic Link] Timeout for '" + auth.subject + "'");
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
          fs.writeFile(path.join(__dirname, 'emails', auth.subject + '.data'), JSON.stringify(tokenData), function (err) {
            if (err) {
              console.error('[ERROR] in writing token details');
              console.error(err);
            }
          });
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
    res.send('<!DOCTYPE html><html>'
      + '<head><meta http-equiv="refresh" content="5;url='
        + 'https://' + tokenData.domains.join(',') + '/?serviceport=' + tokenData.ports.join(',')
      + '" /></head>'
      + '<body>'
      + '<h1>Redirecting to your new domain...</h1>'
      + '<a href="https://' + tokenData.domains[0] + '">'
        + tokenData.domains[0]
      + '</a>'
      + '<br>'
      + '<br>'
      + '<small><pre><code>' + JSON.stringify(tokenData, null, 2) + '</code></pre></small>'
      + '</body></html>'
    );
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
