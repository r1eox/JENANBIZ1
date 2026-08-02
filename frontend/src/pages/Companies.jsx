import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Plus, Trash2, Search, X, Edit2, Phone, Building2, Users } from 'lucide-react';

const FALLBACK_PRODUCT_TYPES = ['كاش', 'نقاط بيع', 'عقار', 'تمويل شخصي', 'أسطول', 'رهن', 'تمويل تجاري'];
const PRODUCT_FIELD_SETS = {
  'كاش': ['annual_deposit_amount', 'min_months', 'whatsapp_number'],
  'نقاط بيع': ['annual_deposit_amount', 'min_months', 'whatsapp_number'],
  'تمويل تجاري': ['annual_deposit_amount', 'min_transfer_amount', 'min_months', 'whatsapp_number'],
  'تمويل شخصي': ['min_transfer_amount', 'min_months', 'whatsapp_number'],
  'عقار': ['min_transfer_amount', 'min_months', 'whatsapp_number'],
  'رهن': ['min_transfer_amount', 'min_months', 'whatsapp_number'],
  'أسطول': ['min_transfer_amount', 'min_months', 'whatsapp_number'],
};

const DEFAULT_VISIBLE_FIELDS = ['annual_deposit_amount', 'min_transfer_amount', 'min_months', 'whatsapp_number'];

const FIELD_META = {
  annual_deposit_amount: { label: 'الإيداعات السنوية', helper: 'بديل موحد لحقول أدنى إيداع ونقاط البيع' },
  min_transfer_amount: { label: 'الحد الأدنى للتحويل', helper: 'يُعرض فقط للأنواع التي تحتاج شرط تحويل' },
  min_months: { label: 'عدد الأشهر', helper: 'مدة كشف الحساب أو النشاط' },
  whatsapp_number: { label: 'رقم واتساب', helper: 'رقم الجهة التمويلية' },
};

const getAnnualDepositAmount = (entity) => Number(entity.annual_deposit_amount ?? entity.min_deposit_transfer_amount ?? entity.min_deposit_amount ?? entity.min_pos_amount ?? 0);

