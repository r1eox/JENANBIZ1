function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function buildFinancialBreakdown(input = {}) {
  const rawFundingAmount = toNumber(input.funding_amount, 0);
  const operatingExpenses = Math.max(0, toNumber(input.operating_expenses, 0));
  const explicitNetRevenue = toNumber(input.net_revenue, 0);
  const explicitCommission = toNumber(input.commission_amount, 0);

  const fundingAmount = Math.max(0, rawFundingAmount > 0 ? rawFundingAmount : operatingExpenses);

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

function applyStatusFinancialUpdate(status, request = {}) {
  const normalizedStatus = String(status || '').toLowerCase();
  const baseData = buildFinancialBreakdown(request);

  if (!['approved', 'transferred', 'fees_received'].includes(normalizedStatus)) {
    return {
      ...baseData,
      commission_amount: toNumber(request.commission_amount, baseData.commission_amount),
    };
  }

  const derivedRevenue = buildFinancialBreakdown({
    funding_amount: request.funding_amount ?? baseData.funding_amount,
    operating_expenses: request.operating_expenses ?? baseData.operating_expenses,
    net_revenue: request.net_revenue ?? baseData.net_revenue,
    commission_amount: request.commission_amount ?? baseData.commission_amount,
  });

  if (toNumber(request.commission_amount, 0) > 0) {
    return {
      ...derivedRevenue,
      commission_amount: toNumber(request.commission_amount, derivedRevenue.net_revenue),
    };
  }

  return {
    ...derivedRevenue,
    commission_amount: derivedRevenue.net_revenue,
  };
}

function summarizeMonthlyAccounting(entries = []) {
  const safeEntries = Array.isArray(entries) ? entries : [];
  const totals = safeEntries.reduce((acc, entry) => {
    const amount = Number(entry?.amount || 0);
    if (!Number.isFinite(amount)) return acc;

    if (String(entry?.type || '').toLowerCase() === 'revenue') {
      acc.total_revenue += amount;
    } else if (String(entry?.type || '').toLowerCase() === 'expense') {
      acc.total_expenses += amount;
    }
    return acc;
  }, { total_revenue: 0, total_expenses: 0 });

  const netRevenue = totals.total_revenue - totals.total_expenses;

  return {
    total_revenue: totals.total_revenue,
    total_expenses: totals.total_expenses,
    net_revenue: netRevenue,
    margin_percent: totals.total_revenue > 0 ? (netRevenue / totals.total_revenue) * 100 : 0,
  };
}

module.exports = { buildFinancialBreakdown, applyStatusFinancialUpdate, summarizeMonthlyAccounting };
