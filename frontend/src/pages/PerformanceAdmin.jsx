import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
  TrendingUp, Users, CheckCircle, Clock, AlertTriangle, XCircle,
  ChevronRight, Calendar, Briefcase, Award, BarChart2, ArrowUpRight,
  UserCheck, FileText, X, MapPin, LogIn, LogOut, Loader, Target, Save, Trash2
} from 'lucide-react';

const STATUS_LABELS = {
  draft: 'مسودة', bank_uploaded: 'كشف مرفوع', analyzing: 'قيد التحليل',
  analyzed: 'تم التحليل', docs_pending: 'وثائق ناقصة', docs_ready: 'وثائق جاهزة',
  contract_submitted: 'عقد مُرسل', forms_ready: 'نماذج جاهزة', forms_sent: 'نماذج مُرسلة',
  file_submitted: 'ملف مُرفوع', missing: 'نواقص', missing_submitted: 'نواقص مُكملة',
  contract_received: 'عقد مُستلم', submitted: 'مُرسل للجهة', approved: 'مُعتمد',
  transferred: 'محوّل', fees_received: 'رسوم مُستلمة', rejected: 'مرفوض',
};

const STATUS_COLOR = {
  draft: 'bg-gray-100 text-gray-600', bank_uploaded: 'bg-blue-50 text-blue-600',
  analyzing: 'bg-yellow-50 text-yellow-700', analyzed: 'bg-yellow-50 text-yellow-700',
  docs_pending: 'bg-orange-50 text-orange-600', docs_ready: 'bg-orange-50 text-orange-600',
  contract_submitted: 'bg-indigo-50 text-indigo-600', forms_ready: 'bg-purple-50 text-purple-600',
  forms_sent: 'bg-purple-50 text-purple-600', file_submitted: 'bg-blue-50 text-blue-700',
  missing: 'bg-red-50 text-red-600', missing_submitted: 'bg-orange-50 text-orange-500',
  contract_received: 'bg-teal-50 text-teal-600', submitted: 'bg-sky-50 text-sky-700',
  approved: 'bg-green-50 text-green-700', transferred: 'bg-green-50 text-green-700',
  fees_received: 'bg-emerald-50 text-emerald-700', rejected: 'bg-red-50 text-red-600',
};

function StatCard({ icon: Icon, label, value, sub, color = 'blue', trend }) {
  const colors = {
    blue:   'bg-blue-50 text-blue-600',
    green:  'bg-green-50 text-green-600',
    orange: 'bg-orange-50 text-orange-600',
    red:    'bg-red-50 text-red-600',
    purple: 'bg-purple-50 text-purple-600',
    gray:   'bg-gray-100 text-gray-600',
  };
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex items-start gap-4">
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${colors[color]}`}>
        <Icon size={20} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-gray-500 mb-0.5">{label}</p>
        <p className="text-2xl font-bold text-gray-800">{value}</p>
        {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      </div>
      {trend !== undefined && (
        <span className={`text-xs font-medium px-2 py-1 rounded-full ${trend >= 0 ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}>
          {trend >= 0 ? '+' : ''}{trend}%
        </span>
      )}
    </div>
  );
}

