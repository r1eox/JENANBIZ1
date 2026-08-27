const assert = require('node:assert/strict');
const { buildFinancialBreakdown, summarizeMonthlyAccounting } = require('../financial');

const result = buildFinancialBreakdown({ funding_amount: 10000, operating_expenses: 3000, net_revenue: 7000 });
assert.equal(result.funding_amount, 10000);
assert.equal(result.operating_expenses, 3000);
assert.equal(result.net_revenue, 7000);
assert.equal(result.commission_amount, 7000);

const fallback = buildFinancialBreakdown({ funding_amount: 0, operating_expenses: 1500, net_revenue: 0 });
assert.equal(fallback.funding_amount, 1500);
assert.equal(fallback.net_revenue, 0);

const summary = summarizeMonthlyAccounting([
  { type: 'revenue', amount: 6000 },
  { type: 'expense', amount: 1800 },
  { type: 'expense', amount: 1200 },
  { type: 'revenue', amount: 1500 },
]);
assert.equal(summary.total_revenue, 7500);
assert.equal(summary.total_expenses, 3000);
assert.equal(summary.net_revenue, 4500);

console.log('financial breakdown tests passed');
