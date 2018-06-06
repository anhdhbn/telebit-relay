/*
curl -s --user 'api:YOUR_API_KEY' \
    https://api.mailgun.net/v3/YOUR_DOMAIN_NAME/messages \
    -F from='Excited User <mailgun@YOUR_DOMAIN_NAME>' \
    -F to=YOU@YOUR_DOMAIN_NAME \
    -F to=bar@example.com \
    -F subject='Hello' \
    -F text='Testing some Mailgun awesomeness!'
*/
module.exports.authenticate = function (opts) {
  var util = require('util');
  var requestAsync = util.promisify(require('request'));
  var state = opts.state;
  var jwtoken = opts.auth;
  var mailer = {
    user: 'wizard@telebit.cloud'
  , secret: 'fbbf21d73c9d2f480bd0e71f5f18494e'
  };
  var crypto = require('crypto');
  if (!state._auths) {
    state._auths = {};
  }

  if ('{' === jwtoken) {
    try {
      auth = JSON.parse(auth);
    } catch(e) {
      auth = null;
    }
    if (auth && /^.+@.+\..+$.test(auth.subject)) {
      var id = crypto.randomBytes(16).toString('hex');
      state._auths[id] = {};
			return requestAsync({
				url: 'https://api.mailgun.net/v3/YOUR_DOMAIN_NAME/messages'
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
			}).then(function () {
        console.log("[DEBUG] email was sent, or so they say");
        return new state.Promise(function (resolve, reject) {
          // TODO use global interval whenever the number of active links is high
          var t = setTimeout(function () {
            delete state._auths[id];
            var err = new Error("Login Failure: Magic Link was not clicked within 5 minutes");
            err.code = 'E_LOGIN_TIMEOUT';
            reject();
          }, 300 * 1000);
 
          function authorize() {
            clearTimeout(t);
            delete state._auths[id];
						var hri = require('human-readable-ids').hri;
						var hrname = hri.random() + '.telebit.cloud';
						var jwt = require('jsonwebtoken');
						var tokenData = {
							domains: [ hrname ]
						, ports: [ 1024 + Math.round(Math.random() * 6300) ]
						, aud: 'telebit.cloud'
						, iss: Math.round(Date.now() / 1000)
            , id: id
						};
            tokenData.jwt = jwt.sign(tokenData, state.secret);
            resolve(tokenData);
          }

          state._auths[id] = {
            fn: authorize
          , dt: Date.now()
          , reject: reject
          };

        });
      });
    }
  }

  try {
    decoded = jwt.decode(jwtoken, { complete: true });
  } catch(e) {
    decoded = null;
  }

  return state.defaults.authenticate(opts.auth);
};
