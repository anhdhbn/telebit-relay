(function () {
'use strict';

var magic = (window.location.hash || '').substr(2).replace(/magic=/, '');

if (magic) {
  window.fetch('https://api.' + location.hostname + '/api/telebit.cloud/magic/' + magic, {
    method: 'GET'
  , cors: true
  }).then(function (resp) {
    return resp.json().then(function (json) {
      document.querySelector('body').hidden = false;
      document.querySelector('js-magic').hidden = false;
      document.querySelector('js-token-data').innerText = JSON.stringify(json, null, 2);
      document.querySelector('js-new-href').href = json.domains[0];
      document.querySelector('js-new-href').innerText = json.domains[0];
    });
  });
} else {
  document.querySelector('body').hidden = false;
}

}());
