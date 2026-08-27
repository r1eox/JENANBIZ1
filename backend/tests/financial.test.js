const assert = require('node:assert/strict');
const { buildFinancialBreakdown } = require('../financial');

const result = buildFinancialBreakdown({ funding_amount: 10000, operating_expenses: 3000, net_revenue: 7000 });
assert.equal(result.funding_amount, 10000);
assert.equal(result.operating_expenses, 3000);
assert.equal(result.net_revenue, 7000);
assert.equal(result.commission_amount, 10000);

const fallback = buildFinancialBreakdown({ funding_amount: 0, operating_expenses: 1500, net_revenue: 0 });
assert.equal(fallback.funding_amount, 1500);
assert.equal(fallback.net_revenue, 0);

console.log('financial breakdown tests passed');
