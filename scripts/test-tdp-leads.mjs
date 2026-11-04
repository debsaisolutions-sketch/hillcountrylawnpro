/**
 * Local test for js/tdp-leads.js with a mocked fetch.
 * Does not call TradeDeskPro.
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const scriptPath = new URL('../js/tdp-leads.js', import.meta.url);
const source = readFileSync(scriptPath, 'utf8');

function createElement(tag) {
  return {
    tag,
    type: '',
    name: '',
    value: '',
    className: '',
    tabIndex: 0,
    autocomplete: '',
    disabled: false,
    textContent: '',
    style: {},
    attrs: {},
    children: [],
    dataset: {},
    setAttribute(name, value) {
      this.attrs[name] = value;
    },
    appendChild(child) {
      this.children.push(child);
      child.parent = this;
      return child;
    },
    removeAttribute() {},
  };
}

function queryAll(root, selector) {
  const nodes = [];
  function walk(node) {
    if (!node || typeof node !== 'object') return;
    nodes.push(node);
    (node.children || []).forEach(walk);
  }
  walk(root);
  if (selector === 'form') return nodes.filter((node) => node.tag === 'form');
  if (selector === 'script[src*="tdp-lead-attribution.js"]') {
    return nodes.filter(
      (node) => node.tag === 'script' && String(node.src || '').includes('tdp-lead-attribution.js')
    );
  }
  const attr = selector.match(/^\[name="([^"]+)"\]$/);
  if (attr) return nodes.filter((node) => node.name === attr[1]);
  if (selector === '.form-status') return nodes.filter((node) => node.className === 'form-status');
  if (selector === 'button[type="submit"], button:not([type])') {
    return nodes.filter((node) => node.tag === 'button');
  }
  return [];
}

function makeForm(values) {
  const form = createElement('form');
  form.tag = 'form';
  form.listeners = {};
  form.addEventListener = (type, fn) => {
    form.listeners[type] = fn;
  };
  form.reset = () => {
    queryAll(form, '[name="name"]').concat(queryAll(form, '[name="phone"]')).forEach((el) => {
      /* reset below */
    });
    for (const node of queryAll(form, 'form')) {
      /* no-op */
    }
    const names = ['name', 'phone', 'email', 'service', 'area', 'message', 'company_website'];
    names.forEach((name) => {
      queryAll(form, `[name="${name}"]`).forEach((el) => {
        el.value = '';
      });
    });
  };
  form.querySelector = (selector) => queryAll(form, selector)[0] || null;
  form.querySelectorAll = (selector) => queryAll(form, selector);

  function add(tag, name, value) {
    const el = createElement(tag);
    el.name = name;
    el.value = value || '';
    form.appendChild(el);
    return el;
  }

  add('input', 'name', values.name || '');
  add('input', 'phone', values.phone || '');
  add('input', 'email', values.email || '');
  add('select', 'service', values.service || '');
  add('input', 'area', values.area || '');
  add('textarea', 'message', values.message || '');
  if (values.honeypot) add('input', 'company_website', values.honeypot);
  const button = createElement('button');
  button.tag = 'button';
  button.textContent = 'Request Free Estimate';
  button.type = 'submit';
  form.appendChild(button);
  return form;
}

function loadLeads({ now = 10_000, attribution, search = '' } = {}) {
  const calls = [];
  const document = {
    readyState: 'complete',
    head: createElement('head'),
    documentElement: createElement('html'),
    createElement,
    querySelector() {
      return null;
    },
    querySelectorAll(selector) {
      return queryAll(document.body, selector);
    },
    body: createElement('body'),
    addEventListener() {},
  };
  document.head.tag = 'head';
  document.body.tag = 'body';

  const window = {
    document,
    location: {
      href: `https://hillcountrylawnpro.com/${search}`,
      search,
    },
    __tdpTestNow: now,
    tdpLeadAttribution: attribution,
    fetch: async (url, init) => {
      calls.push({ url, init });
      const status = window.__nextStatus ?? 201;
      if (status === 'throw') throw new Error('network');
      return { status, ok: status >= 200 && status < 300 };
    },
    Date,
    URLSearchParams,
  };
  window.window = window;
  document.defaultView = window;

  const context = vm.createContext(window);
  vm.runInContext(source, context, { filename: scriptPath.pathname });
  return { window, calls, document };
}

function payloadOf(call) {
  return JSON.parse(call.init.body);
}

let failed = 0;
function assert(cond, message) {
  if (!cond) {
    failed += 1;
    console.error('FAIL:', message);
  } else {
    console.log('ok:', message);
  }
}

const sample = {
  name: 'Ada Lopez',
  phone: '(830) 465-4344',
  email: 'ada@example.com',
  service: 'Lawn Mowing & Maintenance',
  area: 'Kerrville',
  message: 'Need a weekly mow.',
};

