import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  LayoutDashboard, FileText, Users, Building2, UserCheck,
  Settings, LogOut, Menu, X, ChevronLeft, Briefcase, Clock, CalendarDays, TrendingUp, BarChart2, Plus, ClipboardCheck, Award, Bell, Store, CheckCheck, Trash2, MessageCircleMore, RefreshCw, AlertTriangle, CheckCircle2, ArrowUpLeft, Calculator
} from 'lucide-react';

const navItems = [
  { path: '/dashboard',       label: 'لوحة التحكم',   icon: LayoutDashboard, roles: ['admin', 'employee', 'partner'] },
  { path: '/requests',        label: 'الطلبات',       icon: FileText,        roles: ['admin', 'employee', 'partner'] },
  { path: '/commissions',     label: 'عمولاتي',        icon: Award,           roles: ['partner'] },
  { path: '/accounting',      label: 'المحاسبة',      icon: Calculator,      roles: ['admin', 'employee', 'partner'] },
  { path: '/attendance',      label: 'الحضور',         icon: Clock,           roles: ['employee'] },
  { path: '/attendance-admin',label: 'سجل الحضور',   icon: CalendarDays,    roles: ['admin'], anyPermissions: ['view_attendance_admin', 'delete_attendance_records'] },
  { path: '/performance',     label: 'تحليل الأداء',  icon: TrendingUp,      roles: ['admin'], permission: 'view_performance' },
  { path: '/reports',         label: 'التقارير',        icon: BarChart2,       roles: ['admin'], permission: 'view_reports' },
  { path: '/eligibility',     label: 'أهلية التمويل',  icon: ClipboardCheck,  roles: ['admin', 'employee', 'partner'] },
  { path: '/establishments',  label: 'المنشآت',        icon: Store,           roles: ['admin'], permission: 'manage_establishments' },
  { path: '/brokers',         label: 'الوسطاء',        icon: UserCheck,       roles: ['admin', 'employee'] },
  { path: '/companies',       label: 'جهات التمويل', icon: Building2,       roles: ['admin'], permission: 'manage_funding' },
  { path: '/users',           label: 'المستخدمون',   icon: Users,           roles: ['admin'], anyPermissions: ['manage_users', 'approve_users', 'manage_user_permissions'] },
  { path: '/settings',        label: 'الإعدادات',      icon: Settings,        roles: ['admin'], permission: 'manage_settings' },
];

