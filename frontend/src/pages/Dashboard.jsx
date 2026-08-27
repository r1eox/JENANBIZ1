import React, { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  FileText, Users, Clock, CheckCircle, AlertTriangle, TrendingUp,
  UserCheck, Loader, ArrowUpRight, ArrowDownRight, Minus,
  DollarSign, Zap, Award, BarChart2, Target, ChevronRight
} from 'lucide-react';

const SAR = n => n > 0 ? `${n.toLocaleString('ar-SA', { maximumFractionDigits: 0 })} ر.س` : '—';
const MONTH_AR = m => new Date(m + '-01').toLocaleDateString('ar-SA', { month: 'short' });

const STATUS_LABEL = {
  draft:'مسودة', bank_uploaded:'كشف مرفوع', analyzing:'تحليل', analyzed:'تم التحليل',
  docs_pending:'وثائق ناقصة', docs_ready:'وثائق جاهزة', contract_submitted:'عقد مُرسل',
  forms_ready:'نماذج جاهزة', forms_sent:'نماذج مُرسلة', file_submitted:'ملف مُرفوع',
  missing:'نواقص', missing_submitted:'نواقص مُكملة', contract_received:'عقد مُستلم',
  submitted:'مُرسل للجهة', approved:'مُعتمد', transferred:'محوّل',
  fees_received:'رسوم مُستلمة', rejected:'مرفوض',
};
const STATUS_COLOR = {
  draft:'bg-gray-100 text-gray-500', bank_uploaded:'bg-blue-50 text-blue-600',
  analyzing:'bg-yellow-50 text-yellow-700', analyzed:'bg-yellow-50 text-yellow-700',
  docs_pending:'bg-orange-50 text-orange-600', docs_ready:'bg-orange-50 text-orange-500',
  contract_submitted:'bg-indigo-50 text-indigo-600', forms_ready:'bg-purple-50 text-purple-600',
  forms_sent:'bg-purple-50 text-purple-500', file_submitted:'bg-blue-50 text-blue-700',
  missing:'bg-red-50 text-red-600', missing_submitted:'bg-orange-50 text-orange-500',
  contract_received:'bg-teal-50 text-teal-600', submitted:'bg-sky-50 text-sky-700',
  approved:'bg-green-50 text-green-700', transferred:'bg-green-50 text-green-600',
  fees_received:'bg-emerald-50 text-emerald-700', rejected:'bg-red-50 text-red-600',
};
const PIPELINE_ORDER = [
  'draft','bank_uploaded','analyzing','analyzed','docs_pending','docs_ready',
  'contract_submitted','forms_ready','forms_sent','file_submitted','missing',
  'missing_submitted','contract_received','submitted','approved','transferred',
  'fees_received','rejected'
];

// ── Revenue Card ────────────────────────────────────────────────────────────
function RevCard({ label, value, sub, icon: Icon, accent, trend }) {
  const accents = {
    green:  'from-green-500 to-emerald-500',
    blue:   'from-blue-500 to-sky-500',
    purple: 'from-purple-500 to-indigo-500',
    amber:  'from-amber-500 to-orange-400',
    red:    'from-red-500 to-rose-500',
    teal:   'from-teal-500 to-cyan-500',
  };
  const TrendIcon = trend > 0 ? ArrowUpRight : trend < 0 ? ArrowDownRight : Minus;
  const trendColor = trend > 0 ? 'text-green-100' : trend < 0 ? 'text-red-100' : 'text-white/90';
  return (
    <div className={`relative overflow-hidden rounded-2xl bg-gradient-to-br ${accents[accent]} p-5 text-white shadow-lg`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-white/95 text-sm font-semibold mb-1">{label}</p>
          <p className="text-2xl font-black">{value}</p>
          {sub && <p className="text-white/90 text-sm mt-1">{sub}</p>}
        </div>
        <div className="bg-white/20 rounded-xl p-2.5">
          <Icon size={20} />
        </div>
      </div>
      {trend !== null && trend !== undefined && (
        <div className={`flex items-center gap-1 mt-3 text-xs font-medium ${trendColor}`}>
          <TrendIcon size={13} />
          <span>{trend > 0 ? '+' : ''}{trend}% مقارنةً بالشهر الماضي</span>
        </div>
      )}
      <div className="absolute -bottom-4 -left-4 w-24 h-24 rounded-full bg-white/8" />
    </div>
  );
}

// ── Alert Card ──────────────────────────────────────────────────────────────
function AlertCard({ count, label, sub, color, to, navigate }) {
  const colors = {
    red:    'border-red-200 bg-red-50 hover:bg-red-100',
    orange: 'border-orange-200 bg-orange-50 hover:bg-orange-100',
    blue:   'border-blue-200 bg-blue-50 hover:bg-blue-100',
  };
  const dotColors = { red: 'bg-red-500', orange: 'bg-orange-500', blue: 'bg-blue-500' };

  if (count === 0) return null;
  return (
    <button onClick={() => navigate(to)}
      className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all w-full text-right ${colors[color]}`}>
      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${dotColors[color]} animate-pulse`} />
      <div className="flex-1">
        <span className="font-bold text-gray-800 text-sm">{count}</span>
        <span className="text-gray-600 text-sm mr-1">{label}</span>
        {sub && <span className="text-gray-400 text-xs block">{sub}</span>}
      </div>
      <ChevronRight size={14} className="text-gray-400" />
    </button>
  );
}

