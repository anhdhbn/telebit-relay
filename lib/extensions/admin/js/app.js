(function () {
'use strict';

document.body.hidden = false;

function formSubmit() {
  // to be used for good, not evil
  var msg = {
    name: document.querySelector('.js-list-comment').value
  , address: document.querySelector('.js-list-address').value
  , list: 'telebit@ppl.family'
  };

  window.fetch('https://api.ppl.family/api/ppl.family/public/list', {
    method: 'POST'
  , cors: true
  , headers: new Headers({ 'Content-Type': 'application/json' })
  , body: JSON.stringify(msg)
  }).then(function (resp) {
    return resp.json().then(function (data) {
      if (data.error) {
        window.alert("Couldn't save your message. Email coolaj86@gmail.com instead.");
        return;
      }
      document.querySelector('.js-list-form').hidden = true;
      document.querySelector('.js-list-form').className += ' hidden';
      document.querySelector('.js-list-thanks').hidden = false;
      document.querySelector('.js-list-thanks').className = document.querySelector('.js-list-thanks').className.replace(/\s*hidden\b/, '');
    }, function () {
      window.alert("Couldn't save your message. Email coolaj86@gmail.com instead.");
    });
  }, function () {
    window.alert("Didn't get your message. Bad network connection? Email coolaj86@gmail.com instead.");
  });
}
document.body.addEventListener('submit', function (ev) {
  if (ev.target.matches('.js-list-form')) {
    ev.preventDefault();
    ev.stopPropagation();
    formSubmit();
    return;
  }
});
document.body.addEventListener('click', function (ev) {
  if (ev.target.matches('.js-list-submit')) {
    ev.preventDefault();
    ev.stopPropagation();
    formSubmit();
    return;
  }
  /*
  if (ev.target.closest('.js-navbar-toggle')) {
    ev.preventDefault();
    ev.stopPropagation();
    if (/show/.test(document.querySelector('.js-navbar-collapse').className)) {
      document.querySelector('.js-navbar-collapse').className = document.querySelector('.js-navbar-collapse').className.replace(/\s+show\b/, '');
    } else {
      document.querySelector('.js-navbar-collapse').className += ' show';
    }
    return;
  }
  */
});

}());
