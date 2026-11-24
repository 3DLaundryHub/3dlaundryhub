/* 3D Laundry Hub - staff app. All text is written with textContent (never
   innerHTML), so customer-typed names/addresses can never run as code. */
(function () {
  'use strict';

  // Refuse to run inside another site's frame (clickjacking).
  if (window.top !== window.self) { document.documentElement.textContent = ''; return; }

  var API_URL = String(window.STAFF_API_URL || '');
  var IDLE_MS = 15 * 60 * 1000;
  var STORE_KEY = 'staff3d';
  var app = document.getElementById('app');
  var DEVICE_KEY = 'staff3d_device';
  var state = { token: null, user: null, prices: null, filter: 'todo', q: '', view: 'home', deviceKey: '' };
  var lastActive = Date.now();

  // ---------- small helpers ----------
  function el(tag, props, kids) {
    var n = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (k) {
        var v = props[k];
        if (k === 'class') n.className = v;
        else if (k === 'text') n.textContent = v;
        else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v);
        else if (v === true) n.setAttribute(k, '');
        else if (v !== false && v !== null && v !== undefined) n.setAttribute(k, v);
      });
    }
    (kids || []).forEach(function (c) {
      if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return n;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function peso(n) { return String.fromCharCode(8369) + Number(n).toLocaleString('en-PH'); }
  function msg(kind, text, extra) { return el('div', { class: 'msg ' + kind + (extra ? ' ' + extra : ''), role: kind === 'err' ? 'alert' : 'status', text: text }); }
  function field(labelText, attrs) {
    var input = el(attrs.tag || 'input', attrs);
    var wrap = el('div', null, [el('label', { text: labelText, for: attrs.id }), input]);
    wrap.input = input;
    return wrap;
  }

  function save() {
    try {
      if (state.token) sessionStorage.setItem(STORE_KEY, JSON.stringify({ token: state.token, user: state.user, prices: state.prices }));
      else sessionStorage.removeItem(STORE_KEY);
    } catch (ignore) {}
  }
  function restore() {
    try {
      var raw = sessionStorage.getItem(STORE_KEY);
      if (!raw) return;
      var s = JSON.parse(raw);
      state.token = s.token; state.user = s.user; state.prices = s.prices;
    } catch (ignore) {}
  }
  function signOutLocal(message) {
    state.token = null; state.user = null;
    save();
    showLogin(message);
  }

  // ---------- API ----------
  function api(action, payload) {
    var body = payload || {};
    body.action = action;
    if (state.token) body.token = state.token;
    return fetch(API_URL, {
      method: 'POST',
      body: JSON.stringify(body), // text/plain body avoids a CORS preflight
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'follow',
      referrerPolicy: 'no-referrer'
    }).then(function (r) { return r.json(); }).then(function (res) {
      if (res && res.success) return res;
      var e = new Error((res && res.error) || 'Something went wrong. Please try again.');
      e.code = (res && res.code) || '';
      if (e.code === 'AUTH') signOutLocal('Your session ended. Please sign in again.');
      if (e.code === 'DEVICE') { setDeviceKey(''); showRegister(e.message); }
      if (e.code === 'MUST_CHANGE') showChange(true);
      throw e;
    }, function () {
      var e = new Error('Could not reach the server. Check your internet. If you were saving something, reopen the booking to see whether it was saved before trying again.');
      e.code = 'NETWORK';
      throw e;
    });
  }

  /** Runs an API call from a button: blocks double taps, shows errors. */
  function run(btn, box, fn) {
    if (btn.disabled) return;
    var label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Please wait...';
    clear(box);
    var done = function () { btn.disabled = false; btn.textContent = label; };
    var p;
    try { p = fn(); } catch (e) { p = Promise.reject(e); }
    Promise.resolve(p).then(done, function (e) {
      done();
      if (e.code !== 'AUTH' && e.code !== 'MUST_CHANGE' && e.code !== 'DEVICE') box.appendChild(msg('err', e.message));
    });
  }

  // ---------- layout ----------
  function shell(content) {
    clear(app);
    var u = state.user;
    var nav = [
      el('div', { class: 'brand' }, ['3D Laundry Hub', el('small', { text: 'Staff: ' + u.name + (u.role === 'owner' ? ' (owner)' : '') })]),
      navBtn('Bookings', 'home', function () { showHome(); })
    ];
    if (u.role === 'owner') {
      nav.push(navBtn('Staff', 'staff', function () { showStaff(); }));
      nav.push(navBtn('Activity', 'log', showLog));
    }
    nav.push(navBtn(u.role === 'owner' ? 'My password' : 'My PIN', 'change', function () { showChange(false); }));
    nav.push(el('button', { type: 'button', text: 'Sign out', onclick: function () {
      api('logout').then(null, function () {}).then(function () { signOutLocal('You are signed out.'); });
    } }));
    app.appendChild(el('header', { class: 'topbar' }, nav));
    var wrap = el('main', { class: 'wrap' }, content);
    app.appendChild(wrap);
    window.scrollTo(0, 0);
    return wrap;
  }
  function navBtn(text, view, fn) {
    return el('button', { type: 'button', text: text, class: state.view === view ? 'on' : '', onclick: fn });
  }

  // ---------- register this phone ----------
  function setDeviceKey(k) {
    state.deviceKey = String(k || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 64);
    try {
      if (state.deviceKey) localStorage.setItem(DEVICE_KEY, state.deviceKey);
      else localStorage.removeItem(DEVICE_KEY);
    } catch (ignore) {}
  }
  function showRegister(message) {
    state.view = 'register';
    clear(app);
    var key = field('Device key', { id: 'dk', type: 'text', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', maxlength: '40', placeholder: 'xxxx-xxxx-xxxx-xxxx-xxxx' });
    var box = el('div');
    var form = el('form', { novalidate: true, onsubmit: function (ev) {
      ev.preventDefault();
      clear(box);
      setDeviceKey(key.input.value);
      if (state.deviceKey.length < 16) { box.appendChild(msg('err', 'Type the full device key from the owner.')); return; }
      showLogin();
    } }, [key, el('button', { class: 'btn', type: 'submit', text: 'Register this phone' }), box]);
    app.appendChild(el('main', { class: 'wrap' }, [el('div', { class: 'card login' }, [
      el('img', { src: '../logo.png', alt: '3D Laundry Hub' }),
      el('h1', { class: 'center', text: 'Register this phone' }),
      el('p', { class: 'muted center', text: 'This page is for 3D Laundry Hub staff. Ask the owner for the device key - you only type it once on this phone.' }),
      message ? msg('warn', message) : null,
      form
    ])]));
    key.input.focus();
  }

  // ---------- sign in ----------
  function showLogin(message) {
    if (!state.deviceKey) { showRegister(message); return; }
    state.view = 'login';
    clear(app);
    var box = el('div');
    var user = field('Username', { id: 'u', type: 'text', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', maxlength: '20' });
    var pin = field('PIN or password', { id: 'p', type: 'password', autocomplete: 'current-password', maxlength: '64' });
    var btn = el('button', { class: 'btn', type: 'submit', text: 'Sign in' });
    var form = el('form', { novalidate: true, onsubmit: function (ev) {
      ev.preventDefault();
      run(btn, box, function () {
        return api('login', { username: user.input.value, secret: pin.input.value, deviceKey: state.deviceKey }).then(function (res) {
          pin.input.value = '';
          state.token = res.token; state.user = res.user; state.prices = res.prices;
          save();
          if (res.user.mustChange) showChange(true); else showHome();
        });
      });
    } }, [user, pin, btn, box]);
    var card = el('div', { class: 'card login' }, [
      el('img', { src: '../logo.png', alt: '3D Laundry Hub' }),
      el('h1', { class: 'center', text: 'Staff sign in' }),
      el('p', { class: 'muted center', text: 'For 3D Laundry Hub staff only.' }),
      message ? msg('warn', message) : null,
      API_URL.indexOf('https://') !== 0 && API_URL.charAt(0) !== '/' ? msg('err', 'Setup is not finished: the staff API link is missing in config.js.') : null,
      form
    ]);
    app.appendChild(el('main', { class: 'wrap' }, [card]));
    user.input.focus();
  }

  // ---------- change PIN / password ----------
  function showChange(forced) {
    state.view = 'change';
    var owner = state.user.role === 'owner';
    var word = owner ? 'password' : 'PIN';
    var box = el('div');
    var attrs = owner ? { type: 'password', maxlength: '64' } : { type: 'password', inputmode: 'numeric', maxlength: '12' };
    var cur = field('Current ' + word, Object.assign({ id: 'c0', autocomplete: 'current-password' }, attrs, { maxlength: '64', inputmode: null }));
    var n1 = field('New ' + word, Object.assign({ id: 'c1', autocomplete: 'new-password' }, attrs));
    var n2 = field('New ' + word + ' again', Object.assign({ id: 'c2', autocomplete: 'new-password' }, attrs));
    var btn = el('button', { class: 'btn', type: 'submit', text: 'Save new ' + word });
    var form = el('form', { novalidate: true, onsubmit: function (ev) {
      ev.preventDefault();
      run(btn, box, function () {
        if (n1.input.value !== n2.input.value) throw new Error('The two new entries do not match.');
        return api('changeSecret', { current: cur.input.value, next: n1.input.value }).then(function (res) {
          state.token = res.token; state.user = res.user;
          save();
          showHome('Your new ' + word + ' is saved.');
        });
      });
    } }, [cur, n1, n2, btn, box]);
    var card = el('div', { class: 'card' }, [
      el('h1', { text: forced ? 'Set your own ' + word : 'Change my ' + word }),
      el('p', { class: 'muted', text: forced
        ? 'You were given a temporary ' + word + '. Choose your own now - nobody else should know it.'
        : 'Changing it signs you out on every other device.' }),
      el('p', { class: 'muted', text: owner ? 'At least 10 characters, with a letter and a number.' : '6 to 12 digits. Avoid easy ones like 123456.' }),
      form
    ]);
    if (forced) {
      clear(app);
      app.appendChild(el('main', { class: 'wrap' }, [card]));
    } else {
      shell([card]);
    }
    cur.input.focus();
  }

  // ---------- booking list ----------
  function showHome(flash) {
    state.view = 'home';
    var listBox = el('div');
    var tabs = el('div', { class: 'tabs' });
    var search = el('input', { type: 'search', placeholder: 'Booking code, name or phone', value: state.q, maxlength: '40', 'aria-label': 'Search bookings' });
    var form = el('form', { class: 'search', onsubmit: function (ev) { ev.preventDefault(); state.q = search.value.trim(); load(); } },
      [search, el('button', { class: 'btn alt', type: 'submit', text: 'Search' })]);
    shell([flash ? msg('ok', flash, 'top') : null, tabs, form, listBox]);

    var names = { todo: 'To finalize', agree: 'Ask customer', unpaid: 'Unpaid', paid: 'Paid' };
    function drawTabs(counts) {
      clear(tabs);
      ['todo', 'agree', 'unpaid', 'paid'].forEach(function (f) {
        tabs.appendChild(el('button', { type: 'button', class: state.filter === f ? 'on' : '', onclick: function () { state.filter = f; load(); } },
          [el('span', { class: 'n', text: counts ? String(counts[f]) : '-' }), names[f]]));
      });
    }
    function load() {
      drawTabs(null);
      clear(listBox);
      listBox.appendChild(el('p', { class: 'muted center', text: 'Loading...' }));
      api('list', { filter: state.filter, q: state.q }).then(function (res) {
        if (state.view !== 'home') return;
        drawTabs(res.counts);
        clear(listBox);
        if (!res.bookings.length) {
          listBox.appendChild(el('p', { class: 'muted center', text: state.q ? 'No bookings match your search here.' : 'Nothing here right now.' }));
          return;
        }
        res.bookings.forEach(function (b) {
          var money = b.amount !== null ? peso(b.amount) : (b.estimatedTotal !== null ? 'est. ' + peso(b.estimatedTotal) : '');
          listBox.appendChild(el('button', { type: 'button', class: 'item', onclick: function () { showBooking(b.code); } }, [
            el('div', { class: 'row1' }, [el('span', { text: b.code + '  ' + b.name }), el('span', { class: 'amt', text: money })]),
            el('div', { class: 'row2' }, [
              b.rush ? el('span', { class: 'badge rush', text: 'RUSH' }) : null,
              b.proof ? el('span', { class: 'badge proof', text: 'PROOF RECEIVED' }) : null,
              b.warn ? el('span', { class: 'badge warn', text: 'Needs owner' }) : null,
              el('span', { text: 'Pickup ' + b.pickupDate + ', ' + b.pickupSlot + ' - ' + b.status })
            ])
          ]));
        });
      }, function (e) {
        if (state.view !== 'home' || e.code === 'AUTH' || e.code === 'MUST_CHANGE') return;
        clear(listBox);
        listBox.appendChild(msg('err', e.message));
      });
    }
    load();
  }

  // ---------- one booking ----------
  function showBooking(code, flash) {
    state.view = 'booking';
    var wrap = shell([el('p', { class: 'muted center', text: 'Loading...' })]);
    api('get', { code: code }).then(function (res) {
      if (state.view !== 'booking') return;
      state.prices = res.prices; save();
      drawBooking(res.booking, flash);
    }, function (e) {
      if (e.code === 'AUTH' || e.code === 'MUST_CHANGE') return;
      clear(wrap);
      wrap.appendChild(backBtn());
      wrap.appendChild(msg('err', e.message));
    });
  }
  function backBtn() {
    return el('button', { type: 'button', class: 'back', text: '< Back to bookings', onclick: function () { showHome(); } });
  }
  function kv(pairs) {
    var dl = el('dl', { class: 'kv' });
    pairs.forEach(function (p) {
      if (!p) return;
      dl.appendChild(el('dt', { text: p[0] }));
      dl.appendChild(el('dd', null, [p[1]]));
    });
    return dl;
  }

  function drawBooking(b, flash) {
    var owner = state.user.role === 'owner';
    var tel = b.contact.replace(/[^0-9+]/g, '');
    var parts = [backBtn(), flash ? msg('ok', flash, 'top') : null];

    parts.push(el('div', { class: 'card' }, [
      el('h1', { text: b.code }),
      el('p', null, [
        b.rush ? el('span', { class: 'badge rush', text: 'RUSH x' + state.prices.rushMultiplier }) : null,
        el('span', { class: 'badge', text: b.status }),
        el('span', { class: 'badge' + (b.payment === 'Unpaid' ? '' : ' ok'), text: b.payment === 'Unpaid' ? 'Unpaid' : 'Paid - ' + b.payment })
      ]),
      kv([
        ['Customer', b.name],
        ['Phone', tel ? el('a', { href: 'tel:' + tel, text: b.contact }) : b.contact],
        ['Address', b.location],
        ['Pickup', b.pickupDate + ', ' + b.pickupSlot],
        ['Delivery', b.deliveryDate + ', ' + b.deliverySlot],
        b.estimatedTotal !== null ? ['Estimate', peso(b.estimatedTotal) + ' (what the customer saw when booking)'] : null,
        !b.bill && b.services ? ['Booked', b.services] : null
      ])
    ]));

    var cancelled = b.status === (b.ownerOnlyStatus || 'Cancelled');
    if (!cancelled || owner) parts.push(statusCard(b, owner));
    if (cancelled) {
      parts.push(msg('warn', owner ? 'This booking is cancelled. Change the status above to bring it back.' : 'This booking is cancelled. Only the owner can bring it back.'));
      shell(parts);
      return;
    }

    var warnings = {
      manual: 'An amount of ' + (b.amount !== null ? peso(b.amount) : '') + ' was typed directly in the Google Sheet, not through this app. Only the owner can confirm or correct it.',
      bad: 'The saved bill for this booking was changed outside this app. Payment is blocked until the owner corrects the bill.',
      mismatch: 'The amount in the Google Sheet (' + (b.amount !== null ? peso(b.amount) : 'empty') + ') does not match the bill saved by this app' + (b.bill ? ' (' + peso(b.bill.amount) + ')' : '') + '. Payment is blocked until the owner corrects the bill.'
    };
    if (warnings[b.integrity]) parts.push(msg('warn', warnings[b.integrity], 'top'));

    var slot = el('div');
    parts.push(slot);
    shell(parts);

    if (b.integrity === 'none') {
      drawEditor(slot, b, false);
      return;
    }
    drawFinal(slot, b, owner);
  }

  /** Status picker. The choices come from the Status dropdown of the sheet. */
  function statusCard(b, owner) {
    var locked = b.ownerOnlyStatus || 'Cancelled';
    var box = el('div');
    var select = el('select', { id: 'st' });
    var options = (b.statusOptions || []).slice();
    if (options.indexOf(b.status) === -1) options.unshift(b.status);
    options.forEach(function (o) {
      var blocked = o === locked && !owner;
      var opt = el('option', { value: o, text: o + (blocked ? ' (owner only)' : '') });
      if (blocked) opt.disabled = true;
      if (o === b.status) opt.selected = true;
      select.appendChild(opt);
    });
    var btn = el('button', { class: 'btn ok', type: 'button', disabled: true, text: 'Update Status' });
    select.addEventListener('change', function () { btn.disabled = select.value === b.status; });
    btn.addEventListener('click', function () {
      var next = select.value;
      if (next === b.status) return;
      run(btn, box, function () {
        return api('setStatus', { code: b.code, status: next, expectedStatus: b.status })
          .then(function (res) { drawBooking(res.booking, 'Status changed to: ' + res.booking.status); },
            function (e) { if (e.code === 'CONFLICT') { showBooking(b.code); } throw e; });
      });
    });
    return el('div', { class: 'card' }, [
      el('h2', { text: 'Booking status' }),
      el('label', { for: 'st', text: 'Current status' }),
      select, btn, box
    ]);
  }

  /** Quantity editor -> review -> confirm. `correction` = owner fixing a bill. */
  function drawEditor(slot, b, correction) {
    var prices = state.prices;
    var qty = {};
    prices.items.forEach(function (it) { qty[it.id] = 0; });
    b.startItems.forEach(function (it) { if (it.id in qty) qty[it.id] = it.qty; });
    var reasonText = '';

    function totals() {
      var sub = 0;
      prices.items.forEach(function (it) { sub += it.price * qty[it.id]; });
      return { sub: sub, total: b.rush ? sub * prices.rushMultiplier : sub };
    }

    function edit() {
      clear(slot);
      var box = el('div');
      var sumBox = el('div');
      var card = el('div', { class: 'card' }, [
        el('h2', { text: correction ? 'Correct the bill' : 'Actual items received' }),
        el('p', { class: 'muted', text: 'Enter what was actually counted and weighed. Prices are fixed - you only set the quantities.' })
      ]);
      function drawSum() {
        var t = totals();
        clear(sumBox);
        sumBox.appendChild(el('div', { class: 'sum' }, [el('span', { text: 'Subtotal' }), el('span', { class: 'amt', text: peso(t.sub) })]));
        if (b.rush) sumBox.appendChild(el('div', { class: 'sum' }, [el('span', { text: 'Rush service x' + prices.rushMultiplier }), el('span', { class: 'amt', text: '+' + peso(t.total - t.sub) })]));
        sumBox.appendChild(el('div', { class: 'sum total' }, [el('span', { text: 'Total' }), el('span', { class: 'amt', text: peso(t.total) })]));
      }
      prices.items.forEach(function (it) {
        var q = el('span', { class: 'q', text: String(qty[it.id]), 'aria-live': 'polite' });
        var minus = el('button', { type: 'button', text: '-', 'aria-label': 'Less ' + it.name });
        var plus = el('button', { type: 'button', text: '+', 'aria-label': 'More ' + it.name });
        function sync() {
          q.textContent = String(qty[it.id]);
          minus.disabled = qty[it.id] <= 0;
          plus.disabled = qty[it.id] >= prices.maxQty;
          drawSum();
        }
        minus.addEventListener('click', function () { if (qty[it.id] > 0) { qty[it.id]--; sync(); } });
        plus.addEventListener('click', function () { if (qty[it.id] < prices.maxQty) { qty[it.id]++; sync(); } });
        card.appendChild(el('div', { class: 'line' }, [
          el('div', { class: 'nm' }, [it.name, el('small', { text: peso(it.price) + ' per ' + it.unit })]),
          el('div', { class: 'stepper' }, [minus, q, plus])
        ]));
        sync();
      });
      card.appendChild(sumBox);
      var reason = null;
      if (correction) {
        reason = field('Reason for the correction (required)', { tag: 'textarea', id: 'reason', maxlength: '200' });
        reason.input.value = reasonText;
        card.appendChild(reason);
      }
      card.appendChild(el('button', { class: 'btn', type: 'button', text: 'Review final amount', onclick: function () {
        clear(box);
        if (reason) reasonText = reason.input.value.trim();
        if (totals().sub <= 0) { box.appendChild(msg('err', 'Add at least one item.')); return; }
        if (correction && reasonText.length < 5) { box.appendChild(msg('err', 'Please type the reason for the correction.')); return; }
        review();
      } }));
      if (correction) card.appendChild(el('button', { class: 'btn alt', type: 'button', text: 'Cancel', onclick: function () { showBooking(b.code); } }));
      card.appendChild(box);
      slot.appendChild(card);
    }

    function review() {
      clear(slot);
      var t = totals();
      var box = el('div');
      var card = el('div', { class: 'card' }, [el('h2', { text: 'Check before you confirm' })]);
      var items = [];
      prices.items.forEach(function (it) {
        if (!qty[it.id]) return;
        items.push({ id: it.id, qty: qty[it.id] });
        card.appendChild(el('div', { class: 'sum' }, [
          el('span', { text: qty[it.id] + ' x ' + it.name + ' @ ' + peso(it.price) }),
          el('span', { class: 'amt', text: peso(it.price * qty[it.id]) })
        ]));
      });
      if (b.rush) card.appendChild(el('div', { class: 'sum' }, [el('span', { text: 'Rush service x' + prices.rushMultiplier }), el('span', { class: 'amt', text: '+' + peso(t.total - t.sub) })]));
      card.appendChild(el('div', { class: 'sum total' }, [el('span', { text: 'FINAL AMOUNT' }), el('span', { class: 'amt', text: peso(t.total) })]));
      if (b.estimatedTotal !== null && b.estimatedTotal !== t.total) {
        var d = t.total - b.estimatedTotal;
        card.appendChild(msg('warn', 'This is ' + peso(Math.abs(d)) + (d > 0 ? ' MORE' : ' LESS') + ' than the customer\'s estimate of ' + peso(b.estimatedTotal) + '. Make sure the customer is told.'));
      }
      if (correction) card.appendChild(el('p', { class: 'muted', text: 'Reason: ' + reasonText }));
      var tick = el('input', { type: 'checkbox', id: 'tick' });
      var btn = el('button', { class: 'btn ok', type: 'button', disabled: true, text: b.twoStep ? 'Save ' + peso(t.total) + ' (ask customer next)' : 'Confirm ' + peso(t.total) + ' as final' });
      tick.addEventListener('change', function () { btn.disabled = !tick.checked; });
      card.appendChild(el('label', { class: 'check', for: 'tick' }, [tick, el('span', { text: 'I counted and weighed these items myself and the quantities are correct.' })]));
      card.appendChild(el('p', { class: 'muted', text: b.twoStep
        ? 'Next: tell the customer this amount. It becomes final (and payable) only after you tap "Customer agreed".'
        : (correction ? '' : 'After you confirm, the customer sees this amount and only the owner can change it.') }));
      btn.addEventListener('click', function () {
        if (!tick.checked) return;
        run(btn, box, function () {
          return api('finalize', { code: b.code, items: items, expectedTotal: t.total, version: b.version, reason: correction ? reasonText : '' })
            .then(function (res) {
              var rb = res.booking;
              drawBooking(rb, rb.integrity === 'awaiting'
                ? 'Saved ' + peso(rb.bill.amount) + '. Now tell the customer, then tap "Customer agreed".'
                : 'Final amount saved: ' + peso(rb.amount));
            },
              function (e) { if (e.code === 'CONFLICT') { showBooking(b.code); } throw e; });
        });
      });
      card.appendChild(btn);
      card.appendChild(el('button', { class: 'btn alt', type: 'button', text: 'Go back and edit', onclick: edit }));
      card.appendChild(box);
      slot.appendChild(card);
    }

    edit();
  }

  /** Finalized booking: bill, payment, owner tools. */
  function drawFinal(slot, b, owner) {
    clear(slot);
    if (b.bill) {
      var waiting = b.integrity === 'awaiting';
      var bill = el('div', { class: 'card' }, [el('h2', { text: waiting ? 'Counted bill (not final yet)' : 'Final bill' })]);
      b.bill.items.forEach(function (it) {
        bill.appendChild(el('div', { class: 'sum' }, [
          el('span', { text: it.qty + ' x ' + it.name + ' @ ' + peso(it.price) }),
          el('span', { class: 'amt', text: peso(it.price * it.qty) })
        ]));
      });
      if (b.bill.rush) bill.appendChild(el('div', { class: 'sum' }, [el('span', { text: 'Rush service' }), el('span', { class: 'amt', text: '+' + peso(b.bill.amount - b.bill.subtotal) })]));
      bill.appendChild(el('div', { class: 'sum total final' }, [el('span', { text: waiting ? 'COUNTED AMOUNT' : 'FINAL AMOUNT' }), el('span', { class: 'amt', text: peso(b.bill.amount) })]));
      bill.appendChild(el('p', { class: 'muted', text: 'Set by ' + b.bill.by + ' on ' + b.bill.at + (b.bill.version > 1 ? ' (correction no. ' + (b.bill.version - 1) + ': ' + b.bill.reason + ')' : '') }));
      slot.appendChild(bill);
    }

    if (b.integrity === 'awaiting' && b.bill) slot.appendChild(agreeCard(b));
    var pr = b.proof;
    if (b.payment === 'Unpaid') {
      if (pr && pr.status === 'Submitted' && (b.integrity === 'ok' || b.integrity === 'manual')) slot.appendChild(proofCard(b, pr));
      else if (pr && pr.status === 'Short') slot.appendChild(el('div', { class: 'card' }, [
        el('h2', { text: 'Part payment received' }),
        pr.image ? el('img', { class: 'proofimg', src: pr.image, alt: 'Customer receipt' }) : null,
        kv([['Received', peso(pr.receivedBefore)], ['Balance', peso(pr.balance)], ['Last ref', pr.ref]]),
        msg('warn', 'The customer was asked to send the balance and upload that receipt.')
      ]));
      if (b.integrity === 'ok' && !(pr && pr.status === 'Submitted')) slot.appendChild(payCard(b));
    } else {
      var r = b.paymentRecord;
      var paid = el('div', { class: 'card' }, [el('h2', { text: 'Payment' })]);
      if (r) {
        paid.appendChild(kv([
          ['Paid by', r.method], ['Amount', peso(r.amount)], r.ref ? ['Reference', r.ref] : null, ['Recorded', r.by + ', ' + r.at]
        ]));
        if (!r.valid) paid.appendChild(msg('warn', 'This payment record does not match the Google Sheet. Tell the owner.'));
        if (pr && pr.status === 'Overpaid') paid.appendChild(msg('warn', pr.note + '. Any refund needs the owner\'s OK.'));
      } else {
        paid.appendChild(msg('warn', 'Marked as "' + b.payment + '" directly in the Google Sheet. No payment was recorded through this app.'));
      }
      if (owner) paid.appendChild(ownerReasonAction('Void this payment', 'Why is this payment being voided?', 'Void payment', function (reason) {
        return api('voidPayment', { code: b.code, reason: reason }).then(function (res) { drawBooking(res.booking, 'Payment voided. The booking is unpaid again.'); });
      }));
      slot.appendChild(paid);
    }

    if (owner && b.payment === 'Unpaid') {
      var tools = el('div', { class: 'card' }, [
        el('h2', { text: 'Owner tools' }),
        el('button', { class: 'btn danger', type: 'button', text: b.integrity === 'manual' ? 'Enter the bill properly' : 'Correct this bill', onclick: function () { drawEditor(slot, b, true); } })
      ]);
      slot.appendChild(tools);
    } else if (owner) {
      slot.appendChild(el('p', { class: 'muted center', text: 'To correct the amount, void the payment first.' }));
    }
  }

  /** A customer uploaded a GCash receipt: staff check the money arrived. */
  function proofCard(b, pr) {
    var box = el('div');
    var got = field('Amount that arrived in GCash', { id: 'got', type: 'text', inputmode: 'decimal', autocomplete: 'off', maxlength: '10' });
    got.input.value = String(pr.balance);
    var tick = el('input', { type: 'checkbox', id: 'seen' });
    var btn = el('button', { class: 'btn ok', type: 'button', disabled: true, text: 'Payment received \u2014 confirm' });
    tick.addEventListener('change', function () { btn.disabled = !tick.checked; });
    btn.addEventListener('click', function () {
      var n = Number(String(got.input.value).replace(/[,\s\u20B1]/g, ''));
      run(btn, box, function () {
        if (!(n > 0)) throw new Error('Enter the amount that actually arrived.');
        return api('proofReview', { code: b.code, proofId: pr.id, decision: 'accept', received: n, expectedAmount: b.amount })
          .then(function (res) {
            var p2 = res.booking.proof;
            drawBooking(res.booking, p2 && p2.status === 'Short' ? 'Part payment recorded. ' + p2.note + '.' : 'Payment recorded as received.');
          }, function (e) { if (e.code === 'CONFLICT') { showBooking(b.code); } throw e; });
      });
    });
    var warns = [];
    if (pr.amountChanged) warns.push(msg('err', 'The final amount changed after this receipt was uploaded (it was for ' + peso(pr.due) + '). Recheck with the customer, then reject this proof.'));
    if (pr.duplicate) warns.push(msg('err', 'This reference number was already used on another booking. Do not accept it without the owner.'));
    if (!pr.valid) warns.push(msg('err', 'This proof record was changed outside the app. Ask the owner.'));
    if (pr.screenAmount !== null && pr.screenAmount !== pr.balance) warns.push(msg('warn', 'The receipt seems to show ' + peso(pr.screenAmount) + ' (read automatically - check the picture).'));
    var card = el('div', { class: 'card' }, [
      el('h2', null, ['Payment proof ', el('span', { class: 'badge proof', text: 'PROOF RECEIVED' })]),
      pr.image ? el('img', { class: 'proofimg', src: pr.image, alt: 'Customer receipt' }) : msg('warn', 'The receipt picture could not be loaded.'),
      kv([
        ['Method', 'GCash'], ['Reference', pr.ref], ['To collect', peso(pr.balance) + (pr.receivedBefore ? ' (balance; ' + peso(pr.receivedBefore) + ' received earlier)' : '')],
        ['Uploaded', pr.at]
      ])
    ].concat(warns).concat([
      msg('warn', 'Open the shop\'s GCash app and check that this amount with this reference really arrived. The screenshot alone is not proof.'),
      got,
      el('label', { class: 'check', for: 'seen' }, [tick, el('span', { text: 'I checked GCash and saw this money arrive.' })]),
      btn, box,
      ownerReasonAction('Not received \u2014 reject proof', 'Why is this proof rejected? (the customer sees this)', 'Reject proof', function (reason) {
        return api('proofReview', { code: b.code, proofId: pr.id, decision: 'reject', reason: reason })
          .then(function (res) { drawBooking(res.booking, 'Proof rejected. The customer can upload again.'); });
      })
    ]));
    return card;
  }

  /** Two-step: the customer must agree to the counted amount before it becomes final. */
  function agreeCard(b) {
    var amt = b.bill.amount;
    var box = el('div');
    var tick = el('input', { type: 'checkbox', id: 'agreed' });
    var btn = el('button', { class: 'btn ok', type: 'button', disabled: true, text: 'Customer agreed \u2014 make it final' });
    tick.addEventListener('change', function () { btn.disabled = !tick.checked; });
    btn.addEventListener('click', function () {
      run(btn, box, function () {
        return api('agree', { code: b.code, version: b.bill.version, expectedAmount: amt, confirm: tick.checked })
          .then(function (res) { drawBooking(res.booking, 'Final amount confirmed. The customer can now see and pay ' + peso(amt) + '.'); },
            function (e) { if (e.code === 'CONFLICT') { showBooking(b.code); } throw e; });
      });
    });
    var est = b.estimatedTotal !== null && b.estimatedTotal !== amt
      ? msg('warn', 'This is ' + peso(Math.abs(amt - b.estimatedTotal)) + (amt > b.estimatedTotal ? ' MORE' : ' LESS') + ' than the booking estimate of ' + peso(b.estimatedTotal) + '.')
      : null;
    return el('div', { class: 'card' }, [
      el('h2', null, ['Waiting for the customer\'s OK ', el('span', { class: 'badge warn', text: 'NOT FINAL YET' })]),
      el('p', { text: 'Tell the customer the final amount of ' + peso(amt) + ' (text or call). They do not see it yet and cannot pay until you confirm here.' }),
      est,
      el('label', { class: 'check', for: 'agreed' }, [tick, el('span', { text: 'The customer agreed to ' + peso(amt) + '.' })]),
      btn, box,
      el('p', { class: 'muted', text: 'If the customer disagrees, ask the owner to correct the bill.' })
    ]);
  }

  function payCard(b) {
    var amount = b.bill.amount;
    var method = '';
    var box = el('div');
    var ref = field('Reference number', { id: 'ref', type: 'text', autocomplete: 'off', autocapitalize: 'characters', maxlength: '30' });
    ref.hidden = true;
    var tick = el('input', { type: 'checkbox', id: 'got' });
    var btn = el('button', { class: 'btn ok', type: 'button', disabled: true, text: 'Record payment of ' + peso(amount) });
    var radios = el('div', { class: 'radio', role: 'radiogroup', 'aria-label': 'Payment method' });
    function sync() { btn.disabled = !(method && tick.checked); }
    ['Cash', 'GCash', 'Bank Transfer'].forEach(function (m, i) {
      var input = el('input', { type: 'radio', name: 'method', id: 'm' + i, value: m });
      var lab = el('label', { for: 'm' + i }, [input, el('span', { text: m })]);
      input.addEventListener('change', function () {
        method = m;
        Array.prototype.forEach.call(radios.children, function (c) { c.className = ''; });
        lab.className = 'on';
        ref.hidden = m === 'Cash';
        ref.firstChild.textContent = m + ' reference number';
        sync();
      });
      radios.appendChild(lab);
    });
    tick.addEventListener('change', sync);
    btn.addEventListener('click', function () {
      run(btn, box, function () {
        return api('pay', { code: b.code, method: method, ref: method === 'Cash' ? '' : ref.input.value, expectedAmount: amount, version: b.version })
          .then(function (res) { drawBooking(res.booking, 'Payment recorded.'); },
            function (e) { if (e.code === 'CONFLICT' || e.code === 'INTEGRITY') { showBooking(b.code); } throw e; });
      });
    });
    return el('div', { class: 'card' }, [
      el('h2', { text: 'Record payment' }),
      el('p', null, ['Amount to collect: ', el('b', { class: 'amt', text: peso(amount) })]),
      radios, ref,
      el('label', { class: 'check', for: 'got' }, [tick, el('span', { text: 'I received the full ' + peso(amount) + ' from the customer.' })]),
      btn, box
    ]);
  }

  /** A button that opens a "type a reason" form (owner-only actions). */
  function ownerReasonAction(openText, labelText, doText, fn) {
    var holder = el('div');
    var open = el('button', { class: 'btn danger', type: 'button', text: openText });
    open.addEventListener('click', function () {
      clear(holder);
      var box = el('div');
      var reason = field(labelText, { tag: 'textarea', id: 'why', maxlength: '200' });
      var go = el('button', { class: 'btn danger', type: 'button', text: doText });
      go.addEventListener('click', function () { run(go, box, function () { return fn(reason.input.value.trim()); }); });
      holder.appendChild(reason); holder.appendChild(go); holder.appendChild(box);
      reason.input.focus();
    });
    holder.appendChild(open);
    return holder;
  }

  // ---------- owner: staff accounts ----------
  function showStaff(flash) {
    state.view = 'staff';
    var listCard = el('div', { class: 'card' }, [el('h2', { text: 'Staff accounts' }), el('p', { class: 'muted', text: 'Loading...' })]);
    var box = el('div');
    var name = field('Full name', { id: 'sn', type: 'text', maxlength: '40', autocomplete: 'off' });
    var user = field('Username (small letters, no spaces)', { id: 'su', type: 'text', maxlength: '20', autocapitalize: 'none', autocomplete: 'off', spellcheck: 'false' });
    var pin = field('Starting PIN (6 to 12 digits)', { id: 'sp', type: 'password', inputmode: 'numeric', maxlength: '12', autocomplete: 'new-password' });
    var mine = field('Your owner password', { id: 'so', type: 'password', maxlength: '64', autocomplete: 'current-password' });
    var btn = el('button', { class: 'btn', type: 'submit', text: 'Add staff member' });
    var addCard = el('div', { class: 'card' }, [
      el('h2', { text: 'Add a staff member' }),
      el('p', { class: 'muted', text: 'They will be asked to change the starting PIN the first time they sign in.' }),
      el('form', { novalidate: true, onsubmit: function (ev) {
        ev.preventDefault();
        run(btn, box, function () {
          return api('staffAdd', { name: name.input.value, username: user.input.value, secret: pin.input.value, ownerSecret: mine.input.value })
            .then(function () { showStaff('Staff member added.'); });
        });
      } }, [name, user, pin, mine, btn, box])
    ]);
    var keyBox = el('div');
    var keyPass = field('Your owner password', { id: 'kp', type: 'password', maxlength: '64', autocomplete: 'current-password' });
    var keyBtn = el('button', { class: 'btn alt', type: 'button', text: 'Show the device key' });
    keyBtn.addEventListener('click', function () {
      run(keyBtn, keyBox, function () {
        return api('deviceKey', { ownerSecret: keyPass.input.value }).then(function (res) {
          keyPass.input.value = '';
          clear(keyBox);
          keyBox.appendChild(msg('ok', 'Device key: ' + res.deviceKey));
          keyBox.appendChild(el('p', { class: 'muted', text: 'Type this once on the staff phone when it asks to register. Do not post it anywhere public.' }));
        });
      });
    });
    var keyCard = el('div', { class: 'card' }, [
      el('h2', { text: 'Set up another phone' }),
      el('p', { class: 'muted', text: 'A phone must be registered with the device key before anyone can sign in on it.' }),
      keyPass, keyBtn, keyBox
    ]);
    shell([flash ? msg('ok', flash, 'top') : null, listCard, addCard, keyCard]);

    api('staffList').then(function (res) {
      if (state.view !== 'staff') return;
      clear(listCard);
      listCard.appendChild(el('h2', { text: 'Staff accounts' }));
      res.staff.forEach(function (s) {
        var row = el('div', { class: 'staffrow' }, [
          el('div', null, [
            el('b', { text: s.name + ' ' }), el('span', { class: 'muted', text: '(' + s.username + ') ' }),
            el('span', { class: 'badge', text: s.role }),
            !s.active ? el('span', { class: 'badge warn', text: 'Deactivated' }) : null,
            s.locked ? el('span', { class: 'badge warn', text: 'Locked' }) : null,
            s.mustChange ? el('span', { class: 'badge', text: 'Temporary PIN' }) : null
          ])
        ]);
        if (s.role === 'staff') {
          var panel = el('div');
          var acts = el('div', { class: 'acts' }, [
            el('button', { class: 'btn alt small', type: 'button', text: 'Reset PIN', onclick: function () { staffPanel(panel, s, 'reset'); } }),
            el('button', { class: 'btn alt small', type: 'button', text: s.active ? 'Deactivate' : 'Activate', onclick: function () { staffPanel(panel, s, 'active'); } })
          ]);
          row.appendChild(acts);
          row.appendChild(panel);
        }
        listCard.appendChild(row);
      });
    }, function (e) {
      if (e.code === 'AUTH' || e.code === 'MUST_CHANGE') return;
      clear(listCard); listCard.appendChild(msg('err', e.message));
    });
  }
  function staffPanel(panel, s, kind) {
    clear(panel);
    var box = el('div');
    var pin = kind === 'reset' ? field('New starting PIN for ' + s.name, { id: 'rp', type: 'password', inputmode: 'numeric', maxlength: '12', autocomplete: 'new-password' }) : null;
    var mine = field('Your owner password', { id: 'ro', type: 'password', maxlength: '64', autocomplete: 'current-password' });
    var go = el('button', { class: 'btn', type: 'button', text: kind === 'reset' ? 'Reset PIN' : (s.active ? 'Deactivate ' : 'Activate ') + s.name });
    go.addEventListener('click', function () {
      run(go, box, function () {
        var p = kind === 'reset'
          ? api('staffReset', { username: s.username, secret: pin.input.value, ownerSecret: mine.input.value })
          : api('staffSetActive', { username: s.username, active: !s.active, ownerSecret: mine.input.value });
        return p.then(function () { showStaff('Saved.'); });
      });
    });
    if (pin) panel.appendChild(pin);
    panel.appendChild(mine); panel.appendChild(go); panel.appendChild(box);
    (pin || mine).input.focus();
  }

  // ---------- owner: activity log ----------
  function showLog() {
    state.view = 'log';
    var card = el('div', { class: 'card' }, [el('h2', { text: 'Activity log' }), el('p', { class: 'muted', text: 'Loading...' })]);
    shell([card]);
    api('audit').then(function (res) {
      if (state.view !== 'log') return;
      clear(card);
      card.appendChild(el('h2', { text: 'Activity log' }));
      card.appendChild(res.chainOk
        ? msg('ok', 'Log check passed: all ' + res.total + ' entries are intact.')
        : msg('err', 'WARNING: the log was edited by hand in the Google Sheet (first changed row: ' + res.badRow + ').'));
      res.entries.forEach(function (e) {
        card.appendChild(el('div', { class: 'log' }, [
          el('b', { text: e.action }), ' ', el('span', { text: e.code }),
          el('div', { class: 'd', text: e.user + ' - ' + e.at + (e.detail ? ' - ' + e.detail : '') })
        ]));
      });
    }, function (e) {
      if (e.code === 'AUTH' || e.code === 'MUST_CHANGE') return;
      clear(card); card.appendChild(msg('err', e.message));
    });
  }

  // ---------- idle sign-out ----------
  ['click', 'keydown', 'touchstart'].forEach(function (ev) {
    document.addEventListener(ev, function () { lastActive = Date.now(); }, { passive: true });
  });
  setInterval(function () {
    if (state.token && Date.now() - lastActive > IDLE_MS) {
      api('logout').then(null, function () {});
      signOutLocal('Signed out after 15 minutes without activity.');
    }
  }, 30000);

  // ---------- start ----------
  try { state.deviceKey = localStorage.getItem(DEVICE_KEY) || ''; } catch (ignore) {}
  restore();
  if (state.token && state.user) {
    if (state.user.mustChange) showChange(true); else showHome();
  } else {
    showLogin();
  }
})();
