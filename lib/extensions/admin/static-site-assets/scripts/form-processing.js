(function(){
'use strict';

function validateFormData(data) {
  var errors = {}
  if(!data.address) {
    errors.email = "Please enter an email address.";
  } else if(data.address.length > 244) {
    errors.email = "Email is too long.<br>" +
      "If your email address is really this long, we apologize. <br>" +
      "Please email us directly (hello@ppl.family) so we can adjust our form.";
  } else if(!/.+@.+\..+/.test(data.address)) {
    errors.email = "Please enter a valid email address.";
  }

  if(data.comment && data.comment.length > 102400) {
    errors.name = "Name is too long. <br>Please use a shorter version of your name.";
  }

  if(Object.keys(errors).length) {
    return errors;
  }
  return false;
}

function enableForm(form) {
  var elements = form.elements;

  for(var i = 0; i < elements.length; ++i) {
    elements[i].removeAttribute("disabled");
  }
}

function disableForm(form) {
  var elements = form.elements;

  for(var i = 0; i < elements.length; ++i) {
    elements[i].setAttribute("disabled", "");
  }
}

function enableEmailForms() {
  enableForm(document.querySelector(".js-inline-email-form"));
}

function disableEmailForms() {
  disableForm(document.querySelector(".js-inline-email-form"));
}

function displaySuccess(form) {
  var successEle = form.querySelector(".success-message");
  if(successEle) {
    successEle.classList.remove("js-inactive");
  }
}
function hideSuccess(form){
  var successEle = form.querySelector(".success-message");
  if(successEle) {
    successEle.classList.add("js-inactive");
  }
}

function displayErrors(form, errors) {
  errors = errors || {};

  form.querySelectorAll(".input-error").forEach(function(ele) {
    ele.classList.add("js-inactive");
  });
  form.querySelector(".form-error").classList.add("js-inactive");

  Object.keys(errors).forEach(function(key) {
    var errorEle;
    if(key === "_form" && errors[key]) {
      errorEle = form.querySelector(".form-error");
    } else if(errors[key]) {
      var query = "." + key + ".input-error";
      errorEle = form.querySelector(query);
    }
    if(!errorEle) return;

    errorEle.innerHTML = errors[key];
    errorEle.classList.remove("js-inactive");
  });
}

function submitFormData(form) {
  hideSuccess(form);
  var data = new FormData(form);

  var msg = {
    address: data.get("email")
  , comment: 'telebit: ' + (data.get("name") || '')
  };

  var errors = validateFormData(msg);
  displayErrors(form, errors);
  if(errors) {
    console.warn("Form validation failed: ", errors);
    return Promise.resolve();
  }


  disableEmailForms();

  return window.fetch('https://api.ppl.family/api/ppl.family/public/list', {
    method: 'POST'
  , cors: true
  , headers: new Headers({ 'Content-Type': 'application/json' })
  , body: JSON.stringify(msg)
  }).then(function (resp) {
    return resp.json();
  }).then(function (data) {
    enableEmailForms();
    if (data.error) {
      console.error("Error submitting form: ", data.error);
      err = {
        "_form": "Couldn't save email. <br>Try again or email hello@ppl.family directly."
      };
      return displayErrors(form, errors);
    }
    displaySuccess(form);
    console.log("Successfully subscribed!");

    form.reset();

  }, function (err) {
    enableEmailForms();
    console.error("Error sending form data to server: ", err);
    displayErrors(form, {
      "_form": "Unable to send the info to the server.<br>" +
      "Please try again or email hello@ppl.family directly."
    });
  });
}
document.body.addEventListener('submit', function (ev) {
  console.log("Caught event!");
  function eleMatchesString(ele, selector) {
     return ele.matches ? ele.matches(selector) : ele.msMatchesSelector(selector);
  }
  var form = ev.target;
  if (!eleMatchesString(form, '.js-inline-email-form')) {
    return;
  }
  ev.preventDefault();
  ev.stopPropagation();
  submitFormData(form);
  return;
});
})();
