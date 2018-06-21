(function () {
'use strict';

var meta = {};
var magic;
var domainname;

function checkStatus() {
  // TODO use Location or Link
  window.fetch(meta.baseUrl + 'api/telebit.cloud/pair_state/' + magic, {
    method: 'GET'
  , cors: true
  }).then(function (resp) {
    return resp.json().then(function (data) {
      console.log(data);
      if ('invalid' === data.status) {
        window.alert("something went wrong");
        return;
      }
      if ('complete' === data.status) {
        setTimeout(function () {
          window.document.body.innerHTML += ('<img src="https://' + domainname + '/_apis/telebit.cloud/clear.gif">');
          // TODO once this is loaded (even error) Let's Encrypt is done,
          // then it's time to redirect to the domain. Yay!
        }, 1 * 1000);
        return;
      }
      setTimeout(checkStatus, 2 * 1000);
    }, function (err) {
      console.error(err);
      setTimeout(checkStatus, 2 * 1000);
    });
  });
}

function submitCode(pair) {
  // TODO use Location or Link
  document.querySelector('.js-magic').hidden = true;
  window.fetch(meta.baseUrl + 'api/telebit.cloud/pair_code/', {
    method: 'POST'
  , headers: {
      'Content-Type': 'application/json'
    }
  , body: JSON.stringify({
      magic: pair.magic
    , pin: pair.pin || pair.code
    , agree_tos: pair.agreeTos
    })
  , cors: true
  }).then(function (resp) {
    return resp.json().then(function (data) {
      // TODO check for error (i.e. bad Pair Code / PIN)
      // shouldn't be pending (because we get here by being ready)
      // should poll over 'ready'


      setTimeout(checkStatus, 0);

      document.querySelector('.js-authz').hidden = false;
      console.log(data);
      /*
      document.querySelectorAll('.js-token-data').forEach(function ($el) {
        $el.innerText = JSON.stringify(data, null, 2);
      });
      */
      document.querySelectorAll('.js-new-href').forEach(function ($el) {
        domainname = data.domains[0];
        $el.href = 'https://' + data.domains[0] + '/';
        $el.innerText = '🔐 https://' + data.domains[0];
      });
      document.querySelectorAll('.js-domainname').forEach(function ($el) {
        $el.innerText = data.domains.join(',');
      });
      document.querySelectorAll('.js-serviceport').forEach(function ($el) {
        $el.innerText = data.ports.join(',');
      });
      document.querySelectorAll('.js-token').forEach(function ($el) {
        $el.innerText = data.jwt;
      });
    }, function (err) {
      console.error(err);
      document.querySelector('.js-error').hidden = false;
    });
  });
}

function init() {
  magic = (window.location.hash || '').substr(2).replace(/magic=/, '');

  if (!magic) {
    document.querySelector('body').hidden = false;
    document.querySelector('.js-error').hidden = false;
  }

  window.fetch(meta.baseUrl + meta.pair_request.pathname + '/' + magic, {
    method: 'GET'
  , cors: true
  }).then(function (resp) {
    return resp.json().then(function (data) {
      console.log('Data:');
      console.log(data);
      document.querySelector('body').hidden = false;
      if (data.error) {
        document.querySelector('.js-error').hidden = false;
        document.querySelector('.js-magic-link').innerText = magic;
        window.alert("Something went wrong. Perhaps an bad or expired link.");
        return;
      }
      document.querySelector('.js-magic').hidden = false;
      document.querySelector('.js-hostname').innerText = data.hostname || 'Device';
      //document.querySelector('.js-token-data').innerText = JSON.stringify(data, null, 2);
    });
  });

  document.querySelector('.js-submit').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var pair = {};
    pair.magic = magic;
    pair.code = document.querySelector('[name=pair-code]').value;
    pair.agreeTos = document.querySelector('[name=letsencrypt-agree]').checked
      && document.querySelector('[name=telebit-agree]').checked;
    console.log('Pair Form:');
    console.log(pair);
    submitCode(pair);
  });
}

window.fetch('https://' + location.hostname + '/_apis/telebit.cloud/index.json', {
  method: 'GET'
, cors: true
}).then(function (resp) {
  return resp.json().then(function (_json) {
    meta = _json;
    meta.baseUrl = 'https://' + meta.api_host.replace(/:hostname/g, location.hostname) + '/';
    init();
  });
});

}());
