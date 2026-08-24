# Money Model Desk

An interactive LTV : CAC and cash-payback engine built on Alex Hormozi's money-model rules, made for live partner meetings — every number on the page is editable and the whole model recomputes instantly. State is encoded in the URL, so "Copy live link" hands anyone the exact scenario on screen.

**Live app:** deployed on Vercel (see the repo's About link).

## The rules the page enforces

- **LTV means lifetime gross profit** — revenue minus COGS, shipping, warehouse handling, and payment processing. Never revenue.
- **LTV : CAC ≥ 3 : 1** — Hormozi's stated floor for a working acquisition machine.
- **Client-Financed Acquisition** (*$100M Leads*) — recover what it costs to acquire *and* fulfill a customer within the first 30 days (one card cycle).
- **The 2× cash rule** (*$100M Money Models* / Gym Launch 30-Day Cash Model) — collect at least 2× (CAC + cost to fulfill) in 30-day cash, so each customer funds the next two.
- **Payback period over margin** — the faster an ad dollar returns, the more times it respins per year.

## Model

Per order, for each payment rail (credit card / e-transfer):

```
gross profit = AOV − AOV/COGS-ratio − shipping − warehouse fee − processing
```

Per customer: month 1 carries the 30-day LTV multiple (× AOV). Months 2–12 follow a geometric repeat falloff, normalized so the 12-month total exactly equals `30-day multiple × 12-month multiple` orders.

Headline outputs:

- **Max CAC to break even in 30 days** = 30-day gross profit per customer
- **Self-funding (2×) target** = the CAC where 30-day cash ≥ 2 × (CAC + cost to fulfill), i.e. 30-day GP − half of 30-day revenue
- Cumulative LTV : CAC by month, payback month, months of retention needed to clear 3 : 1
- A 12-month compounding simulator: month-1 budget buys cohort #1, later months reinvest a share of the previous month's gross profit into ads, cohorts stack.

## Running locally

Static files, no build step:

```
python3 -m http.server 4179
```

then open http://localhost:4179.

## Tests

```
node tests/engine.test.js
```

Hand-computed expectations for the default inputs, plus edge-case guards (flat decay, no repeats, zero CAC).

## Stack

Vanilla JS + SVG, no dependencies. `engine.js` is a pure math module (UMD — importable from Node for testing); `app.js` is the UI layer.

---

Planning tool, not accounting or financial advice.
