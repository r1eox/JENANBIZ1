import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { FileText, Send, Mail, Plus, TrendingUp, BarChart3, Download, Eye, CheckCircle, Clock3, Printer, ExternalLink, Upload, Archive, Building2 } from 'lucide-react';

const DOC_TYPES = [
  { value: 'invoice', label: 'فاتورة' },
  { value: 'receipt', label: 'سند قبض' },
  { value: 'quote', label: 'عرض سعر' },
  { value: 'contract', label: 'عقد' },
  { value: 'other', label: 'أخرى' },
];

const money = (n) => Number(n || 0).toLocaleString('ar-SA', { maximumFractionDigits: 0 }) + ' ر.س';
const thisMonth = () => new Date().toISOString().slice(0, 7);

export default function Documents() {
  const { authFetch } = useAuth();
  const [month, setMonth] = useState(thisMonth());
  const [documents, setDocuments] = useState([]);
  const [selectedRequestId, setSelectedRequestId] = useState('');
  const [requests, setRequests] = useState([]);
  const [requestDetail, setRequestDetail] = useState(null);
  const [fundingEntities, setFundingEntities] = useState([]);
  const [selectedFundingEntityId, setSelectedFundingEntityId] = useState('');
  const [selectedDocId, setSelectedDocId] = useState(null);
  const [selectedDoc, setSelectedDoc] = useState(null);
  const [summary, setSummary] = useState({
    total_documents: 0,
    invoice_count: 0,
    receipt_count: 0,
    quote_count: 0,
    contract_count: 0,
    total_amount: 0,
    sent_count: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    document_type: 'invoice',
    document_number: '',
    client_name: '',
    company_name: '',
    email: '',
    total_amount: '',
    notes: '',
    issue_month: thisMonth(),
  });

  const loadData = async (selectedMonth = month) => {
    setLoading(true);
    try {
      const [summaryRes, listRes, requestsRes] = await Promise.all([
        authFetch(`/api/admin/documents/summary?month=${selectedMonth}`),
        authFetch(`/api/admin/documents?month=${selectedMonth}`),
        authFetch('/api/admin/requests'),
      ]);

      if (!summaryRes.ok || !listRes.ok || !requestsRes.ok) {
        throw new Error('فشل في تحميل بيانات المستندات');
      }

      const summaryData = await summaryRes.json();
      const listData = await listRes.json();
      const requestsData = await requestsRes.json();
      setSummary(summaryData.summary || {
        total_documents: 0,
        invoice_count: 0,
        receipt_count: 0,
        quote_count: 0,
        contract_count: 0,
        total_amount: 0,
        sent_count: 0,
      });
      setDocuments(listData.documents || []);
      setRequests(Array.isArray(requestsData) ? requestsData : []);
    } catch (err) {
      setError(err.message || 'حدث خطأ');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData(month);
  }, [month]);

  useEffect(() => {
    if (!selectedRequestId) {
      setRequestDetail(null);
      return;
    }

    const loadRequest = async () => {
      try {
        const res = await authFetch(`/api/admin/requests/${selectedRequestId}`);
        if (!res.ok) throw new Error('فشل في تحميل تفاصيل الطلب');
        const data = await res.json();
        setRequestDetail(data);
      } catch (err) {
        setError(err.message || 'حدث خطأ في تحميل تفاصيل الطلب');
      }
    };

    loadRequest();
  }, [selectedRequestId, authFetch]);

  useEffect(() => {
    const loadEntities = async () => {
      try {
        const res = await authFetch('/api/admin/funding-entities');
        if (!res.ok) return;
        const data = await res.json();
        setFundingEntities(Array.isArray(data) ? data : []);
      } catch (_) {}
    };
    loadEntities();
  }, [authFetch]);

  const openDocumentDetail = async (id) => {
    try {
      const res = await authFetch(`/api/admin/documents/${id}`);
      if (!res.ok) throw new Error('فشل في تحميل تفاصيل المستند');
      const data = await res.json();
      setSelectedDocId(id);
      setSelectedDoc(data);
    } catch (err) {
      setError(err.message || 'حدث خطأ في تفاصيل المستند');
    }
  };

  const printDocument = async (id) => {
    try {
      const res = await authFetch(`/api/admin/documents/${id}/template`);
      if (!res.ok) throw new Error('تعذر فتح قالب المستند');
      const html = await res.text();
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const newWindow = window.open(url, '_blank');
      if (newWindow) {
        setTimeout(() => newWindow.focus(), 250);
      }
    } catch (err) {
      setError(err.message || 'حدث خطأ في طباعة المستند');
    }
  };

  const handleChange = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const payload = {
        ...form,
        request_id: selectedRequestId || null,
        total_amount: Number(form.total_amount || 0),
        issue_month: form.issue_month || month,
      };

      const res = await authFetch('/api/admin/documents', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'لم يتم حفظ المستند');
      }

      setForm({
        document_type: 'invoice',
        document_number: '',
        client_name: '',
        company_name: '',
        email: '',
        total_amount: '',
        notes: '',
        issue_month: month,
      });
      await loadData(month);
    } catch (err) {
      setError(err.message || 'حدث خطأ أثناء الحفظ');
    }
  };

  const sendEmail = async (id) => {
    try {
      const res = await authFetch(`/api/admin/documents/${id}/send-email`, { method: 'POST' });
      if (!res.ok) throw new Error('فشل في إرسال البريد');
      await loadData(month);
    } catch (err) {
      setError(err.message || 'حدث خطأ في إرسال البريد');
    }
  };

  const uploadRequestDocumentFiles = async (docId, files) => {
    if (!selectedRequestId || !files || files.length === 0) return;
    const formData = new FormData();
    Array.from(files).forEach((file) => formData.append('files', file));

    try {
      const res = await authFetch(`/api/requests/${selectedRequestId}/documents/${docId}/upload`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'فشل في رفع الملفات');
      setError('');
      const next = await authFetch(`/api/admin/requests/${selectedRequestId}`);
      if (next.ok) {
        setRequestDetail(await next.json());
      }
      alert(data.message || 'تم رفع المستند بنجاح');
    } catch (err) {
      setError(err.message || 'حدث خطأ أثناء رفع الملف');
    }
  };

  const createRequestPackage = async () => {
    if (!selectedRequestId) {
      setError('اختر طلباً أولاً');
      return;
    }

    try {
      const formData = new FormData();
      const res = await authFetch(`/api/requests/${selectedRequestId}/submit-file`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'فشل في تجميع الملف');
      setError('');
      const next = await authFetch(`/api/admin/requests/${selectedRequestId}`);
      if (next.ok) {
        setRequestDetail(await next.json());
      }
      alert(data.message || 'تم تجميع الملف المضغوط بنجاح');
    } catch (err) {
      setError(err.message || 'حدث خطأ أثناء تجميع الملف');
    }
  };

  const sendPackageToFunding = async () => {
    if (!selectedRequestId || !selectedFundingEntityId) {
      setError('اختر طلباً وجهة تمويلية أولاً');
      return;
    }

    try {
      const res = await authFetch(`/api/admin/requests/${selectedRequestId}/assign-funding`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ funding_entity_id: selectedFundingEntityId, note: 'تم إرسال الملف المضغوط بعد المراجعة' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'فشل في إرسال الملف للجهة');
      if (data.whatsapp_url) window.open(data.whatsapp_url, '_blank', 'noopener,noreferrer');
      alert(data.message || 'تم إرسال الملف للجهة التمويلية');
    } catch (err) {
      setError(err.message || 'حدث خطأ أثناء إرسال الملف');
    }
  };

  const totalCards = useMemo(() => [
    { label: 'عدد المستندات', value: summary.total_documents, icon: FileText, color: 'from-sky-500 to-blue-600' },
    { label: 'الفواتير', value: summary.invoice_count, icon: FileText, color: 'from-emerald-500 to-green-600' },
    { label: 'العقود', value: summary.contract_count, icon: CheckCircle, color: 'from-violet-500 to-purple-600' },
    { label: 'العروض', value: summary.quote_count, icon: BarChart3, color: 'from-amber-500 to-orange-500' },
    { label: 'سندات القبض', value: summary.receipt_count, icon: Mail, color: 'from-pink-500 to-rose-600' },
    { label: 'الإجمالي', value: money(summary.total_amount), icon: TrendingUp, color: 'from-cyan-500 to-teal-600' },
  ], [summary]);

  return (
    <div className="p-4 md:p-8" dir="rtl">
      <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-black text-slate-900">لوحة المستندات</h1>
          <p className="text-sm text-slate-500">فواتير، عروض أسعار، سندات قبض، عقود، ومتابعة الإرسال عبر البريد</p>
        </div>
        <label className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm">
          الشهر
          <input
            type="month"
            className="mr-2 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 outline-none"
            value={month}
            onChange={(e) => setMonth(e.target.value || thisMonth())}
          />
        </label>
      </div>

      <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {totalCards.map(({ label, value, icon: Icon, color }) => (
          <div key={label} className={`rounded-2xl bg-gradient-to-br ${color} p-4 text-white shadow-lg`}>
            <div className="flex items-center justify-between">
              <span className="text-sm opacity-90">{label}</span>
              <Icon size={18} />
            </div>
            <div className="mt-3 text-xl font-black">{value}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-black text-slate-800"><Upload size={18} className="text-blue-600" />رفع مستندات الطلب</h2>

          <div className="space-y-4">
            <label className="block text-sm font-medium text-slate-700">
              الطلب
              <select className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 outline-none" value={selectedRequestId} onChange={(e) => setSelectedRequestId(e.target.value)}>
                <option value="">اختر طلباً</option>
                {requests.map((request) => (
                  <option key={request.id} value={request.id}>#{request.id} - {request.company_name}</option>
                ))}
              </select>
            </label>

            {requestDetail?.documents?.length ? (
              <div className="space-y-3">
                {requestDetail.documents.map((doc) => (
                  <div key={doc.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="text-sm font-bold text-slate-800">{doc.document_name}</div>
                        <div className="text-[11px] text-slate-500">{doc.status === 'valid' ? 'مقبول' : doc.status === 'expired' ? 'منتهي' : 'مطلوب'}</div>
                      </div>
                      <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700">
                        <Upload size={12} /> رفع
                        <input type="file" multiple className="hidden" onChange={(e) => uploadRequestDocumentFiles(doc.id, e.target.files)} />
                      </label>
                    </div>
                    {doc.file_name && (
                      <a href={doc.file_path ? (doc.file_path.startsWith('http') ? doc.file_path : `${window.location.origin}${doc.file_path}`) : '#'} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-[11px] text-emerald-700 hover:underline">
                        <Download size={11} /> {doc.file_name}
                      </a>
                    )}
                  </div>
                ))}
              </div>
            ) : selectedRequestId ? (
              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">لا توجد مستندات طلب مُعرّفة لهذا الطلب حتى الآن.</div>
            ) : null}

            {selectedRequestId && (
              <div className="space-y-3 border-t border-slate-200 pt-4">
                <button type="button" onClick={createRequestPackage} className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-3 py-2.5 text-sm font-bold text-white hover:bg-emerald-700">
                  <Archive size={16} /> تجميع الملف المضغوط
                </button>

                <div className="space-y-2">
                  <label className="block text-sm font-medium text-slate-700">
                    الجهة التمويلية
                    <select className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 outline-none" value={selectedFundingEntityId} onChange={(e) => setSelectedFundingEntityId(e.target.value)}>
                      <option value="">اختر الجهة</option>
                      {fundingEntities.map((entity) => (
                        <option key={entity.id} value={entity.id}>{entity.name}</option>
                      ))}
                    </select>
                  </label>

                  <button type="button" onClick={sendPackageToFunding} className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-3 py-2.5 text-sm font-bold text-white hover:bg-blue-700">
                    <Building2 size={16} /> إرسال الملف المضغوط للجهة
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <form onSubmit={handleCreate} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-black text-slate-800"><Plus size={18} className="text-blue-600" />إنشاء مستند جديد</h2>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm font-medium text-slate-700">
                نوع المستند
                <select className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 outline-none" value={form.document_type} onChange={(e) => handleChange('document_type', e.target.value)}>
                  {DOC_TYPES.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </select>
              </label>
              <label className="text-sm font-medium text-slate-700">
                الشهر
                <input type="month" className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 outline-none" value={form.issue_month || month} onChange={(e) => handleChange('issue_month', e.target.value)} />
              </label>
            </div>

            <label className="block text-sm font-medium text-slate-700">
              طلب مرتبط (اختياري)
              <select className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 outline-none" value={selectedRequestId} onChange={(e) => setSelectedRequestId(e.target.value)}>
                <option value="">بدون طلب</option>
                {requests.map((request) => (
                  <option key={request.id} value={request.id}>#{request.id} - {request.company_name}</option>
                ))}
              </select>
            </label>

            <label className="block text-sm font-medium text-slate-700">
              رقم المستند
              <input className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 outline-none" value={form.document_number} onChange={(e) => handleChange('document_number', e.target.value)} placeholder="مثال: INV-2026-001" />
            </label>

            <label className="block text-sm font-medium text-slate-700">
              اسم العميل
              <input className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 outline-none" value={form.client_name} onChange={(e) => handleChange('client_name', e.target.value)} placeholder="اسم العميل الكامل" />
            </label>

            <label className="block text-sm font-medium text-slate-700">
              اسم الشركة
              <input className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 outline-none" value={form.company_name} onChange={(e) => handleChange('company_name', e.target.value)} placeholder="اسم الشركة إن وجد" />
            </label>

            <label className="block text-sm font-medium text-slate-700">
              البريد الإلكتروني
              <input type="email" className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 outline-none" value={form.email} onChange={(e) => handleChange('email', e.target.value)} placeholder="client@example.com" />
            </label>

            <label className="block text-sm font-medium text-slate-700">
              المبلغ الإجمالي (ر.س)
              <input type="number" min="0" step="0.01" className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 outline-none" value={form.total_amount} onChange={(e) => handleChange('total_amount', e.target.value)} placeholder="0" />
            </label>

            <label className="block text-sm font-medium text-slate-700">
              ملاحظات
              <textarea className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 outline-none" rows="3" value={form.notes} onChange={(e) => handleChange('notes', e.target.value)} placeholder="ملاحظات إضافية" />
            </label>
          </div>

          {error && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

          <button type="submit" className="mt-5 w-full rounded-xl bg-blue-600 px-4 py-3 font-bold text-white hover:bg-blue-700">
            حفظ المستند
          </button>
        </form>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-black text-slate-800">سجلات المستندات</h2>
            <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">{documents.length} سجل</span>
          </div>

          {loading ? (
            <div className="py-10 text-center text-slate-500">جارٍ تحميل البيانات...</div>
          ) : documents.length === 0 ? (
            <div className="py-10 text-center text-slate-500">لا توجد مستندات لهذا الشهر</div>
          ) : (
            <div className="space-y-3">
              {documents.map((doc) => (
                <div key={doc.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-700">{doc.document_type}</span>
                        <span className="text-xs text-slate-500">#{doc.document_number || doc.id}</span>
                      </div>
                      <h3 className="mt-2 text-sm font-black text-slate-800">{doc.client_name || 'عميل غير محدد'}</h3>
                      <p className="text-xs text-slate-500">{doc.company_name || '—'}</p>
                    </div>
                    <div className="text-left">
                      <div className="text-lg font-black text-slate-800">{money(doc.total_amount)}</div>
                      <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                        {doc.sent_via_email ? <CheckCircle size={12} /> : <Clock3 size={12} />}
                        {doc.sent_via_email ? 'تم الإرسال' : 'لم يرسل'}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <button onClick={() => openDocumentDetail(doc.id)} className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200">
                      <Eye size={12} /> تفاصيل
                    </button>
                    <button onClick={() => printDocument(doc.id)} className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700">
                      <Printer size={12} /> طباعة
                    </button>
                    {doc.file_path && (
                      <a href={doc.file_path} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200">
                        <Download size={12} /> ملف
                      </a>
                    )}
                    <button onClick={() => sendEmail(doc.id)} className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700">
                      <Send size={12} /> إرسال إيميل
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {selectedDoc && (
        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-black text-slate-800">تفاصيل المستند</h2>
            <div className="flex gap-2">
              <button onClick={() => printDocument(selectedDoc.document.id)} className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700">
                <Printer size={14} /> طباعة / معاينة
              </button>
              {selectedDoc.document.email && (
                <button onClick={() => sendEmail(selectedDoc.document.id)} className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700">
                  <Send size={14} /> إرسال بريد
                </button>
              )}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <DetailItem label="رقم المستند" value={selectedDoc.document.document_number} />
            <DetailItem label="النوع" value={selectedDoc.document.document_type} />
            <DetailItem label="المبلغ" value={money(selectedDoc.document.total_amount)} />
            <DetailItem label="العميل" value={selectedDoc.document.client_name || '—'} />
            <DetailItem label="الشركة" value={selectedDoc.document.company_name || '—'} />
            <DetailItem label="البريد" value={selectedDoc.document.email || '—'} />
            <DetailItem label="طلب مرتبط" value={selectedDoc.request ? `#${selectedDoc.request.id} - ${selectedDoc.request.company_name}` : 'لا يوجد'} />
            <DetailItem label="الحالة" value={selectedDoc.document.sent_via_email ? 'تم الإرسال' : 'لم يرسل'} />
            <DetailItem label="الشهر" value={selectedDoc.document.issue_month} />
          </div>

          {selectedDoc.request && (
            <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <h3 className="mb-3 text-sm font-black text-slate-800">بيانات الطلب المرتبط</h3>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <DetailItem label="مبلغ التمويل" value={money(selectedDoc.request.funding_amount || 0)} />
                <DetailItem label="المصاريف التشغيلية" value={money(selectedDoc.request.operating_expenses || 0)} />
                <DetailItem label="صافي الإيرادات" value={money(selectedDoc.request.net_revenue || 0)} />
                <DetailItem label="العمولة" value={money(selectedDoc.request.commission_amount || 0)} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DetailItem({ label, value }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="text-[11px] font-medium text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-bold text-slate-800">{value || '—'}</div>
    </div>
  );
}