export default function Layout({ children }) {
  const { user, logout, authFetch, hasPermission, hasAnyPermission } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const canCreateRequest = ['admin', 'employee', 'partner'].includes(user?.role) || hasPermission('create_requests');
  const canApproveUsers = hasPermission('approve_users');
  const [missingCount, setMissingCount] = useState(0);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [pendingUsers, setPendingUsers] = useState(0);
  const [newUserToast, setNewUserToast] = useState(false);
  const prevPendingRef = React.useRef(null);
  const [notifications, setNotifications] = React.useState([]);
  const [unreadNotif, setUnreadNotif] = React.useState(0);
  const [showNotifPanel, setShowNotifPanel] = React.useState(false);
  const [newNotifToast, setNewNotifToast] = React.useState(null);
  const [expandedNotifId, setExpandedNotifId] = React.useState(null);
  const notifRef = React.useRef(null);
  const prevUnreadRef = React.useRef(null);

  const handleLogout = () => { logout(); navigate('/login'); };
  const handleNewRequest = () => { navigate('/requests?new=1'); };

  useEffect(() => {
    const isStaff = ['employee', 'partner'].includes(user?.role);
    if (!isStaff) {
      setMissingCount(0);
      return;
    }

    let mounted = true;
    const loadMissingCount = async () => {
      try {
        const res = await authFetch('/api/requests');
        const data = res.ok ? await res.json() : [];
        if (!mounted) return;
        const count = Array.isArray(data) ? data.filter(r => r.status === 'missing').length : 0;
        setMissingCount(count);
      } catch (_) {
        if (mounted) setMissingCount(0);
      }
    };

    loadMissingCount();
    const timer = setInterval(loadMissingCount, 30000);
    return () => { mounted = false; clearInterval(timer); };
  }, [user?.role, location.pathname]);

  // Badge: رسائل غير مقروءة (للجميع)
  useEffect(() => {
    let mounted = true;
    const loadUnread = async () => {
      try {
        const res = await authFetch('/api/requests/messages/unread-count');
        if (res.ok && mounted) {
          const data = await res.json();
          setUnreadMessages(data.count || 0);
        }
      } catch (_) {}
    };
    loadUnread();
    const t = setInterval(loadUnread, 20000);
    return () => { mounted = false; clearInterval(t); };
  }, [location.pathname]);

  // Badge: مستخدمون بانتظار الموافقة (للأدمن فقط)
  useEffect(() => {
    if (!canApproveUsers) return;
    let mounted = true;
    const loadPending = async () => {
      try {
        const res = await authFetch('/api/admin/users/pending-count');
        if (res.ok && mounted) {
          const data = await res.json();
          const newCount = data.count || 0;
          setPendingUsers(prev => {
            // إذا زاد العدد أظهر إشعاراً
            if (prevPendingRef.current !== null && newCount > prevPendingRef.current) {
              setNewUserToast(true);
              setTimeout(() => setNewUserToast(false), 6000);
            }
            prevPendingRef.current = newCount;
            return newCount;
          });
        }
      } catch (_) {}
    };
    loadPending();
    const t = setInterval(loadPending, 15000);
    return () => { mounted = false; clearInterval(t); };
  }, [canApproveUsers, location.pathname]);

  // Notifications polling
  React.useEffect(() => {
    let mounted = true;
    const loadNotifs = async () => {
      try {
        const res = await authFetch('/api/notifications');
        if (res.ok && mounted) {
          const data = await res.json();
          const arr = Array.isArray(data) ? data : [];
          const unread = arr.filter(n => !n.is_read).length;
          // إظهار toast عند وصول تنبيه جديد
          if (prevUnreadRef.current !== null && unread > prevUnreadRef.current) {
            const newest = arr.find(n => !n.is_read);
            if (newest) {
              setNewNotifToast(newest);
              setTimeout(() => setNewNotifToast(null), 6000);
            }
          }
          prevUnreadRef.current = unread;
          setNotifications(arr);
          setUnreadNotif(unread);
        }
      } catch (_) {}
    };
    loadNotifs();
    const t = setInterval(loadNotifs, 15000);
    return () => { mounted = false; clearInterval(t); };
  }, [location.pathname]);

  // Close notif panel on outside click
  React.useEffect(() => {
    const handler = (e) => { if (notifRef.current && !notifRef.current.contains(e.target)) setShowNotifPanel(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const markAllRead = async () => {
    try {
      await authFetch('/api/notifications/read-all', { method: 'PATCH' });
      setNotifications(n => n.map(x => ({ ...x, is_read: true })));
      setUnreadNotif(0);
    } catch (_) {}
  };

  const markRead = async (id) => {
    try {
      await authFetch(`/api/notifications/${id}/read`, { method: 'PATCH' });
      setNotifications(n => n.map(x => x.id === id ? { ...x, is_read: true } : x));
      setUnreadNotif(prev => Math.max(0, prev - 1));
    } catch (_) {}
  };

  const deleteNotif = async (id) => {
    try {
      await authFetch(`/api/notifications/${id}`, { method: 'DELETE' });
      setNotifications(n => n.filter(x => x.id !== id));
      setUnreadNotif(prev => {
        const was = notifications.find(x => x.id === id);
        return was && !was.is_read ? Math.max(0, prev - 1) : prev;
      });
    } catch (_) {}
  };

  const toggleNotifPanel = () => {
    setShowNotifPanel(prev => !prev);
  };

  const openNotification = async (notif) => {
    if (!notif.is_read) await markRead(notif.id);
    if (notif.link) {
      navigate(notif.link);
      setShowNotifPanel(false);
      return;
    }
    setExpandedNotifId(prev => prev === notif.id ? null : notif.id);
  };

  const notifTypeMeta = (type) => {
    switch(type) {
      case 'message':
        return { Icon: MessageCircleMore, iconClass: 'text-sky-600', bgClass: 'bg-sky-100' };
      case 'update':
        return { Icon: RefreshCw, iconClass: 'text-indigo-600', bgClass: 'bg-indigo-100' };
      case 'warning':
        return { Icon: AlertTriangle, iconClass: 'text-amber-600', bgClass: 'bg-amber-100' };
      case 'success':
        return { Icon: CheckCircle2, iconClass: 'text-emerald-600', bgClass: 'bg-emerald-100' };
      default:
        return { Icon: Bell, iconClass: 'text-slate-600', bgClass: 'bg-slate-100' };
    }
  };

  const allowed = navItems.filter((item) => {
    if (item.roles?.includes(user?.role)) return true;
    if (item.permission && hasPermission(item.permission)) return true;
    if (item.anyPermissions?.length && hasAnyPermission(item.anyPermissions)) return true;
    return false;
  });

  const NotificationDropdown = ({ buttonClassName, iconSize, badgeClassName, panelClassName, arrowClassName = '' }) => (
    <div ref={notifRef} className="relative">
      <button
        onClick={toggleNotifPanel}
        className={buttonClassName}
        title="التنبيهات"
      >
        <Bell size={iconSize} />
        {unreadNotif > 0 && (
          <span className={badgeClassName}>
            {unreadNotif > 9 ? '9+' : unreadNotif}
          </span>
        )}
      </button>

      {showNotifPanel && (
        <div
          className={panelClassName}
          dir="rtl"
        >
          <div className={`absolute -top-2 left-1/2 h-4 w-4 -translate-x-1/2 rotate-45 border-l border-t border-slate-200 bg-white shadow-sm ${arrowClassName}`} />
          <div className="relative overflow-hidden rounded-[28px] border border-slate-200 bg-white/95 shadow-[0_24px_70px_rgba(15,23,42,0.18)] backdrop-blur">
            <div className="border-b border-slate-100 px-4 pb-4 pt-4 text-center sm:px-5 sm:pt-5">
              <div className="flex items-center justify-between gap-2">
                <button onClick={() => setShowNotifPanel(false)} className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
                  <X size={15} />
                </button>
                <div className="flex items-center justify-center gap-2 min-w-0">
                  <span className="text-lg font-black tracking-tight text-slate-800 sm:text-xl">التنبيهات</span>
                  {unreadNotif > 0 && (
                    <span className="inline-flex min-w-7 items-center justify-center rounded-full bg-cyan-500 px-2 py-1 text-xs font-black text-white shadow-sm">
                      {unreadNotif > 99 ? '99+' : unreadNotif}
                    </span>
                  )}
                </div>
                {unreadNotif > 0 ? (
                  <button onClick={markAllRead} title="تحديد الكل كمقروء" className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-sky-600">
                    <CheckCheck size={15} />
                  </button>
                ) : <span className="h-8 w-8" />}
              </div>
              <p className="mt-2 text-[11px] font-medium text-slate-400 sm:text-xs">آخر التحديثات والرسائل الخاصة بك</p>
            </div>

            <div className="max-h-[26rem] overflow-y-auto bg-slate-50/60">
              {notifications.length === 0 ? (
                <div className="bg-white px-6 py-10 text-center text-slate-400 sm:py-12">
                  <Bell size={30} className="mx-auto mb-3 opacity-30" />
                  <p className="text-sm font-medium">لا توجد تنبيهات حالياً</p>
                </div>
              ) : (
                <div className="bg-white">
                  {notifications.map(n => {
                    const meta = notifTypeMeta(n.type);
                    const Icon = meta.Icon;
                    return (
                      <div
                        key={n.id}
                        className={`group flex items-start gap-3 border-b border-slate-100 px-4 py-3.5 last:border-b-0 transition-colors sm:py-4 ${n.is_read ? 'bg-white hover:bg-slate-50' : 'bg-sky-50/55 hover:bg-sky-50'}`}
                        onClick={() => openNotification(n)}
                        style={{ cursor: 'pointer' }}
                      >
                        <div className="pt-1">
                          <span className={`flex h-10 w-10 items-center justify-center rounded-full sm:h-11 sm:w-11 ${meta.bgClass}`}>
                            <Icon size={17} className={meta.iconClass} />
                          </span>
                        </div>
                        <div className="min-w-0 flex-1 overflow-hidden">
                          <div className="flex items-start gap-2">
                            {!n.is_read && <span className="mt-2 h-2.5 w-2.5 flex-shrink-0 rounded-full bg-rose-400" />}
                            <div className="min-w-0 flex-1">
                              <p className={`text-[13px] font-extrabold leading-6 break-words whitespace-normal sm:text-sm ${n.is_read ? 'text-slate-700' : 'text-slate-900'}`}>{n.title}</p>
                              {n.body && (
                                <p className={`mt-0.5 text-[12px] leading-5 text-slate-500 break-words whitespace-normal overflow-hidden sm:text-[13px] sm:leading-6 ${expandedNotifId === n.id ? '' : 'line-clamp-2'}`}>
                                  {n.body}
                                </p>
                              )}
                              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                                <span className="font-medium text-slate-400">{new Date(n.created_at).toLocaleString('ar-SA', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                                {n.link && <span className="inline-flex items-center gap-1 font-bold text-sky-600"><ArrowUpLeft size={12} /> فتح</span>}
                                {!n.link && n.body && <span className="font-bold text-sky-600">{expandedNotifId === n.id ? 'إخفاء' : 'تفاصيل أكثر'}</span>}
                              </div>
                            </div>
                          </div>
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); deleteNotif(n.id); }}
                          className="mt-1 inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-slate-300 transition hover:bg-rose-50 hover:text-rose-500 md:opacity-0 md:group-hover:opacity-100"
                          title="حذف التنبيه"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );

  const Sidebar = ({ mobile = false }) => (
    <div className={`flex flex-col h-full ${mobile ? '' : ''}`}>
      {/* الشعار */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-white/10">
        <img src="/logo-dark-bg.svg" alt="Jenan BIZ" className="h-14 w-auto flex-shrink-0 object-contain drop-shadow-[0_8px_20px_rgba(0,0,0,0.18)]" />
        <div className="mr-1">
          <div className="text-white/70 text-xs">مرحباً،</div>
          <div className="text-white font-semibold text-sm truncate max-w-[130px]">{user?.name}</div>
          <div className="text-sky-300 text-xs">{user?.role === 'admin' ? 'مدير' : user?.role === 'employee' ? 'موظف' : 'شريك'}</div>
        </div>
      </div>

      {/* القائمة */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {allowed.map(item => {
          const active = location.pathname === item.path;
          return (
            <Link
              key={item.path}
              to={item.path}
              onClick={() => setOpen(false)}
              className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
                active
                  ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                  : 'text-white/70 hover:bg-white/8 hover:text-white'
              }`}
            >
              <item.icon size={18} />
              <span>{item.label}</span>
              {item.path === '/requests' && missingCount > 0 && (
                <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-orange-500 text-white text-[10px] font-black flex items-center justify-center">
                  {missingCount}
                </span>
              )}
              {item.path === '/requests' && unreadMessages > 0 && (
                <span className="min-w-[18px] h-4.5 px-1 rounded-full bg-blue-500 text-white text-[10px] font-black flex items-center justify-center ml-1" title="رسائل غير مقروءة">
                  {unreadMessages}
                </span>
              )}
              {item.path === '/users' && pendingUsers > 0 && (
                <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-yellow-500 text-white text-[10px] font-black flex items-center justify-center animate-pulse" title="بانتظار الموافقة">
                  {pendingUsers}
                </span>
              )}
              {active && <ChevronLeft size={14} className="mr-auto opacity-60" />}
            </Link>
          );
        })}
      </nav>

    </div>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50" dir="rtl">
      {/* Sidebar Desktop */}
      <aside className="hidden lg:flex lg:w-64 flex-col flex-shrink-0"
        style={{ background: 'linear-gradient(180deg, #0d1b35 0%, #1e3a8a 100%)' }}>
        <Sidebar />
      </aside>

      {/* Mobile overlay */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <aside className="absolute right-0 top-0 h-full w-64 z-50"
            style={{ background: 'linear-gradient(180deg, #0d1b35 0%, #1e3a8a 100%)' }}>
            <Sidebar mobile />
            <button onClick={() => setOpen(false)} className="absolute top-4 left-4 text-white/60 hover:text-white">
              <X size={20} />
            </button>
          </aside>
        </div>
      )}

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header mobile */}
        <header className="lg:hidden flex items-center justify-between px-4 py-3 bg-white border-b border-gray-200">
          <button onClick={() => setOpen(true)} className="text-gray-600">
            <Menu size={22} />
          </button>
          <img src="/logo.svg" alt="Jenan BIZ" className="h-10 w-auto object-contain" />
          <div className="flex items-center gap-2" dir="ltr">
            {canCreateRequest && (
              <button
                onClick={handleNewRequest}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700"
              >
                <Plus size={13} />
                <span>طلب جديد</span>
              </button>
            )}
            <NotificationDropdown
              buttonClassName="relative inline-flex items-center justify-center w-8 h-8 rounded-lg bg-gray-100 text-gray-600 hover:bg-blue-100 hover:text-blue-600 transition-colors"
              iconSize={16}
              badgeClassName="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white text-[10px] font-black flex items-center justify-center"
              panelClassName="fixed inset-x-3 top-[4.9rem] z-50 sm:absolute sm:inset-x-auto sm:top-full sm:left-1/2 sm:mt-4 sm:w-[min(22rem,calc(100vw-1.5rem))] sm:max-w-[calc(100vw-1.5rem)] sm:-translate-x-1/2"
              arrowClassName="hidden sm:block"
            />
            <button
              onClick={handleLogout}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-red-50 text-red-700 border border-red-200 text-xs font-semibold hover:bg-red-100"
            >
              <LogOut size={13} />
              <span>خروج</span>
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          <div className="hidden lg:flex items-center mb-4">
            <div className="mr-auto flex items-center gap-2" dir="ltr">
              {canCreateRequest && (
                <button
                  onClick={handleNewRequest}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 shadow-sm"
                >
                  <Plus size={15} />
                  <span>رفع طلب جديد</span>
                </button>
              )}
              <NotificationDropdown
                buttonClassName="relative inline-flex items-center justify-center w-10 h-10 rounded-xl bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 hover:text-blue-600 transition-colors shadow-sm"
                iconSize={18}
                badgeClassName="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-black flex items-center justify-center shadow-sm"
                panelClassName="absolute top-full left-1/2 z-50 mt-4 w-[22rem] max-w-[calc(100vw-2rem)] -translate-x-1/2"
              />
              <button
                onClick={handleLogout}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm font-bold hover:bg-red-100"
              >
                <LogOut size={15} />
                <span>تسجيل الخروج</span>
              </button>
            </div>
          </div>
          {children}
        </main>
      </div>

      {/* Toast تنبيه جديد */}
      {newNotifToast && (
        <div
          className="fixed bottom-6 right-6 z-50 flex items-start gap-3 px-4 py-4 rounded-2xl shadow-2xl cursor-pointer animate-bounce-once"
          style={{ background: 'linear-gradient(135deg, #0d1b35, #1e3a8a)', minWidth: 280, maxWidth: 340 }}
          onClick={() => { setNewNotifToast(null); setShowNotifPanel(true); }}
          dir="rtl"
        >
          <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0 text-lg">
            {(() => {
              const { Icon } = notifTypeMeta(newNotifToast.type);
              return <Icon size={18} className="text-white" />;
            })()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-white font-bold text-sm">تنبيه جديد</div>
            <div className="text-blue-200 text-xs mt-0.5 truncate">{newNotifToast.title}</div>
            {newNotifToast.body && <div className="text-blue-300 text-[11px] mt-0.5 line-clamp-1">{newNotifToast.body}</div>}
          </div>
          <button onClick={(e) => { e.stopPropagation(); setNewNotifToast(null); }} className="text-white/60 hover:text-white flex-shrink-0">
            <X size={15} />
          </button>
        </div>
      )}

      {/* Toast إشعار مستخدم جديد */}
      {newUserToast && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-4 rounded-2xl shadow-2xl cursor-pointer"
          style={{ background: 'linear-gradient(90deg, #1e3a8a, #2563eb)', minWidth: 280 }}
          onClick={() => { setNewUserToast(false); navigate('/users'); }}
          dir="rtl"
        >
          <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
            <Users size={18} className="text-white" />
          </div>
          <div>
            <div className="text-white font-bold text-sm">طلب تسجيل جديد</div>
            <div className="text-blue-200 text-xs mt-0.5">يوجد مستخدم بانتظار موافقتك — اضغط للمراجعة</div>
          </div>
          <button onClick={(e) => { e.stopPropagation(); setNewUserToast(false); }} className="mr-auto text-white/60 hover:text-white">
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