function MiniBar({ value, max, color = 'bg-blue-400' }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
      <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function formatDt(dt) {
  if (!dt) return '—';
  return new Date(dt).toLocaleDateString('ar-SA', { month: 'short', day: 'numeric' });
}
function formatTime(dt) {
  if (!dt) return '—';
  return new Date(dt).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' });
}
function duration(ci, co) {
  if (!ci || !co) return null;
  const m = Math.round((new Date(co) - new Date(ci)) / 60000);
  return `${Math.floor(m/60)}س ${m%60}د`;
}

// ===== Detail Drawer =====
function DetailDrawer({ userId, month, authFetch, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('requests'); // 'requests' | 'attendance' | 'chart'

  useEffect(() => {
    const p = month ? `?month=${month}` : '';
    authFetch(`/api/admin/performance/${userId}${p}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); });
  }, [userId, month, authFetch]);

  if (loading) return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="fixed inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-2xl bg-white h-full shadow-2xl flex items-center justify-center">
        <Loader className="animate-spin text-blue-500" size={32} />
      </div>
    </div>
  );

  if (!data) return null;
  const { user, requests, monthly, attendance } = data;

  // Aggregate by status
  const byStatus = requests.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="fixed inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-2xl bg-white h-full shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-l from-blue-600 to-blue-500 px-6 py-5 text-white shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold">{user.name}</h2>
              <p className="text-blue-100 text-sm">{user.role === 'employee' ? 'موظف' : 'شريك'} — {user.phone || 'لا يوجد هاتف'}</p>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-xl transition-colors">
              <X size={20} />
            </button>
          </div>
          {/* Quick stats */}
          <div className="grid grid-cols-4 gap-3 mt-4">
            {[
              { l: 'الإجمالي', v: requests.length },
              { l: 'مُعتمد', v: requests.filter(r => ['approved','transferred','fees_received'].includes(r.status)).length },
              { l: 'نواقص', v: requests.filter(r => r.status === 'missing').length },
              { l: 'مرفوض', v: requests.filter(r => r.status === 'rejected').length },
            ].map(s => (
              <div key={s.l} className="bg-white/10 rounded-xl p-2 text-center">
                <p className="text-lg font-bold">{s.v}</p>
                <p className="text-blue-200 text-xs">{s.l}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100 bg-gray-50 shrink-0">
          {[['requests','الطلبات'], ['attendance','الحضور'], ['chart','الشهري']].map(([k,l]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`flex-1 py-3 text-sm font-medium transition-colors ${tab===k ? 'text-blue-600 border-b-2 border-blue-500 bg-white' : 'text-gray-500 hover:text-gray-700'}`}>
              {l}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-3">

          {/* Requests tab */}
          {tab === 'requests' && (
            <>
              {/* Status breakdown */}
              <div className="bg-gray-50 rounded-2xl p-4 mb-4">
                <p className="text-xs font-semibold text-gray-500 mb-3 uppercase tracking-wide">توزيع الحالات</p>
                <div className="grid grid-cols-3 gap-2">
                  {Object.entries(byStatus).map(([s, c]) => (
                    <div key={s} className={`rounded-xl px-3 py-2 text-xs font-medium flex items-center justify-between ${STATUS_COLOR[s] || 'bg-gray-100 text-gray-600'}`}>
                      <span>{STATUS_LABELS[s] || s}</span>
                      <span className="font-bold">{c}</span>
                    </div>
                  ))}
                </div>
              </div>

              {requests.length === 0 ? (
                <div className="text-center py-10 text-gray-400">
                  <FileText size={36} className="mx-auto mb-2 opacity-30" />
                  <p>لا توجد طلبات</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {requests.map(r => (
                    <div key={r.id} className="bg-white border border-gray-100 rounded-xl px-4 py-3 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-800 truncate">{r.company_name}</p>
                        <p className="text-xs text-gray-400">{r.funding_type} · {r.funding_entity_name || 'لم تُحدد الجهة'}</p>
                      </div>
                      <div className="shrink-0 text-left">
                        <span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_COLOR[r.status] || 'bg-gray-100 text-gray-600'}`}>
                          {STATUS_LABELS[r.status] || r.status}
                        </span>
                        <p className="text-xs text-gray-400 mt-1 text-center">{formatDt(r.updated_at)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* Attendance tab */}
          {tab === 'attendance' && (
            attendance.length === 0 ? (
              <div className="text-center py-10 text-gray-400">
                <Calendar size={36} className="mx-auto mb-2 opacity-30" />
                <p>لا توجد سجلات حضور</p>
              </div>
            ) : (
              <div className="space-y-2">
                {attendance.map((a, i) => (
                  <div key={i} className="bg-white border border-gray-100 rounded-xl px-4 py-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-gray-700">{formatDt(a.date)}</span>
                      {a.check_in && a.check_out && (
                        <span className="text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded-full font-medium">
                          {duration(a.check_in, a.check_out)}
                        </span>
                      )}
                      {a.check_in && !a.check_out && (
                        <span className="text-xs bg-yellow-50 text-yellow-700 px-2 py-0.5 rounded-full">في العمل</span>
                      )}
                    </div>
                    <div className="flex gap-4 text-xs text-gray-500">
                      <span className="flex items-center gap-1 text-green-600">
                        <LogIn size={11} />{formatTime(a.check_in)}
                      </span>
                      <span className="flex items-center gap-1 text-orange-600">
                        <LogOut size={11} />{formatTime(a.check_out)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )
          )}

          {/* Monthly chart tab */}
          {tab === 'chart' && (
            monthly.length === 0 ? (
              <div className="text-center py-10 text-gray-400">
                <BarChart2 size={36} className="mx-auto mb-2 opacity-30" />
                <p>لا توجد بيانات</p>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-gray-500 font-semibold uppercase tracking-wide mb-4">آخر 6 أشهر</p>
                {[...monthly].reverse().map(m => {
                  const maxTotal = Math.max(...monthly.map(x => x.total), 1);
                  const pct = Math.round((m.total / maxTotal) * 100);
                  const appPct = m.total > 0 ? Math.round((m.approved / m.total) * 100) : 0;
                  return (
                    <div key={m.month} className="bg-white border border-gray-100 rounded-xl px-4 py-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-gray-700">{m.month}</span>
                        <div className="flex items-center gap-3 text-xs">
                          <span className="text-gray-600">{m.total} طلب</span>
                          <span className="text-green-600 font-medium">{m.approved} مُعتمد</span>
                          {m.rejected > 0 && <span className="text-red-500">{m.rejected} مرفوض</span>}
                        </div>
                      </div>
                      {/* Total bar */}
                      <div className="w-full h-2.5 bg-gray-100 rounded-full overflow-hidden mb-1">
                        <div className="h-full bg-blue-400 rounded-full transition-all" style={{ width: `${pct}%` }} />
                      </div>
                      {/* Approved bar */}
                      <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-green-400 rounded-full transition-all" style={{ width: `${appPct}%` }} />
                      </div>
                      <div className="flex gap-4 mt-1.5 text-xs text-gray-400">
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-400 inline-block" />إجمالي</span>
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-400 inline-block" />معدل الإنجاز {appPct}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}

// ===== MAIN PAGE =====
export default function PerformanceAdmin() {
  const { authFetch } = useAuth();
  const [data, setData]           = useState([]);
  const [targetsData, setTargets] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [targLoading, setTargLoad]= useState(false);
  const [month, setMonth]         = useState(new Date().toISOString().slice(0, 7));
  const [selectedId, setSelectedId] = useState(null);
  const [roleFilter, setRoleFilter] = useState('all');
  const [sortBy, setSortBy]       = useState('total');
  const [mainTab, setMainTab]     = useState('perf'); // 'perf' | 'targets'
  const [savingTargets, setSaving]= useState({});
  const [editTargets, setEditT]   = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await authFetch(`/api/admin/performance?month=${month}`).then(r => r.json());
      setData(Array.isArray(d) ? d : []);
    } finally {
      setLoading(false);
    }
  }, [authFetch, month]);

  useEffect(() => { load(); }, [load]);

  // == Targets ==
  const loadTargets = useCallback(async () => {
    setTargLoad(true);
    try {
      const d = await authFetch(`/api/admin/targets?month=${month}`).then(r => r.json());
      const initial = {};
      (Array.isArray(d) ? d : []).forEach(t => {
        initial[t.user_id] = {
          target_requests: t.target?.target_requests ?? 0,
          target_approved: t.target?.target_approved ?? 0,
          target_revenue:  t.target?.target_revenue  ?? 0,
        };
      });
      setTargets(Array.isArray(d) ? d : []);
      setEditT(initial);
    } finally { setTargLoad(false); }
  }, [authFetch, month]);

  useEffect(() => { if (mainTab === 'targets') loadTargets(); }, [mainTab, loadTargets]);

  const saveTarget = async (userId) => {
    setSaving(p => ({ ...p, [userId]: true }));
    try {
      await authFetch(`/api/admin/targets/${userId}/${month}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editTargets[userId] || {}),
      });
      await loadTargets();
    } finally { setSaving(p => ({ ...p, [userId]: false })); }
  };

  const deleteTarget = async (userId, name) => {
    if (!window.confirm(`حذف هدف ${name} لشهر ${month}؟`)) return;
    setSaving(p => ({ ...p, [userId]: true }));
    try {
      await authFetch(`/api/admin/targets/${userId}/${month}`, { method: 'DELETE' });
      await loadTargets();
    } finally { setSaving(p => ({ ...p, [userId]: false })); }
  };

  const filtered = data
    .filter(u => roleFilter === 'all' || u.role === roleFilter)
    .sort((a, b) => {
      if (sortBy === 'total') return b.stats.total - a.stats.total;
      if (sortBy === 'approved') return b.stats.approved - a.stats.approved;
      if (sortBy === 'missing') return b.stats.missing_pending - a.stats.missing_pending;
      if (sortBy === 'attendance') return b.stats.attendance_days - a.stats.attendance_days;
      if (sortBy === 'conversion') return b.stats.conversion_rate - a.stats.conversion_rate;
      return 0;
    });

  const maxTotal = Math.max(...filtered.map(u => u.stats.total), 1);

  // Aggregate totals
  const totals = filtered.reduce((acc, u) => ({
    total: acc.total + u.stats.total,
    approved: acc.approved + u.stats.approved,
    in_progress: acc.in_progress + u.stats.in_progress,
    missing: acc.missing + u.stats.missing_pending,
    rejected: acc.rejected + u.stats.rejected,
  }), { total: 0, approved: 0, in_progress: 0, missing: 0, rejected: 0 });

  const overallConversion = totals.total > 0 ? Math.round((totals.approved / totals.total) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">تحليل الأداء</h1>
          <p className="text-sm text-gray-400 mt-0.5">متابعة أداء الموظفين والشركاء</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex rounded-xl overflow-hidden border border-gray-200">
            <button onClick={() => setMainTab('perf')}
              className={`px-4 py-2 text-xs font-medium transition-colors flex items-center gap-1 ${mainTab==='perf' ? 'bg-blue-500 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
              <BarChart2 size={13} />الأداء
            </button>
            <button onClick={() => setMainTab('targets')}
              className={`px-4 py-2 text-xs font-medium transition-colors flex items-center gap-1 ${mainTab==='targets' ? 'bg-blue-500 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
              <Target size={13} />الأهداف
            </button>
          </div>
          <label className="text-xs text-gray-500">الشهر</label>
          <input type="month" value={month} onChange={e => setMonth(e.target.value)}
            className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
        </div>
      </div>

      {mainTab === 'perf' ? (<>
      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard icon={FileText}    label="إجمالي الطلبات"    value={totals.total}       color="blue"   />
        <StatCard icon={CheckCircle} label="معتمدة"            value={totals.approved}    color="green"  />
        <StatCard icon={Clock}       label="قيد التنفيذ"       value={totals.in_progress} color="purple" />
        <StatCard icon={AlertTriangle} label="نواقص معلقة"     value={totals.missing}     color="orange" />
        <StatCard icon={TrendingUp}  label="معدل الإنجاز الكلي" value={`${overallConversion}%`} color={overallConversion >= 50 ? 'green' : overallConversion >= 25 ? 'orange' : 'red'} />
      </div>

      {/* Filters & sort */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex flex-wrap gap-3 items-center">
        {/* Role tabs */}
        <div className="flex rounded-xl overflow-hidden border border-gray-200">
          {[['all','الكل'], ['employee','موظفون'], ['partner','شركاء']].map(([v,l]) => (
            <button key={v} onClick={() => setRoleFilter(v)}
              className={`px-4 py-2 text-sm font-medium transition-colors ${roleFilter===v ? 'bg-blue-500 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
              {l}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 mr-auto">
          <label className="text-xs text-gray-500">ترتيب حسب</label>
          <select value={sortBy} onChange={e => setSortBy(e.target.value)}
            className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200">
            <option value="total">إجمالي الطلبات</option>
            <option value="approved">المعتمدة</option>
            <option value="conversion">معدل الإنجاز</option>
            <option value="missing">النواقص</option>
            <option value="attendance">أيام الحضور</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <Loader className="animate-spin text-blue-500" size={28} />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <Users size={40} className="mx-auto mb-2 opacity-30" />
            <p>لا يوجد موظفون</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-400 text-xs uppercase">
                <tr>
                  <th className="px-5 py-3 text-right">الموظف</th>
                  <th className="px-4 py-3 text-center">الإجمالي</th>
                  <th className="px-4 py-3 text-center">مُعتمد</th>
                  <th className="px-4 py-3 text-center">قيد التنفيذ</th>
                  <th className="px-4 py-3 text-center">نواقص</th>
                  <th className="px-4 py-3 text-center">مرفوض</th>
                  <th className="px-4 py-3 text-center">معدل الإنجاز</th>
                  <th className="px-4 py-3 text-center">حضور الشهر</th>
                  <th className="px-4 py-3 text-center">وسطاء</th>
                  <th className="px-4 py-3 text-center">آخر نشاط</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map(u => {
                  const s = u.stats;
                  return (
                    <tr key={u.id} onClick={() => setSelectedId(u.id)}
                      className="hover:bg-blue-50/30 cursor-pointer transition-colors group">
                      {/* Name */}
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold shrink-0 ${u.role === 'employee' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
                            {u.name.charAt(0)}
                          </div>
                          <div>
                            <p className="font-semibold text-gray-800">{u.name}</p>
                            <p className="text-xs text-gray-400">{u.role === 'employee' ? 'موظف' : `شريك${u.partner_type ? ' · ' + u.partner_type : ''}`}</p>
                          </div>
                        </div>
                      </td>

                      {/* Total with bar */}
                      <td className="px-4 py-4 text-center">
                        <div className="flex flex-col items-center gap-1">
                          <span className="font-bold text-gray-800">{s.total}</span>
                          <MiniBar value={s.total} max={maxTotal} color="bg-blue-400" />
                        </div>
                      </td>

                      {/* Approved */}
                      <td className="px-4 py-4 text-center">
                        <span className={`inline-flex items-center gap-1 font-semibold ${s.approved > 0 ? 'text-green-600' : 'text-gray-300'}`}>
                          {s.approved > 0 && <CheckCircle size={13} />}{s.approved}
                        </span>
                      </td>

                      {/* In progress */}
                      <td className="px-4 py-4 text-center">
                        <span className={`font-medium ${s.in_progress > 0 ? 'text-blue-600' : 'text-gray-300'}`}>{s.in_progress}</span>
                      </td>

                      {/* Missing */}
                      <td className="px-4 py-4 text-center">
                        {s.missing_pending > 0 ? (
                          <span className="inline-flex items-center gap-1 bg-red-50 text-red-600 text-xs font-semibold px-2 py-1 rounded-full">
                            <AlertTriangle size={11} />{s.missing_pending}
                          </span>
                        ) : <span className="text-gray-300">0</span>}
                      </td>

                      {/* Rejected */}
                      <td className="px-4 py-4 text-center">
                        <span className={`font-medium ${s.rejected > 0 ? 'text-red-500' : 'text-gray-300'}`}>{s.rejected}</span>
                      </td>

                      {/* Conversion rate */}
                      <td className="px-4 py-4 text-center">
                        <div className="flex flex-col items-center gap-1">
                          <span className={`text-sm font-bold ${s.conversion_rate >= 50 ? 'text-green-600' : s.conversion_rate >= 25 ? 'text-yellow-600' : s.conversion_rate > 0 ? 'text-orange-500' : 'text-gray-300'}`}>
                            {s.conversion_rate}%
                          </span>
                          <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full transition-all ${s.conversion_rate >= 50 ? 'bg-green-400' : s.conversion_rate >= 25 ? 'bg-yellow-400' : 'bg-orange-400'}`}
                              style={{ width: `${s.conversion_rate}%` }} />
                          </div>
                        </div>
                      </td>

                      {/* Attendance */}
                      <td className="px-4 py-4 text-center">
                        <span className={`text-sm font-medium ${s.attendance_days > 0 ? 'text-indigo-600' : 'text-gray-300'}`}>
                          {s.attendance_days > 0 ? `${s.attendance_days} يوم` : '—'}
                        </span>
                      </td>

                      {/* Brokers */}
                      <td className="px-4 py-4 text-center">
                        <span className={`text-sm font-medium ${s.brokers_added > 0 ? 'text-teal-600' : 'text-gray-300'}`}>
                          {s.brokers_added > 0 ? s.brokers_added : '—'}
                        </span>
                      </td>

                      {/* Last active */}
                      <td className="px-4 py-4 text-center">
                        {u.last_request ? (
                          <div>
                            <p className="text-xs text-gray-600 truncate max-w-[100px]">{u.last_request.company}</p>
                            <p className="text-xs text-gray-400">{formatDt(u.last_request.date)}</p>
                          </div>
                        ) : <span className="text-gray-300 text-xs">—</span>}
                      </td>

                      {/* Arrow */}
                      <td className="px-4 py-4">
                        <ChevronRight size={16} className="text-gray-300 group-hover:text-blue-400 transition-colors" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Detail drawer */}
      {selectedId && (
        <DetailDrawer
          userId={selectedId}
          month={month}
          authFetch={authFetch}
          onClose={() => setSelectedId(null)}
        />
      )}
      </>) : (
        /* ===== لوحة الأهداف ===== */
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          {targLoading ? (
            <div className="flex items-center justify-center h-48">
              <Loader className="animate-spin text-blue-500" size={28} />
            </div>
          ) : targetsData.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <Target size={40} className="mx-auto mb-2 opacity-30" />
              <p>لا يوجد موظفون</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-400 text-xs uppercase">
                  <tr>
                    <th className="px-5 py-3 text-right">الموظف</th>
                    <th className="px-4 py-3 text-center">هدف الطلبات</th>
                    <th className="px-4 py-3 text-center">فعلي</th>
                    <th className="px-4 py-3 text-center">هدف المعتمدة</th>
                    <th className="px-4 py-3 text-center">فعلي</th>
                    <th className="px-4 py-3 text-center">هدف الإيرادات (ر.س)</th>
                    <th className="px-4 py-3 text-center">فعلي</th>
                    <th className="px-4 py-3 text-center">حفظ</th>
                    <th className="px-4 py-3 text-center">حذف</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {targetsData.map(row => {
                    const uid = row.user_id;
                    const ed  = editTargets[uid] || {};
                    const act = row.actual || {};
                    const isSaving = savingTargets[uid];
                    const reqTarget = Number(ed.target_requests || 0);
                    const approvedTarget = Number(ed.target_approved || 0);
                    const revenueTarget = Number(ed.target_revenue || 0);
                    const reqPct = reqTarget > 0 ? Math.min(100, Math.round(((act.total ?? 0) / reqTarget) * 100)) : 0;
                    const approvedPct = approvedTarget > 0 ? Math.min(100, Math.round(((act.approved ?? 0) / approvedTarget) * 100)) : 0;
                    const revenuePct = revenueTarget > 0 ? Math.min(100, Math.round(((act.revenue ?? 0) / revenueTarget) * 100)) : 0;
                    return (
                      <tr key={uid} className="hover:bg-blue-50/20">
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center text-sm font-bold shrink-0">
                              {row.name?.charAt(0)}
                            </div>
                            <div>
                              <p className="font-semibold text-gray-800">{row.name}</p>
                              <p className="text-xs text-gray-400">{row.role === 'employee' ? 'موظف' : 'شريك'}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-4 text-center">
                          <input type="number" min="0" value={ed.target_requests ?? 0}
                            onChange={e => setEditT(p => ({ ...p, [uid]: { ...p[uid], target_requests: +e.target.value } }))}
                            className="w-20 border border-gray-200 rounded-lg px-2 py-1.5 text-center text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
                        </td>
                        <td className="px-4 py-4 text-center">
                          <div className="flex flex-col items-center gap-1">
                            <span className={`font-bold ${(act.total??0) >= reqTarget && reqTarget > 0 ? 'text-green-600' : 'text-gray-700'}`}>
                              {act.total ?? 0}
                            </span>
                            {reqTarget > 0 && <span className="text-[10px] text-gray-500">{reqPct}%</span>}
                          </div>
                        </td>
                        <td className="px-4 py-4 text-center">
                          <input type="number" min="0" value={ed.target_approved ?? 0}
                            onChange={e => setEditT(p => ({ ...p, [uid]: { ...p[uid], target_approved: +e.target.value } }))}
                            className="w-20 border border-gray-200 rounded-lg px-2 py-1.5 text-center text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
                        </td>
                        <td className="px-4 py-4 text-center">
                          <div className="flex flex-col items-center gap-1">
                            <span className={`font-bold ${(act.approved??0) >= approvedTarget && approvedTarget > 0 ? 'text-green-600' : 'text-gray-700'}`}>
                              {act.approved ?? 0}
                            </span>
                            {approvedTarget > 0 && <span className="text-[10px] text-gray-500">{approvedPct}%</span>}
                          </div>
                        </td>
                        <td className="px-4 py-4 text-center">
                          <input type="number" min="0" value={ed.target_revenue ?? 0}
                            onChange={e => setEditT(p => ({ ...p, [uid]: { ...p[uid], target_revenue: +e.target.value } }))}
                            className="w-28 border border-gray-200 rounded-lg px-2 py-1.5 text-center text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
                        </td>
                        <td className="px-4 py-4 text-center">
                          <div className="flex flex-col items-center gap-1">
                            <span className={`font-bold ${(act.revenue??0) >= revenueTarget && revenueTarget > 0 ? 'text-green-600' : 'text-gray-700'}`}>
                              {(act.revenue ?? 0).toLocaleString('ar-SA')}
                            </span>
                            {revenueTarget > 0 && <span className="text-[10px] text-gray-500">{revenuePct}%</span>}
                          </div>
                        </td>
                        <td className="px-4 py-4 text-center">
                          <button onClick={() => saveTarget(uid)} disabled={isSaving}
                            className="inline-flex items-center gap-1 bg-blue-500 hover:bg-blue-600 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                            {isSaving ? <Loader size={12} className="animate-spin" /> : <Save size={12} />}حفظ
                          </button>
                        </td>
                        <td className="px-4 py-4 text-center">
                          <button onClick={() => deleteTarget(uid, row.name)} disabled={isSaving}
                            className="inline-flex items-center gap-1 bg-red-50 hover:bg-red-100 text-red-600 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                            <Trash2 size={12} />حذف
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
