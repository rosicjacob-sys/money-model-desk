/* Money Model Desk — UI layer. Engine does the math; this file does the room. */
(function () {
  'use strict';

  var E = window.Engine;
  var state = Object.assign({}, E.DEFAULTS);

  // ---------- helpers ----------
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function fmtMoney(v, dec) {
    if (!isFinite(v)) return '—';
    if (dec === undefined) dec = 0;
    var sign = v < 0 ? '−' : '';
    return sign + '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  }
  function fmtNum(v, dec) {
    if (!isFinite(v)) return '—';
    return v.toLocaleString('en-US', { minimumFractionDigits: dec || 0, maximumFractionDigits: dec || 0 });
  }
  function fmtX(v) { return isFinite(v) ? fmtNum(v, v < 10 ? 2 : 1) + '×' : '—'; }
  function fmtAxis(v) {
    var s = v < 0 ? '−' : '', a = Math.abs(v);
    if (a >= 1e6) return s + '$' + fmtNum(a / 1e6, a >= 1e7 ? 0 : 1) + 'M';
    if (a >= 1000) return s + '$' + fmtNum(a / 1000, a >= 1e4 ? 0 : 1) + 'k';
    return s + '$' + fmtNum(a);
  }
  function fmtRatio(v) { return isFinite(v) ? fmtNum(v, 1) + ' : 1' : '—'; }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  function niceCeil(v) {
    if (v <= 0) return 1;
    var p = Math.pow(10, Math.floor(Math.log10(v)));
    var m = v / p;
    var n = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10;
    return n * p;
  }
  function debounce(fn, ms) {
    var t; return function () { clearTimeout(t); t = setTimeout(fn, ms); };
  }

  var RAILS = {
    cc: { name: 'Credit card', color: 'var(--cc)', hex: '#2a78d6' },
    et: { name: 'E-transfer', color: 'var(--et)', hex: '#eb6834' },
    blend: { name: 'Blend', color: 'var(--bl)', hex: '#1baf7a' }
  };
  function railName(s) {
    if (s === 'blend') return 'Blend (' + fmtNum(E.clampNum(state.blendCC, 0, 100, 70)) + '% card)';
    return RAILS[s].name;
  }

  // ---------- URL state ----------
  function stateToHash() {
    var diff = {};
    Object.keys(E.DEFAULTS).forEach(function (k) {
      if (state[k] !== E.DEFAULTS[k]) diff[k] = state[k];
    });
    var json = JSON.stringify(diff);
    var h = json === '{}' ? '' : '#m=' + encodeURIComponent(json);
    if (h !== location.hash) history.replaceState(null, '', h || location.pathname + location.search);
  }
  var pushHash = debounce(stateToHash, 250);

  function hashToState() {
    var m = /#m=(.+)$/.exec(location.hash);
    if (!m) return;
    try {
      var diff = JSON.parse(decodeURIComponent(m[1]));
      Object.keys(diff).forEach(function (k) {
        if (k === 'scenario') {
          if (['cc', 'et', 'blend'].indexOf(diff[k]) !== -1) state[k] = diff[k];
        } else if (k === 'simFloor') {
          state[k] = !!diff[k];
        } else if (KEY_RANGES[k]) {
          // Only keys with a declared control range are accepted, clamped to
          // the same bounds typing allows. Anything else (e.g. months) is
          // ignored so a hand-edited link can't break the page.
          var r = KEY_RANGES[k];
          state[k] = E.clampNum(diff[k], r.min, r.typedMax, E.DEFAULTS[k]);
        }
      });
    } catch (err) { /* malformed hash: keep defaults */ }
  }

  // ---------- controls ----------
  // typedMax = ceiling for typed values and shared-link values (sliders keep
  // their own max). Keys without typedMax cap at the slider max.
  var CONTROL_GROUPS = [
    { title: 'Order value', items: [
      { key: 'aovCC', label: 'AOV — credit card', unit: '$', min: 20, max: 1000, step: 1, typedMax: 10000 },
      { key: 'aovET', label: 'AOV — e-transfer', unit: '$', min: 20, max: 1000, step: 1, typedMax: 10000 },
      { key: 'blendCC', label: 'Customers paying by card', unit: '%', min: 0, max: 100, step: 5,
        note: 'Only drives the Blend tab', idleUnless: 'blend' }
    ]},
    { title: 'Cost per order', items: [
      { key: 'cogsRatio', label: 'COGS ratio (1 : X)', unit: ': 1', min: 1.5, max: 20, step: 0.5,
        typedMax: 100, noteId: 'cogsNote' },
      { key: 'shipCost', label: 'Shipping', unit: '$', min: 0, max: 60, step: 0.5, typedMax: 500 },
      { key: 'whFee', label: 'Warehouse pick fee', unit: '$', min: 0, max: 30, step: 0.5, typedMax: 500 },
      { advanced: 'Processing fees', items: [
        { key: 'procPctCC', label: 'Card — % of order', unit: '%', min: 0, max: 6, step: 0.1, typedMax: 15 },
        { key: 'procFlatCC', label: 'Card — flat per order', unit: '$', min: 0, max: 2, step: 0.05, typedMax: 10 },
        { key: 'procPctET', label: 'E-transfer — % of order', unit: '%', min: 0, max: 6, step: 0.1, typedMax: 15 },
        { key: 'procFlatET', label: 'E-transfer — flat per order', unit: '$', min: 0, max: 5, step: 0.25, typedMax: 10 }
      ]}
    ]},
    { title: 'Customer value curve', items: [
      { key: 'm1Mult', label: '30-day revenue multiple', unit: '× AOV', min: 1, max: 5, step: 0.05,
        typedMax: 20, note: 'Revenue a customer generates in the first 30 days, as a multiple of AOV' },
      { key: 'yearMult', label: '12-month revenue multiple', unit: '× 30-day', min: 1, max: 10, step: 0.25,
        typedMax: 50, note: 'Year revenue = this × the 30-day revenue' },
      { key: 'decay', label: 'Repeat falloff (mo/mo)', unit: '', min: 0.5, max: 1, step: 0.01,
        note: '1.00 = repeats stay flat; lower = front-loaded' },
      { derivedId: 'curveDerived' }
    ]},
    { title: 'Marketing', items: [
      { key: 'cac', label: 'CAC — cost per customer', unit: '$', min: 1, max: 600, step: 1, typedMax: 10000 },
      { quickset: true }
    ]},
    { title: 'Scale simulator', items: [
      { key: 'simBudget', label: 'Month-1 ad budget', unit: '$', min: 500, max: 100000, step: 500, typedMax: 10000000 },
      { key: 'simReinvest', label: 'Reinvest last month’s GP', unit: '%', min: 0, max: 150, step: 5 },
      { checkbox: 'simFloor', label: 'Never spend below month-1 budget' }
    ]}
  ];

  // key -> {min, typedMax} for clamping typed input and shared-link state.
  var KEY_RANGES = {};
  CONTROL_GROUPS.forEach(function (g) {
    g.items.forEach(function (it) {
      if (it.advanced) it.items.forEach(function (s) { KEY_RANGES[s.key] = { min: s.min, typedMax: s.typedMax || s.max }; });
      else if (it.key) KEY_RANGES[it.key] = { min: it.min, typedMax: it.typedMax || it.max };
    });
  });

  function controlHTML(it) {
    var v = state[it.key];
    return '<div class="ctl" data-key="' + it.key + '"' + (it.idleUnless ? ' data-idle-unless="' + it.idleUnless + '"' : '') + '>' +
      '<div class="ctl-top"><label for="in-' + it.key + '">' + esc(it.label) + '</label>' +
      '<span class="ctl-field"><input type="number" id="in-' + it.key + '" value="' + v + '" min="' + it.min + '" max="' + (it.typedMax || it.max) + '" step="' + it.step + '">' +
      (it.unit ? '<span class="unit">' + esc(it.unit) + '</span>' : '') + '</span></div>' +
      '<input type="range" data-range="' + it.key + '" value="' + v + '" min="' + it.min + '" max="' + it.max + '" step="' + it.step + '" aria-label="' + esc(it.label) + ' slider">' +
      (it.note ? '<p class="ctl-note">' + esc(it.note) + '</p>' : '') +
      (it.noteId ? '<p class="ctl-note" id="' + it.noteId + '"></p>' : '') +
      '</div>';
  }

  function buildControls() {
    var root = $('#controls');
    var html = '';
    CONTROL_GROUPS.forEach(function (g) {
      html += '<div class="ctl-group"><h3>' + esc(g.title) + '</h3>';
      g.items.forEach(function (it) {
        if (it.advanced) {
          html += '<details class="ctl-adv"><summary>' + esc(it.advanced) + '</summary>';
          it.items.forEach(function (sub) { html += controlHTML(sub); });
          html += '</details>';
        } else if (it.quickset) {
          html += '<div class="quickset">' +
            '<button type="button" id="qsBreakeven">Break-even 30 d<br><b id="qsBreakevenV">$—</b></button>' +
            '<button type="button" id="qsCfa">Self-funding (2×)<br><b id="qsCfaV">$—</b></button></div>';
        } else if (it.checkbox) {
          html += '<label class="ctl-check"><input type="checkbox" id="in-' + it.checkbox + '"' + (state[it.checkbox] ? ' checked' : '') + '> ' + esc(it.label) + '</label>';
        } else if (it.derivedId) {
          html += '<div class="ctl-derived" id="' + it.derivedId + '"></div>';
        } else {
          html += controlHTML(it);
        }
      });
      html += '</div>';
    });
    root.insertAdjacentHTML('beforeend', html);

    // number inputs — typed values are clamped to [min, typedMax] before they
    // reach the engine (browsers do not enforce min/max on typed text)
    $all('.ctl input[type="number"]', root).forEach(function (inp) {
      var key = inp.id.replace('in-', '');
      var range = KEY_RANGES[key];
      inp.addEventListener('input', function () {
        var v = parseFloat(inp.value);
        if (!isFinite(v)) return; // let the user finish typing
        state[key] = E.clampNum(v, range.min, range.typedMax, state[key]);
        var r = $('[data-range="' + key + '"]');
        if (r) r.value = state[key];
        render(); pushHash();
      });
      inp.addEventListener('blur', function () {
        // settle the field on the clamped value actually in use
        inp.value = state[key];
      });
    });
    // sliders
    $all('input[type="range"][data-range]', root).forEach(function (r) {
      var key = r.getAttribute('data-range');
      r.addEventListener('input', function () {
        state[key] = parseFloat(r.value);
        var inp = $('#in-' + key);
        if (inp) inp.value = r.value;
        render(); pushHash();
      });
    });
    // checkbox
    $('#in-simFloor').addEventListener('change', function (e) {
      state.simFloor = e.target.checked; render(); pushHash();
    });
    // quickset
    $('#qsBreakeven').addEventListener('click', function () { setCac(lastRes.metrics.maxCac30); });
    $('#qsCfa').addEventListener('click', function () { setCac(lastRes.metrics.cfaCac); });
  }

  function setCac(v) {
    // Floor, never round: values set from "max CAC" style ceilings must not
    // land one dollar past the ceiling they came from.
    state.cac = Math.max(1, Math.floor(v));
    syncControl('cac');
    render(); pushHash();
  }
  function syncControl(key) {
    var inp = $('#in-' + key), r = $('[data-range="' + key + '"]');
    if (inp) inp.value = state[key];
    if (r) r.value = state[key];
  }
  function syncAllControls() {
    Object.keys(E.DEFAULTS).forEach(function (k) {
      if (k === 'scenario') return;
      if (k === 'simFloor') { var c = $('#in-simFloor'); if (c) c.checked = state.simFloor; return; }
      syncControl(k);
    });
  }

  // ---------- tooltip ----------
  var tip = $('#tooltip');
  function showTip(html, x, y) {
    tip.innerHTML = html;
    tip.classList.add('show');
    var w = tip.offsetWidth, h = tip.offsetHeight;
    var px = x + 14, py = y - h - 10;
    if (px + w > window.innerWidth - 8) px = x - w - 14;
    if (py < 8) py = y + 16;
    tip.style.left = px + 'px';
    tip.style.top = py + 'px';
  }
  function hideTip() { tip.classList.remove('show'); }

  // ---------- hero + meter ----------
  var dragMeterMax = null;
  function renderHero(res) {
    var m = res.metrics;
    var name = railName(state.scenario);
    var under = m.maxCac30 <= 0;
    var heroN = $('#heroNumber');
    // Floor a ceiling — never display a "max" one dollar past break-even.
    heroN.textContent = fmtNum(under ? m.maxCac30 : Math.floor(m.maxCac30), 0);
    heroN.classList.toggle('is-bad', under);
    $('#heroLabel').textContent = under
      ? 'These orders lose money before you spend $1 on ads'
      : 'Max CAC to break even in 30 days — ' + name.toLowerCase() + ' rail';
    $('#heroSub').textContent = under
      ? 'Gross profit per order is negative: fix AOV or costs first. No marketing budget can save under-water unit economics.'
      : 'Spend up to ' + fmtMoney(Math.floor(m.maxCac30)) + ' per new customer and the first 30 days of gross profit pays it all back. ' +
        (m.cfaCac > 0
          ? 'Hormozi’s self-funding zone: ' + fmtMoney(Math.floor(m.cfaCac)) + ' or less — 30-day cash covers 2× (CAC + cost to fulfill).'
          : 'No self-funding zone at this margin — 30-day cash can’t cover 2× (CAC + cost to fulfill) at any CAC.');

    // meter
    var meterMax = dragMeterMax || Math.max(m.maxCac30 * 1.5, state.cac * 1.15, 60);
    var cfaW = Math.max(0, Math.min(1, m.cfaCac / meterMax));
    var beW = Math.max(0, Math.min(1 - cfaW, (m.maxCac30 - m.cfaCac) / meterMax));
    $('#zoneCfa').style.width = (cfaW * 100) + '%';
    $('#zoneBe').style.width = (beW * 100) + '%';
    $('#zoneTrap').style.width = ((1 - cfaW - beW) * 100) + '%';
    var pin = $('#meterPin');
    var pos = Math.max(0, Math.min(1, state.cac / meterMax));
    pin.style.left = (pos * 100) + '%';
    pin.setAttribute('aria-valuenow', Math.round(state.cac));
    pin.setAttribute('aria-valuemax', Math.round(meterMax));
    $('#meterPinValue').textContent = fmtMoney(state.cac);
    pin.dataset.meterMax = meterMax;
  }

  function initMeter() {
    var track = $('#meterTrack');
    var pin = $('#meterPin');
    function posToCac(clientX) {
      var r = track.getBoundingClientRect();
      var frac = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
      var meterMax = dragMeterMax || parseFloat(pin.dataset.meterMax) || 300;
      return Math.max(1, Math.round(frac * meterMax));
    }
    function start(ev) {
      if (ev.button !== 0 || ev.isPrimary === false) return; // primary button only
      ev.preventDefault();
      dragMeterMax = parseFloat(pin.dataset.meterMax) || 300;
      try { track.setPointerCapture(ev.pointerId); } catch (e) { /* older engines */ }
      pin.focus(); // arrow keys nudge CAC right after a click
      move(ev);
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', end);
      window.addEventListener('pointercancel', end);
    }
    function move(ev) {
      state.cac = posToCac(ev.clientX);
      syncControl('cac');
      render();
    }
    function end() {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      dragMeterMax = null;
      render(); pushHash();
    }
    track.addEventListener('pointerdown', start);
    pin.addEventListener('keydown', function (ev) {
      var step = ev.shiftKey ? 10 : 1;
      if (ev.key === 'ArrowRight' || ev.key === 'ArrowUp') { setCac(state.cac + step); ev.preventDefault(); }
      if (ev.key === 'ArrowLeft' || ev.key === 'ArrowDown') { setCac(state.cac - step); ev.preventDefault(); }
    });
  }

  // ---------- KPI row ----------
  function badge(el, cls, text) {
    el.className = 'badge ' + cls;
    el.textContent = text;
  }
  function renderKpis(res) {
    var m = res.metrics;
    $('#kpiLtvV').textContent = fmtMoney(m.ltvGross);
    $('#kpiLtvS').textContent = fmtMoney(m.ltvRevenue) + ' in revenue · ' + railName(state.scenario);

    $('#kpiRatioV').textContent = fmtRatio(m.ltvCac);
    var rb = $('#kpiRatioB');
    if (m.ltvCac >= 3) badge(rb, 'b-good', '≥ 3:1 — Hormozi floor cleared');
    else if (m.ltvCac >= 1) badge(rb, 'b-warn', 'Below the 3:1 floor — fix the machine');
    else badge(rb, 'b-bad', 'Under water — losing money per customer');

    $('#kpiPaybackV').textContent = m.paybackMonth ? 'Month ' + m.paybackMonth : 'Not in 12 mo';
    $('#kpiPaybackS').textContent = m.paybackMonth
      ? 'cumulative GP crosses ' + fmtMoney(m.cac) + ' in month ' + m.paybackMonth
      : 'cumulative GP never reaches ' + fmtMoney(m.cac);

    $('#kpi30dV').textContent = fmtX(m.thirtyDayMultiple);
    var s30 = $('#kpi30dS');
    s30.textContent = m.cfaMet
      ? 'self-funding: 30-day cash ≥ 2× (CAC + fulfillment)'
      : m.thirtyDayMultiple >= 1
        ? 'breaks even in 30 days, below the 2× self-funding bar'
        : 'only ' + fmtMoney(res.active.cumGP[0]) + ' back in 30 days per ' + fmtMoney(m.cac) + ' spent';

    $('#kpi3xV').textContent = m.monthsTo3x ? m.monthsTo3x + (m.monthsTo3x === 1 ? ' month' : ' months') : '> 12 mo';
  }

  // ---------- dollar bar ----------
  function renderDollar(res) {
    var po = res.active.perOrder;
    $('#dollarNote').textContent = 'Average order · ' + railName(state.scenario).toLowerCase() + ' · AOV ' + fmtMoney(po.aov, 2);
    var segs = [
      { k: 'COGS', v: po.cogs, c: '#52514e' },
      { k: 'Shipping', v: po.shipping, c: '#6e6c66' },
      { k: 'Warehouse', v: po.warehouse, c: '#898781' },
      { k: 'Processing', v: po.processing, c: '#a5a39c' },
      { k: 'Gross profit', v: Math.max(0, po.gross), c: RAILS[state.scenario].hex, gp: true }
    ];
    var total = segs.reduce(function (a, s) { return a + s.v; }, 0);
    var W = 1000, H = 64, gap = 2, x = 0;
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="Order dollar breakdown">';
    segs.forEach(function (s, i) {
      var w = total > 0 ? (s.v / total) * (W - gap * (segs.length - 1)) : 0;
      svg += '<rect data-seg="' + i + '" x="' + x + '" y="0" width="' + Math.max(0, w) + '" height="' + H + '" rx="4" fill="' + s.c + '"></rect>';
      x += w + gap;
    });
    svg += '</svg>';
    $('#dollarChart').innerHTML = svg;

    var legend = segs.map(function (s) {
      var pct = po.aov > 0 ? (s.v / po.aov) * 100 : 0;
      return '<li><span class="sw" style="background:' + s.c + '"></span>' + esc(s.k) +
        ' <b>' + fmtMoney(s.v, 2) + '</b> · ' + fmtNum(pct, 1) + '%</li>';
    });
    if (po.gross < 0) legend.push('<li><span class="sw" style="background:var(--critical)"></span><b style="color:var(--critical)">' + fmtMoney(po.gross, 2) + ' lost per order</b></li>');
    $('#dollarLegend').innerHTML = legend.join('');

    $all('#dollarChart rect').forEach(function (r) {
      var s = segs[+r.getAttribute('data-seg')];
      r.addEventListener('pointermove', function (ev) {
        showTip('<div class="tt-title">' + esc(s.k) + '</div><div class="tt-row"><span class="k">per order</span><span>' + fmtMoney(s.v, 2) + '</span></div>' +
          '<div class="tt-row"><span class="k">share of AOV</span><span>' + fmtNum(po.aov > 0 ? s.v / po.aov * 100 : 0, 1) + '%</span></div>', ev.clientX, ev.clientY);
      });
      r.addEventListener('pointerleave', hideTip);
    });
  }

  // ---------- payback chart ----------
  function visibleSeries(res) {
    var out = [];
    if (state.scenario === 'cc') {
      out.push({ id: 'et', name: 'E-transfer', data: res.et, ctx: true });
      out.push({ id: 'cc', name: 'Credit card', data: res.cc, ctx: false });
    } else if (state.scenario === 'et') {
      out.push({ id: 'cc', name: 'Credit card', data: res.cc, ctx: true });
      out.push({ id: 'et', name: 'E-transfer', data: res.et, ctx: false });
    } else {
      out.push({ id: 'cc', name: 'Credit card', data: res.cc, ctx: true });
      out.push({ id: 'et', name: 'E-transfer', data: res.et, ctx: true });
      out.push({ id: 'blend', name: railName('blend'), data: res.blend, ctx: false });
    }
    return out;
  }

  function renderPayback(res) {
    var wrap = $('#paybackChart');
    var W = Math.max(560, wrap.clientWidth || 800), H = 320;
    var M = { t: 20, r: 118, b: 34, l: 62 };
    var iw = W - M.l - M.r, ih = H - M.t - M.b;
    var series = visibleSeries(res);
    var m = res.metrics;
    var months = state.months;

    // y-domain covers negatives too — an under-water cohort must draw inside
    // the plot, not through the axis labels (mirrors renderSim's domain).
    var hi = state.cac * 1.12, lo = 0;
    series.forEach(function (s) {
      for (var si = 0; si < months; si++) {
        hi = Math.max(hi, s.data.cumGP[si]);
        lo = Math.min(lo, s.data.cumGP[si]);
      }
    });
    hi = niceCeil(hi * 1.05);
    if (lo < 0) lo = -niceCeil(-lo * 1.05);
    var yMax = hi;

    function X(t) { return M.l + (t / months) * iw; }            // t = 0..12
    function Y(v) { return M.t + ih * (hi - v) / (hi - lo); }

    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Cumulative gross profit per customer over 12 months">';

    // gridlines + y ticks
    var ticks = 5;
    for (var i = 0; i <= ticks; i++) {
      var v = lo + (hi - lo) * i / ticks, y = Y(v);
      svg += '<line x1="' + M.l + '" x2="' + (W - M.r) + '" y1="' + y + '" y2="' + y + '" stroke="#e1e0d9" stroke-width="1"></line>';
      svg += '<text class="tick-num" x="' + (M.l - 8) + '" y="' + (y + 4) + '" text-anchor="end">' + fmtAxis(v) + '</text>';
    }
    // zero baseline
    svg += '<line x1="' + M.l + '" x2="' + (W - M.r) + '" y1="' + Y(0) + '" y2="' + Y(0) + '" stroke="#c3c2b7" stroke-width="1.5"></line>';
    // x ticks
    var every = iw / months > 34 ? 1 : 2;
    for (var t = 1; t <= months; t += every) {
      svg += '<text class="tick-num" x="' + X(t) + '" y="' + (H - 12) + '" text-anchor="middle">M' + t + '</text>';
    }

    // CAC + 3x reference lines
    if (state.cac <= yMax) {
      var yc = Y(state.cac);
      svg += '<line x1="' + M.l + '" x2="' + (W - M.r) + '" y1="' + yc + '" y2="' + yc + '" stroke="#52514e" stroke-width="1.5" stroke-dasharray="6 4"></line>';
      svg += '<text class="ref-label" x="' + (W - M.r + 6) + '" y="' + (yc + 4) + '">CAC ' + fmtMoney(state.cac) + '</text>';
    }
    if (3 * state.cac <= yMax) {
      var y3 = Y(3 * state.cac);
      svg += '<line x1="' + M.l + '" x2="' + (W - M.r) + '" y1="' + y3 + '" y2="' + y3 + '" stroke="#898781" stroke-width="1" stroke-dasharray="2 4"></line>';
      svg += '<text class="ref-label" x="' + (W - M.r + 6) + '" y="' + (y3 + 4) + '" fill="#898781">3 : 1 line</text>';
    }

    // series lines (context first, active last so it sits on top)
    var endLabels = [];
    series.forEach(function (s) {
      var pts = 'M ' + X(0) + ' ' + Y(0);
      for (var t = 1; t <= months; t++) pts += ' L ' + X(t) + ' ' + Y(s.data.cumGP[t - 1]);
      var col = s.ctx ? '#c3c2b7' : RAILS[s.id].hex;
      svg += '<path d="' + pts + '" fill="none" stroke="' + col + '" stroke-width="' + (s.ctx ? 2 : 2.5) + '" stroke-linejoin="round"></path>';
      if (!s.ctx) {
        for (var t2 = 1; t2 <= months; t2++) {
          svg += '<circle cx="' + X(t2) + '" cy="' + Y(s.data.cumGP[t2 - 1]) + '" r="3" fill="' + col + '" stroke="#fcfcfb" stroke-width="1.5"></circle>';
        }
      }
      endLabels.push({ y: Y(s.data.cumGP[months - 1]), text: s.name, col: s.ctx ? '#898781' : col });
    });
    // nudge colliding end labels apart
    endLabels.sort(function (a, b) { return a.y - b.y; });
    for (var k = 1; k < endLabels.length; k++) {
      if (endLabels[k].y - endLabels[k - 1].y < 15) endLabels[k].y = endLabels[k - 1].y + 15;
    }
    endLabels.forEach(function (l) {
      svg += '<text class="series-label" x="' + (W - M.r + 6) + '" y="' + (l.y + 4) + '" fill="' + l.col + '">' + esc(l.text) + '</text>';
    });

    // payback marker on the active series
    if (m.paybackMonth) {
      var px = X(m.paybackMonth), py = Y(res.active.cumGP[m.paybackMonth - 1]);
      svg += '<circle cx="' + px + '" cy="' + py + '" r="6" fill="none" stroke="#131210" stroke-width="2"></circle>';
      svg += '<text class="ref-label" x="' + px + '" y="' + (py - 12) + '" text-anchor="middle" fill="#131210">paid back</text>';
    }

    // hover crosshair layer
    svg += '<line id="pbCross" x1="0" x2="0" y1="' + M.t + '" y2="' + (M.t + ih) + '" stroke="#131210" stroke-width="1" stroke-dasharray="3 3" opacity="0"></line>';
    svg += '<rect id="pbHover" x="' + M.l + '" y="' + M.t + '" width="' + iw + '" height="' + ih + '" fill="transparent"></rect>';
    svg += '</svg>';
    wrap.innerHTML = svg;

    var hover = $('#pbHover'), cross = $('#pbCross');
    hover.addEventListener('pointermove', function (ev) {
      var r = wrap.querySelector('svg').getBoundingClientRect();
      var frac = (ev.clientX - r.left) / r.width * W;
      var t = Math.max(1, Math.min(months, Math.round((frac - M.l) / iw * months)));
      cross.setAttribute('x1', X(t)); cross.setAttribute('x2', X(t));
      cross.setAttribute('opacity', '0.5');
      var rows = series.map(function (s) {
        return '<div class="tt-row"><span class="k">' + esc(s.name) + '</span><span>' + fmtMoney(s.data.cumGP[t - 1]) + '</span></div>';
      }).join('');
      var ratio = state.cac > 0 ? res.active.cumGP[t - 1] / state.cac : Infinity;
      showTip('<div class="tt-title">Month ' + t + ' · cum. gross profit</div>' + rows +
        '<div class="tt-row"><span class="k">LTV:CAC so far</span><span>' + fmtRatio(ratio) + '</span></div>', ev.clientX, ev.clientY);
    });
    hover.addEventListener('pointerleave', function () { cross.setAttribute('opacity', '0'); hideTip(); });
  }

  // ---------- month table ----------
  function renderTable(res) {
    var m = res.metrics, a = res.active;
    var head = '<thead><tr><th>Month</th><th>Orders</th><th>Revenue</th><th>Gross profit</th><th>Cum. GP</th><th>Cum. LTV:CAC</th><th>Status</th></tr></thead>';
    var rows = '';
    for (var i = 0; i < state.months; i++) {
      var tags = [];
      if (m.paybackMonth === i + 1) tags.push('<span class="badge b-good">CAC paid back</span>');
      if (m.monthsTo3x === i + 1) tags.push('<span class="badge b-good">3 : 1 cleared</span>');
      if (i === 0 && m.cfaMet) tags.push('<span class="badge b-good">2× self-funding</span>');
      rows += '<tr class="' + (i < 3 ? 'is-early' : '') + '">' +
        '<td>Month ' + (i + 1) + '</td>' +
        '<td>' + fmtNum(a.orders[i], 2) + '</td>' +
        '<td>' + fmtMoney(a.rev[i], 2) + '</td>' +
        '<td>' + fmtMoney(a.gp[i], 2) + '</td>' +
        '<td>' + fmtMoney(a.cumGP[i], 2) + '</td>' +
        '<td>' + fmtRatio(m.ratioByMonth[i]) + '</td>' +
        '<td>' + (tags.join(' ') || '<span style="color:var(--muted)">—</span>') + '</td></tr>';
    }
    $('#monthTable').innerHTML = head + '<tbody>' + rows + '</tbody>';
  }

  // ---------- scale simulator ----------
  function renderSim(res) {
    var sim = res.sim;
    var tiles = [
      { l: 'Customers acquired', v: fmtNum(sim.totalCustomers, 0) },
      { l: 'Total revenue', v: fmtMoney(sim.totalRevenue) },
      { l: 'Total ad spend', v: fmtMoney(sim.totalSpend) },
      { l: 'Gross profit collected', v: fmtMoney(sim.totalGP) },
      { l: 'Ending net cash', v: fmtMoney(sim.endingNet), cls: sim.endingNet >= 0 ? 'pos' : 'neg' },
      { l: 'Cash-positive from', v: sim.breakevenMonth ? 'Month ' + sim.breakevenMonth : 'Not in 12 mo', cls: sim.breakevenMonth ? 'pos' : 'neg' }
    ];
    $('#simSummary').innerHTML = tiles.map(function (t) {
      return '<div class="sim-stat"><span class="l">' + esc(t.l) + '</span><span class="v ' + (t.cls || '') + '">' + t.v + '</span></div>';
    }).join('');

    var wrap = $('#simChart');
    var W = Math.max(560, wrap.clientWidth || 800), H = 320;
    var M = { t: 34, r: 20, b: 34, l: 70 };
    var iw = W - M.l - M.r, ih = H - M.t - M.b;
    var months = state.months;

    var hi = 0, lo = 0;
    for (var i2 = 0; i2 < months; i2++) {
      hi = Math.max(hi, sim.gpCollected[i2], sim.cumNet[i2]);
      lo = Math.min(lo, -sim.spend[i2], sim.cumNet[i2]);
    }
    hi = niceCeil(hi * 1.05); lo = -niceCeil(-lo * 1.05 || 1);

    function Y(v) { return M.t + ih * (hi - v) / (hi - lo); }
    var band = iw / months, barW = Math.min(34, band * 0.62);
    function XC(i) { return M.l + band * i + band / 2; }

    var railHex = RAILS[state.scenario].hex;
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Monthly gross profit, ad spend, and cumulative net cash over 12 months">';

    // legend
    svg += '<g font-family="var(--sans)" font-size="12">' +
      '<rect x="' + M.l + '" y="8" width="11" height="11" rx="3" fill="' + railHex + '"></rect><text x="' + (M.l + 16) + '" y="18" fill="#52514e">GP collected</text>' +
      '<rect x="' + (M.l + 116) + '" y="8" width="11" height="11" rx="3" fill="#a5a39c"></rect><text x="' + (M.l + 132) + '" y="18" fill="#52514e">Ad spend</text>' +
      '<line x1="' + (M.l + 216) + '" x2="' + (M.l + 240) + '" y1="13" y2="13" stroke="#131210" stroke-width="2.5"></line><text x="' + (M.l + 246) + '" y="18" fill="#52514e">Cumulative net cash</text></g>';

    // gridlines
    var ticks = 5;
    for (var g = 0; g <= ticks; g++) {
      var gv = lo + (hi - lo) * g / ticks, gy = Y(gv);
      svg += '<line x1="' + M.l + '" x2="' + (W - M.r) + '" y1="' + gy + '" y2="' + gy + '" stroke="#e1e0d9" stroke-width="1"></line>';
      svg += '<text class="tick-num" x="' + (M.l - 8) + '" y="' + (gy + 4) + '" text-anchor="end">' + fmtAxis(gv) + '</text>';
    }
    // zero baseline
    svg += '<line x1="' + M.l + '" x2="' + (W - M.r) + '" y1="' + Y(0) + '" y2="' + Y(0) + '" stroke="#c3c2b7" stroke-width="1.5"></line>';

    // bars
    for (var b = 0; b < months; b++) {
      var xc = XC(b);
      var gpY = Y(sim.gpCollected[b]);
      svg += '<rect data-m="' + b + '" x="' + (xc - barW / 2) + '" y="' + gpY + '" width="' + barW + '" height="' + Math.max(0, Y(0) - gpY) + '" rx="3" fill="' + railHex + '"></rect>';
      var spY = Y(-sim.spend[b]);
      svg += '<rect data-m="' + b + '" x="' + (xc - barW / 2) + '" y="' + (Y(0) + 2) + '" width="' + barW + '" height="' + Math.max(0, spY - Y(0) - 2) + '" rx="3" fill="#a5a39c"></rect>';
      svg += '<text class="tick-num" x="' + xc + '" y="' + (H - 12) + '" text-anchor="middle">M' + (b + 1) + '</text>';
    }
    // cumulative net line
    var path = '';
    for (var p = 0; p < months; p++) path += (p === 0 ? 'M ' : ' L ') + XC(p) + ' ' + Y(sim.cumNet[p]);
    svg += '<path d="' + path + '" fill="none" stroke="#131210" stroke-width="2.5" stroke-linejoin="round"></path>';
    for (var d = 0; d < months; d++) {
      svg += '<circle data-m="' + d + '" cx="' + XC(d) + '" cy="' + Y(sim.cumNet[d]) + '" r="3.5" fill="#131210" stroke="#fcfcfb" stroke-width="1.5"></circle>';
    }
    svg += '</svg>';
    wrap.innerHTML = svg;

    $all('#simChart [data-m]').forEach(function (el) {
      var i = +el.getAttribute('data-m');
      el.addEventListener('pointermove', function (ev) {
        showTip('<div class="tt-title">Month ' + (i + 1) + '</div>' +
          '<div class="tt-row"><span class="k">Ad spend</span><span>' + fmtMoney(sim.spend[i]) + '</span></div>' +
          '<div class="tt-row"><span class="k">New customers</span><span>' + fmtNum(sim.newCust[i], 0) + '</span></div>' +
          '<div class="tt-row"><span class="k">GP collected</span><span>' + fmtMoney(sim.gpCollected[i]) + '</span></div>' +
          '<div class="tt-row"><span class="k">Net this month</span><span>' + fmtMoney(sim.gpCollected[i] - sim.spend[i]) + '</span></div>' +
          '<div class="tt-row"><span class="k">Cumulative net</span><span>' + fmtMoney(sim.cumNet[i]) + '</span></div>', ev.clientX, ev.clientY);
      });
      el.addEventListener('pointerleave', hideTip);
    });
  }

  // ---------- derived notes ----------
  function renderDerived(res) {
    var a = res.active, po = a.perOrder;
    var cn = $('#cogsNote');
    if (cn) cn.textContent = '= ' + fmtNum(100 / state.cogsRatio, 1) + '% of order value · ' + fmtMoney(po.cogs, 2) + ' on the active rail';
    var cd = $('#curveDerived');
    if (cd) {
      var totOrders = a.orders.reduce(function (x, y) { return x + y; }, 0);
      cd.innerHTML = 'One customer over 12 months → <b>' + fmtNum(totOrders, 1) + ' orders</b> · <b>' + fmtMoney(a.ltvRevenue) + '</b> revenue · <b>' + fmtMoney(a.ltvGross) + '</b> gross profit';
    }
    var qb = $('#qsBreakevenV'), qc = $('#qsCfaV');
    if (qb) qb.textContent = fmtMoney(Math.max(0, Math.floor(res.metrics.maxCac30)));
    if (qc) qc.textContent = fmtMoney(Math.max(0, Math.floor(res.metrics.cfaCac)));
    // dim blend-only control outside the Blend tab
    $all('[data-idle-unless]').forEach(function (el) {
      el.classList.toggle('is-idle', el.getAttribute('data-idle-unless') !== state.scenario);
    });
    // dynamic CAC slider ceiling so the slider always reaches break-even
    var cr = $('[data-range="cac"]');
    if (cr) cr.max = Math.max(600, Math.ceil(res.metrics.maxCac30 * 2));
  }

  // ---------- main render ----------
  var lastRes = null;
  function render() {
    var res = E.compute(state);
    lastRes = res;
    document.documentElement.style.setProperty('--rail', RAILS[state.scenario].color);
    renderHero(res);
    renderKpis(res);
    renderDollar(res);
    renderPayback(res);
    renderTable(res);
    renderSim(res);
    renderDerived(res);
  }

  // ---------- top bar ----------
  function initTopbar() {
    $all('.tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        state.scenario = tab.getAttribute('data-scenario');
        $all('.tab').forEach(function (t) { t.setAttribute('aria-selected', t === tab ? 'true' : 'false'); });
        render(); pushHash();
      });
    });
    $('#btnReset').addEventListener('click', function () {
      var sc = state.scenario;
      state = Object.assign({}, E.DEFAULTS);
      state.scenario = sc;
      syncAllControls();
      render(); pushHash();
    });
    $('#btnShare').addEventListener('click', function () {
      stateToHash();
      var url = location.href;
      function done() { toast('Link copied — your numbers travel with it'); }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(done, function () { prompt('Copy this link:', url); });
      } else { prompt('Copy this link:', url); }
    });
  }
  function toast(msg) {
    var t = document.createElement('div');
    t.className = 'toast'; t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2200);
  }

  // ---------- boot ----------
  hashToState();
  buildControls();
  syncAllControls();
  initTopbar();
  initMeter();
  $all('.tab').forEach(function (t) {
    t.setAttribute('aria-selected', t.getAttribute('data-scenario') === state.scenario ? 'true' : 'false');
  });
  render();
  window.addEventListener('resize', debounce(render, 120));
})();
