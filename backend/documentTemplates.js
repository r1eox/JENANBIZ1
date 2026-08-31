function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function formatMoney(value) {
  return `${Number(value || 0).toLocaleString('ar-SA', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ر.س`;
}

function normalizeRequestData(request = {}) {
  const source = request || {};
  return {
    id: source.id || null,
    companyName: source.company_name || source.companyName || 'غير محدد',
    ownerName: source.owner_name || source.ownerName || source.client_name || 'غير محدد',
    fundingType: source.funding_type || source.fundingType || 'تمويل',
    entityType: source.entity_type || source.entityType || 'شركة',
    fundingAmount: toNumber(source.funding_amount ?? source.fundingAmount, 0),
    operatingExpenses: toNumber(source.operating_expenses ?? source.operatingExpenses, 0),
    netRevenue: toNumber(source.net_revenue ?? source.netRevenue, toNumber(source.commission_amount ?? source.commissionAmount, 0)),
    commissionAmount: toNumber(source.commission_amount ?? source.commissionAmount, toNumber(source.net_revenue ?? source.netRevenue, 0)),
    email: source.user_email || source.email || source.client_email || '',
    phone: source.owner_phone || source.ownerPhone || source.user_phone || '',
    createdAt: source.created_at || source.createdAt || new Date().toISOString(),
  };
}

function buildDocumentTemplateContext(document = {}, request = {}) {
  const doc = document || {};
  const requestData = normalizeRequestData(request || doc.request || {});
  const type = String(doc.document_type || 'invoice').toLowerCase();
  const typeLabels = {
    invoice: 'فاتورة',
    receipt: 'سند قبض',
    quote: 'عرض سعر',
    contract: 'عقد',
    other: 'مستند',
  };

  const amount = toNumber(doc.total_amount ?? doc.amount ?? requestData.fundingAmount, 0);

  return {
    docId: doc.id || null,
    number: doc.document_number || `DOC-${doc.id || 'NEW'}`,
    type,
    typeLabel: typeLabels[type] || 'مستند',
    issueDate: doc.issue_month || new Date().toISOString().slice(0, 7),
    createdAt: doc.created_at || new Date().toISOString(),
    amount,
    companyName: doc.company_name || requestData.companyName || 'غير محدد',
    clientName: doc.client_name || requestData.ownerName || 'غير محدد',
    clientEmail: doc.email || requestData.email || '',
    phone: requestData.phone || '',
    fundingType: requestData.fundingType,
    entityType: requestData.entityType,
    requestId: doc.request_id || requestData.id || null,
    fundingAmount: requestData.fundingAmount,
    operatingExpenses: requestData.operatingExpenses,
    netRevenue: requestData.netRevenue,
    commissionAmount: requestData.commissionAmount,
    notes: doc.notes || '',
  };
}

