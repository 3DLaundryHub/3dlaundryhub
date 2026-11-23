/* 3D Laundry Hub - customer payment page (GCash receipt upload).
   All text is written with textContent, never innerHTML. */
(function () {
  'use strict';
  if (window.top !== window.self) { document.documentElement.textContent = ''; return; }

  var API_URL = String(window.STAFF_API_URL || '');
  var HAND_OFF_KEY = 'pay3d'; // set by the "Pay now" button in Track my booking
  var MAX_SIDE = 1400;        // screenshots are shrunk on the phone before upload
  var app = document.getElementById('app');
  var who = { code: '', phone: '' };

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
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function peso(n) { return String.fromCharCode(8369) + Number(n).toLocaleString('en-PH'); }
  function msg(kind, text) { return el('div', { class: 'msg ' + kind, role: kind === 'err' ? 'alert' : 'status', text: text }); }
  function show(kids) { clear(app); kids.forEach(function (k) { if (k) app.appendChild(k); }); window.scrollTo(0, 0); }

  function api(payload) {
    payload.code = who.code;
    payload.contact = who.phone;
    return fetch(API_URL, {
      method: 'POST', body: JSON.stringify(payload), credentials: 'omit', cache: 'no-store',
      redirect: 'follow', referrerPolicy: 'no-referrer'
    }).then(function (r) { return r.json(); }, function () {
      throw new Error('Could not reach our server. Check your internet and try again.');
    }).then(function (res) {
      if (res && res.success) return res;
      var e = new Error((res && res.error) || 'Something went wrong. Please try again.');
      e.code = (res && res.code) || '';
      throw e;
    });
  }

  function busy(btn, on, label) { btn.disabled = on; btn.textContent = on ? 'Please wait...' : label; }

  // ---------- step 1: find the booking ----------
  function showFind(error) {
    var code = el('input', { type: 'text', id: 'code', placeholder: 'e.g. 3D-4F7K', autocapitalize: 'characters', autocomplete: 'off', maxlength: '12', value: who.code });
    var phone = el('input', { type: 'tel', id: 'phone', placeholder: 'e.g. 09171234567', autocomplete: 'tel', maxlength: '20', value: who.phone });
    var box = el('div');
    var btn = el('button', { class: 'btn', type: 'submit', text: 'Find my booking' });
    var form = el('form', { novalidate: true, onsubmit: function (ev) {
      ev.preventDefault();
      clear(box);
      who.code = code.value.trim().toUpperCase();
      who.phone = phone.value.trim();
      if (!who.code || !who.phone) { box.appendChild(msg('err', 'Enter both your booking code and mobile number.')); return; }
      busy(btn, true);
      lookup().then(null, function (e) { busy(btn, false, 'Find my booking'); box.appendChild(msg('err', e.message)); });
    } }, [
      el('label', { for: 'code', text: 'Booking code' }), code,
      el('label', { for: 'phone', text: 'Mobile number you booked with' }), phone,
      btn, box
    ]);
    show([el('div', { class: 'card' }, [
      el('h1', { text: 'Pay your final amount' }),
      el('p', { class: 'muted', text: 'Pay with GCash after we have confirmed your final amount, then upload your receipt here.' }),
      error ? msg('err', error) : null,
      form
    ])]);
  }

  function lookup() {
    return api({ action: 'payLookup' }).then(function (res) { showBooking(res.booking); });
  }

  function amountCard(b) {
    var kids = [el('h2', { text: 'Booking ' + b.code })];
    if (b.services) kids.push(el('div', { class: 'row' }, [el('span', { text: 'Services' }), el('span', { text: b.services + (b.rush ? ' (RUSH)' : '') })]));
    if (b.received > 0) {
      kids.push(el('div', { class: 'row' }, [el('span', { text: 'Final amount' }), el('span', { text: peso(b.amount) })]));
      kids.push(el('div', { class: 'row' }, [el('span', { text: 'Received so far' }), el('span', { text: '- ' + peso(b.received) })]));
      kids.push(el('div', { class: 'total' }, [el('span', { text: 'Balance to pay' }), el('b', { text: peso(b.balance) })]));
    } else {
      kids.push(el('div', { class: 'total' }, [el('span', { text: 'Final amount' }), el('b', { text: peso(b.amount) })]));
    }
    return el('div', { class: 'card' }, kids);
  }

  // ---------- step 2: amount, GCash QR, upload ----------
  function showBooking(b) {
    if (b.state === 'not_ready') {
      show([el('div', { class: 'card' }, [
        el('h1', { text: 'Booking ' + b.code }),
        el('p', { text: 'Your final amount is not confirmed yet. We weigh your laundry at our store and confirm the amount first. Please come back once Track my booking shows the green Final Amount.' }),
        el('a', { class: 'btn alt', href: '../#track', text: 'Back to Track my booking' })
      ])]);
      return;
    }
    if (b.state === 'cancelled') {
      show([el('div', { class: 'card' }, [el('h1', { text: 'Booking ' + b.code }), el('p', { text: 'This booking is cancelled. Nothing to pay.' })])]);
      return;
    }
    if (b.state === 'paid') {
      show([el('div', { class: 'card done' }, [
        el('div', { class: 'c', text: '\u2713' }), el('h1', { text: 'Paid - thank you!' }),
        el('p', { class: 'muted', text: 'Booking ' + b.code + ' is marked paid (' + b.payment + ').' })
      ])]);
      return;
    }
    if (b.state === 'waiting') { showWaiting(b); return; }

    var note = null;
    if (b.last && b.last.status === 'Rejected') note = msg('warn', 'Your last receipt could not be confirmed: ' + b.last.note + '. Please upload it again, or call us.');
    if (b.last && b.last.status === 'Short') note = msg('warn', 'We received part of your payment. Please send the balance of ' + peso(b.balance) + ' and upload that receipt.');

    var box = el('div');
    var file = el('input', { type: 'file', accept: 'image/*', id: 'file' });
    var drop = el('label', { class: 'upload', for: 'file' }, ['Tap to upload your GCash receipt', el('small', { text: 'Screenshot or photo of the receipt' }), file]);
    file.addEventListener('change', function () {
      clear(box);
      var f = file.files && file.files[0];
      if (!f) return;
      if (!/^image\//.test(f.type)) { box.appendChild(msg('err', 'Please choose a picture (screenshot or photo).')); return; }
      drop.firstChild.textContent = 'Uploading and reading your receipt...';
      shrink(f).then(function (jpeg) {
        return api({ action: 'payUpload', image: jpeg.base64 }).then(function (res) { showCheck(b, res, jpeg.url); });
      }).then(null, function (e) {
        drop.firstChild.textContent = 'Tap to upload your GCash receipt';
        file.value = '';
        if (e.code === 'WAITING') { lookup().then(null, function () {}); return; }
        box.appendChild(msg('err', e.message));
      });
    });
    show([
      note,
      amountCard(b),
      el('div', { class: 'card' }, [
        el('h2', { text: '1. Pay with GCash' }),
        el('div', { class: 'qr' }, [
          el('img', { src: '../gcash.png', alt: '3D Laundry Hub GCash QR code' }),
          el('p', { class: 'muted', text: 'Scan with your GCash app and send exactly ' + peso(b.balance) + '. Check the account name shown in GCash before you send.' })
        ]),
        el('p', { class: 'muted', text: 'Paying cash? Pay the rider or staff.' }),
        el('h2', { text: '2. Upload your receipt', style: null }),
        drop, box
      ])
    ]);
  }

  /** Shrinks the picture on the phone and returns it as JPEG base64. */
  function shrink(f) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(f);
      var img = new Image();
      img.onload = function () {
        var s = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
        var c = document.createElement('canvas');
        c.width = Math.round(img.width * s);
        c.height = Math.round(img.height * s);
        var g = c.getContext('2d');
        g.fillStyle = '#fff';
        g.fillRect(0, 0, c.width, c.height);
        g.drawImage(img, 0, 0, c.width, c.height);
        var data = c.toDataURL('image/jpeg', 0.85);
        resolve({ base64: data.slice(data.indexOf(',') + 1), url: url });
      };
      img.onerror = function () { reject(new Error('We could not open that picture. Please take a screenshot of the receipt and try again.')); };
      img.src = url;
    });
  }

  // ---------- step 3: check the reference number ----------
  function showCheck(b, res, previewUrl) {
    var ref = el('input', { type: 'text', class: 'ref', id: 'ref', inputmode: 'numeric', autocomplete: 'off', maxlength: '40', value: res.ref || '' });
    var tick = el('input', { type: 'checkbox', id: 'tick' });
    var box = el('div');
    var btn = el('button', { class: 'btn ok', type: 'button', disabled: true, text: 'Submit payment proof' });
    tick.addEventListener('change', function () { btn.disabled = !tick.checked; });
    btn.addEventListener('click', function () {
      clear(box);
      busy(btn, true);
      api({ action: 'paySubmit', proofId: res.proofId, ref: ref.value, confirm: tick.checked }).then(function (r) {
        showWaiting(r.booking);
      }, function (e) {
        busy(btn, false, 'Submit payment proof');
        if (e.code === 'NO_PROOF' || e.code === 'WAITING' || e.code === 'NOT_PAYABLE') { lookup().then(null, function () {}); return; }
        box.appendChild(msg('err', e.message));
      });
    });
    var hint = res.ref
      ? el('p', { class: 'muted', text: 'We read this reference number from your receipt. Please check it matches, and correct it if needed.' })
      : el('p', { class: 'muted', text: 'We could not read the reference number. Please type it exactly as shown on your receipt.' });
    var amountWarn = (res.screenAmount !== null && res.screenAmount !== undefined && res.screenAmount !== b.balance)
      ? msg('warn', 'Your receipt seems to show ' + peso(res.screenAmount) + ', but the amount to pay is ' + peso(b.balance) + '. Please check before you submit.')
      : null;
    show([el('div', { class: 'card' }, [
      el('h1', { text: 'Check your receipt' }),
      el('div', { class: 'shot' }, [el('img', { src: previewUrl, alt: 'Your receipt' }), hint]),
      el('label', { for: 'ref', text: 'Reference number' }), ref,
      amountWarn,
      el('label', { class: 'check', for: 'tick' }, [tick, el('span', { text: 'I sent ' + peso(b.balance) + ' for booking ' + b.code + ' and this reference number is correct.' })]),
      btn, box,
      el('button', { class: 'btn alt', type: 'button', text: 'Upload a different picture', onclick: function () { showBooking(b); } })
    ])]);
    ref.focus();
  }

  // ---------- step 4: waiting for staff ----------
  function showWaiting(b) {
    show([el('div', { class: 'card done' }, [
      el('div', { class: 'c wait', text: '\u2713' }),
      el('h1', { text: 'Thank you! We received your payment proof.' }),
      el('p', { class: 'muted', text: 'Booking ' + b.code + (b.last && b.last.ref ? ' \u00b7 GCash ref ' + b.last.ref : '') }),
      msg('ok', 'Staff will confirm once received. Your booking stays Unpaid until then. Track my booking will show Paid when it is confirmed.'),
      el('a', { class: 'btn alt', href: '../#track', text: 'Back to Track my booking' })
    ])]);
  }

  // ---------- start ----------
  try {
    var hand = JSON.parse(sessionStorage.getItem(HAND_OFF_KEY) || 'null');
    sessionStorage.removeItem(HAND_OFF_KEY);
    if (hand && typeof hand.code === 'string' && typeof hand.phone === 'string') { who.code = hand.code.slice(0, 12); who.phone = hand.phone.slice(0, 20); }
  } catch (ignore) {}
  if (API_URL.indexOf('https://') !== 0 && API_URL.charAt(0) !== '/') { showFind('This page is not set up yet. Please call us to pay.'); return; }
  if (who.code && who.phone) {
    lookup().then(null, function (e) { showFind(e.message); });
  } else {
    showFind();
  }
})();