// Success 201 includes profile, source, folded message, landing url, and UTMs.
{
  const { window, calls } = loadLeads({
    now: 1_000,
    search: '?utm_source=google&utm_medium=cpc&utm_campaign=lawn',
    attribution() {
      return {
        landing_url: 'https://hillcountrylawnpro.com/?utm_source=google&utm_medium=cpc&utm_campaign=lawn',
        first_touch_url: 'https://hillcountrylawnpro.com/?utm_source=google',
        utm_source: 'google',
        utm_medium: 'cpc',
        utm_campaign: 'lawn',
      };
    },
  });
  const form = makeForm(sample);
  window.document.body.appendChild(form);
  window.TdpLeads.wireForm(form);
  window.__tdpTestNow = 5_000;
  window.__nextStatus = 201;
  form.listeners.submit({ preventDefault() {} });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert(calls.length === 1, '201 posts once');
  const body = payloadOf(calls[0]);
  assert(calls[0].url === 'https://www.tradedeskpro.com/api/leads', 'posts to TDP leads API');
  assert(body.name === 'Ada Lopez', 'name is posted');
  assert(body.profile_id === '63e7470e-fe1e-4367-aae0-56d0d6392d78', 'profile_id is Deb');
  assert(body.phone === '(830) 465-4344', 'phone is posted');
  assert(body.email === 'ada@example.com', 'email is posted');
  assert(body.source === 'hillcountrylawnpro.com', 'source is the site domain');
  assert(
    body.message === 'Service: Lawn Mowing & Maintenance\nArea: Kerrville\nNeed a weekly mow.',
    'service and area fold into message'
  );
  assert(body.landing_url.includes('hillcountrylawnpro.com'), 'landing_url is set');
  assert(body.first_touch_url.includes('utm_source=google'), 'first_touch_url is set');
  assert(body.utm_source === 'google' && body.utm_medium === 'cpc' && body.utm_campaign === 'lawn', 'utm fields are posted');
  assert(!('X-TDP-Lead-Secret' in (calls[0].init.headers || {})), 'no lead secret header');
  assert(JSON.stringify(calls[0].init.headers).includes('application/json'), 'JSON content type');
  const status = form.querySelector('.form-status');
  assert(status && status.textContent.includes('Request received'), '201 shows success');
  assert(form.querySelector('[name="name"]').value === '', 'form resets after success');
}

// 202 filtered is still a friendly success, and the button is re-enabled.
{
  const { window, calls } = loadLeads({ now: 1_000 });
  const form = makeForm(sample);
  window.TdpLeads.wireForm(form);
  window.__tdpTestNow = 9_000;
  window.__nextStatus = 202;
  form.listeners.submit({ preventDefault() {} });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert(calls.length === 1, '202 still posts');
  const status = form.querySelector('.form-status');
  assert(status.textContent.includes('Request received'), '202 shows success, not a filter notice');
  const button = form.querySelector('button[type="submit"], button:not([type])');
  assert(button.disabled === false && button.textContent === 'Request Free Estimate', 'button restored after 202');
}

for (const statusCode of [403, 429, 500]) {
  const { window, calls } = loadLeads({ now: 1_000 });
  const form = makeForm(sample);
  window.TdpLeads.wireForm(form);
  window.__tdpTestNow = 9_000;
  window.__nextStatus = statusCode;
  form.listeners.submit({ preventDefault() {} });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert(calls.length === 1, `${statusCode} posts once`);
  const status = form.querySelector('.form-status');
  assert(status.textContent.includes('(830) 465-4344'), `${statusCode} includes the site phone`);
  assert(!status.textContent.includes('Request received'), `${statusCode} is not a success message`);
}

// Network failure.
{
  const { window, calls } = loadLeads({ now: 1_000 });
  const form = makeForm(sample);
  window.TdpLeads.wireForm(form);
  window.__tdpTestNow = 9_000;
  window.__nextStatus = 'throw';
  form.listeners.submit({ preventDefault() {} });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert(calls.length === 1, 'network error still attempted one post');
  assert(
    form.querySelector('.form-status').textContent.includes('(830) 465-4344'),
    'network error includes the site phone'
  );
}

// Honeypot does not post.
{
  const { window, calls } = loadLeads({ now: 1_000 });
  const form = makeForm({ ...sample, honeypot: 'https://spam.example' });
  window.TdpLeads.wireForm(form);
  window.__tdpTestNow = 9_000;
  form.listeners.submit({ preventDefault() {} });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert(calls.length === 0, 'honeypot does not post');
  assert(
    form.querySelector('.form-status').textContent.includes('Thanks'),
    'honeypot shows a fake success'
  );
}

// Submits faster than 3s after load do not post.
{
  const { window, calls } = loadLeads({ now: 1_000 });
  const form = makeForm(sample);
  window.TdpLeads.wireForm(form);
  window.__tdpTestNow = 2_000;
  form.listeners.submit({ preventDefault() {} });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert(calls.length === 0, 'submit under 3 seconds does not post');
}

// Missing name/phone does not post once the timer has elapsed.
{
  const { window, calls } = loadLeads({ now: 1_000 });
  const form = makeForm({ ...sample, name: '   ', phone: '' });
  window.TdpLeads.wireForm(form);
  window.__tdpTestNow = 9_000;
  form.listeners.submit({ preventDefault() {} });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert(calls.length === 0, 'missing name or phone does not post');
  assert(
    form.querySelector('.form-status').textContent.includes('name and phone'),
    'missing name or phone asks for both'
  );
}

// init wires a form that has name and phone, and strips a leftover action.
{
  const { window, document } = loadLeads({ now: 1_000 });
  const form = makeForm(sample);
  form.action = 'https://example.invalid/f/placeholder';
  document.body.appendChild(form);
  window.TdpLeads.wireForm(form);
  assert(form.dataset.tdpWired === '1', 'form is marked wired');
  assert(form.querySelector('[name="company_website"]'), 'honeypot is added when missing');
}

assert(!source.includes('X-TDP-Lead-Secret'), 'script source has no lead secret');
assert(source.includes('https://www.tradedeskpro.com/js/tdp-lead-attribution.js'), 'script loads attribution');

if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log('\nAll mocked lead-form tests passed.');
