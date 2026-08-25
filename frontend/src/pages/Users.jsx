import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { UserCheck, UserX, Trash2, Search, Edit2, X, Plus, Bell, Send, Shield } from 'lucide-react';

const roleLabel = { admin: 'مدير', employee: 'موظف', partner: 'شريك' };
const roleColor = { admin: 'bg-purple-100 text-purple-700', employee: 'bg-blue-100 text-blue-700', partner: 'bg-green-100 text-green-700' };
const statusColor = { approved: 'bg-green-100 text-green-700', pending: 'bg-yellow-100 text-yellow-700', blocked: 'bg-red-100 text-red-700' };
const statusLabel = { approved: 'نشط', pending: 'بانتظار الموافقة', blocked: 'محظور' };

export default function Users() {
  const { authFetch, isAdmin, user, hasPermission, refreshUser } = useAuth();
  const canManageUsers = hasPermission('manage_users');
  const canApproveUsers = hasPermission('approve_users');
  const canManageUserPermissions = hasPermission('manage_user_permissions');
  const [users, setUsers] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [deleteDialog, setDeleteDialog] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const [editUser, setEditUser] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [submittingEdit, setSubmittingEdit] = useState(false);

  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState({ name: '', email: '', password: '', role: 'employee', phone: '', partner_type: '' });
  const [submittingAdd, setSubmittingAdd] = useState(false);

  const [showNotifModal, setShowNotifModal] = useState(false);
  const [notifTarget, setNotifTarget] = useState('all');
  const [notifUserId, setNotifUserId] = useState('');
  const [notifForm, setNotifForm] = useState({ title: '', body: '', type: 'general' });
  const [sendingNotif, setSendingNotif] = useState(false);

  const [permissionUser, setPermissionUser] = useState(null);
  const [permissionOptions, setPermissionOptions] = useState([]);
  const [selectedPermissions, setSelectedPermissions] = useState([]);
  const [loadingPermissions, setLoadingPermissions] = useState(false);
  const [savingPermissions, setSavingPermissions] = useState(false);

  const load = async () => {
    setLoading(true);
    const res = await authFetch('/api/admin/users');
    const data = res.ok ? await res.json() : [];
    setUsers(Array.isArray(data) ? data : []);
    setSelectedIds([]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const setStatus = async (id, status) => {
    if (!canApproveUsers) return;
    const res = await authFetch(`/api/admin/users/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) });
    if (res.ok) load();
    else alert('خطأ في التحديث');
  };

  const deleteUser = async (id, name) => {
    if (!canManageUsers) return;
    setDeleteDialog({
      mode: 'single',
      title: `حذف "${name}"`,
      description: 'سيتم حذف هذا الحساب من داخل النظام مباشرةً ولن يظهر مرة أخرى في القائمة.',
      ids: [id],
    });
  };

  const toggleSelection = (id) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(itemId => itemId !== id) : [...prev, id]);
  };

  const clearSelection = () => setSelectedIds([]);

  const openEdit = (user) => {
    if (!canManageUsers) return;
    setEditUser(user);
    setEditForm({
      name: user.name || '',
      email: user.email || '',
      role: user.role || 'employee',
      phone: user.phone || '',
      partner_type: user.partner_type || '',
    });
  };

  const submitEdit = async (e) => {
    e.preventDefault();
    if (!canManageUsers) return;
    setSubmittingEdit(true);
    const res = await authFetch(`/api/admin/users/${editUser.id}`, { method: 'PUT', body: JSON.stringify(editForm) });
    const data = await res.json();
    if (!res.ok) alert(data.error || 'خطأ في التعديل');
    else {
      setEditUser(null);
      load();
    }
    setSubmittingEdit(false);
  };

  const submitAdd = async (e) => {
    e.preventDefault();
    if (!canManageUsers) return;
    setSubmittingAdd(true);
    const res = await authFetch('/api/admin/users', { method: 'POST', body: JSON.stringify(addForm) });
    const data = await res.json();
    if (!res.ok) alert(data.error || 'خطأ في الإنشاء');
    else {
      setShowAddModal(false);
      setAddForm({ name: '', email: '', password: '', role: 'employee', phone: '', partner_type: '' });
      load();
    }
    setSubmittingAdd(false);
  };

  const sendNotification = async (e) => {
    e.preventDefault();
    if (!notifForm.title.trim()) return;
    setSendingNotif(true);
    try {
      const payload = notifTarget === 'all'
        ? { ...notifForm, target: 'all' }
        : { ...notifForm, user_id: Number(notifUserId) };
      const res = await authFetch('/api/notifications', { method: 'POST', body: JSON.stringify(payload) });
      const data = await res.json();
      if (res.ok) {
        setShowNotifModal(false);
        setNotifForm({ title: '', body: '', type: 'general' });
        setNotifTarget('all');
        setNotifUserId('');
        alert(notifTarget === 'all' ? 'تم إرسال التنبيه للجميع' : 'تم إرسال التنبيه');
      } else {
        alert(data.error || 'خطأ');
      }
    } catch (_) {
      alert('خطأ في الاتصال');
    }
    setSendingNotif(false);
  };

  const filtered = users.filter(user =>
    user.name?.toLowerCase().includes(search.toLowerCase()) ||
    user.email?.toLowerCase().includes(search.toLowerCase())
  );

  const openPermissions = async (targetUser) => {
    if (!canManageUserPermissions) return;
    setLoadingPermissions(true);
    setPermissionUser(targetUser);
    const res = await authFetch(`/api/admin/users/${targetUser.id}/permissions`);
    const data = res.ok ? await res.json() : null;
    if (!data) {
      alert('تعذر تحميل صلاحيات المستخدم');
      setPermissionUser(null);
      setLoadingPermissions(false);
      return;
    }
    setPermissionOptions(Array.isArray(data.all_permissions) ? data.all_permissions : []);
    setSelectedPermissions(Array.isArray(data.user_permissions) ? data.user_permissions : []);
    setLoadingPermissions(false);
  };

  const togglePermission = (permissionKey) => {
    setSelectedPermissions((current) => current.includes(permissionKey)
      ? current.filter((key) => key !== permissionKey)
      : [...current, permissionKey]);
  };

  const savePermissions = async () => {
    if (!permissionUser) {
      setPermissionUser(null);
      return;
    }

    setSavingPermissions(true);
    const res = await authFetch(`/api/admin/users/${permissionUser.id}/permissions`, {
      method: 'PUT',
      body: JSON.stringify({ permissions: selectedPermissions }),
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'تعذر حفظ الصلاحيات');
      setSavingPermissions(false);
      return;
    }

    if (Number(permissionUser.id) === Number(user?.id)) {
      await refreshUser();
    }

    setSavingPermissions(false);
    setPermissionUser(null);
  };

  const visibleSelectableIds = canManageUsers ? filtered.map(user => user.id) : [];
  const allVisibleSelected = visibleSelectableIds.length > 0 && visibleSelectableIds.every(id => selectedIds.includes(id));

  const toggleSelectAllVisible = () => {
    if (allVisibleSelected) {
      setSelectedIds(prev => prev.filter(id => !visibleSelectableIds.includes(id)));
      return;
    }
    setSelectedIds(prev => Array.from(new Set([...prev, ...visibleSelectableIds])));
  };

  const bulkDeleteUsers = async () => {
    if (!canManageUsers) return;
    if (selectedIds.length === 0) return;
    setDeleteDialog({
      mode: 'bulk',
      title: 'حذف المستخدمين المحددين',
      description: `سيتم حذف ${selectedIds.length} حسابًا نهائيًا من النظام.`,
      ids: [...selectedIds],
    });
  };

  const confirmDelete = async () => {
    if (!deleteDialog || deleteDialog.ids.length === 0) return;

    setDeleting(true);
    const isBulk = deleteDialog.mode === 'bulk';
    try {
      const res = await authFetch(isBulk ? '/api/admin/users/bulk-delete' : `/api/admin/users/${deleteDialog.ids[0]}`, {
        method: isBulk ? 'POST' : 'DELETE',
        body: isBulk ? JSON.stringify({ ids: deleteDialog.ids }) : undefined,
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'خطأ في الحذف');
        return;
      }
      setDeleteDialog(null);
      clearSelection();
      load();
    } catch (_) {
      alert('خطأ في الاتصال');
    } finally {
      setDeleting(false);
    }
  };

  const pending = filtered.filter(user => user.status === 'pending');
  const others = filtered.filter(user => user.status !== 'pending');

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-gray-900">المستخدمون</h1>
          <p className="text-gray-500 text-sm mt-1">{users.length} مستخدم إجمالاً</p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <button
              onClick={() => setShowNotifModal(true)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-white font-semibold text-sm hover:opacity-90"
              style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}
            >
              <Bell size={16} /> إرسال تنبيه
            </button>
          )}
          {canManageUsers && (
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-white font-semibold text-sm hover:opacity-90"
              style={{ background: 'linear-gradient(90deg, #1e3a8a, #2563eb)' }}
            >
              <Plus size={16} /> إضافة مستخدم
            </button>
          )}
        </div>
      </div>

      <div className="relative mb-4">
        <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="بحث بالاسم أو البريد..."
          className="w-full border border-gray-200 rounded-xl py-2.5 pr-10 pl-4 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {canManageUsers && visibleSelectableIds.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gray-100 bg-white px-4 py-3">
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={toggleSelectAllVisible}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              {allVisibleSelected ? 'إلغاء تحديد الكل' : 'تحديد الكل'}
            </label>
            <span className="text-xs text-gray-400">{selectedIds.length} محدد</span>
          </div>
          <button
            onClick={bulkDeleteUsers}
            disabled={selectedIds.length === 0}
            className="flex items-center gap-2 rounded-xl bg-red-50 px-4 py-2 text-sm font-bold text-red-600 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 size={15} /> حذف المحدد
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {pending.length > 0 && (
            <div className="mb-6">
              <h2 className="text-sm font-bold text-yellow-700 bg-yellow-50 px-4 py-2 rounded-xl mb-3 flex items-center gap-2">
                <span className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse" />
                بانتظار الموافقة ({pending.length})
              </h2>
              <div className="space-y-2">
                {pending.map(user => (
                  <UserRow
                    key={user.id}
                    user={user}
                    onStatus={setStatus}
                    onDelete={deleteUser}
                    onEdit={openEdit}
                    onPermissions={openPermissions}
                    isSelected={selectedIds.includes(user.id)}
                    onToggleSelect={toggleSelection}
                    canManageUsers={canManageUsers}
                    canApproveUsers={canApproveUsers}
                    canManageUserPermissions={canManageUserPermissions}
                  />
                ))}
              </div>
            </div>
          )}

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            {others.length === 0 ? (
              <div className="text-center py-12 text-gray-400">لا توجد نتائج</div>
            ) : (
              <div className="divide-y divide-gray-50">
                {others.map(user => (
                  <UserRow
                    key={user.id}
                    user={user}
                    onStatus={setStatus}
                    onDelete={deleteUser}
                    onEdit={openEdit}
                    onPermissions={openPermissions}
                    isSelected={selectedIds.includes(user.id)}
                    onToggleSelect={toggleSelection}
                    canManageUsers={canManageUsers}
                    canApproveUsers={canApproveUsers}
                    canManageUserPermissions={canManageUserPermissions}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {editUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" dir="rtl">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-black text-gray-900">تعديل بيانات المستخدم</h2>
              <button onClick={() => setEditUser(null)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <form onSubmit={submitEdit} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">الاسم *</label>
                <input
                  required
                  value={editForm.name}
                  onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                  className="w-full border border-gray-200 rounded-xl py-2.5 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">البريد الإلكتروني *</label>
                <input
                  required
                  type="email"
                  value={editForm.email}
                  onChange={e => setEditForm({ ...editForm, email: e.target.value })}
                  className="w-full border border-gray-200 rounded-xl py-2.5 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">الدور</label>
                  <select
                    value={editForm.role}
                    onChange={e => setEditForm({ ...editForm, role: e.target.value })}
                    disabled={editUser.role === 'admin'}
                    className="w-full border border-gray-200 rounded-xl py-2.5 px-4 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400"
                  >
                    <option value="employee">موظف</option>
                    <option value="partner">شريك</option>
                    {isAdmin && <option value="admin">مدير</option>}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">رقم الجوال</label>
                  <input
                    value={editForm.phone}
                    onChange={e => setEditForm({ ...editForm, phone: e.target.value })}
                    className="w-full border border-gray-200 rounded-xl py-2.5 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="اختياري"
                  />
                </div>
              </div>
              {editForm.role === 'partner' && (
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">نوع الشراكة</label>
                  <input
                    value={editForm.partner_type}
                    onChange={e => setEditForm({ ...editForm, partner_type: e.target.value })}
                    className="w-full border border-gray-200 rounded-xl py-2.5 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="مثل: وسيط"
                  />
                </div>
              )}
              <div className="flex gap-3 pt-2">
                <button
                  type="submit"
                  disabled={submittingEdit}
                  className="flex-1 py-2.5 rounded-xl text-white font-bold text-sm hover:opacity-90 disabled:opacity-60"
                  style={{ background: 'linear-gradient(90deg, #92400e, #d97706)' }}
                >
                  {submittingEdit ? 'جارٍ الحفظ...' : 'حفظ التعديلات'}
                </button>
                <button
                  type="button"
                  onClick={() => setEditUser(null)}
                  className="px-5 py-2.5 rounded-xl border border-gray-200 text-gray-600 text-sm hover:bg-gray-50"
                >
                  إلغاء
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" dir="rtl">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-black text-gray-900">إضافة مستخدم جديد</h2>
              <button onClick={() => setShowAddModal(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <form onSubmit={submitAdd} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">الاسم *</label>
                <input
                  required
                  value={addForm.name}
                  onChange={e => setAddForm({ ...addForm, name: e.target.value })}
                  className="w-full border border-gray-200 rounded-xl py-2.5 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="الاسم الكامل"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">البريد الإلكتروني *</label>
                <input
                  required
                  type="email"
                  value={addForm.email}
                  onChange={e => setAddForm({ ...addForm, email: e.target.value })}
                  className="w-full border border-gray-200 rounded-xl py-2.5 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="example@email.com"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">كلمة المرور *</label>
                <input
                  required
                  type="password"
                  value={addForm.password}
                  onChange={e => setAddForm({ ...addForm, password: e.target.value })}
                  className="w-full border border-gray-200 rounded-xl py-2.5 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="6 أحرف على الأقل"
                  minLength={6}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">الدور</label>
                  <select
                    value={addForm.role}
                    onChange={e => setAddForm({ ...addForm, role: e.target.value })}
                    className="w-full border border-gray-200 rounded-xl py-2.5 px-4 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="employee">موظف</option>
                    <option value="partner">شريك</option>
                    {isAdmin && <option value="admin">مدير</option>}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">رقم الجوال</label>
                  <input
                    value={addForm.phone}
                    onChange={e => setAddForm({ ...addForm, phone: e.target.value })}
                    className="w-full border border-gray-200 rounded-xl py-2.5 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="اختياري"
                  />
                </div>
              </div>
              {addForm.role === 'partner' && (
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">نوع الشراكة</label>
                  <input
                    value={addForm.partner_type}
                    onChange={e => setAddForm({ ...addForm, partner_type: e.target.value })}
                    className="w-full border border-gray-200 rounded-xl py-2.5 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="مثل: وسيط"
                  />
                </div>
              )}
              <div className="flex gap-3 pt-2">
                <button
                  type="submit"
                  disabled={submittingAdd}
                  className="flex-1 py-2.5 rounded-xl text-white font-bold text-sm hover:opacity-90 disabled:opacity-60"
                  style={{ background: 'linear-gradient(90deg, #1e3a8a, #2563eb)' }}
                >
                  {submittingAdd ? 'جارٍ الإنشاء...' : 'إنشاء المستخدم'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-5 py-2.5 rounded-xl border border-gray-200 text-gray-600 text-sm hover:bg-gray-50"
                >
                  إلغاء
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showNotifModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" dir="rtl">
            <div
              className="flex items-center justify-between px-6 py-4 rounded-t-2xl"
              style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center">
                  <Bell size={18} className="text-white" />
                </div>
                <h2 className="text-white font-bold text-base">إرسال تنبيه</h2>
              </div>
              <button onClick={() => setShowNotifModal(false)} className="text-white/70 hover:text-white"><X size={20} /></button>
            </div>
            <form onSubmit={sendNotification} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">المستلم</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setNotifTarget('all')}
                    className={`flex-1 py-2 rounded-xl text-sm font-semibold border transition-all ${notifTarget === 'all' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-200'}`}
                  >
                    الجميع
                  </button>
                  <button
                    type="button"
                    onClick={() => setNotifTarget('user')}
                    className={`flex-1 py-2 rounded-xl text-sm font-semibold border transition-all ${notifTarget === 'user' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-200'}`}
                  >
                    مستخدم محدد
                  </button>
                </div>
              </div>
              {notifTarget === 'user' && (
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">اختر المستخدم</label>
                  <select
                    value={notifUserId}
                    onChange={e => setNotifUserId(e.target.value)}
                    className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    required
                  >
                    <option value="">-- اختر مستخدماً --</option>
                    {users.filter(user => user.role !== 'admin').map(user => (
                      <option key={user.id} value={user.id}>{user.name} ({user.role === 'employee' ? 'موظف' : 'شريك'})</option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">نوع التنبيه</label>
                <select
                  value={notifForm.type}
                  onChange={e => setNotifForm(form => ({ ...form, type: e.target.value }))}
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="general">🔔 عام</option>
                  <option value="message">💬 رسالة</option>
                  <option value="update">🔄 تحديث</option>
                  <option value="warning">⚠️ تحذير</option>
                  <option value="success">✅ نجاح</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">عنوان التنبيه <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={notifForm.title}
                  onChange={e => setNotifForm(form => ({ ...form, title: e.target.value }))}
                  placeholder="عنوان التنبيه..."
                  required
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">تفاصيل (اختياري)</label>
                <textarea
                  value={notifForm.body}
                  onChange={e => setNotifForm(form => ({ ...form, body: e.target.value }))}
                  placeholder="نص التنبيه التفصيلي..."
                  rows={3}
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                />
              </div>
              <div className="flex gap-3 pt-1">
                <button
                  type="submit"
                  disabled={sendingNotif}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-white font-bold text-sm disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}
                >
                  <Send size={15} />
                  {sendingNotif ? 'جارٍ الإرسال...' : 'إرسال التنبيه'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowNotifModal(false)}
                  className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-600 font-bold text-sm hover:bg-gray-50"
                >
                  إلغاء
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {permissionUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" dir="rtl">
          <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
                  <Shield size={18} />
                </div>
                <div>
                  <h2 className="text-base font-black text-gray-900">إدارة الصلاحيات</h2>
                  <p className="text-xs text-gray-500">{permissionUser.name}</p>
                </div>
              </div>
              <button onClick={() => setPermissionUser(null)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>

            <div className="space-y-4 px-6 py-5">
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                <div className="font-bold text-slate-900">صلاحيات الدور الأساسية</div>
                <div className="mt-1 text-xs text-slate-500">
                  'يمكنك منح أو سحب أي صلاحية هنا، بما في ذلك حسابات المدير.'
                </div>
              </div>

              {loadingPermissions ? (
                <div className="flex justify-center py-10">
                  <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
                </div>
              ) : (
                <div className="max-h-[26rem] space-y-3 overflow-y-auto pr-1">
                  {permissionOptions.map((permission) => {
                    const checked = selectedPermissions.includes(permission.key);
                    return (
                      <label key={permission.key} className={`flex items-start gap-3 rounded-xl border px-4 py-3 transition-colors ${checked ? 'border-blue-200 bg-blue-50' : 'border-gray-200 bg-white'}`}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => togglePermission(permission.key)}
                          className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-bold text-gray-900">{permission.label}</span>
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">{permission.category || 'عام'}</span>
                          </div>
                          <div className="mt-1 text-xs text-gray-500">{permission.description || permission.key}</div>
                          <div className="mt-1 font-mono text-[11px] text-gray-400">{permission.key}</div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex gap-3 border-t border-gray-100 px-6 py-4">
              <button
                type="button"
                onClick={savePermissions}
                disabled={loadingPermissions || savingPermissions}
                className="flex-1 rounded-xl bg-blue-600 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {savingPermissions ? 'جارٍ الحفظ...' : 'حفظ الصلاحيات'}
              </button>
              <button
                type="button"
                onClick={() => setPermissionUser(null)}
                className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-bold text-gray-600 hover:bg-gray-50"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" dir="rtl">
          <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="bg-gradient-to-r from-red-600 to-rose-600 px-6 py-4">
              <div className="flex items-center gap-3 text-white">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15">
                  <Trash2 size={18} />
                </div>
                <div>
                  <h2 className="text-base font-black">تأكيد الحذف</h2>
                  <p className="text-xs text-white/80">إجراء نهائي داخل صفحة المستخدمين</p>
                </div>
              </div>
            </div>
            <div className="space-y-4 px-6 py-5">
              <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
                <div className="font-bold text-red-900">{deleteDialog.title}</div>
                <div className="mt-1 leading-6">{deleteDialog.description}</div>
              </div>
              <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 text-xs text-gray-500">
                النافذة هنا داخل التصميم نفسه بدل تنبيه المتصفح التقليدي.
              </div>
            </div>
            <div className="flex gap-3 border-t border-gray-100 px-6 py-4">
              <button
                type="button"
                onClick={confirmDelete}
                disabled={deleting}
                className="flex-1 rounded-xl bg-red-600 py-2.5 text-sm font-bold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {deleting ? 'جارٍ الحذف...' : 'نعم، احذف الآن'}
              </button>
              <button
                type="button"
                onClick={() => setDeleteDialog(null)}
                disabled={deleting}
                className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-bold text-gray-600 hover:bg-gray-50 disabled:opacity-60"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function UserRow({ user, onStatus, onDelete, onEdit, onPermissions, isSelected, onToggleSelect, canManageUsers, canApproveUsers, canManageUserPermissions }) {
  return (
    <div className="flex items-center justify-between px-5 py-4 bg-white hover:bg-gray-50 transition-colors">
      <div className="flex items-center gap-3">
        {canManageUsers && (
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => onToggleSelect(user.id)}
            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
        )}
        <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
          <span className="text-blue-700 font-bold text-sm">{user.name?.[0] || '?'}</span>
        </div>
        <div>
          <div className="font-semibold text-gray-900 text-sm">{user.name}</div>
          <div className="text-gray-400 text-xs">{user.email}</div>
          {user.phone && <div className="text-gray-400 text-xs">{user.phone}</div>}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${roleColor[user.role] || 'bg-gray-100 text-gray-600'}`}>
          {roleLabel[user.role] || user.role}
        </span>
        <span className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${statusColor[user.status] || 'bg-gray-100 text-gray-600'}`}>
          {statusLabel[user.status] || user.status}
        </span>
        {canApproveUsers && user.status === 'pending' && (
          <button
            onClick={() => onStatus(user.id, 'approved')}
            className="p-1.5 bg-green-100 text-green-600 rounded-lg hover:bg-green-200 transition-colors"
            title="قبول"
          >
            <UserCheck size={14} />
          </button>
        )}
        {canApproveUsers && user.status === 'approved' && (
          <button
            onClick={() => onStatus(user.id, 'blocked')}
            className="p-1.5 bg-red-100 text-red-600 rounded-lg hover:bg-red-200 transition-colors"
            title="حظر"
          >
            <UserX size={14} />
          </button>
        )}
        {canApproveUsers && user.status === 'blocked' && (
          <button
            onClick={() => onStatus(user.id, 'approved')}
            className="p-1.5 bg-green-100 text-green-600 rounded-lg hover:bg-green-200 transition-colors"
            title="رفع الحظر"
          >
            <UserCheck size={14} />
          </button>
        )}
        {canManageUserPermissions && (
          <button
            onClick={() => onPermissions(user)}
            className="p-1.5 bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 transition-colors"
            title="إدارة الصلاحيات"
          >
            <Shield size={14} />
          </button>
        )}
        {canManageUsers && (
          <button
            onClick={() => onEdit(user)}
            className="p-1.5 bg-amber-50 text-amber-600 rounded-lg hover:bg-amber-100 transition-colors"
            title="تعديل"
          >
            <Edit2 size={14} />
          </button>
        )}
        {canManageUsers && (
          <button
            onClick={() => onDelete(user.id, user.name)}
            className="p-1.5 bg-gray-100 text-gray-500 rounded-lg hover:bg-red-100 hover:text-red-600 transition-colors"
            title="حذف"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