export default function Companies() {
  const { authFetch } = useAuth();
  const [tab, setTab] = useState('entities'); // 'entities' | 'contacts'
  const [entities, setEntities] = useState([]);
  const [selectedEntityIds, setSelectedEntityIds] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [productTypes, setProductTypes] = useState(FALLBACK_PRODUCT_TYPES);
  const [newProductType, setNewProductType] = useState('');

  // Modals
  const [showEntityModal, setShowEntityModal] = useState(false);
  const [showContactModal, setShowContactModal] = useState(false);
  const [editEntity, setEditEntity] = useState(null);
  const [editContact, setEditContact] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const defaultEntityForm = { name: '', priority: 0, annual_deposit_amount: 0, min_transfer_amount: 0, min_months: 6, whatsapp_number: '', product_types: [], notes: '' };
  const defaultContactForm = { funding_entity_id: '', name: '', phone: '', product_types: [], notes: '' };
  const [entityForm, setEntityForm] = useState(defaultEntityForm);
  const [contactForm, setContactForm] = useState(defaultContactForm);

  const loadEntities = async () => {
    const res = await authFetch('/api/admin/funding-entities');
    const data = res.ok ? await res.json() : [];
    const normalized = Array.isArray(data) ? data : [];
    setEntities(normalized);
    setSelectedEntityIds([]);
    return normalized;
  };
  const loadContacts = async () => {
    const res = await authFetch('/api/companies/contacts');
    const data = res.ok ? await res.json() : [];
    const normalized = Array.isArray(data) ? data : [];
    setContacts(normalized);
    return normalized;
  };

  const loadProductTypes = async () => {
    const res = await authFetch('/api/companies/product-types');
    const data = res.ok ? await res.json() : [];
    return Array.isArray(data) && data.length > 0 ? data : FALLBACK_PRODUCT_TYPES;
  };

  const load = async () => {
    setLoading(true);
    const [loadedEntities, loadedContacts, loadedProductTypes] = await Promise.all([loadEntities(), loadContacts(), loadProductTypes()]);
    const dynamicTypes = [
      ...loadedProductTypes,
      ...loadedEntities.flatMap(entity => Array.isArray(entity.product_types) ? entity.product_types : []),
      ...loadedContacts.flatMap(contact => Array.isArray(contact.product_types) ? contact.product_types : []),
    ].map(type => String(type || '').trim()).filter(Boolean);
    setProductTypes(Array.from(new Set(dynamicTypes)));
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  // Entity CRUD
  const openNewEntity = () => { setEditEntity(null); setEntityForm(defaultEntityForm); setShowEntityModal(true); };
  const openEditEntity = (e) => {
    setEditEntity(e);
    setEntityForm({
      name: e.name,
      priority: e.priority,
      annual_deposit_amount: e.annual_deposit_amount ?? e.min_deposit_transfer_amount ?? e.min_deposit_amount ?? e.min_pos_amount ?? 0,
      min_transfer_amount: e.min_transfer_amount,
      min_months: e.min_months,
      whatsapp_number: e.whatsapp_number || '',
      product_types: Array.isArray(e.product_types) ? e.product_types : [],
      notes: e.notes || ''
    });
    setShowEntityModal(true);
  };
  const saveEntity = async (ev) => {
    ev.preventDefault();
    if (!entityForm.product_types[0]) {
      alert('اختر النوع الأساسي للتمويل أولاً');
      return;
    }
    setSubmitting(true);
    const url = editEntity ? `/api/admin/funding-entities/${editEntity.id}` : '/api/admin/funding-entities';
    const method = editEntity ? 'PUT' : 'POST';
    const payload = { ...entityForm, product_types: [entityForm.product_types[0]] };
    const res = await authFetch(url, { method, body: JSON.stringify(payload) });
    const d = await res.json();
    if (!res.ok) alert(d.error || 'خطأ');
    else { setShowEntityModal(false); loadEntities(); }
    setSubmitting(false);
  };
  const deleteEntity = async (id, name) => {
    if (!confirm(`حذف "${name}"؟`)) return;
    const res = await authFetch(`/api/admin/funding-entities/${id}`, { method: 'DELETE' });
    if (res.ok) loadEntities();
    else { const d = await res.json(); alert(d.error || 'خطأ'); }
  };

  const toggleEntitySelection = (id) => {
    setSelectedEntityIds(prev => prev.includes(id) ? prev.filter(itemId => itemId !== id) : [...prev, id]);
  };

  // Contact CRUD
  const openNewContact = () => { setEditContact(null); setContactForm(defaultContactForm); setShowContactModal(true); };
  const openEditContact = (c) => {
    setEditContact(c);
    setContactForm({ funding_entity_id: String(c.funding_entity_id), name: c.name, phone: c.phone || '', product_types: Array.isArray(c.product_types) ? c.product_types : [], notes: c.notes || '' });
    setShowContactModal(true);
  };
  const saveContact = async (ev) => {
    ev.preventDefault(); setSubmitting(true);
    const url = editContact ? `/api/companies/contacts/${editContact.id}` : '/api/companies/contacts';
    const method = editContact ? 'PUT' : 'POST';
    const res = await authFetch(url, { method, body: JSON.stringify({ ...contactForm, funding_entity_id: Number(contactForm.funding_entity_id) }) });
    const d = await res.json();
    if (!res.ok) alert(d.error || 'خطأ');
    else { setShowContactModal(false); loadContacts(); }
    setSubmitting(false);
  };
  const deleteContact = async (id) => {
    if (!confirm('حذف جهة الاتصال؟')) return;
    const res = await authFetch(`/api/companies/contacts/${id}`, { method: 'DELETE' });
    if (res.ok) loadContacts();
    else { const d = await res.json(); alert(d.error || 'خطأ'); }
  };

  const toggleProductType = (type, form, setForm) => {
    setForm(f => ({
      ...f,
      product_types: f.product_types.includes(type) ? f.product_types.filter(t => t !== type) : [...f.product_types, type]
    }));
  };

  const addProductTypeOption = () => {
    const value = String(newProductType || '').trim();
    if (!value) return;
    setProductTypes(current => current.includes(value) ? current : [...current, value]);
    setEntityForm(form => ({ ...form, product_types: [value] }));
    setNewProductType('');
  };

  const filteredEntities = entities.filter(e => e.name?.toLowerCase().includes(search.toLowerCase()));
  const filteredContacts = contacts.filter(c => c.name?.toLowerCase().includes(search.toLowerCase()) || c.entity_name?.toLowerCase().includes(search.toLowerCase()));
  const visibleEntityIds = filteredEntities.map(entity => entity.id);
  const allVisibleEntitiesSelected = visibleEntityIds.length > 0 && visibleEntityIds.every(id => selectedEntityIds.includes(id));
  const activeProductType = entityForm.product_types[0] || '';
  const visibleFields = PRODUCT_FIELD_SETS[activeProductType] || DEFAULT_VISIBLE_FIELDS;

  const toggleSelectAllEntities = () => {
    if (allVisibleEntitiesSelected) {
      setSelectedEntityIds(prev => prev.filter(id => !visibleEntityIds.includes(id)));
      return;
    }
    setSelectedEntityIds(prev => Array.from(new Set([...prev, ...visibleEntityIds])));
  };

  const bulkDeleteEntities = async () => {
    if (selectedEntityIds.length === 0) return;
    if (!confirm(`حذف ${selectedEntityIds.length} جهة تمويلية؟`)) return;
    const res = await authFetch('/api/admin/funding-entities/bulk-delete', {
      method: 'POST',
      body: JSON.stringify({ ids: selectedEntityIds }),
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'خطأ في الحذف الجماعي');
      return;
    }
    loadEntities();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-gray-900">الجهات التمويلية</h1>
          <p className="text-gray-500 text-sm mt-1">{entities.length} جهة · {contacts.length} جهة اتصال</p>
        </div>
        <button onClick={tab === 'entities' ? openNewEntity : openNewContact}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-white font-semibold text-sm hover:opacity-90"
          style={{ background: 'linear-gradient(90deg, #1e3a8a, #2563eb)' }}>
          <Plus size={16} /> {tab === 'entities' ? 'جهة تمويلية' : 'جهة اتصال'}
        </button>
      </div>

      <div className="flex gap-2 mb-4">
        {[{ id: 'entities', label: 'الجهات التمويلية', icon: Building2 }, { id: 'contacts', label: 'جهات الاتصال', icon: Users }].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${tab === t.id ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'}`}>
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </div>

      <div className="relative mb-4">
        <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="بحث..."
          className="w-full border border-gray-200 rounded-xl py-2.5 pr-10 pl-4 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>

      {tab === 'entities' && visibleEntityIds.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gray-100 bg-white px-4 py-3">
          <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={allVisibleEntitiesSelected}
              onChange={toggleSelectAllEntities}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            {allVisibleEntitiesSelected ? 'إلغاء تحديد الكل' : 'تحديد الكل'}
          </label>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-400">{selectedEntityIds.length} محدد</span>
            <button
              onClick={bulkDeleteEntities}
              disabled={selectedEntityIds.length === 0}
              className="flex items-center gap-2 rounded-xl bg-red-50 px-4 py-2 text-sm font-bold text-red-600 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Trash2 size={15} /> حذف المحدد
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>
      ) : tab === 'entities' ? (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          {filteredEntities.length === 0 ? (
            <div className="text-center py-12 text-gray-400">لا توجد جهات تمويلية</div>
          ) : (
            <div className="divide-y divide-gray-50">
              {filteredEntities.map(e => (
                <div key={e.id} className="flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors">
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={selectedEntityIds.includes(e.id)}
                      onChange={() => toggleEntitySelection(e.id)}
                      className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                      <Building2 size={18} className="text-blue-600" />
                    </div>
                    <div>
                      <div className="font-semibold text-gray-900 text-sm">{e.name}</div>
                      <div className="text-xs text-gray-400 mt-0.5">
                        الأولوية: {e.priority} ·
                        {e.product_types?.length > 0 && ` ${e.product_types.slice(0,3).join('، ')}${e.product_types.length > 3 ? '...' : ''}`}
                      </div>
                      <div className="text-xs text-gray-400">
                        الإيداعات السنوية: {getAnnualDepositAmount(e).toLocaleString()} ريال
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-1 rounded-full ${e.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {e.is_active ? 'نشطة' : 'معطلة'}
                    </span>
                    <button onClick={() => openEditEntity(e)} className="p-1.5 bg-gray-100 text-gray-500 rounded-lg hover:bg-blue-100 hover:text-blue-600 transition-colors"><Edit2 size={14} /></button>
                    <button onClick={() => deleteEntity(e.id, e.name)} className="p-1.5 bg-gray-100 text-gray-500 rounded-lg hover:bg-red-100 hover:text-red-600 transition-colors"><Trash2 size={14} /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          {filteredContacts.length === 0 ? (
            <div className="text-center py-12 text-gray-400">لا توجد جهات اتصال</div>
          ) : (
            <div className="divide-y divide-gray-50">
              {filteredContacts.map(c => (
                <div key={c.id} className="flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center">
                      <span className="text-purple-700 font-bold text-sm">{c.name?.[0]}</span>
                    </div>
                    <div>
                      <div className="font-semibold text-gray-900 text-sm">{c.name}</div>
                      <div className="text-xs text-blue-600 font-medium">{c.entity_name}</div>
                      {c.phone && <div className="flex items-center gap-1 text-gray-400 text-xs"><Phone size={11} />{c.phone}</div>}
                      {c.product_types?.length > 0 && <div className="text-xs text-gray-400">{c.product_types.join('، ')}</div>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => openEditContact(c)} className="p-1.5 bg-gray-100 text-gray-500 rounded-lg hover:bg-blue-100 hover:text-blue-600 transition-colors"><Edit2 size={14} /></button>
                    <button onClick={() => deleteContact(c.id)} className="p-1.5 bg-gray-100 text-gray-500 rounded-lg hover:bg-red-100 hover:text-red-600 transition-colors"><Trash2 size={14} /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Entity Modal */}
      {showEntityModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 overflow-y-auto" dir="rtl">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 my-8 p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-black text-gray-900">{editEntity ? 'تعديل الجهة التمويلية' : 'جهة تمويلية جديدة'}</h2>
              <button onClick={() => setShowEntityModal(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <form onSubmit={saveEntity} className="space-y-3">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">اسم الجهة *</label>
                <input required value={entityForm.name} onChange={e => setEntityForm({ ...entityForm, name: e.target.value })}
                  className="w-full border border-gray-200 rounded-xl py-2.5 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">الأولوية</label>
                  <input type="number" value={entityForm.priority} onChange={e => setEntityForm({ ...entityForm, priority: Number(e.target.value) })}
                    className="w-full border border-gray-200 rounded-xl py-2.5 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">النوع الأساسي</label>
                  <select
                    value={activeProductType}
                    onChange={e => setEntityForm(form => ({ ...form, product_types: e.target.value ? [e.target.value] : [] }))}
                    className="w-full border border-gray-200 rounded-xl py-2.5 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  >
                    <option value="">اختر النوع</option>
                    {productTypes.map(type => <option key={type} value={type}>{type}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex gap-2">
                <input
                  value={newProductType}
                  onChange={e => setNewProductType(e.target.value)}
                  placeholder="إضافة نوع تمويلي جديد"
                  className="flex-1 border border-gray-200 rounded-xl py-2.5 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  type="button"
                  onClick={addProductTypeOption}
                  className="px-4 rounded-xl border border-blue-200 text-blue-700 text-sm font-bold hover:bg-blue-50"
                >
                  إضافة
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {visibleFields.map((fieldKey) => {
                  const meta = FIELD_META[fieldKey];
                  if (!meta) return null;
                  return (
                    <div key={fieldKey}>
                      <label className="block text-xs font-semibold text-gray-700 mb-1">{meta.label}</label>
                      <input
                        type="number"
                        value={entityForm[fieldKey]}
                        onChange={e => setEntityForm({ ...entityForm, [fieldKey]: Number(e.target.value) })}
                        className="w-full border border-gray-200 rounded-xl py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <p className="mt-1 text-[11px] text-gray-400">{meta.helper}</p>
                    </div>
                  );
                })}
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">رقم واتساب</label>
                <input value={entityForm.whatsapp_number} onChange={e => setEntityForm({ ...entityForm, whatsapp_number: e.target.value })}
                  className="w-full border border-gray-200 rounded-xl py-2.5 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="05xxxxxxxx" />
              </div>
              <div className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-700">
                إظهار الحقول يتم تلقائياً حسب النوع الأساسي المختار، وباقي الحقول تختفي.
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">ملاحظات</label>
                <textarea value={entityForm.notes} onChange={e => setEntityForm({ ...entityForm, notes: e.target.value })}
                  rows={2} className="w-full border border-gray-200 rounded-xl py-2.5 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="submit" disabled={submitting}
                  className="flex-1 py-2.5 rounded-xl text-white font-bold text-sm hover:opacity-90 disabled:opacity-60"
                  style={{ background: 'linear-gradient(90deg, #1e3a8a, #2563eb)' }}>
                  {submitting ? 'جارٍ الحفظ...' : 'حفظ'}
                </button>
                <button type="button" onClick={() => setShowEntityModal(false)} className="px-5 py-2.5 rounded-xl border border-gray-200 text-gray-600 text-sm hover:bg-gray-50">إلغاء</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Contact Modal */}
      {showContactModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" dir="rtl">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-black text-gray-900">{editContact ? 'تعديل جهة الاتصال' : 'جهة اتصال جديدة'}</h2>
              <button onClick={() => setShowContactModal(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <form onSubmit={saveContact} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">الجهة التمويلية *</label>
                <select required value={contactForm.funding_entity_id} onChange={e => setContactForm({ ...contactForm, funding_entity_id: e.target.value })}
                  className="w-full border border-gray-200 rounded-xl py-2.5 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                  <option value="">اختر الجهة</option>
                  {entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">الاسم *</label>
                <input required value={contactForm.name} onChange={e => setContactForm({ ...contactForm, name: e.target.value })}
                  className="w-full border border-gray-200 rounded-xl py-2.5 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">رقم الجوال</label>
                <input value={contactForm.phone} onChange={e => setContactForm({ ...contactForm, phone: e.target.value })}
                  className="w-full border border-gray-200 rounded-xl py-2.5 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="05xxxxxxxx" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">المنتجات</label>
                <div className="flex flex-wrap gap-2">
                  {productTypes.map(t => (
                    <button key={t} type="button" onClick={() => toggleProductType(t, contactForm, setContactForm)}
                      className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${contactForm.product_types.includes(t) ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">ملاحظات</label>
                <textarea value={contactForm.notes} onChange={e => setContactForm({ ...contactForm, notes: e.target.value })}
                  rows={2} className="w-full border border-gray-200 rounded-xl py-2.5 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="submit" disabled={submitting}
                  className="flex-1 py-2.5 rounded-xl text-white font-bold text-sm hover:opacity-90 disabled:opacity-60"
                  style={{ background: 'linear-gradient(90deg, #1e3a8a, #2563eb)' }}>
                  {submitting ? 'جارٍ الحفظ...' : 'حفظ'}
                </button>
                <button type="button" onClick={() => setShowContactModal(false)} className="px-5 py-2.5 rounded-xl border border-gray-200 text-gray-600 text-sm hover:bg-gray-50">إلغاء</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