function renderDocumentTemplate(document = {}, request = {}) {
  const ctx = buildDocumentTemplateContext(document, request);
  const title = `${ctx.typeLabel} - ${ctx.number}`;

  const requestSummaryRows = [
    ['اسم الشركة', ctx.companyName],
    ['اسم العميل', ctx.clientName],
    ['نوع الطلب', ctx.fundingType],
    ['نوع المنشأة', ctx.entityType],
    ['رقم الطلب', ctx.requestId ? `#${ctx.requestId}` : '—'],
  ];

  const financialRows = [
    ['مبلغ التمويل', formatMoney(ctx.fundingAmount)],
    ['المصاريف التشغيلية', formatMoney(ctx.operatingExpenses)],
    ['صافي الإيرادات', formatMoney(ctx.netRevenue)],
    ['العمولات / الربح', formatMoney(ctx.commissionAmount)],
    ['المبلغ الإجمالي', formatMoney(ctx.amount)],
  ];

  const requestSummaryHtml = requestSummaryRows.map(([label, value]) => `
    <tr>
      <td>${label}</td>
      <td>${value}</td>
    </tr>
  `).join('');

  const financialHtml = financialRows.map(([label, value]) => `
    <tr>
      <td>${label}</td>
      <td>${value}</td>
    </tr>
  `).join('');

  return `<!doctype html>
<html lang="ar" dir="rtl">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <style>
      body {
        margin: 0;
        font-family: "Segoe UI", Tahoma, Arial, sans-serif;
        background: #f5f7fb;
        color: #102033;
      }
      .page {
        width: 794px;
        min-height: 1123px;
        margin: 24px auto;
        background: white;
        box-shadow: 0 8px 24px rgba(15, 23, 42, 0.08);
        padding: 36px 36px 30px;
        box-sizing: border-box;
      }
      .header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding-bottom: 18px;
        border-bottom: 2px solid #e2e8f0;
      }
      .brand {
        font-size: 28px;
        font-weight: 900;
        color: #184d9a;
      }
      .badge {
        background: linear-gradient(135deg, #1d4ed8, #2563eb);
        color: white;
        border-radius: 20px;
        padding: 8px 16px;
        font-size: 13px;
        font-weight: 700;
      }
      .meta {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 18px;
        margin: 24px 0;
      }
      .meta-box {
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        padding: 16px 18px;
        border-radius: 16px;
      }
      .meta-label {
        display: block;
        font-size: 11px;
        color: #64748b;
        margin-bottom: 6px;
      }
      .meta-value {
        font-size: 18px;
        font-weight: 800;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 16px;
      }
      th, td {
        border: 1px solid #e2e8f0;
        padding: 12px 14px;
        text-align: right;
        vertical-align: top;
      }
      th {
        background: #eff6ff;
        color: #1e3a8a;
        font-size: 13px;
      }
      td {
        font-size: 13px;
      }
      .total-box {
        background: #0f172a;
        color: white;
        border-radius: 18px;
        padding: 18px 20px;
        margin-top: 22px;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .notes {
        margin-top: 22px;
        border: 1px solid #e2e8f0;
        border-radius: 16px;
        padding: 18px 20px;
        background: #f8fafc;
      }
      .footer {
        margin-top: 32px;
        border-top: 1px solid #e2e8f0;
        padding-top: 18px;
        display: flex;
        justify-content: space-between;
        color: #64748b;
        font-size: 12px;
      }
      @media print {
        body {
          background: white;
        }
        .page {
          box-shadow: none;
          margin: 0;
          width: 100%;
          min-height: auto;
        }
      }
    </style>
  </head>
  <body>
    <div class="page">
      <div class="header">
        <div>
          <div class="brand">JENAN BIZ</div>
          <div style="font-size:12px;color:#64748b;">نظام إدارة المستندات والمحاسبة</div>
        </div>
        <div class="badge">${ctx.typeLabel}</div>
      </div>

      <div class="meta">
        <div class="meta-box">
          <span class="meta-label">رقم المستند</span>
          <span class="meta-value">${ctx.number}</span>
        </div>
        <div class="meta-box">
          <span class="meta-label">تاريخ الإصدار</span>
          <span class="meta-value">${ctx.issueDate}</span>
        </div>
        <div class="meta-box">
          <span class="meta-label">المبلغ الإجمالي</span>
          <span class="meta-value">${formatMoney(ctx.amount)}</span>
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th style="width:35%;">البيان</th>
            <th style="width:65%;">القيمة</th>
          </tr>
        </thead>
        <tbody>
          ${requestSummaryHtml}
        </tbody>
      </table>

      <table>
        <thead>
          <tr>
            <th style="width:35%;">البند المالي</th>
            <th style="width:65%;">القيمة</th>
          </tr>
        </thead>
        <tbody>
          ${financialHtml}
        </tbody>
      </table>

      <div class="total-box">
        <span>الإجمالي</span>
        <strong>${formatMoney(ctx.amount)}</strong>
      </div>

      <div class="notes">
        <div style="font-size:12px;color:#64748b;margin-bottom:8px;">ملاحظات</div>
        <div>${ctx.notes || 'لا توجد ملاحظات إضافية.'}</div>
      </div>

      <div class="footer">
        <span>العميل: ${ctx.clientName}</span>
        <span>البريد: ${ctx.clientEmail || 'غير محدد'}</span>
        <span>رقم الطلب: ${ctx.requestId ? `#${ctx.requestId}` : '—'}</span>
      </div>
    </div>
  </body>
</html>`;
}

module.exports = { buildDocumentTemplateContext, renderDocumentTemplate, formatMoney };
