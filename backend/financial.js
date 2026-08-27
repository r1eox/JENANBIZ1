function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function buildFinancialBreakdown(input = {}) {
  const fundingAmount = Math.max(0, toNumber(input.funding_amount, 0));
  const operatingExpenses = Math.max(0, toNumber(input.operating_expenses, 0));
  const explicitNetRevenue = toNumber(input.net_revenue, 0);
  const explicitCommission = toNumber(input.commission_amount, 0);

  let netRevenue = explicitNetRevenue;
  if (netRevenue <= 0 && fundingAmount > 0) {
    netRevenue = Math.max(0, fundingAmount - operatingExpenses);
  }

  const finalFundingAmount = Math.max(fundingAmount, 0);
  const finalOperatingExpenses = Math.max(operatingExpenses, 0);
  const finalNetRevenue = Math.max(netRevenue, 0);

  const commissionAmount = explicitCommission > 0
    ? explicitCommission
    : finalNetRevenue > 0
      ? finalNetRevenue
      : 0;

  return {
    funding_amount: finalFundingAmount,
    operating_expenses: finalOperatingExpenses,
    net_revenue: finalNetRevenue,
    commission_amount: commissionAmount,
  };
}

module.exports = { buildFinancialBreakdown };
