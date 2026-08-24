/* Hand-computed expectations for the default inputs.
 * Run: node tests/engine.test.js  (exits non-zero on any failure) */
const E = require('../engine.js');

let failures = 0;
function eq(name, got, want, tol = 0.01) {
  const ok = Math.abs(got - want) <= tol;
  if (!ok) { failures++; console.error(`FAIL ${name}: got ${got}, want ${want}`); }
  else console.log(`ok   ${name}: ${got.toFixed ? got.toFixed(4) : got}`);
}

const S = { ...E.DEFAULTS };

// --- Per-order economics, credit card ---
// COGS 185/7 = 26.428571; processing 185*2.9% + 0.30 = 5.665; fulfillment 19
const cc = E.perOrder(E.railInputs(S, 'cc'));
eq('cc cogs', cc.cogs, 26.428571);
eq('cc processing', cc.processing, 5.665);
eq('cc gross/order', cc.gross, 133.906429);
eq('cc margin %', cc.marginPct, 72.38, 0.01);

// --- Per-order economics, e-transfer ---
// COGS 106/7 = 15.142857; processing 1.50 flat; fulfillment 19
const et = E.perOrder(E.railInputs(S, 'et'));
eq('et cogs', et.cogs, 15.142857);
eq('et gross/order', et.gross, 70.357143);

// --- Order curve: month 1 = 1.5 orders, 12-month total = 6.0 exactly ---
const oc = E.orderCurve(1.5, 4, 0.85, 12);
eq('curve length', oc.length, 12, 0);
eq('curve m1', oc[0], 1.5);
eq('curve total', oc.reduce((a, b) => a + b, 0), 6.0, 1e-9);
// A = 4.5 * 0.15 / (1 - 0.85^11) = 0.810659
eq('curve m2', oc[1], 0.810659, 0.0001);
eq('curve m3', oc[2], 0.689060, 0.0001);

// --- Cohort stream, credit card ---
const ccCo = E.cohort(S, 'cc');
eq('cc 30-day GP', ccCo.cumGP[0], 200.859643);
eq('cc cum GP m2', ccCo.cumGP[1], 309.415, 0.01);
eq('cc cum GP m3', ccCo.cumGP[2], 401.688, 0.01);
eq('cc 12-mo LTV (gross)', ccCo.ltvGross, 803.438571);
eq('cc 12-mo LTV (revenue)', ccCo.ltvRevenue, 1110.0);

// --- Cohort stream, e-transfer ---
const etCo = E.cohort(S, 'et');
eq('et 30-day GP', etCo.cumGP[0], 105.535714);
eq('et 12-mo LTV (gross)', etCo.ltvGross, 422.142857);

// --- Metrics at break-even CAC: ratio must be exactly 1.0 / 1.54 / 2.0 / 4.0 ---
const mBE = E.metrics(ccCo, ccCo.cumGP[0]);
eq('maxCac30 cc', mBE.maxCac30, 200.859643);
// strict 2x rule: cash30 >= 2*(CAC + cost30)  <=>  CAC <= GP30 - rev30/2
// = 200.859643 - 277.50/2 = 62.109643
eq('cfa cc (2x money-model rule)', mBE.cfaCac, 62.109643);
eq('ratio m1 @breakeven', mBE.ratioByMonth[0], 1.0, 1e-9);
eq('ratio m2 @breakeven', mBE.ratioByMonth[1], 1.5404, 0.001);
eq('ratio m3 @breakeven', mBE.ratioByMonth[2], 1.9998, 0.001);
eq('ratio m12 @breakeven', mBE.ratioByMonth[11], 4.0, 1e-9);
eq('payback month @breakeven', mBE.paybackMonth, 1, 0);
eq('months to 3:1 @breakeven', mBE.monthsTo3x, 6, 0); // cum ratio hits 3.004 in month 6

// --- Metrics at the self-funding CAC ---
const mCFA = E.metrics(ccCo, mBE.cfaCac);
eq('30-day multiple @CFA', mCFA.thirtyDayMultiple, 3.2340, 0.001);
eq('ltv:cac @CFA', mCFA.ltvCac, 12.9358, 0.001);
eq('months to 3:1 @CFA', mCFA.monthsTo3x, 1, 0);
eq('cfaMet at $62', E.metrics(ccCo, 62).cfaMet ? 1 : 0, 1, 0);
eq('cfaMet fails at $63', E.metrics(ccCo, 63).cfaMet ? 1 : 0, 0, 0);
// verify the reduction against the raw published inequality:
// cash30 >= 2*(CAC + cost30) with cash30 = 277.50, cost30 = 277.50 - 200.859643
const cost30 = ccCo.cumRev[0] - ccCo.cumGP[0];
eq('published inequality holds at ceiling', ccCo.cumRev[0], 2 * (mBE.cfaCac + cost30), 1e-6);

// --- Blend 70% CC: weighted per-order gross ---
const bl = E.blendCohorts(ccCo, etCo, 0.7);
eq('blend gross/order', bl.perOrder.gross, 0.7 * 133.906429 + 0.3 * 70.357143);
eq('blend 12-mo LTV', bl.ltvGross, 0.7 * 803.438571 + 0.3 * 422.142857);

// --- Scale sim invariants ---
const simState = { ...S, cac: 100, simBudget: 10000, simReinvest: 80, simFloor: true };
const sim = E.scaleSim(simState, ccCo);
eq('sim m1 spend', sim.spend[0], 10000);
eq('sim m1 customers', sim.newCust[0], 100);
eq('sim m1 GP', sim.gpCollected[0], 100 * 200.859643, 0.01);
// month 2 spend = 80% of month-1 GP (above the floor)
eq('sim m2 spend', sim.spend[1], 0.8 * 100 * 200.859643, 0.01);
// cumulative net never contradicts totals
eq('sim ending net = totGP - totSpend', sim.endingNet, sim.totalGP - sim.totalSpend, 0.01);

// --- Guards ---
const flat = E.orderCurve(1.5, 4, 1.0, 12); // decay = 1 must not divide by zero
eq('flat curve total', flat.reduce((a, b) => a + b, 0), 6.0, 1e-9);
// near-1 decay must keep the exact-total invariant (old epsilon-band bug)
eq('decay 0.9999 total', E.orderCurve(1.5, 4, 0.9999, 12).reduce((a, b) => a + b, 0), 6.0, 1e-9);
eq('decay 1.0001 total', E.orderCurve(1.5, 4, 1.0001, 12).reduce((a, b) => a + b, 0), 6.0, 1e-9);
// negative-margin cohort must never produce negative ad spend or customers
const uw = { ...S, scenario: 'et', aovET: 20, simFloor: false, cac: 100, simBudget: 10000 };
const uwSim = E.scaleSim(uw, E.cohort(uw, 'et'));
eq('underwater sim min spend >= 0', Math.min(...uwSim.spend), 0, 1e-9);
eq('underwater sim min customers >= 0', Math.min(...uwSim.newCust), 0, 1e-9);
const noRepeat = E.orderCurve(1.5, 1, 0.85, 12); // year = 30-day only
eq('no-repeat total', noRepeat.reduce((a, b) => a + b, 0), 1.5, 1e-9);
const inf = E.metrics(ccCo, 0); // zero CAC must not crash
eq('zero cac ratio is Infinity', isFinite(inf.ltvCac) ? 0 : 1, 1, 0);

console.log(failures ? `\n${failures} FAILURES` : '\nAll tests passed.');
process.exit(failures ? 1 : 0);
