'use strict';
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
var escapeHtml = require('escape-html');
var _auths = module.exports._auths = {};
module.exports.authenticate = function (opts) {
  console.log("It's auth'n time!");
  var util = require('util');
  var requestAsync = util.promisify(require('request'));
  var state = opts.state;
  var jwtoken = opts.auth;
  var auth;
  var crypto = require('crypto');

  console.log('[DEBUG] ext auth', jwtoken);
  auth = jwtoken;
  if ('object' === typeof auth && /^.+@.+\..+$/.test(auth.subject)) {
    console.log("[DEBUG] gonna send email");
    auth.id = crypto.randomBytes(12).toString('hex');
    //var id = crypto.randomBytes(16).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
    var subj = 'Confirm New Device Connection';
    var text = "You tried connecting with '{{hostname}}' for the first time. Confirm to continue connecting:\n"
          + '\n'
          + '    https://' + state.config.webminDomain + '/login/#/magic={{id}}\n'
          + '\n'
          + "({{os_arch}} {{os_platform}} {{os_release}})\n"
          + '\n'
          ;
    var html = "You tried connecting with '{{hostname}}' for the first time. Confirm to continue connecting:<br>"
          + '<br>'
          + '&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;    <a href="https://' + state.config.webminDomain + '/login/#/magic={{id}}">Confirm Device</a><br>'
          + '<br>'
          + '&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;    <small>or copy and paste this link:</small><br>'
          + '&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;    <small>https://' + state.config.webminDomain + '/login/#/magic={{id}}</small><br>'
          + '<br>'
          + "({{os_arch}} {{os_platform}} {{os_release}})<br>"
          + '<br>'
          ;
    [ 'id', 'hostname', 'os_arch', 'os_platform', 'os_release' ].forEach(function (key) {
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
        }, 2 * 60 * 60 * 1000);

        function authorize() {
          console.log("mighty auth'n ranger!");
          clearTimeout(t);
          delete _auths[id];
          var hri = require('human-readable-ids').hri;
          var hrname = hri.random() + '.' + state.config.sharedDomain;
          var jwt = require('jsonwebtoken');
          var tokenData = {
            domains: [ hrname ]
          , ports: [ 1024 + Math.round(Math.random() * 6300) ]
          , aud: state.config.webminDomain
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
  var decoded;
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
var staticApp = express();
var nowww = require('nowww')();
var CORS = require('connect-cors');
staticApp.use('/', express.static(path.join(__dirname, 'admin')));
app.use('/api', CORS({}));
app.get('/api/telebit.cloud/magic/:magic', function (req, res) {
  console.log("DEBUG telebit.cloud magic");
  var tokenData;
  var magic = req.params.magic || req.query.magic;
  console.log("DEBUG telebit.cloud magic 1a");
  if (_auths[magic]) {
    console.log("DEBUG telebit.cloud magic 1b");
    tokenData = _auths[magic].resolve();
    console.log("DEBUG telebit.cloud magic 1c");
    res.send(tokenData);
  } else {
    console.log("DEBUG telebit.cloud magic 2");
    res.send({ error: { code: "E_TOKEN", message: "Invalid or expired magic link." } });
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
  if ('api.' + state.config.webminDomain === host) {
    console.log("DEBUG going to api");
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
