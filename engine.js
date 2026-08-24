/* Money Model Desk — pure math engine.
 * Hormozi conventions: LTV means lifetime GROSS PROFIT (revenue minus COGS,
 * fulfillment, and processing), never revenue. All ratios are computed on
 * gross profit. Works in the browser (window.Engine) and in Node (module.exports).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Engine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEFAULTS = {
    scenario: 'cc',            // 'cc' | 'et' | 'blend'
    aovCC: 185,
    aovET: 106,
    procPctCC: 2.9,            // % of order value
    procFlatCC: 0.30,          // $ per order
    procPctET: 0,
    procFlatET: 1.50,
    cogsRatio: 7,              // COGS = order value / ratio  (1:7)
    shipCost: 14,              // $ per order
    whFee: 5,                  // $ per order, warehouse person
    m1Mult: 1.5,               // 30-day revenue = m1Mult x AOV
    yearMult: 4,               // 12-month revenue = yearMult x 30-day revenue
    decay: 0.85,               // month-over-month repeat decay, months 2..12
    months: 12,
    cac: 62,                   // $ paid to acquire one customer
    blendCC: 70,               // % of customers paying by credit card (Blend tab)
    simBudget: 10000,          // month-1 ad budget
    simReinvest: 15,           // % of last month's gross profit reinvested in ads
    simFloor: true             // never spend less than the month-1 budget
  };

  function clampNum(v, lo, hi, fallback) {
    v = Number(v);
    if (!isFinite(v)) return fallback;
    return Math.min(hi, Math.max(lo, v));
  }

  function railInputs(state, rail) {
    if (rail === 'cc') {
      return { aov: state.aovCC, procPct: state.procPctCC, procFlat: state.procFlatCC,
               cogsRatio: state.cogsRatio, shipCost: state.shipCost, whFee: state.whFee };
    }
    return { aov: state.aovET, procPct: state.procPctET, procFlat: state.procFlatET,
             cogsRatio: state.cogsRatio, shipCost: state.shipCost, whFee: state.whFee };
  }

  // Per-order unit economics for one payment rail.
  function perOrder(inp) {
    var aov = Math.max(0, inp.aov);
    var cogs = inp.cogsRatio > 0 ? aov / inp.cogsRatio : 0;
    var processing = aov * (inp.procPct / 100) + inp.procFlat;
    var shipping = inp.shipCost;
    var warehouse = inp.whFee;
    var gross = aov - cogs - processing - shipping - warehouse;
    return {
      aov: aov, cogs: cogs, processing: processing,
      shipping: shipping, warehouse: warehouse, gross: gross,
      marginPct: aov > 0 ? (gross / aov) * 100 : 0
    };
  }

  /* Orders placed by ONE customer, month by month.
   * Month 1 carries m1Mult orders (30-day revenue = m1Mult x AOV).
   * Months 2..N follow a geometric decay scaled so the 12-month total
   * equals m1Mult x yearMult orders exactly. */
  function orderCurve(m1Mult, yearMult, decay, months) {
    months = months || 12;
    var o1 = Math.max(0, m1Mult);
    var total = o1 * Math.max(1, yearMult);
    var rest = Math.max(0, total - o1);
    var n = months - 1;
    var orders = [o1];
    if (n > 0) {
      // Treat decay as flat only at true degeneracy, and emit the same flat
      // tail the normalizer assumed — the 12-month total must stay exact.
      var flat = Math.abs(1 - decay) < 1e-9;
      var sumFactor = flat ? n : (1 - Math.pow(decay, n)) / (1 - decay);
      var A = sumFactor > 0 ? rest / sumFactor : 0;
      for (var t = 0; t < n; t++) orders.push(flat ? A : A * Math.pow(decay, t));
    }
    return orders;
  }

  // Full monthly cohort stream for one rail: revenue + gross profit per customer.
  function cohort(state, rail) {
    var inp = railInputs(state, rail);
    var po = perOrder(inp);
    var orders = orderCurve(state.m1Mult, state.yearMult, state.decay, state.months);
    var rev = [], gp = [], cumRev = [], cumGP = [];
    var r = 0, g = 0;
    for (var i = 0; i < orders.length; i++) {
      var mr = orders[i] * po.aov;
      var mg = orders[i] * po.gross;
      r += mr; g += mg;
      rev.push(mr); gp.push(mg); cumRev.push(r); cumGP.push(g);
    }
    return { rail: rail, perOrder: po, orders: orders, rev: rev, gp: gp,
             cumRev: cumRev, cumGP: cumGP,
             ltvRevenue: r, ltvGross: g };
  }

  // Weighted mix of the two rails (f = share of customers on credit card, 0..1).
  function blendCohorts(cc, et, f) {
    function mix(a, b) { return a.map(function (v, i) { return f * v + (1 - f) * b[i]; }); }
    function mixNum(a, b) { return f * a + (1 - f) * b; }
    var po = {};
    ['aov', 'cogs', 'processing', 'shipping', 'warehouse', 'gross'].forEach(function (k) {
      po[k] = mixNum(cc.perOrder[k], et.perOrder[k]);
    });
    po.marginPct = po.aov > 0 ? (po.gross / po.aov) * 100 : 0;
    return {
      rail: 'blend', perOrder: po,
      orders: mix(cc.orders, et.orders),
      rev: mix(cc.rev, et.rev), gp: mix(cc.gp, et.gp),
      cumRev: mix(cc.cumRev, et.cumRev), cumGP: mix(cc.cumGP, et.cumGP),
      ltvRevenue: mixNum(cc.ltvRevenue, et.ltvRevenue),
      ltvGross: mixNum(cc.ltvGross, et.ltvGross)
    };
  }

  /* Hormozi metrics for one cohort stream at a chosen CAC.
   * maxCac30   — spend this per customer and every dollar is back by day 30
   *              (the $100M Leads client-financed bar: recover what it costs
   *              to acquire AND fulfill within one card cycle).
   * cfaCac     — the self-funding ceiling from his 2x rule ($100M Money
   *              Models / Gym Launch 30-Day Cash Model): 30-day cash
   *              collected >= 2 x (CAC + cost to fulfill). In this model,
   *              cash30 = 30-day revenue and cost30 = revenue30 - GP30, so
   *              the ceiling reduces to GP30 - revenue30/2 (floored at 0).
   * paybackMonth / monthsTo3x — 1-based month index, or null if never inside
   *              the modeled horizon. */
  function metrics(cohortData, cac) {
    var cum = cohortData.cumGP;
    var maxCac30 = cum[0];
    var cfaCac = Math.max(0, cum[0] - cohortData.cumRev[0] / 2);
    var paybackMonth = null, monthsTo3x = null;
    var ratioByMonth = [];
    for (var i = 0; i < cum.length; i++) {
      ratioByMonth.push(cac > 0 ? cum[i] / cac : Infinity);
      if (paybackMonth === null && cum[i] >= cac) paybackMonth = i + 1;
      if (monthsTo3x === null && cum[i] >= 3 * cac) monthsTo3x = i + 1;
    }
    var ltvCac = cac > 0 ? cohortData.ltvGross / cac : Infinity;
    return {
      cac: cac,
      maxCac30: maxCac30,
      cfaCac: cfaCac,
      cfaMet: cac > 0 && cac <= cfaCac + 1e-9,
      thirtyDayMultiple: cac > 0 ? cum[0] / cac : Infinity, // GP collected in 30d per $1 of CAC
      paybackMonth: paybackMonth,
      monthsTo3x: monthsTo3x,
      ratioByMonth: ratioByMonth,
      ltvGross: cohortData.ltvGross,
      ltvRevenue: cohortData.ltvRevenue,
      ltvCac: ltvCac
    };
  }

  /* Compounding simulator: month-1 budget buys the first cohort; each later
   * month reinvests reinvestPct% of the PREVIOUS month's collected gross
   * profit into ads (optionally never dropping below the month-1 budget).
   * Cohorts stack: a customer bought in month m generates the cohort curve
   * shifted to start at m. */
  function scaleSim(state, cohortData) {
    var months = state.months;
    var cac = Math.max(0.01, state.cac);
    var gpCurve = cohortData.gp;
    var revCurve = cohortData.rev;
    var spend = [], newCust = [], gpCollected = [], revCollected = [];
    var cumNet = [], totalCust = [];
    var custByMonth = [];
    var runCust = 0, runNet = 0;
    var budget = Math.max(0, state.simBudget);
    for (var m = 0; m < months; m++) {
      var s;
      if (m === 0) s = budget;
      else {
        // Ad spend can never go negative, even when a cohort loses money.
        s = Math.max(0, (state.simReinvest / 100) * gpCollected[m - 1]);
        if (state.simFloor) s = Math.max(s, budget);
      }
      var n = s / cac;
      custByMonth.push(n);
      runCust += n;
      var gpm = 0, revm = 0;
      for (var c = 0; c <= m; c++) {
        var age = m - c;
        if (age < gpCurve.length) {
          gpm += custByMonth[c] * gpCurve[age];
          revm += custByMonth[c] * revCurve[age];
        }
      }
      runNet += gpm - s;
      spend.push(s); newCust.push(n);
      gpCollected.push(gpm); revCollected.push(revm);
      cumNet.push(runNet); totalCust.push(runCust);
    }
    var totSpend = spend.reduce(function (a, b) { return a + b; }, 0);
    var totGP = gpCollected.reduce(function (a, b) { return a + b; }, 0);
    var totRev = revCollected.reduce(function (a, b) { return a + b; }, 0);
    var breakevenMonth = null;
    for (var i = 0; i < cumNet.length; i++) {
      if (cumNet[i] >= 0) { breakevenMonth = i + 1; break; }
    }
    return {
      spend: spend, newCust: newCust, gpCollected: gpCollected,
      revCollected: revCollected, cumNet: cumNet, totalCust: totalCust,
      totalSpend: totSpend, totalGP: totGP, totalRevenue: totRev,
      endingNet: cumNet[months - 1], totalCustomers: runCust,
      breakevenMonth: breakevenMonth,
      realizedRoas: totSpend > 0 ? totRev / totSpend : Infinity
    };
  }

  // One call that computes everything the UI needs from the state.
  function compute(state) {
    var cc = cohort(state, 'cc');
    var et = cohort(state, 'et');
    var blend = blendCohorts(cc, et, clampNum(state.blendCC, 0, 100, 70) / 100);
    var active = state.scenario === 'et' ? et : (state.scenario === 'blend' ? blend : cc);
    var m = metrics(active, state.cac);
    var sim = scaleSim(state, active);
    return { cc: cc, et: et, blend: blend, active: active, metrics: m, sim: sim };
  }

  return {
    DEFAULTS: DEFAULTS,
    clampNum: clampNum,
    railInputs: railInputs,
    perOrder: perOrder,
    orderCurve: orderCurve,
    cohort: cohort,
    blendCohorts: blendCohorts,
    metrics: metrics,
    scaleSim: scaleSim,
    compute: compute
  };
});
