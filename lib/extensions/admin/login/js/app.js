(function () {
'use strict';

var meta = {};
var magic;
var domainname;
var port;

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
        successScreen();
        setTimeout(function () {
          //window.document.body.innerHTML += ('<img src="https://' + domainname + '/_apis/telebit.cloud/clear.gif">');
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

function successScreen() {
  document.querySelector('.js-authz').hidden = true;
  document.querySelector('.js-finish-button').addEventListener('click', function(e) {
    window.location.href='https://' + domainname + "/#/serviceport=" + port;
  });
  document.querySelectorAll('.js-new-domain').forEach(function(ele) {
    ele.innerHTML = domainname;
  });
  document.querySelector('.js-finish').hidden = false;

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

      console.log('Submit Code Response:');
      console.log(data);
      if (data.error) {
        document.querySelector('.js-error').hidden = false;
        return;
      }

      setTimeout(checkStatus, 0);

      document.querySelector('.js-authz').hidden = false;
      document.querySelector('.js-debug-container').hidden = false;

      /*
      document.querySelectorAll('.js-token-data').forEach(function ($el) {
        $el.innerText = JSON.stringify(data, null, 2);
      });
      */
      document.querySelectorAll('.js-new-href').forEach(function ($el) {
        domainname = data.domains[0];
        port = data.port;
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
    return;
  }

  window.fetch(meta.baseUrl + meta.pair_request.pathname + '/' + magic, {
    method: 'GET'
  , cors: true
  }).then(function (resp) {
    return resp.json().then(function (data) {
      console.log('pair request data:');
      console.log(data);
      document.querySelector('body').hidden = false;
      if (data.error) {
        document.querySelector('.js-error').hidden = false;
        document.querySelector('.js-magic-link').innerText = "Something went wrong. Perhaps an bad or expired link.";
        return;
      }
      document.querySelector('.js-magic').hidden = false;
      document.querySelectorAll('.js-hostname').forEach(function(ele) {
        ele.innerText = data.hostname || 'Device';
      });
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

  var formElements = document.querySelector('.js-submit').elements;
  for(var i = 0; i < formElements.length; ++i) {
    var tosCheck = document.querySelector('[name=telebit-agree]');
    var leCheck = document.querySelector('[name=letsencrypt-agree]');
    var pairCodeInput = document.querySelector('[name=pair-code]');
    formElements[i].addEventListener('input', function(ev) {
      if(tosCheck.checked && leCheck.checked && pairCodeInput.value.length) {
        document.querySelector('.js-submit button').disabled = false;
      } else {
        document.querySelector('.js-submit button').disabled = true;
      }
    });
  };
  document.querySelector('.js-debug-button').addEventListener("click", function(e) {
    document.querySelector('.js-debug-container').classList.toggle("visible");
  })
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
