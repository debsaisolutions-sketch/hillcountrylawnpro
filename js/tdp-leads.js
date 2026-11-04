/* TradeDeskPro first-touch/UTM capture (no-op if the page already includes it). */
(function () {
  if (typeof document === 'undefined') return;
  if (document.querySelector('script[src*="tdp-lead-attribution.js"]')) return;
  var s = document.createElement('script');
  s.src = 'https://www.tradedeskpro.com/js/tdp-lead-attribution.js';
  s.defer = true;
  (document.head || document.documentElement).appendChild(s);
})();

/**
 * Lead intake for Hill Country Lawn Pro → TradeDeskPro /api/leads.
 * Posts JSON only. No lead secret in the browser.
 */
(function () {
  var API_URL = 'https://www.tradedeskpro.com/api/leads';
  var PROFILE_ID = '63e7470e-fe1e-4367-aae0-56d0d6392d78';
  var SOURCE = 'hillcountrylawnpro.com';
  var PHONE_FALLBACK = '(830) 465-4344';
  var MIN_FILL_MS = 3000;
  var UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];

  function now() {
    return typeof window.__tdpTestNow === 'number' ? window.__tdpTestNow : Date.now();
  }

  var loadedAt = now();

  function field(form, name) {
    var el = form.querySelector('[name="' + name + '"]');
    return el && el.value ? String(el.value).trim() : '';
  }

  function readUtmsFromLocation() {
    var utm = {};
    try {
      var params = new URLSearchParams(window.location.search || '');
      UTM_KEYS.forEach(function (key) {
        var value = params.get(key);
        if (value) utm[key] = value;
      });
    } catch (e) {}
    return utm;
  }

  function attribution() {
    var landing = '';
    try {
      landing = String(window.location.href || '').split('#')[0];
    } catch (e) {}

    var extra = {
      landing_url: landing,
      first_touch_url: '',
    };
    try {
      if (typeof window.tdpLeadAttribution === 'function') {
        var payload = window.tdpLeadAttribution() || {};
        if (payload.landing_url) extra.landing_url = payload.landing_url;
        if (payload.first_touch_url) extra.first_touch_url = payload.first_touch_url;
        UTM_KEYS.forEach(function (key) {
          if (payload[key]) extra[key] = payload[key];
        });
      }
    } catch (e2) {}

    var fromUrl = readUtmsFromLocation();
    UTM_KEYS.forEach(function (key) {
      if (!extra[key] && fromUrl[key]) extra[key] = fromUrl[key];
    });
    if (!extra.first_touch_url) extra.first_touch_url = extra.landing_url;
    return extra;
  }

  function buildMessage(form) {
    var service = field(form, 'service');
    var area = field(form, 'area') || field(form, 'city') || field(form, 'county');
    var message = field(form, 'message') || field(form, 'details');
    var lines = [];
    if (service) lines.push('Service: ' + service);
    if (area) lines.push('Area: ' + area);
    if (message) lines.push(message);
    return lines.join('\n');
  }

  function buildPayload(form) {
    var attr = attribution();
    var body = {
      name: field(form, 'name'),
      profile_id: PROFILE_ID,
      source: SOURCE,
      landing_url: attr.landing_url,
    };
    var phone = field(form, 'phone');
    var email = field(form, 'email');
    var message = buildMessage(form);
    if (phone) body.phone = phone;
    if (email) body.email = email;
    if (message) body.message = message;
    if (attr.first_touch_url) body.first_touch_url = attr.first_touch_url;
    UTM_KEYS.forEach(function (key) {
      if (attr[key]) body[key] = attr[key];
    });
    return body;
  }

  function ensureStatus(form) {
    var el = form.querySelector('.form-status');
    if (!el) {
      el = document.createElement('p');
      el.className = 'form-status';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      form.appendChild(el);
    }
    return el;
  }

  function showStatus(form, text, ok) {
    var el = ensureStatus(form);
    el.textContent = text;
    el.style.color = ok ? '#166534' : '#991b1b';
  }

  function fakeSuccess(form) {
    showStatus(form, "Thanks — we received your request and will be in touch shortly.", true);
    if (typeof form.reset === 'function') form.reset();
  }

  function errorMessage(status) {
    if (status === 429) {
      return "We're getting a lot of requests right now. Please call " + PHONE_FALLBACK + " or try again in a few minutes.";
    }
    if (status === 403) {
      return "We couldn't send that from this page. Please call " + PHONE_FALLBACK + " and we'll help right away.";
    }
    return "Something went wrong sending your request. Please call " + PHONE_FALLBACK + " and we'll help right away.";
  }

  function ensureHoneypot(form) {
    if (form.querySelector('[name="company_website"]')) return;
    var wrap = document.createElement('div');
    wrap.className = 'hp-field';
    wrap.setAttribute('aria-hidden', 'true');
    var input = document.createElement('input');
    input.type = 'text';
    input.name = 'company_website';
    input.tabIndex = -1;
    input.autocomplete = 'off';
    wrap.appendChild(input);
    form.appendChild(wrap);
  }

  function wireForm(form) {
    if (!form || form.dataset.tdpWired === '1') return;
    form.dataset.tdpWired = '1';
    form.removeAttribute('action');
    form.removeAttribute('method');
    ensureHoneypot(form);

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (field(form, 'company_website')) {
        fakeSuccess(form);
        return;
      }
      if (now() - loadedAt < MIN_FILL_MS) {
        fakeSuccess(form);
        return;
      }

      var name = field(form, 'name');
      var phone = field(form, 'phone');
      if (!name || !phone) {
        showStatus(form, 'Please enter your name and phone number.', false);
        return;
      }

      var btn = form.querySelector('button[type="submit"], button:not([type])');
      var original = btn ? btn.textContent : '';
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Sending...';
      }

      var payload = buildPayload(form);
      fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(payload),
      })
        .then(function (res) {
          if (res.status === 201 || res.status === 202 || (res.ok && res.status >= 200 && res.status < 300)) {
            showStatus(
              form,
              "Request received. We'll contact you within 1 hour during business hours.",
              true
            );
            if (typeof form.reset === 'function') form.reset();
            return;
          }
          showStatus(form, errorMessage(res.status), false);
        })
        .catch(function () {
          showStatus(form, errorMessage(0), false);
        })
        .then(function () {
          if (btn) {
            btn.disabled = false;
            btn.textContent = original;
          }
        });
    });
  }

  function init() {
    var forms = document.querySelectorAll('form');
    Array.prototype.forEach.call(forms, function (form) {
      if (form.querySelector('[name="name"]') && form.querySelector('[name="phone"]')) {
        wireForm(form);
      }
    });
  }

  window.TdpLeads = {
    API_URL: API_URL,
    PROFILE_ID: PROFILE_ID,
    SOURCE: SOURCE,
    PHONE_FALLBACK: PHONE_FALLBACK,
    buildPayload: buildPayload,
    buildMessage: buildMessage,
    wireForm: wireForm,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
