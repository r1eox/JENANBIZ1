import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Calculator, Plus, Trash2, Upload, DollarSign, TrendingUp, TrendingDown, FileText, ArrowLeft } from 'lucide-react';

const currency = (value) => Number(value || 0).toLocaleString('ar-SA', { maximumFractionDigits: 0 }) + ' ر.س';
const todayMonth = () => new Date().toISOString().slice(0, 7);

const categoryOptions = [
  'الإيرادات',
  'رواتب',
  'إيجار',
  'مصاريف تشغيل',
  'عمولات موظفين',
  'بنزين',
  'مشتريات',
  'أخرى'
];

export default function Accounting() {
  const { authFetch } = useAuth();
  const [month, setMonth] = useState(todayMonth());
  const [entries, setEntries] = useState([]);
  const [summary, setSummary] = useState({ total_revenue: 0, total_expenses: 0, net_revenue: 0, margin_percent: 0 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    entry_type: 'expense',
    category: 'مصاريف تشغيل',
    label: '',
    vendor_name: '',
    amount: '',
    notes: '',
    entry_month: todayMonth(),
  });

  const loadData = async (selectedMonth = month) => {
    setLoading(true);
    try {
      const [summaryRes, entriesRes] = await Promise.all([
        authFetch(`/api/admin/accounting/summary?month=${selectedMonth}`),
        authFetch(`/api/admin/accounting/entries?month=${selectedMonth}`),
      ]);

      if (!summaryRes.ok || !entriesRes.ok) {
        throw new Error('فشل في تحميل بيانات المحاسبة');
      }

      const summaryData = await summaryRes.json();
      const entriesData = await entriesRes.json();
      setSummary(summaryData.summary || { total_revenue: 0, total_expenses: 0, net_revenue: 0, margin_percent: 0 });
      setEntries(entriesData.entries || []);
    } catch (err) {
      setError(err.message || 'حدث خطأ');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData(month);
  }, [month]);

  const handleChange = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');

    try {
      const payload = {
        ...form,
        amount: Number(form.amount || 0),
        entry_month: form.entry_month || month,
      };

      const res = await authFetch('/api/admin/accounting/entries', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'لم يتم حفظ السجل');
      }

      setForm({
        entry_type: 'expense',
        category: 'مصاريف تشغيل',
        label: '',
        vendor_name: '',
        amount: '',
        notes: '',
        entry_month: month,
      });
      await loadData(month);
    } catch (err) {
      setError(err.message || 'حدث خطأ أثناء الحفظ');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('هل تريد حذف هذا السجل؟')) return;
    try {
      const res = await authFetch(`/api/admin/accounting/entries/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('فشل في الحذف');
      await loadData(month);
    } catch (err) {
      setError(err.message || 'حدث خطأ في الحذف');
    }
  };

  const handleUpload = async (id, file) => {
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await authFetch(`/api/admin/accounting/entries/${id}/documents`, {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) throw new Error('فشل في رفع الملف');
      await loadData(month);
    } catch (err) {
      setError(err.message || 'حدث خطأ في رفع الملف');
    }
  };

  const revenueCount = useMemo(() => entries.filter((e) => e.entry_type === 'revenue').length, [entries]);
  const expenseCount = useMemo(() => entries.filter((e) => e.entry_type === 'expense').length, [entries]);

  return (
    <div className="p-4 md:p-8" dir="rtl">
      <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-black text-slate-900">المحاسبة</h1>
          <p className="text-sm text-slate-500">إيرادات، مصروفات، فواتير، سندات قبض، وصافي الإيرادات الشهري</p>
        </div>
        <label className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm">
          الشهر
          <input
            type="month"
            className="mr-2 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 outline-none"
            value={month}
            onChange={(e) => setMonth(e.target.value || todayMonth())}
          />
        </label>
      </div>

      <div className="mb-6 grid gap-4 md:grid-cols-4">
        <div className="rounded-2xl bg-gradient-to-br from-emerald-500 to-green-600 p-4 text-white shadow-lg">
          <div className="flex items-center justify-between">
            <span className="text-sm opacity-90">إجمالي الإيرادات</span>
            <TrendingUp size={18} />
          </div>
          <div className="mt-3 text-2xl font-black">{currency(summary.total_revenue)}</div>
        </div>
        <div className="rounded-2xl bg-gradient-to-br from-rose-500 to-red-600 p-4 text-white shadow-lg">
          <div className="flex items-center justify-between">
            <span className="text-sm opacity-90">المصروفات</span>
            <TrendingDown size={18} />
          </div>
          <div className="mt-3 text-2xl font-black">{currency(summary.total_expenses)}</div>
        </div>
        <div className="rounded-2xl bg-gradient-to-br from-sky-500 to-blue-600 p-4 text-white shadow-lg">
          <div className="flex items-center justify-between">
            <span className="text-sm opacity-90">صافي الإيرادات</span>
            <DollarSign size={18} />
          </div>
          <div className="mt-3 text-2xl font-black">{currency(summary.net_revenue)}</div>
        </div>
        <div className="rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600 p-4 text-white shadow-lg">
          <div className="flex items-center justify-between">
            <span className="text-sm opacity-90">نسبة الهوامش</span>
            <Calculator size={18} />
          </div>
          <div className="mt-3 text-2xl font-black">{Number(summary.margin_percent || 0).toFixed(1)}%</div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
        <form onSubmit={handleSubmit} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-black text-slate-800"><Plus size={18} className="text-blue-600" />إضافة سجل جديد</h2>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm font-medium text-slate-700">
                النوع
                <select className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 outline-none" value={form.entry_type} onChange={(e) => handleChange('entry_type', e.target.value)}>
                  <option value="revenue">إيراد</option>
                  <option value="expense">مصروف</option>
                </select>
              </label>
              <label className="text-sm font-medium text-slate-700">
                الشهر
                <input type="month" className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 outline-none" value={form.entry_month || month} onChange={(e) => handleChange('entry_month', e.target.value)} />
              </label>
            </div>

            <label className="block text-sm font-medium text-slate-700">
              التصنيف
              <select className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 outline-none" value={form.category} onChange={(e) => handleChange('category', e.target.value)}>
                {categoryOptions.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </label>

            <label className="block text-sm font-medium text-slate-700">
              الاسم / الوصف
              <input className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 outline-none" placeholder="مثل: راتب الموظف / إيجار المكتب / فاتورة بنزين" value={form.label} onChange={(e) => handleChange('label', e.target.value)} />
            </label>

            <label className="block text-sm font-medium text-slate-700">
              الجهة / المورد
              <input className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 outline-none" placeholder="اسم الجهة أو المورد" value={form.vendor_name} onChange={(e) => handleChange('vendor_name', e.target.value)} />
            </label>

            <label className="block text-sm font-medium text-slate-700">
              المبلغ (ر.س)
              <input type="number" min="0" step="0.01" className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 outline-none" placeholder="0" value={form.amount} onChange={(e) => handleChange('amount', e.target.value)} />
            </label>

            <label className="block text-sm font-medium text-slate-700">
              ملاحظات
              <textarea className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 outline-none" rows="3" placeholder="ملاحظات إضافية" value={form.notes} onChange={(e) => handleChange('notes', e.target.value)} />
            </label>
          </div>

          {error && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

          <button type="submit" disabled={saving} className="mt-5 w-full rounded-xl bg-blue-600 px-4 py-3 font-bold text-white transition hover:bg-blue-700 disabled:opacity-60">
            {saving ? 'جارٍ الحفظ...' : 'حفظ السجل'}
          </button>
        </form>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-black text-slate-800">سجلات {month}</h2>
            <div className="flex gap-2 text-xs text-slate-500">
              <span className="rounded-full bg-emerald-50 px-2 py-1 text-emerald-700">إيراد: {revenueCount}</span>
              <span className="rounded-full bg-red-50 px-2 py-1 text-red-700">مصروف: {expenseCount}</span>
            </div>
          </div>

          {loading ? (
            <div className="py-10 text-center text-slate-500">جارٍ تحميل البيانات...</div>
          ) : entries.length === 0 ? (
            <div className="py-10 text-center text-slate-500">لا توجد بيانات لهذا الشهر</div>
          ) : (
            <div className="space-y-3">
              {entries.map((entry) => (
                <div key={entry.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${entry.entry_type === 'revenue' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                          {entry.entry_type === 'revenue' ? 'إيراد' : 'مصروف'}
                        </span>
                        <span className="text-xs text-slate-500">{entry.category}</span>
                      </div>
                      <h3 className="mt-2 text-sm font-black text-slate-800">{entry.label}</h3>
                      {entry.vendor_name && <p className="text-xs text-slate-500">{entry.vendor_name}</p>}
                    </div>
                    <div className="text-left">
                      <div className={`text-lg font-black ${entry.entry_type === 'revenue' ? 'text-emerald-700' : 'text-red-700'}`}>
                        {entry.entry_type === 'revenue' ? '+' : '-'}{currency(entry.amount)}
                      </div>
                      <button onClick={() => handleDelete(entry.id)} className="mt-2 inline-flex items-center gap-1 text-xs text-red-600 hover:underline">
                        <Trash2 size={13} /> حذف
                      </button>
                    </div>
                  </div>

                  {entry.notes && <p className="mt-2 text-xs text-slate-600">ملاحظة: {entry.notes}</p>}

                  <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-dashed border-slate-200 bg-white px-2 py-2">
                    <span className="text-xs text-slate-500">مرفقات</span>
                    <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200">
                      <Upload size={12} /> رفع ملف
                      <input type="file" className="hidden" onChange={(e) => handleUpload(entry.id, e.target.files?.[0])} />
                    </label>
                  </div>

                  {Array.isArray(entry.documents) && entry.documents.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {entry.documents.map((doc) => (
                        <a key={doc.id} href={doc.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100">
                          <FileText size={12} /> {doc.file_name}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
