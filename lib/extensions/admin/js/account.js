(function () {
  'use strict';
  var OAUTH3 = window.OAUTH3;
  var oauth3 = OAUTH3.create({
    host: window.location.host
  , pathname: window.location.pathname.replace(/\/[^\/]*$/, '/')
  });
  var $ = function () { return document.querySelector.apply(document, arguments); }
  var vueData = {
    domains: []
  , newDomain: null
  , newEmail: null
  , hasAccount: false
  , token: null
  };
  var app = new Vue({
    el: '.v-app'
  , data: vueData
  , methods: {
      challengeDns: function () {
        console.log("A new (DNS) challenger!", vueData);
      }
    , challengeEmail: function () {
        console.log("A new (Email) challenger!", vueData);
      }
    }
  });

  function listStuff(data) {
    //window.alert("TODO: show authorized devices, domains, and connectivity information");
    vueData.hasAccount = true;
    vueData.domains = data.domains;
  }

  var sessionStr = localStorage.getItem('session');
  var session;
  if (sessionStr) {
    try {
      session = JSON.parse(sessionStr);
    } catch(e) {
      // ignore
    }
  }

  function loadAccount(session) {
    return oauth3.request({
      url: 'https://api.' + location.hostname + '/api/telebit.cloud/account'
    , session: session
    }).then(function (resp) {

      console.info("Telebit Account:");
      console.log(resp.data);

      if (resp.data && resp.data.domains) {
        listStuff(resp.data);
        return;
      }

      if (1 === resp.data.accounts.length) {
        listStuff(resp);
      } else if (0 === resp.data.accounts.length) {
        return oauth3.request({
          url: 'https://api.' + location.hostname + 'api/telebit.cloud/account'
        , method: 'POST'
        , session: session
        , body: {
            email: email
          }
        }).then(function (resp) {
          listStuff(resp);
        });
      } if (resp.data.accounts.length > 2) {
        window.alert("Multiple accounts.");
      } else {
        window.alert("Bad response.");
      }

    });
  }

  function onChangeProvider(providerUri) {
    // example https://oauth3.org
    return oauth3.setIdentityProvider(providerUri);
  }

  // This opens up the login window for the specified provider
  //
  function onClickLogin(ev) {
    ev.preventDefault();
    ev.stopPropagation();

    var email = $('.js-auth-subject').value;

    // TODO check subject for provider viability
    return oauth3.authenticate({
      subject: email
    , scope: 'email@oauth3.org'
    }).then(function (session) {

      console.info('Authentication was Successful:');
      console.log(session);

      // You can use the PPID (or preferably a hash of it) as the login for your app
      // (it securely functions as both username and password which is known only by your app)
      // If you use a hash of it as an ID, you can also use the PPID itself as a decryption key
      //
      console.info('Secure PPID (aka subject):', session.token.sub);

      return oauth3.request({
        url: 'https://api.oauth3.org/api/issuer@oauth3.org/jwks/:sub/:kid.json'
          .replace(/:sub/g, session.token.sub)
          .replace(/:kid/g, session.token.iss)
      , session: session
      }).then(function (resp) {
        console.info("Public Key:");
        console.log(resp.data);

        return oauth3.request({
          url: 'https://api.oauth3.org/api/issuer@oauth3.org/acl/profile'
        , session: session
        }).then(function (resp) {

          console.info("Inspect Token:");
          console.log(resp.data);

          localStorage.setItem('session', JSON.stringify(session));
          loadAccount(session)
        });

      });

    }, function (err) {
      console.error('Authentication Failed:');
      console.log(err);
    });
  }

  $('body form.js-auth-form').addEventListener('submit', onClickLogin);
  onChangeProvider('oauth3.org');
  if (session) {
    vueData.token = session.access_token
    loadAccount(session);
  }
}());