// ── Progress Bar ─────────────────────────────────────────────────────────────
function Progress({ value, max, label, color = 'bg-blue-500' }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div>
      <div className="flex justify-between text-xs text-gray-500 mb-1">
        <span>{label}</span>
        <span className="font-semibold">{value} / {max} <span className="text-gray-400">({pct}%)</span></span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color} ${pct >= 100 ? 'bg-emerald-500' : ''}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function GoalProgress({ value, max, label, formatValue = v => v, color = 'bg-blue-500' }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div>
      <div className="flex justify-between text-xs text-gray-500 mb-1">
        <span>{label}</span>
        <span className="font-semibold">{formatValue(value)} / {formatValue(max)} <span className="text-gray-400">({pct}%)</span></span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color} ${pct >= 100 ? 'bg-emerald-500' : ''}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// ADMIN DASHBOARD
// ════════════════════════════════════════════════════════════════════════════
function AdminDashboard({ data, navigate }) {
  if (!data) return null;
  const { revenue, stages, actions, top_performers, monthly_trend, targets, recent_requests } = data;
  const stageMap = Object.fromEntries((stages || []).map(s => [s.status, s.count]));
  const maxStage = Math.max(...(stages || []).map(s => s.count), 1);
  const maxRev   = Math.max(...(monthly_trend || []).map(t => t.revenue), 1);
  const maxNew   = Math.max(...(monthly_trend || []).map(t => t.new_requests), 1);
  const now = new Date();
  const thisMonthLabel = now.toLocaleDateString('ar-SA', { month: 'long', year: 'numeric' });
  const hasTargets = targets?.target?.tr > 0 || targets?.target?.ta > 0 || targets?.target?.rv > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-black text-gray-900">لوحة التحكم</h1>
        <p className="text-sm text-gray-500 mt-0.5">{thisMonthLabel}</p>
      </div>

      {/* ─── Revenue KPIs ─── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <RevCard label="إيرادات الشهر"  value={SAR(revenue.this_month)}  sub={`${revenue.this_month_count} عملية مغلقة`} icon={DollarSign} accent="green"  trend={revenue.trend_pct} />
        <RevCard label="الشهر الماضي"   value={SAR(revenue.last_month)}  sub="مغلق"                                       icon={TrendingUp}  accent="blue"   trend={null} />
        <RevCard label="إيرادات السنة"  value={SAR(revenue.ytd)}         sub={`${revenue.ytd_count} صفقة`}                icon={Award}      accent="purple" trend={null} />
        <RevCard label="خط الإنتاج"     value={SAR(revenue.pipeline)}    sub="عمولات متوقعة"                              icon={Zap}         accent="amber"  trend={null} />
      </div>

      {/* ─── Urgent Alerts ─── */}
      {(actions.pending_users > 0 || actions.missing_docs > 0 || actions.overdue > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <AlertCard count={actions.pending_users} label="مستخدم ينتظر الموافقة"  color="blue"   to="/users"    navigate={navigate} />
          <AlertCard count={actions.missing_docs}  label="نواقص معلقة في الطلبات" color="orange" to="/requests" navigate={navigate} />
          <AlertCard count={actions.overdue}       label="طلب متأخر عن المتابعة"  color="red"    to="/requests" navigate={navigate} />
        </div>
      )}

      {/* ─── Monthly Target Progress ─── */}
      {hasTargets && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-gray-800 flex items-center gap-2"><Target size={16} className="text-blue-500" />الهدف الشهري للفريق</h3>
            <Link to="/performance" className="text-xs text-blue-500 hover:underline">التفاصيل ←</Link>
          </div>
          <div className="space-y-3">
            {targets.target.tr > 0 && <Progress value={targets.actual.tr} max={targets.target.tr} label="طلبات جديدة" color="bg-blue-500" />}
            {targets.target.ta > 0 && <Progress value={targets.actual.ta} max={targets.target.ta} label="طلبات معتمدة" color="bg-green-500" />}
            {targets.target.rv > 0 && (
              <div>
                <div className="flex justify-between text-xs text-gray-500 mb-1">
                  <span>الإيرادات المستهدفة</span>
                  <span className="font-semibold">{SAR(targets.actual.rv)} / {SAR(targets.target.rv)}</span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${Math.min(100, targets.target.rv > 0 ? Math.round((targets.actual.rv/targets.target.rv)*100) : 0)}%` }} />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── Middle Row: Pipeline + Top Performers ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Pipeline Stages */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2"><BarChart2 size={16} className="text-indigo-500" />توزيع مراحل الطلبات</h3>
          <div className="space-y-2">
            {PIPELINE_ORDER.filter(s => stageMap[s] > 0).map(s => {
              const count = stageMap[s];
              const pct = Math.round((count / maxStage) * 100);
              return (
                <div key={s} className="flex items-center gap-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap w-28 text-center shrink-0 ${STATUS_COLOR[s] || 'bg-gray-100 text-gray-500'}`}>
                    {STATUS_LABEL[s] || s}
                  </span>
                  <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${STATUS_COLOR[s]?.includes('green') ? 'bg-green-400' : STATUS_COLOR[s]?.includes('red') ? 'bg-red-400' : STATUS_COLOR[s]?.includes('orange') ? 'bg-orange-400' : STATUS_COLOR[s]?.includes('blue') ? 'bg-blue-400' : STATUS_COLOR[s]?.includes('purple') ? 'bg-purple-400' : 'bg-gray-300'}`}
                      style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs font-bold text-gray-700 w-6 text-center shrink-0">{count}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Top Performers */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2"><Award size={16} className="text-amber-500" />أفضل الموظفين (الشهر)</h3>
          {top_performers.length === 0 ? (
            <p className="text-center text-gray-400 text-sm py-6">لا توجد بيانات</p>
          ) : (
            <div className="space-y-3">
              {top_performers.map((p, i) => (
                <div key={p.id} className="flex items-center gap-3">
                  <span className={`w-7 h-7 rounded-xl flex items-center justify-center text-xs font-black shrink-0 ${i === 0 ? 'bg-amber-100 text-amber-700' : i === 1 ? 'bg-gray-100 text-gray-600' : i === 2 ? 'bg-orange-100 text-orange-600' : 'bg-gray-50 text-gray-400'}`}>
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm text-gray-800 truncate">{p.name}</p>
                    <p className="text-xs text-gray-400">{p.approved} معتمد · {p.total} إجمالي</p>
                  </div>
                  {p.revenue > 0 && <span className="text-xs text-emerald-600 font-bold shrink-0">{SAR(p.revenue)}</span>}
                </div>
              ))}
            </div>
          )}
          <Link to="/performance" className="text-xs text-blue-500 hover:underline block text-center mt-4">عرض التقرير الكامل ←</Link>
        </div>
      </div>

      {/* ─── Monthly Trend Chart ─── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-bold text-gray-800 flex items-center gap-2"><TrendingUp size={16} className="text-green-500" />اتجاه الإيرادات (آخر 6 أشهر)</h3>
          <Link to="/reports" className="text-xs text-blue-500 hover:underline">تقارير مفصلة ←</Link>
        </div>
        <div className="flex items-end gap-3 h-40 px-2">
          {monthly_trend.map((m, i) => {
            const revH = maxRev > 0 ? Math.max(4, Math.round((m.revenue / maxRev) * 100)) : 4;
            const newH = maxNew > 0 ? Math.max(4, Math.round((m.new_requests / maxNew) * 100)) : 4;
            const isLast = i === monthly_trend.length - 1;
            return (
              <div key={m.month} className="flex-1 flex flex-col items-center gap-1">
                <div className="w-full flex items-end justify-center gap-1" style={{ height: '100px' }}>
                  <div title={`إيرادات: ${SAR(m.revenue)}`}
                    className={`w-5 rounded-t-lg transition-all cursor-pointer ${isLast ? 'bg-green-500' : 'bg-green-200 hover:bg-green-400'}`}
                    style={{ height: `${revH}%` }} />
                  <div title={`طلبات جديدة: ${m.new_requests}`}
                    className={`w-5 rounded-t-lg transition-all cursor-pointer ${isLast ? 'bg-blue-400' : 'bg-blue-100 hover:bg-blue-300'}`}
                    style={{ height: `${newH}%` }} />
                </div>
                <span className={`text-xs ${isLast ? 'font-bold text-gray-700' : 'text-gray-400'}`}>{MONTH_AR(m.month)}</span>
                {m.revenue > 0 && <span className="text-xs text-emerald-600 font-semibold">{SAR(m.revenue)}</span>}
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-4 mt-3 text-xs text-gray-500">
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-400 inline-block" />إيرادات</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-blue-300 inline-block" />طلبات جديدة</span>
        </div>
      </div>

      {/* ─── Recent Requests ─── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-bold text-gray-800">آخر الطلبات</h3>
          <Link to="/requests" className="text-xs text-blue-500 hover:underline">عرض الكل ←</Link>
        </div>
        <table className="w-full text-sm">
          <tbody className="divide-y divide-gray-50">
            {recent_requests.map(r => (
              <tr key={r.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-5 py-3 font-semibold text-gray-800">{r.company_name}</td>
                <td className="px-4 py-3 text-gray-500 text-xs">{r.user_name || '—'}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_COLOR[r.status] || 'bg-gray-100 text-gray-500'}`}>
                    {STATUS_LABEL[r.status] || r.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-gray-400">
                  {new Date(r.updated_at).toLocaleDateString('ar-SA', { month: 'short', day: 'numeric' })}
                </td>
                {r.commission_amount > 0 && (
                  <td className="px-4 py-3 text-xs text-emerald-600 font-semibold">{SAR(r.commission_amount)}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// EMPLOYEE DASHBOARD
// ════════════════════════════════════════════════════════════════════════════
function EmployeeDashboard({ user, requests, authFetch }) {
  const [myTarget, setMyTarget] = useState(null);
  const month = new Date().toISOString().slice(0, 7);

  useEffect(() => {
    if (!user?.id) return;
    authFetch(`/api/admin/targets?month=${month}`)
      .then(r => r.ok ? r.json() : [])
      .then(data => {
        const t = Array.isArray(data) ? data.find(d => d.id === user.id) : null;
        setMyTarget(t || null);
      })
      .catch(() => {});
  }, [authFetch, user, month]);

  const total    = requests.length;
  const approved = requests.filter(r => ['approved','transferred','fees_received'].includes(r.status)).length;
  const active   = requests.filter(r => !['approved','transferred','fees_received','rejected','draft'].includes(r.status)).length;
  const missing  = requests.filter(r => r.status === 'missing').length;
  const recent   = requests.slice(0, 6);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black text-gray-900">مرحباً، {user?.name?.split(' ')[0]}</h1>
        <p className="text-sm text-gray-500 mt-0.5">{new Date().toLocaleDateString('ar-SA', { weekday:'long', year:'numeric', month:'long', day:'numeric' })}</p>
      </div>

            {/* Stats - RevCard style */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <RevCard label="إجمالي طلباتي" value={String(total)}    sub="جميع الطلبات" icon={FileText}      accent="blue"   trend={null} />
        <RevCard label="قيد التنفيذ"    value={String(active)}   sub="طلبات نشطة"  icon={Clock}         accent="amber"  trend={null} />
        <RevCard label="معتمدة"         value={String(approved)} sub="تم اعتمادها"  icon={CheckCircle}   accent="green"  trend={null} />
        <RevCard label="نواقص معلقة"    value={String(missing)}  sub="تحتاج متابعة"  icon={AlertTriangle} accent="red"    trend={null} />
      </div>

      {/* My Target Progress */}
      {myTarget && (myTarget.target?.target_requests > 0 || myTarget.target?.target_approved > 0 || myTarget.target?.target_revenue > 0) && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
            <Target size={16} className="text-blue-500" />هدفي هذا الشهر
          </h3>
          <div className="space-y-3">
            {myTarget.target.target_requests > 0 && <Progress value={myTarget.actual?.requests || 0} max={myTarget.target.target_requests} label="طلبات جديدة" color="bg-blue-500" />}
            {myTarget.target.target_approved > 0  && <Progress value={myTarget.actual?.approved  || 0} max={myTarget.target.target_approved}  label="طلبات معتمدة" color="bg-green-500" />}
            {myTarget.target.target_revenue > 0 && (
              <GoalProgress
                value={myTarget.actual?.revenue || 0}
                max={myTarget.target.target_revenue}
                label="إيرادات مستهدفة"
                color="bg-emerald-500"
                formatValue={v => `${Number(v).toLocaleString('ar-SA', { maximumFractionDigits: 0 })} ر.س`}
              />
            )}
          </div>
        </div>
      )}

      {/* Missing Alerts */}
      {missing > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4 flex items-center gap-3">
          <AlertTriangle size={20} className="text-red-500 shrink-0" />
          <div>
            <p className="font-semibold text-red-700">لديك {missing} طلب بنواقص معلقة</p>
            <p className="text-xs text-red-500">يرجى إكمال المستندات المطلوبة في أقرب وقت</p>
          </div>
        </div>
      )}

      {/* Recent Requests */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="font-bold text-gray-800">آخر طلباتي</h3>
        </div>
        {recent.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <FileText size={36} className="mx-auto mb-2 opacity-30" />
            <p className="text-sm">لا توجد طلبات بعد</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <tbody className="divide-y divide-gray-50">
              {recent.map(r => (
                <tr key={r.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-5 py-3 font-semibold text-gray-800">{r.company_name}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{r.funding_type}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_COLOR[r.status] || 'bg-gray-100 text-gray-500'}`}>
                      {STATUS_LABEL[r.status] || r.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400">
                    {new Date(r.updated_at || r.created_at).toLocaleDateString('ar-SA', { month: 'short', day: 'numeric' })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// PARTNER DASHBOARD
// ════════════════════════════════════════════════════════════════════════════
function PartnerDashboard({ user, requests }) {
  const total    = requests.length;
  const approved = requests.filter(r => ['approved','transferred','fees_received'].includes(r.status)).length;
  const active   = requests.filter(r => !['approved','transferred','fees_received','rejected','draft'].includes(r.status)).length;
  const missing  = requests.filter(r => r.status === 'missing').length;
  const commissionEarned = requests
    .filter(r => r.status === 'fees_received' && r.commission_amount > 0)
    .reduce((s, r) => s + (r.commission_amount || 0), 0);
  const commissionPipeline = requests
    .filter(r => ['approved','transferred'].includes(r.status) && r.commission_amount > 0)
    .reduce((s, r) => s + (r.commission_amount || 0), 0);

  const recent = requests.slice(0, 6);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black text-gray-900">مرحباً، {user?.name?.split(' ')[0]}</h1>
        <p className="text-sm text-gray-500 mt-0.5">{new Date().toLocaleDateString('ar-SA', { weekday:'long', year:'numeric', month:'long', day:'numeric' })}</p>
      </div>

      {/* Stats - RevCard style */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <RevCard label="إجمالي طلباتي" value={String(total)}    sub="جميع الطلبات" icon={FileText}      accent="blue"   trend={null} />
        <RevCard label="قيد التنفيذ"    value={String(active)}   sub="طلبات نشطة"  icon={Clock}         accent="amber"  trend={null} />
        <RevCard label="معتمدة"         value={String(approved)} sub="تم اعتمادها"  icon={CheckCircle}   accent="green"  trend={null} />
        <RevCard label="نواقص معلقة"    value={String(missing)}  sub="تحتاج متابعة"  icon={AlertTriangle} accent="red"    trend={null} />
      </div>

      {/* Commission Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-500 p-5 text-white shadow-lg">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-white/95 text-sm font-semibold mb-1">العمولات المحصّلة</p>
              <p className="text-2xl font-black">{commissionEarned > 0 ? SAR(commissionEarned) : '—'}</p>
              <p className="text-white/90 text-xs mt-1">طلبات مستلمة الرسوم</p>
            </div>
            <div className="bg-white/20 rounded-xl p-2.5"><Award size={20} /></div>
          </div>
          <div className="absolute -bottom-4 -left-4 w-24 h-24 rounded-full bg-white/8" />
        </div>
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-amber-500 to-orange-400 p-5 text-white shadow-lg">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-white/95 text-sm font-semibold mb-1">عمولات متوقعة</p>
              <p className="text-2xl font-black">{commissionPipeline > 0 ? SAR(commissionPipeline) : '—'}</p>
              <p className="text-white/90 text-xs mt-1">طلبات معتمدة ومحوّلة</p>
            </div>
            <div className="bg-white/20 rounded-xl p-2.5"><Zap size={20} /></div>
          </div>
          <div className="absolute -bottom-4 -left-4 w-24 h-24 rounded-full bg-white/8" />
        </div>
      </div>

      {/* Missing Alerts */}
      {missing > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4 flex items-center gap-3">
          <AlertTriangle size={20} className="text-red-500 shrink-0" />
          <div>
            <p className="font-semibold text-red-700">لديك {missing} طلب بنواقص معلقة</p>
            <p className="text-xs text-red-500">يرجى إكمال المستندات المطلوبة في أقرب وقت</p>
          </div>
        </div>
      )}

      {/* Recent Requests */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="font-bold text-gray-800">آخر طلباتي</h3>
        </div>
        {recent.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <FileText size={36} className="mx-auto mb-2 opacity-30" />
            <p className="text-sm">لا توجد طلبات بعد</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <tbody className="divide-y divide-gray-50">
              {recent.map(r => (
                <tr key={r.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-5 py-3 font-semibold text-gray-800">{r.company_name}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{r.funding_type}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_COLOR[r.status] || 'bg-gray-100 text-gray-500'}`}>
                      {STATUS_LABEL[r.status] || r.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400">
                    {new Date(r.updated_at || r.created_at).toLocaleDateString('ar-SA', { month: 'short', day: 'numeric' })}
                  </td>
                  {r.commission_amount > 0 && (
                    <td className="px-4 py-3 text-xs text-emerald-600 font-semibold">{SAR(r.commission_amount)}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN
// ════════════════════════════════════════════════════════════════════════════
export default function Dashboard() {
  const { authFetch, isAdmin, user } = useAuth();
  const navigate = useNavigate();
  const [dashData, setDashData]   = useState(null);
  const [myRequests, setMyRequests] = useState([]);
  const [loading, setLoading]     = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        if (isAdmin) {
          const d = await authFetch('/api/admin/dashboard-stats').then(r => r.json());
          setDashData(d);
        } else {
          const r = await authFetch('/api/requests').then(r => r.json());
          setMyRequests(Array.isArray(r) ? r : []);
        }
      } catch(e) {} finally { setLoading(false); }
    };
    load();
  }, [isAdmin]);

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader className="animate-spin text-blue-500" size={32} />
    </div>
  );

  if (isAdmin) return <AdminDashboard data={dashData} navigate={navigate} />;
  if (user?.role === 'partner') return <PartnerDashboard user={user} requests={myRequests} />;
  return <EmployeeDashboard user={user} requests={myRequests} authFetch={authFetch} />;
}
