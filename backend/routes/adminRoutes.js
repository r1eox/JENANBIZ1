const express = require('express');
const db = require('../database');
const { adminMiddleware, hasPermission, hasAnyPermission } = require('../middleware/authMiddleware');
const { createNotification, notifyAdmins } = require('../services/notificationService');
const { ensureRequestDocuments } = require('../services/requestDocuments');

const router = express.Router();

const usersAccessMiddleware = hasAnyPermission(['manage_users', 'approve_users', 'manage_user_permissions']);

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function parseObjectField(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (!value) return {};

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    return {};
  }
}

function isPrimaryAdminUser(user = {}) {
  const primaryAdminEmail = (process.env.PRIMARY_ADMIN_EMAIL || '').trim().toLowerCase();
  if (!primaryAdminEmail || !user || !user.email) return false;
  return String(user.email).trim().toLowerCase() === primaryAdminEmail;
}

function canDeleteAdminUsers(user = {}) {
  return user.role === 'admin' || (Array.isArray(user.permissions) && user.permissions.includes('delete_admins'));
}

function parseRequestRow(request = null) {
  if (!request) return request;
  return {
    ...request,
    product_details: parseObjectField(request.product_details),
  };
}

// ===== USERS =====
router.post('/users', hasPermission('manage_users'), async (req, res) => {
  try {
    const bcrypt = require('bcryptjs');
    const { name, email, role, phone, partner_type, password } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'الاسم مطلوب' });
    if (!email || !email.trim()) return res.status(400).json({ error: 'البريد مطلوب' });
    if (!password || password.length < 6) return res.status(400).json({ error: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' });
    if (role === 'admin' && req.user.role !== 'admin') return res.status(403).json({ error: 'إنشاء مدير جديد متاح للمدير فقط' });
    const dup = await db.prepare('SELECT id FROM users WHERE email = ?').get(email.trim().toLowerCase());
    if (dup) return res.status(400).json({ error: 'البريد الإلكتروني مستخدم مسبقاً' });
    const hashed = await bcrypt.hash(password, 10);
    const result = await db.prepare(
      'INSERT INTO users (name, email, password, role, phone, partner_type, status) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(name.trim(), email.trim().toLowerCase(), hashed, role || 'employee', phone?.trim() || null, partner_type?.trim() || null, 'approved');
    res.status(201).json({ id: result.lastInsertRowid, message: 'تم إنشاء المستخدم بنجاح' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'خطأ في إنشاء المستخدم' });
  }
});

router.get('/users', usersAccessMiddleware, async (req, res) => {
  try {
    const users = await db.prepare(
      `SELECT u.id, u.name, u.email, u.role, u.partner_type, u.status, u.phone, u.created_at
       FROM users u
       ORDER BY u.created_at DESC`
    ).all();
    res.json(users);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'خطأ في استرجاع المستخدمين' });
  }
});

router.get('/users/pending-count', hasPermission('approve_users'), async (req, res) => {
  try {
    const row = await db.prepare("SELECT COUNT(*) as count FROM users WHERE status = 'pending'").get();
    res.json({ count: row.count });
  } catch (err) {
    res.status(500).json({ count: 0 });
  }
});

router.put('/users/:id', hasPermission('manage_users'), async (req, res) => {
  try {
    const user = await db.prepare('SELECT role FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
    const { name, email, role, phone, partner_type } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'الاسم مطلوب' });
    if (!email || !email.trim()) return res.status(400).json({ error: 'البريد مطلوب' });
    if (role === 'admin' && req.user.role !== 'admin') return res.status(403).json({ error: 'تعيين دور المدير متاح للمدير فقط' });
    if (Number(req.params.id) === Number(req.user.id) && role && role !== user.role) {
      return res.status(403).json({ error: 'لا يمكنك تغيير دور حسابك الحالي من هنا' });
    }
    const dup = await db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email.trim().toLowerCase(), req.params.id);
    if (dup) return res.status(400).json({ error: 'البريد الإلكتروني مستخدم مسبقاً' });
    await db.prepare('UPDATE users SET name = ?, email = ?, role = ?, phone = ?, partner_type = ? WHERE id = ?')
      .run(name.trim(), email.trim().toLowerCase(), role || user.role, phone?.trim() || null, partner_type?.trim() || null, req.params.id);
    res.json({ message: 'تم تحديث بيانات المستخدم' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'خطأ في التعديل' });
  }
});

router.put('/users/:id/status', hasPermission('approve_users'), async (req, res) => {
  try {
    const { status } = req.body;
    if (!['approved', 'blocked', 'pending'].includes(status)) return res.status(400).json({ error: 'حالة غير صحيحة' });
    const user = await db.prepare('SELECT id, name, role FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
    if (user.role === 'admin') return res.status(403).json({ error: 'لا يمكن تغيير حالة الأدمن' });
    await db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, req.params.id);

    const statusPayload = {
      approved: {
        type: 'success',
        title: 'تم اعتماد حسابك',
        body: 'يمكنك الآن تسجيل الدخول واستخدام المنصة.',
        link: '/dashboard',
      },
      blocked: {
        type: 'warning',
        title: 'تم حظر حسابك',
        body: 'تم تغيير حالة حسابك إلى محظور. تواصل مع الإدارة للمراجعة.',
        link: '/dashboard',
      },
      pending: {
        type: 'update',
        title: 'تمت إعادة حسابك للمراجعة',
        body: 'حسابك عاد إلى حالة المراجعة مؤقتاً.',
        link: '/dashboard',
      },
    };

    await createNotification(user.id, statusPayload[status]);
    res.json({ message: 'تم تحديث الحالة بنجاح' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'خطأ في تحديث الحالة' });
  }
});

router.delete('/users/:id', hasPermission('manage_users'), async (req, res) => {
  try {
    const user = await db.prepare('SELECT id, role, email FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });

    const isPrimaryAdmin = isPrimaryAdminUser(user);
    const requesterCanDeleteAdmins = canDeleteAdminUsers(req.user);

    if (user.role === 'admin' && !requesterCanDeleteAdmins) {
      return res.status(403).json({ error: 'لا تملك صلاحية حذف الأدمن' });
    }

    if (Number(req.params.id) === Number(req.user.id) && !isPrimaryAdmin) {
      return res.status(403).json({ error: 'لا يمكنك حذف حسابك الحالي' });
    }

    await db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
    res.json({ message: isPrimaryAdmin ? 'تم حذف الحساب الأساسي بنجاح' : 'تم حذف المستخدم' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'خطأ في الحذف' });
  }
});

router.post('/users/bulk-delete', hasPermission('manage_users'), async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Boolean) : [];
    if (ids.length === 0) return res.status(400).json({ error: 'لم يتم تحديد مستخدمين للحذف' });

    let deletedCount = 0;
    const requesterCanDeleteAdmins = canDeleteAdminUsers(req.user);

    for (const id of ids) {
      const user = await db.prepare('SELECT id, role, email FROM users WHERE id = ?').get(id);
      if (!user) continue;

      const isPrimaryAdmin = isPrimaryAdminUser(user);
      if (user.role === 'admin' && !requesterCanDeleteAdmins) continue;
      if (Number(id) === Number(req.user.id) && !isPrimaryAdmin) continue;

      await db.prepare('DELETE FROM users WHERE id = ?').run(id);
      deletedCount += 1;
    }

    res.json({ message: `تم حذف ${deletedCount} مستخدم`, deletedCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'خطأ في الحذف الجماعي' });
  }
});

router.put('/users/:id/password', hasPermission('manage_users'), async (req, res) => {
  try {
    const bcrypt = require('bcryptjs');
    const { password } = req.body;
    if (!password || password.length < 6) return res.status(400).json({ error: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' });
    const user = await db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
    const hashed = await bcrypt.hash(password, 10);
    await db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashed, req.params.id);
    res.json({ message: 'تم تحديث كلمة المرور بنجاح' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'خطأ في تحديث كلمة المرور' });
  }
});

// ===== REQUESTS =====
router.get('/requests', hasPermission('view_all_requests'), async (req, res) => {
  try {
    const requests = await db.prepare(`
      SELECT r.*, u.name as user_name, u.phone as user_phone,
             fe.name as funding_entity_name, fe.whatsapp_number as fe_whatsapp
      FROM requests r
      LEFT JOIN users u ON r.user_id = u.id
      LEFT JOIN funding_entities fe ON r.funding_entity_id = fe.id
      ORDER BY r.updated_at DESC
    `).all();
    res.json((requests || []).map(parseRequestRow));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'خطأ في استرجاع الطلبات' });
  }
});

router.get('/requests/:id', hasPermission('view_all_requests'), async (req, res) => {
  try {
    const request = await db.prepare(`
            SELECT r.*, u.name as user_name, u.phone as user_phone, u.email as user_email,
              fe.name as funding_entity_name, fe.whatsapp_number as fe_whatsapp,
              fe.required_documents as fe_required_docs
      FROM requests r
      LEFT JOIN users u ON r.user_id = u.id
      LEFT JOIN funding_entities fe ON r.funding_entity_id = fe.id
      WHERE r.id = ?
    `).get(req.params.id);
    if (!request) return res.status(404).json({ error: 'الطلب غير موجود' });
    await ensureRequestDocuments(req.params.id, request);
    const [bankStatements, accountStatements, taxDocuments, documents, statusHistory] = await Promise.all([
      db.prepare('SELECT * FROM bank_statements WHERE request_id = ? ORDER BY uploaded_at').all(req.params.id),
      db.prepare('SELECT * FROM account_statements WHERE request_id = ? ORDER BY id').all(req.params.id),
      db.prepare('SELECT * FROM tax_documents WHERE request_id = ? ORDER BY id').all(req.params.id),
      db.prepare('SELECT * FROM request_documents WHERE request_id = ? ORDER BY id').all(req.params.id),
      db.prepare(`SELECT sh.*, u.name as created_by_name FROM status_history sh
        LEFT JOIN users u ON sh.created_by = u.id
        WHERE sh.request_id = ? ORDER BY sh.created_at DESC`).all(req.params.id),
    ]);
    let analysisResult = {};
    try { analysisResult = JSON.parse(request.analysis_result || '{}'); } catch (e) {}
    res.json({ ...parseRequestRow(request), analysis_result: analysisResult, bank_statements: bankStatements, account_statements: accountStatements, tax_documents: taxDocuments, documents, status_history: statusHistory });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'خطأ' });
  }
});

router.put('/requests/:id/status', hasPermission('update_request_status'), async (req, res) => {
  try {
    const { status, note, rejection_reason } = req.body;
    const validStatuses = ['draft','bank_uploaded','analyzing','analyzed','docs_pending','docs_ready',
      'contract_submitted','forms_ready','forms_sent','file_submitted','missing','missing_submitted',
      'contract_received','submitted','approved','transferred','fees_received','rejected'];
    if (!validStatuses.includes(status)) return res.status(400).json({ error: 'حالة غير صحيحة' });
    const request = await db.prepare('SELECT id, user_id, company_name FROM requests WHERE id = ?').get(req.params.id);
    if (!request) return res.status(404).json({ error: 'الطلب غير موجود' });
    if (status === 'rejected' && rejection_reason) {
      await db.prepare("UPDATE requests SET status = ?, rejection_reason = ?, updated_at = NOW() WHERE id = ?")
        .run(status, rejection_reason, req.params.id);
    } else {
      await db.prepare("UPDATE requests SET status = ?, updated_at = NOW() WHERE id = ?").run(status, req.params.id);
    }
    await db.prepare('INSERT INTO status_history (request_id, status, note, created_by) VALUES (?, ?, ?, ?)')
      .run(req.params.id, status, note || rejection_reason || null, req.user.id);

    const statusLabels = {
      draft: 'مسودة',
      bank_uploaded: 'كشف مرفوع',
      analyzing: 'قيد التحليل',
      analyzed: 'تم التحليل',
      docs_pending: 'وثائق ناقصة',
      docs_ready: 'الوثائق جاهزة',
      contract_submitted: 'العقد مُرسل',
      forms_ready: 'النماذج جاهزة',
      forms_sent: 'النماذج مرسلة',
      file_submitted: 'الملف مقدم',
      missing: 'نواقص',
      missing_submitted: 'تم استكمال النواقص',
      contract_received: 'تم استلام العقد',
      submitted: 'تم تقديمه للجهة',
      approved: 'تمت الموافقة',
      transferred: 'تم التحويل',
      fees_received: 'تم استلام العمولة',
      rejected: 'مرفوض',
    };

    await createNotification(request.user_id, {
      type: status === 'rejected' ? 'warning' : status === 'approved' || status === 'fees_received' ? 'success' : 'update',
      title: `تحديث على طلب ${request.company_name}`,
      body: `${statusLabels[status] || status}${note || rejection_reason ? ` - ${note || rejection_reason}` : ''}`,
      link: `/requests?view=${request.id}`,
    });
    res.json({ message: 'تم تحديث حالة الطلب' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'خطأ في تحديث الحالة' });
  }
});

router.post('/requests/:id/send-missing', hasPermission('send_missing_docs'), async (req, res) => {
  try {
    const { missing_items, note } = req.body;
    if (!missing_items || !Array.isArray(missing_items) || missing_items.length === 0)
      return res.status(400).json({ error: 'قائمة النواقص مطلوبة' });
    const request = await db.prepare('SELECT id, user_id, company_name FROM requests WHERE id = ?').get(req.params.id);
    if (!request) return res.status(404).json({ error: 'الطلب غير موجود' });
    for (const item of missing_items) {
      await db.prepare("INSERT INTO request_documents (request_id, document_name, status) VALUES (?, ?, 'missing')").run(req.params.id, item);
    }
    await db.prepare("UPDATE requests SET status = 'missing', updated_at = NOW() WHERE id = ?").run(req.params.id);
    await db.prepare('INSERT INTO status_history (request_id, status, note, created_by) VALUES (?, ?, ?, ?)')
      .run(req.params.id, 'missing', `نواقص مطلوبة: ${missing_items.join('، ')}${note ? ' - ' + note : ''}`, req.user.id);

    await createNotification(request.user_id, {
      type: 'warning',
      title: `نواقص مطلوبة لطلب ${request.company_name}`,
      body: `${missing_items.join('، ')}${note ? ` - ${note}` : ''}`,
      link: `/requests?view=${request.id}`,
    });
    res.json({ message: 'تم إرسال النواقص للموظف' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'خطأ في إرسال النواقص' });
  }
});

router.get('/missing-requests', hasPermission('send_missing_docs'), async (req, res) => {
  try {
    const missingByType = await db.prepare(`
      SELECT 'employees' as type, COUNT(DISTINCT r.user_id) as count, COUNT(r.id) as total_requests
      FROM requests r WHERE r.status = 'missing'
      UNION ALL
      SELECT 'partners' as type, COUNT(DISTINCT u.id) as count, COUNT(r.id) as total_requests
      FROM requests r LEFT JOIN users u ON r.user_id = u.id
      WHERE r.status = 'missing' AND u.role IN ('partner', 'company')
    `).all();
    res.json({ by_type: missingByType });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'خطأ في تحميل البيانات' });
  }
});

router.get('/missing-recipients/:type', hasPermission('send_missing_docs'), async (req, res) => {
  try {
    const { type } = req.params;
    let query;
    if (type === 'employees') {
      query = `SELECT DISTINCT u.id, u.name, u.phone, u.email, u.role, COUNT(r.id) as missing_count
        FROM users u LEFT JOIN requests r ON u.id = r.user_id AND r.status = 'missing'
        WHERE u.role = 'employee' GROUP BY u.id HAVING COUNT(r.id) > 0 ORDER BY u.name`;
    } else if (type === 'partners') {
      query = `SELECT DISTINCT u.id, u.name, u.phone, u.email, u.role, u.partner_type, COUNT(r.id) as missing_count
        FROM users u LEFT JOIN requests r ON u.id = r.user_id AND r.status = 'missing'
        WHERE u.role IN ('partner', 'company') GROUP BY u.id HAVING COUNT(r.id) > 0 ORDER BY u.name`;
    } else {
      return res.status(400).json({ error: 'نوع غير صحيح' });
    }
    const recipients = await db.prepare(query).all();
    res.json(recipients);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'خطأ في تحميل البيانات' });
  }
});

router.get('/missing-requests/:userId', hasPermission('send_missing_docs'), async (req, res) => {
  try {
    const requests = await db.prepare(`
      SELECT r.*, u.name as user_name, u.phone as user_phone, fe.name as funding_entity_name
      FROM requests r LEFT JOIN users u ON r.user_id = u.id
      LEFT JOIN funding_entities fe ON r.funding_entity_id = fe.id
      WHERE r.user_id = ? AND r.status = 'missing' ORDER BY r.updated_at DESC
    `).all(req.params.userId);
    const enriched = await Promise.all(requests.map(async (r) => {
      const docs = await db.prepare("SELECT document_name FROM request_documents WHERE request_id = ? AND status = 'missing'").all(r.id);
      return { ...r, missing_documents: docs.map(d => d.document_name) };
    }));
    res.json(enriched);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'خطأ في تحميل البيانات' });
  }
});

router.post('/send-missing-alert', hasPermission('send_missing_docs'), async (req, res) => {
  try {
    const { recipient_id, request_id, missing_items, message, phone_number } = req.body;
    if (!recipient_id || !request_id || !missing_items || !phone_number)
      return res.status(400).json({ error: 'بيانات ناقصة' });
    if (!Array.isArray(missing_items))
      return res.status(400).json({ error: 'قائمة النواقص يجب أن تكون مصفوفة' });
    const [request, recipient] = await Promise.all([
      db.prepare('SELECT * FROM requests WHERE id = ?').get(request_id),
      db.prepare('SELECT * FROM users WHERE id = ?').get(recipient_id),
    ]);
    if (!request) return res.status(404).json({ error: 'الطلب غير موجود' });
    if (!recipient) return res.status(404).json({ error: 'المستخدم غير موجود' });
    const result = await db.prepare(`
      INSERT INTO missing_items_alerts (request_id, recipient_id, recipient_type, missing_items, message, phone_number, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(request_id, recipient_id, recipient.role === 'employee' ? 'employee' : 'partner',
      JSON.stringify(missing_items), message || '', phone_number, req.user.id);
    if (request.status !== 'missing') {
      await db.prepare("UPDATE requests SET status = 'missing', updated_at = NOW() WHERE id = ?").run(request_id);
    }
    res.json({
      message: 'تم تسجيل إرسال النواقص بنجاح',
      alert_id: result.lastInsertRowid,
      whatsapp_url: `https://wa.me/${phone_number.replace(/\D/g, '')}?text=${encodeURIComponent(message || '')}`
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'خطأ: ' + err.message });
  }
});

router.get('/pending-missing-alerts', hasPermission('send_missing_docs'), async (req, res) => {
  try {
    const pending = await db.prepare(`
      SELECT a.*, u.name as recipient_name, r.company_name, r.status as request_status,
        EXTRACT(EPOCH FROM NOW() - a.alert_sent_at)::INTEGER / 3600 as hours_elapsed
      FROM missing_items_alerts a
      LEFT JOIN users u ON a.recipient_id = u.id
      LEFT JOIN requests r ON a.request_id = r.id
      WHERE a.is_completed = 0 AND EXTRACT(EPOCH FROM NOW() - a.alert_sent_at) / 86400 >= 1
      ORDER BY a.alert_sent_at ASC
    `).all();
    res.json(pending);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'خطأ في تحميل البيانات' });
  }
});

router.post('/missing-alerts/:alertId/complete', hasPermission('send_missing_docs'), async (req, res) => {
  try {
    const alert = await db.prepare('SELECT * FROM missing_items_alerts WHERE id = ?').get(req.params.alertId);
    if (!alert) return res.status(404).json({ error: 'التنبيه غير موجود' });
    await db.prepare("UPDATE missing_items_alerts SET is_completed = 1, completed_at = NOW() WHERE id = ?").run(req.params.alertId);
    const missingDocs = await db.prepare("SELECT COUNT(*) as c FROM request_documents WHERE request_id = ? AND status = 'missing'").get(alert.request_id);
    if (missingDocs.c === 0) {
      await db.prepare("UPDATE requests SET status = 'file_submitted', updated_at = NOW() WHERE id = ?").run(alert.request_id);
    }
    res.json({ message: 'تم تحديث حالة التنبيه' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'خطأ' });
  }
});

router.post('/missing-alerts/:alertId/send-reminder', hasPermission('send_missing_docs'), async (req, res) => {
  try {
    const alert = await db.prepare('SELECT * FROM missing_items_alerts WHERE id = ?').get(req.params.alertId);
    if (!alert) return res.status(404).json({ error: 'التنبيه غير موجود' });
    await db.prepare("UPDATE missing_items_alerts SET reminder_sent_at = NOW() WHERE id = ?").run(req.params.alertId);
    res.json({
      message: 'تم تسجيل إرسال التذكير',
      whatsapp_url: `https://wa.me/${alert.phone_number.replace(/\D/g, '')}?text=${encodeURIComponent('تذكير: يرجى إكمال النواقص المطلوبة في أقرب وقت')}`
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'خطأ' });
  }
});

router.post('/requests/:id/assign-funding', hasPermission('send_to_funding'), async (req, res) => {
  try {
    const { funding_entity_id, contact_id, note } = req.body;
    if (!funding_entity_id) return res.status(400).json({ error: 'الجهة التمويلية مطلوبة' });
    const [request, entity] = await Promise.all([
      db.prepare('SELECT id, user_id, company_name, complete_file_path, complete_file_name FROM requests WHERE id = ?').get(req.params.id),
      db.prepare('SELECT id, name, whatsapp_number FROM funding_entities WHERE id = ?').get(funding_entity_id),
    ]);
    if (!request) return res.status(404).json({ error: 'الطلب غير موجود' });
    if (!entity) return res.status(404).json({ error: 'الجهة التمويلية غير موجودة' });
    let contactName = null;
    if (contact_id) {
      const contact = await db.prepare('SELECT name FROM funding_entity_contacts WHERE id = ?').get(contact_id);
      contactName = contact?.name || null;
    }
    await db.prepare("UPDATE requests SET funding_entity_id = ?, status = 'submitted', updated_at = NOW() WHERE id = ?")
      .run(funding_entity_id, req.params.id);
    const historyNote = [`تم إرسال الطلب إلى ${entity.name}`, contactName ? `المسؤول: ${contactName}` : null, note || null].filter(Boolean).join(' | ');
    await db.prepare('INSERT INTO status_history (request_id, status, note, created_by) VALUES (?, ?, ?, ?)')
      .run(req.params.id, 'submitted', historyNote, req.user.id);
    await createNotification(request.user_id, {
      type: 'update',
      title: `تم إرسال طلب ${request.company_name} للجهة التمويلية`,
      body: historyNote,
      link: `/requests?view=${request.id}`,
    });

    const packageUrl = request.complete_file_path
      ? `${req.protocol}://${req.get('host')}/uploads/${request.complete_file_path.replace(/\\/g, '/').split('/uploads/').pop()}`
      : null;
    const whatsappNumber = String(entity.whatsapp_number || '').replace(/\D/g, '');
    const whatsappUrl = whatsappNumber
      ? `https://wa.me/${whatsappNumber}?text=${encodeURIComponent([`مرحباً، تم إرسال طلب ${request.company_name} إليكم.`, packageUrl ? `رابط الملف المضغوط: ${packageUrl}` : null, note || null].filter(Boolean).join('\n'))}`
      : null;

    res.json({
      message: `تم إرسال الطلب إلى ${entity.name}`,
      whatsapp_url: whatsappUrl,
      package_url: packageUrl,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'خطأ في الإرسال: ' + err.message });
  }
});

// ===== FUNDING ENTITIES =====
router.get('/funding-entities', hasAnyPermission(['manage_funding', 'send_to_funding']), async (req, res) => {
  try {
    const entities = await db.prepare('SELECT * FROM funding_entities ORDER BY priority DESC').all();
    res.json(entities.map(e => ({
      ...e,
      annual_deposit_amount: Number(e.annual_deposit_amount ?? e.min_deposit_transfer_amount ?? e.min_deposit_amount ?? e.min_pos_amount ?? 0),
      product_types: JSON.parse(e.product_types || '[]'),
      required_documents: JSON.parse(e.required_documents || '[]'),
      additional_whatsapp_numbers: JSON.parse(e.additional_whatsapp_numbers || '[]')
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'خطأ في استرجاع الجهات التمويلية' });
  }
});

router.post('/funding-entities', hasPermission('manage_funding'), async (req, res) => {
  try {
    const { name, priority, min_pos_amount, min_deposit_amount, min_transfer_amount, min_months,
      annual_deposit_amount, required_documents, notes, whatsapp_number, additional_whatsapp_numbers, product_types } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'اسم الجهة مطلوب' });
    const normalizedAnnualDeposit = annual_deposit_amount ?? min_deposit_amount ?? min_pos_amount ?? 0;
    const result = await db.prepare(`
      INSERT INTO funding_entities (name, priority, min_pos_amount, min_deposit_amount, min_transfer_amount,
        min_months, required_documents, notes, whatsapp_number, additional_whatsapp_numbers, product_types, min_deposit_transfer_amount, annual_deposit_amount)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(name.trim(), priority || 0, min_pos_amount || 0, min_deposit_amount || 0, min_transfer_amount || 0,
      min_months || 6, JSON.stringify(required_documents || []), notes || '', whatsapp_number || '',
      JSON.stringify(additional_whatsapp_numbers || []), JSON.stringify(product_types || []), normalizedAnnualDeposit || 0, normalizedAnnualDeposit || 0);
    res.status(201).json({ id: result.lastInsertRowid, message: 'تمت إضافة الجهة التمويلية' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'خطأ في الإضافة' });
  }
});

router.put('/funding-entities/:id', hasPermission('manage_funding'), async (req, res) => {
  try {
    const entity = await db.prepare('SELECT * FROM funding_entities WHERE id = ?').get(req.params.id);
    if (!entity) return res.status(404).json({ error: 'الجهة غير موجودة' });
    const { name, priority, min_pos_amount, min_deposit_amount, min_transfer_amount, min_months,
      annual_deposit_amount, required_documents, notes, whatsapp_number, additional_whatsapp_numbers, product_types, is_active } = req.body;
    const normalizedAnnualDeposit = annual_deposit_amount ?? min_deposit_amount ?? min_pos_amount ?? entity.annual_deposit_amount ?? entity.min_deposit_transfer_amount ?? 0;
    await db.prepare(`UPDATE funding_entities SET name=?, priority=?, min_pos_amount=?, min_deposit_amount=?,
      min_transfer_amount=?, min_months=?, required_documents=?, notes=?, whatsapp_number=?,
      additional_whatsapp_numbers=?, product_types=?, min_deposit_transfer_amount=?, annual_deposit_amount=?, is_active=?, updated_at=NOW() WHERE id=?`
    ).run(name ?? entity.name, priority ?? entity.priority,
      min_pos_amount ?? entity.min_pos_amount, min_deposit_amount ?? entity.min_deposit_amount,
      min_transfer_amount ?? entity.min_transfer_amount, min_months ?? entity.min_months,
      required_documents ? JSON.stringify(required_documents) : entity.required_documents,
      notes ?? entity.notes, whatsapp_number ?? entity.whatsapp_number,
      additional_whatsapp_numbers ? JSON.stringify(additional_whatsapp_numbers) : entity.additional_whatsapp_numbers,
      product_types ? JSON.stringify(product_types) : entity.product_types,
      normalizedAnnualDeposit,
      normalizedAnnualDeposit,
      is_active !== undefined ? (is_active ? 1 : 0) : entity.is_active, req.params.id);
    res.json({ message: 'تم تحديث الجهة التمويلية' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'خطأ في التحديث' });
  }
});

router.delete('/funding-entities/:id', hasPermission('manage_funding'), async (req, res) => {
  try {
    await db.prepare('DELETE FROM funding_entities WHERE id = ?').run(req.params.id);
    res.json({ message: 'تم حذف الجهة التمويلية' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'خطأ في الحذف' });
  }
});

router.post('/funding-entities/bulk-delete', hasPermission('manage_funding'), async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Boolean) : [];
    if (ids.length === 0) return res.status(400).json({ error: 'لم يتم تحديد جهات تمويلية للحذف' });

    let deletedCount = 0;

    for (const id of ids) {
      const entity = await db.prepare('SELECT id FROM funding_entities WHERE id = ?').get(id);
      if (!entity) continue;
      await db.prepare('DELETE FROM funding_entities WHERE id = ?').run(id);
      deletedCount += 1;
    }

    res.json({ message: `تم حذف ${deletedCount} جهة تمويلية`, deletedCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'خطأ في الحذف الجماعي' });
  }
});

// ===== STATS =====
router.get('/stats', adminMiddleware, async (req, res) => {
  try {
    const [total, pending, fileSubmitted, approved, feesReceived, missing] = await Promise.all([
      db.prepare('SELECT COUNT(*) as c FROM requests').get(),
      db.prepare("SELECT COUNT(*) as c FROM users WHERE status='pending'").get(),
      db.prepare("SELECT COUNT(*) as c FROM requests WHERE status='file_submitted'").get(),
      db.prepare("SELECT COUNT(*) as c FROM requests WHERE status='approved'").get(),
      db.prepare("SELECT COUNT(*) as c FROM requests WHERE status='fees_received'").get(),
      db.prepare("SELECT COUNT(*) as c FROM requests WHERE status='missing'").get(),
    ]);
    res.json({ totalRequests: total.c, pendingUsers: pending.c, fileSubmitted: fileSubmitted.c, approved: approved.c, feesReceived: feesReceived.c, missing: missing.c });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'خطأ في الإحصائيات' });
  }
});

router.get('/employees-with-requests', adminMiddleware, async (req, res) => {
  try {
    const employees = await db.prepare(`
      SELECT u.id as user_id, u.name as user_name, u.phone as user_phone, u.role, u.partner_type,
        COUNT(r.id) as active_requests_count
      FROM users u
      LEFT JOIN requests r ON u.id = r.user_id AND r.status NOT IN ('approved','fees_received','rejected')
      WHERE u.role IN ('employee','partner','company') AND u.status='approved'
      GROUP BY u.id HAVING COUNT(r.id) > 0 ORDER BY u.name
    `).all();
    const result = await Promise.all(employees.map(async (emp) => {
      const requests = await db.prepare(`
        SELECT r.id, r.company_name, r.owner_name, r.owner_phone, r.status, r.funding_type, r.updated_at,
          fe.name as funding_entity_name, fe.whatsapp_number as fe_whatsapp
        FROM requests r LEFT JOIN funding_entities fe ON r.funding_entity_id = fe.id
        WHERE r.user_id = ? AND r.status NOT IN ('approved','fees_received','rejected')
        ORDER BY r.updated_at DESC
      `).all(emp.user_id);
      return { ...emp, requests };
    }));
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'خطأ في تحميل البيانات' });
  }
});

router.get('/pending-alerts', adminMiddleware, async (req, res) => {
  try {
    const [missingAlerts, pendingAlerts] = await Promise.all([
      db.prepare(`
        SELECT r.id as request_id, r.company_name, r.owner_name, r.owner_phone, r.status, r.updated_at, r.funding_type,
          u.id as user_id, u.name as user_name, u.phone as user_phone, u.role as user_role,
          EXTRACT(EPOCH FROM NOW() - r.updated_at)::INTEGER / 3600 as hours_elapsed,
          'missing' as alert_type, fe.name as funding_entity_name
        FROM requests r LEFT JOIN users u ON r.user_id=u.id LEFT JOIN funding_entities fe ON r.funding_entity_id=fe.id
        WHERE r.status='missing' ORDER BY r.updated_at ASC
      `).all(),
      db.prepare(`
        SELECT r.id as request_id, r.company_name, r.owner_name, r.owner_phone, r.status, r.updated_at, r.funding_type,
          u.id as user_id, u.name as user_name, u.phone as user_phone, u.role as user_role,
          EXTRACT(EPOCH FROM NOW() - r.updated_at)::INTEGER / 3600 as hours_elapsed,
          'pending' as alert_type, fe.name as funding_entity_name
        FROM requests r LEFT JOIN users u ON r.user_id=u.id LEFT JOIN funding_entities fe ON r.funding_entity_id=fe.id
        WHERE r.status IN ('docs_pending','forms_sent','file_submitted','bank_uploaded','analyzed')
          AND EXTRACT(EPOCH FROM NOW() - r.updated_at)/86400 >= 1
        ORDER BY r.updated_at ASC
      `).all(),
    ]);
    const enrichedMissing = await Promise.all(missingAlerts.map(async (a) => {
      const [lastAlert, missingDocs] = await Promise.all([
        db.prepare("SELECT alert_sent_at, reminder_sent_at FROM missing_items_alerts WHERE request_id=? AND is_completed=0 ORDER BY created_at DESC LIMIT 1").get(a.request_id),
        db.prepare("SELECT document_name FROM request_documents WHERE request_id=? AND status='missing'").all(a.request_id),
      ]);
      return { ...a, last_alert_sent: lastAlert?.reminder_sent_at || lastAlert?.alert_sent_at || null, missing_documents: missingDocs.map(d => d.document_name) };
    }));
    res.json({ total: missingAlerts.length + pendingAlerts.length, missing: enrichedMissing, pending: pendingAlerts });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'خطأ في تحميل التنبيهات' });
  }
});

router.post('/dismiss-alert/:requestId', adminMiddleware, async (req, res) => {
  try {
    const existing = await db.prepare("SELECT id FROM missing_items_alerts WHERE request_id=? AND is_completed=0 ORDER BY created_at DESC LIMIT 1").get(req.params.requestId);
    if (existing) {
      await db.prepare("UPDATE missing_items_alerts SET reminder_sent_at=NOW() WHERE id=?").run(existing.id);
    } else {
      const reqRow = await db.prepare('SELECT user_id, owner_phone FROM requests WHERE id=?').get(req.params.requestId);
      if (reqRow) {
        await db.prepare("INSERT INTO missing_items_alerts (request_id, recipient_id, recipient_type, phone_number, created_by, reminder_sent_at) VALUES (?,?,'employee',?,?,NOW())")
          .run(req.params.requestId, reqRow.user_id, reqRow.owner_phone || '', req.user.id);
      }
    }
    res.json({ message: 'تم تسجيل إرسال التذكير' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'خطأ: ' + err.message });
  }
});

// ===== PERMISSIONS =====
router.post('/permissions/reset', adminMiddleware, async (req, res) => {
  try {
    const defaultPermissions = [
      { key: 'view_all_requests',     label: 'عرض جميع الطلبات',           description: 'يستطيع رؤية طلبات جميع الموظفين والشركاء',       category: 'الطلبات' },
      { key: 'update_request_status', label: 'تحديث حالة الطلبات',          description: 'يستطيع تغيير حالة أي طلب',                      category: 'الطلبات' },
      { key: 'send_missing_docs',     label: 'إرسال نواقص للموظف',          description: 'يستطيع طلب مستندات ناقصة من الموظف',            category: 'الطلبات' },
      { key: 'send_to_funding',       label: 'إرسال الملف للجهة التمويلية', description: 'يظهر له زر الإرسال عبر واتساب للجهة التمويلية', category: 'الإرسال' },
      { key: 'send_to_employee',      label: 'التواصل مع الموظف بالواتساب', description: 'يستطيع الضغط على زر واتساب الموظف',            category: 'الإرسال' },
      { key: 'create_requests',       label: 'إنشاء الطلبات',               description: 'يستطيع إنشاء طلب جديد من الواجهة',            category: 'الطلبات' },
      { key: 'delete_requests',       label: 'حذف الطلبات',                 description: 'يستطيع حذف الطلبات نهائياً أو اعتماد حذفها',   category: 'الطلبات' },
      { key: 'approve_users',         label: 'الموافقة على المستخدمين',      description: 'يستطيع تفعيل أو حظر المستخدمين الجدد',         category: 'المستخدمون' },
      { key: 'manage_users',          label: 'إدارة المستخدمين',            description: 'يستطيع إنشاء وتعديل وحذف المستخدمين غير الأدمن', category: 'المستخدمون' },
      { key: 'manage_user_permissions', label: 'إدارة صلاحيات المستخدمين', description: 'يستطيع منح وسحب الصلاحيات للمستخدمين',        category: 'المستخدمون' },
      { key: 'delete_admins',         label: 'حذف الأدمن',                description: 'يستطيع حذف حسابات الأدمن بما فيها الأدمن الأساسي', category: 'المستخدمون' },
      { key: 'manage_funding',        label: 'إدارة الجهات التمويلية',       description: 'يستطيع إضافة وتعديل وحذف الجهات التمويلية',    category: 'الجهات التمويلية' },
      { key: 'manage_settings',       label: 'الوصول للإعدادات',             description: 'يستطيع تعديل إعدادات المنصة والذكاء الاصطناعي', category: 'الإعدادات' },
      { key: 'manage_establishments', label: 'إدارة المنشآت',               description: 'يستطيع عرض وإضافة وتعديل وحذف المنشآت',        category: 'المنشآت' },
      { key: 'view_attendance_admin', label: 'عرض سجل الحضور',              description: 'يستطيع مشاهدة سجلات حضور الموظفين',           category: 'الحضور' },
      { key: 'delete_attendance_records', label: 'حذف سجلات الحضور',       description: 'يستطيع حذف سجلات حضور الموظفين',              category: 'الحضور' },
      { key: 'view_performance',      label: 'عرض تحليل الأداء',            description: 'يستطيع مشاهدة تقارير أداء الموظفين',          category: 'التقارير' },
      { key: 'view_reports',          label: 'عرض التقارير',                description: 'يستطيع مشاهدة التقارير والتحليلات',            category: 'التقارير' },
    ];
    for (const p of defaultPermissions) {
      await db.prepare('INSERT INTO permissions (key, label, description, category) VALUES (?,?,?,?) ON CONFLICT (key) DO NOTHING')
        .run(p.key, p.label, p.description, p.category);
    }
    const allPerms = await db.prepare('SELECT * FROM permissions ORDER BY category, label').all();
    res.json({ message: 'تم إعادة تهيئة الصلاحيات', count: allPerms.length, permissions: allPerms });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'خطأ في إعادة التهيئة: ' + err.message });
  }
});

router.get('/permissions', hasPermission('manage_user_permissions'), async (req, res) => {
  try {
    const permissions = await db.prepare('SELECT * FROM permissions ORDER BY category, label').all();
    res.json(permissions);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'خطأ في استرجاع الصلاحيات' });
  }
});

router.post('/permissions', adminMiddleware, async (req, res) => {
  try {
    const { key, label, description, category } = req.body;
    if (!key || !label) return res.status(400).json({ error: 'المفتاح والاسم مطلوبان' });
    if (!/^[a-z_]+$/.test(key)) return res.status(400).json({ error: 'المفتاح يجب أن يكون بالإنجليزية وشرطات سفلية فقط' });
    const existing = await db.prepare('SELECT id FROM permissions WHERE key = ?').get(key);
    if (existing) return res.status(409).json({ error: 'هذه الصلاحية موجودة بالفعل' });
    const result = await db.prepare('INSERT INTO permissions (key, label, description, category) VALUES (?,?,?,?)')
      .run(key, label, description || '', category || 'عام');
    res.status(201).json({ id: result.lastInsertRowid, message: 'تم إضافة الصلاحية' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'خطأ في الإضافة' });
  }
});

router.delete('/permissions/:key', adminMiddleware, async (req, res) => {
  try {
    await db.prepare('DELETE FROM user_permissions WHERE permission_key = ?').run(req.params.key);
    await db.prepare('DELETE FROM permissions WHERE key = ?').run(req.params.key);
    res.json({ message: 'تم حذف الصلاحية' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'خطأ في الحذف' });
  }
});

router.get('/users/:id/permissions', hasPermission('manage_user_permissions'), async (req, res) => {
  try {
    const user = await db.prepare('SELECT id, name, role, revoked_permissions FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
    const [allPermissions, userPerms] = await Promise.all([
      db.prepare('SELECT * FROM permissions ORDER BY category, label').all(),
      db.prepare('SELECT permission_key FROM user_permissions WHERE user_id = ?').all(req.params.id),
    ]);
    const userPermKeys = userPerms.map(p => p.permission_key);
    const revokedPermissions = parseJsonArray(user.revoked_permissions);
    const effectivePermissions = user.role === 'admin'
      ? allPermissions.map(permission => permission.key).filter((key) => !revokedPermissions.includes(key))
      : userPermKeys;
    res.json({ user, all_permissions: allPermissions, user_permissions: effectivePermissions, is_admin: user.role === 'admin', revoked_permissions: revokedPermissions });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'خطأ في استرجاع الصلاحيات' });
  }
});

router.put('/users/:id/permissions', hasPermission('manage_user_permissions'), async (req, res) => {
  try {
    const { permissions } = req.body;
    if (!Array.isArray(permissions)) return res.status(400).json({ error: 'قائمة صلاحيات غير صالحة' });
    const user = await db.prepare('SELECT role FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
    if (user.role === 'admin') {
      const allPermissions = await db.prepare('SELECT key FROM permissions').all();
      const allKeys = allPermissions.map(permission => permission.key);
      const revokedPermissions = allKeys.filter((key) => !permissions.includes(key));
      await db.prepare('UPDATE users SET revoked_permissions = ? WHERE id = ?').run(JSON.stringify(revokedPermissions), req.params.id);
    } else {
      await db.prepare('DELETE FROM user_permissions WHERE user_id = ?').run(req.params.id);
      for (const key of permissions) {
        await db.prepare('INSERT INTO user_permissions (user_id, permission_key, granted_by) VALUES (?,?,?)').run(req.params.id, key, req.user.id);
      }
      await db.prepare('UPDATE users SET revoked_permissions = ? WHERE id = ?').run('[]', req.params.id);
    }
    res.json({ message: 'تم تحديث صلاحيات المستخدم' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'خطأ في تحديث الصلاحيات' });
  }
});

router.get('/users/:id/permissions-summary', hasPermission('manage_user_permissions'), async (req, res) => {
  try {
    const user = await db.prepare('SELECT id, role, revoked_permissions FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
    const allPermissions = await db.prepare('SELECT key, label, category FROM permissions ORDER BY category, label').all();
    if (user.role === 'admin') {
      const revokedPermissions = parseJsonArray(user.revoked_permissions);
      res.json(allPermissions.map((permission) => ({
        ...permission,
        is_revoked: revokedPermissions.includes(permission.key),
      })));
      return;
    }

    const perms = await db.prepare(`
      SELECT p.key, p.label, p.category, up.granted_at
      FROM user_permissions up JOIN permissions p ON up.permission_key=p.key
      WHERE up.user_id=? ORDER BY p.category
    `).all(req.params.id);
    res.json(perms);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'خطأ' });
  }
});

// ===== DELETE REQUESTS =====
router.get('/delete-requests', hasPermission('delete_requests'), async (req, res) => {
  try {
    const requests = await db.prepare(`
      SELECT r.id, r.company_name, r.owner_name, r.owner_phone, r.entity_type, r.delete_reason, r.updated_at,
        u.name as user_name, u.phone as user_phone
      FROM requests r LEFT JOIN users u ON r.user_id=u.id
      WHERE r.status='delete_requested' ORDER BY r.updated_at DESC
    `).all();
    res.json(requests);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'خطأ' });
  }
});

router.post('/requests/:id/approve-delete', hasPermission('delete_requests'), async (req, res) => {
  try {
    const request = await db.prepare("SELECT * FROM requests WHERE id=? AND status='delete_requested'").get(req.params.id);
    if (!request) return res.status(404).json({ error: 'الطلب غير موجود أو لم يُطلب حذفه' });
    await db.prepare('DELETE FROM requests WHERE id=?').run(req.params.id);
    res.json({ message: 'تم حذف الطلب بنجاح بعد الموافقة' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'خطأ في حذف الطلب' });
  }
});

router.post('/requests/:id/reject-delete', hasPermission('delete_requests'), async (req, res) => {
  try {
    const request = await db.prepare('SELECT * FROM requests WHERE id=?').get(req.params.id);
    if (!request) return res.status(404).json({ error: 'الطلب غير موجود' });
    const { restore_status = 'draft', guidance } = req.body;
    if (!guidance || !guidance.trim()) return res.status(400).json({ error: 'يرجى كتابة التوجيهات للموظف' });
    await db.prepare("UPDATE requests SET status=?, updated_at=NOW() WHERE id=?").run(restore_status, req.params.id);
    await db.prepare('INSERT INTO status_history (request_id, status, note, created_by) VALUES (?,?,?,?)')
      .run(req.params.id, restore_status, `رُفض طلب الحذف — توجيهات المدير:\n${guidance.trim()}`, req.user.id);
    res.json({ message: 'تم رفض طلب الحذف وإرسال التوجيهات' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'خطأ' });
  }
});

// ===== BROKERS =====
router.get('/brokers', adminMiddleware, async (req, res) => {
  try {
    const brokers = await db.prepare(`
      SELECT b.*, u.name as added_by_name, u.role as added_by_role
      FROM brokers b LEFT JOIN users u ON b.added_by_id=u.id
      ORDER BY b.created_at DESC
    `).all();
    res.json(brokers);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'خطأ في استرجاع الوسطاء' });
  }
});

// ===== CONTRACTS =====
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const contractStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../uploads/contracts');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`);
  }
});
const contractUploadAdmin = multer({ storage: contractStorage, limits: { fileSize: 20 * 1024 * 1024 } });

router.get('/contracts', adminMiddleware, async (req, res) => {
  try {
    const contracts = await db.prepare(`
      SELECT c.*, r.company_name, r.entity_type, r.funding_type,
        fe.name as funding_entity_name, u.name as uploaded_by_name, u.role as uploaded_by_role
      FROM contracts c LEFT JOIN requests r ON c.request_id=r.id
      LEFT JOIN funding_entities fe ON r.funding_entity_id=fe.id
      LEFT JOIN users u ON c.uploaded_by=u.id
      ORDER BY c.created_at DESC
    `).all();
    res.json(contracts);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'خطأ في استرجاع العقود' });
  }
});

router.get('/contracts/request/:requestId', adminMiddleware, async (req, res) => {
  try {
    const contracts = await db.prepare(`
      SELECT c.*, u.name as uploaded_by_name FROM contracts c
      LEFT JOIN users u ON c.uploaded_by=u.id
      WHERE c.request_id=? ORDER BY c.created_at DESC
    `).all(req.params.requestId);
    res.json(contracts);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'خطأ' });
  }
});

router.post('/requests/:id/send-forms', adminMiddleware, async (req, res) => {
  try {
    const request = await db.prepare('SELECT * FROM requests WHERE id=?').get(req.params.id);
    if (!request) return res.status(404).json({ error: 'الطلب غير موجود' });
    await db.prepare("UPDATE requests SET status='forms_ready', updated_at=NOW() WHERE id=?").run(req.params.id);
    await db.prepare('INSERT INTO status_history (request_id, status, note, created_by) VALUES (?,?,?,?)')
      .run(req.params.id, 'forms_ready', 'تم إرسال النماذج للموظف من قِبل المدير', req.user.id);
    res.json({ message: 'تم إرسال النماذج للموظف بنجاح' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'خطأ' });
  }
});

router.post('/requests/:id/upload-funding-contract', adminMiddleware, contractUploadAdmin.single('file'), async (req, res) => {
  try {
    const request = await db.prepare('SELECT * FROM requests WHERE id=?').get(req.params.id);
    if (!request) return res.status(404).json({ error: 'الطلب غير موجود' });
    if (!req.file) return res.status(400).json({ error: 'لم يتم رفع أي ملف' });
    await db.prepare('INSERT INTO contracts (request_id, contract_type, file_path, file_name, uploaded_by, notes) VALUES (?,?,?,?,?,?)')
      .run(req.params.id, 'funding', req.file.path, req.file.originalname, req.user.id, req.body.notes || null);
    await db.prepare("UPDATE requests SET funding_contract_path=?, funding_contract_name=?, status='contract_received', updated_at=NOW() WHERE id=?")
      .run(req.file.path, req.file.originalname, req.params.id);
    await db.prepare('INSERT INTO status_history (request_id, status, note, created_by) VALUES (?,?,?,?)')
      .run(req.params.id, 'contract_received', 'تم استلام عقد التمويل وحفظه من قِبل المدير', req.user.id);
    res.json({ message: 'تم رفع عقد التمويل بنجاح' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'خطأ في رفع عقد التمويل' });
  }
});

// ===== PERFORMANCE =====
router.get('/performance', hasPermission('view_performance'), async (req, res) => {
  try {
    const { month } = req.query;
    let dateFilter = '';
    const filterParams = [];
    if (month) { dateFilter = "AND TO_CHAR(r.created_at,'YYYY-MM')=?"; filterParams.push(month); }
    const users = await db.prepare(`SELECT id, name, role, partner_type, phone, status, created_at
      FROM users WHERE role IN ('employee','partner') AND status='approved' ORDER BY role, name`).all();
    const result = await Promise.all(users.map(async (u) => {
      const allReqs = await db.prepare(`SELECT id, status, created_at, updated_at, company_name, funding_type
        FROM requests WHERE user_id=? ${dateFilter}`).all(u.id, ...filterParams);
      const statusGroups = {
        draft:       allReqs.filter(r => ['draft','bank_uploaded'].includes(r.status)).length,
        in_progress: allReqs.filter(r => ['analyzing','analyzed','docs_pending','docs_ready','contract_submitted','forms_ready','forms_sent','file_submitted','missing_submitted','contract_received'].includes(r.status)).length,
        submitted:   allReqs.filter(r => r.status === 'submitted').length,
        approved:    allReqs.filter(r => ['approved','transferred','fees_received'].includes(r.status)).length,
        missing:     allReqs.filter(r => r.status === 'missing').length,
        rejected:    allReqs.filter(r => r.status === 'rejected').length,
        total:       allReqs.length,
      };
      const attendanceMonth = month || new Date().toISOString().slice(0, 7);
      const [attRow, brokersRow, missingRow] = await Promise.all([
        db.prepare("SELECT COUNT(*) as c FROM attendance WHERE user_id=? AND TO_CHAR(date::date,'YYYY-MM')=?").get(u.id, attendanceMonth),
        db.prepare(`SELECT COUNT(*) as c FROM brokers WHERE added_by_id=?${month ? " AND TO_CHAR(created_at,'YYYY-MM')=?" : ''}`).get(u.id, ...(month ? [month] : [])),
        db.prepare("SELECT COUNT(*) as c FROM requests WHERE user_id=? AND status='missing'").get(u.id),
      ]);
      const conversionRate = statusGroups.total > 0 ? Math.round((statusGroups.approved / statusGroups.total) * 100) : 0;
      const lastReq = allReqs.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))[0];
      return {
        ...u,
        stats: { ...statusGroups, attendance_days: attRow.c, brokers_added: brokersRow.c, missing_pending: missingRow.c, conversion_rate: conversionRate },
        last_request: lastReq ? { company: lastReq.company_name, status: lastReq.status, date: lastReq.updated_at } : null,
      };
    }));
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'خطأ في جلب بيانات الأداء: ' + err.message });
  }
});

router.get('/performance/:userId', hasPermission('view_performance'), async (req, res) => {
  try {
    const { month } = req.query;
    const user = await db.prepare('SELECT id, name, role, partner_type, phone, status, created_at FROM users WHERE id=?').get(req.params.userId);
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
    let dateFilter = '';
    const params = [user.id];
    if (month) { dateFilter = "AND TO_CHAR(r.created_at,'YYYY-MM')=?"; params.push(month); }
    const [requests, monthly, attendance] = await Promise.all([
      db.prepare(`SELECT r.id, r.company_name, r.owner_name, r.status, r.funding_type, r.created_at, r.updated_at, fe.name as funding_entity_name
        FROM requests r LEFT JOIN funding_entities fe ON r.funding_entity_id=fe.id
        WHERE r.user_id=? ${dateFilter} ORDER BY r.updated_at DESC`).all(...params),
      db.prepare(`SELECT TO_CHAR(created_at,'YYYY-MM') as month, COUNT(*) as total,
        SUM(CASE WHEN status IN ('approved','transferred','fees_received') THEN 1 ELSE 0 END) as approved,
        SUM(CASE WHEN status='rejected' THEN 1 ELSE 0 END) as rejected
        FROM requests WHERE user_id=? GROUP BY month ORDER BY month DESC LIMIT 6`).all(user.id),
      db.prepare('SELECT date, check_in, check_out FROM attendance WHERE user_id=? ORDER BY date DESC LIMIT 30').all(user.id),
    ]);
    res.json({ user, requests, monthly, attendance });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'خطأ: ' + err.message });
  }
});

// ===== DASHBOARD STATS =====
router.get('/dashboard-stats', adminMiddleware, async (req, res) => {
  try {
    const now = new Date();
    const thisMonth = now.toISOString().slice(0, 7);
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 7);
    const thisYear = now.getFullYear().toString();

    const [thisRev, lastRev, ytd, pipelineRow, stages, pendingUsersRow, missingDocsRow, overdueRow] = await Promise.all([
      db.prepare("SELECT COALESCE(SUM(commission_amount),0) as r, COUNT(*) as c FROM requests WHERE status='fees_received' AND TO_CHAR(updated_at,'YYYY-MM')=?").get(thisMonth),
      db.prepare("SELECT COALESCE(SUM(commission_amount),0) as r FROM requests WHERE status='fees_received' AND TO_CHAR(updated_at,'YYYY-MM')=?").get(lastMonth),
      db.prepare("SELECT COALESCE(SUM(commission_amount),0) as r, COUNT(*) as c FROM requests WHERE status='fees_received' AND TO_CHAR(updated_at,'YYYY')=?").get(thisYear),
      db.prepare("SELECT COALESCE(SUM(commission_amount),0) as r FROM requests WHERE status NOT IN ('fees_received','rejected') AND commission_amount>0").get(),
      db.prepare("SELECT status, COUNT(*) as count FROM requests GROUP BY status ORDER BY count DESC").all(),
      db.prepare("SELECT COUNT(*) as c FROM users WHERE status='pending'").get(),
      db.prepare("SELECT COUNT(*) as c FROM requests WHERE status='missing'").get(),
      db.prepare("SELECT COUNT(*) as c FROM requests WHERE status IN ('docs_pending','file_submitted','forms_sent','bank_uploaded','analyzed','submitted') AND EXTRACT(EPOCH FROM NOW()-updated_at)/86400>3").get(),
    ]);

    const trendPct = lastRev.r > 0 ? Math.round(((thisRev.r - lastRev.r) / lastRev.r) * 100) : null;

    const topPerformers = await db.prepare(`
      SELECT u.id, u.name, u.role, COUNT(r.id) as total,
        SUM(CASE WHEN r.status IN ('approved','transferred','fees_received') THEN 1 ELSE 0 END) as approved,
        COALESCE(SUM(CASE WHEN r.status='fees_received' THEN r.commission_amount ELSE 0 END),0) as revenue
      FROM users u LEFT JOIN requests r ON u.id=r.user_id AND TO_CHAR(r.created_at,'YYYY-MM')=?
      WHERE u.role IN ('employee','partner') AND u.status='approved'
      GROUP BY u.id ORDER BY approved DESC, total DESC LIMIT 5
    `).all(thisMonth);

    const monthlyTrend = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const m = d.toISOString().slice(0, 7);
      const [rev, newR] = await Promise.all([
        db.prepare("SELECT COALESCE(SUM(commission_amount),0) as r, COUNT(*) as c FROM requests WHERE status='fees_received' AND TO_CHAR(updated_at,'YYYY-MM')=?").get(m),
        db.prepare("SELECT COUNT(*) as c FROM requests WHERE TO_CHAR(created_at,'YYYY-MM')=?").get(m),
      ]);
      monthlyTrend.push({ month: m, revenue: rev.r, closed: rev.c, new_requests: newR.c });
    }

    const [teamTarget, teamActuals, recentRequests] = await Promise.all([
      db.prepare("SELECT COALESCE(SUM(target_requests),0) as tr, COALESCE(SUM(target_approved),0) as ta, COALESCE(SUM(target_revenue),0) as rv FROM targets WHERE month=?").get(thisMonth),
      db.prepare("SELECT COUNT(*) as tr, SUM(CASE WHEN status IN ('approved','transferred','fees_received') THEN 1 ELSE 0 END) as ta, COALESCE(SUM(CASE WHEN status='fees_received' THEN commission_amount ELSE 0 END),0) as rv FROM requests WHERE TO_CHAR(created_at,'YYYY-MM')=?").get(thisMonth),
      db.prepare(`SELECT r.id, r.company_name, r.status, r.funding_type, r.updated_at, r.commission_amount,
        u.name as user_name, fe.name as entity_name
        FROM requests r LEFT JOIN users u ON r.user_id=u.id LEFT JOIN funding_entities fe ON r.funding_entity_id=fe.id
        ORDER BY r.updated_at DESC LIMIT 6`).all(),
    ]);

    res.json({
      revenue: { this_month: thisRev.r, this_month_count: thisRev.c, last_month: lastRev.r, ytd: ytd.r, ytd_count: ytd.c, pipeline: pipelineRow.r, trend_pct: trendPct },
      stages,
      actions: { pending_users: pendingUsersRow.c, missing_docs: missingDocsRow.c, overdue: overdueRow.c },
      top_performers: topPerformers,
      monthly_trend: monthlyTrend,
      targets: { target: teamTarget, actual: teamActuals },
      recent_requests: recentRequests,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ===== REPORTS =====
router.get('/reports', hasPermission('view_reports'), async (req, res) => {
  try {
    const year = req.query.year || new Date().getFullYear().toString();
    const monthly = [];
    for (let m = 1; m <= 12; m++) {
      const month = `${year}-${String(m).padStart(2, '0')}`;
      const [closed, newR, approved] = await Promise.all([
        db.prepare("SELECT COUNT(*) as c, COALESCE(SUM(commission_amount),0) as r FROM requests WHERE status='fees_received' AND TO_CHAR(updated_at,'YYYY-MM')=?").get(month),
        db.prepare("SELECT COUNT(*) as c FROM requests WHERE TO_CHAR(created_at,'YYYY-MM')=?").get(month),
        db.prepare("SELECT COUNT(*) as c FROM requests WHERE status IN ('approved','transferred','fees_received') AND TO_CHAR(updated_at,'YYYY-MM')=?").get(month),
      ]);
      monthly.push({ month, closed: closed.c, revenue: closed.r, new_requests: newR.c, approved: approved.c });
    }
    const [funnel, entities, topUsers, closedDeals] = await Promise.all([
      db.prepare("SELECT status, COUNT(*) as count FROM requests GROUP BY status ORDER BY count DESC").all(),
      db.prepare(`SELECT fe.name, COUNT(r.id) as total_sent,
        SUM(CASE WHEN r.status IN ('approved','transferred','fees_received') THEN 1 ELSE 0 END) as approved,
        COALESCE(SUM(CASE WHEN r.status='fees_received' THEN r.commission_amount ELSE 0 END),0) as revenue
        FROM funding_entities fe LEFT JOIN requests r ON r.funding_entity_id=fe.id
        GROUP BY fe.id HAVING COUNT(r.id)>0 ORDER BY approved DESC LIMIT 10`).all(),
      db.prepare(`SELECT u.name, u.role, COUNT(r.id) as total,
        SUM(CASE WHEN r.status IN ('approved','transferred','fees_received') THEN 1 ELSE 0 END) as approved,
        SUM(CASE WHEN r.status='rejected' THEN 1 ELSE 0 END) as rejected,
        COALESCE(SUM(CASE WHEN r.status='fees_received' THEN r.commission_amount ELSE 0 END),0) as revenue
        FROM users u LEFT JOIN requests r ON u.id=r.user_id AND TO_CHAR(r.created_at,'YYYY')=?
        WHERE u.role IN ('employee','partner') GROUP BY u.id ORDER BY approved DESC, total DESC LIMIT 10`).all(year),
      db.prepare(`SELECT r.id, r.company_name, r.funding_type, r.commission_amount, r.updated_at,
        u.name as user_name, fe.name as entity_name
        FROM requests r LEFT JOIN users u ON r.user_id=u.id LEFT JOIN funding_entities fe ON r.funding_entity_id=fe.id
        WHERE r.status='fees_received' AND TO_CHAR(r.updated_at,'YYYY')=? ORDER BY r.updated_at DESC`).all(year),
    ]);
    res.json({ monthly, funnel, entities, top_users: topUsers, closed_deals: closedDeals });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ===== TARGETS =====
router.get('/targets', adminMiddleware, async (req, res) => {
  try {
    const month = req.query.month || new Date().toISOString().slice(0, 7);
    const users = await db.prepare("SELECT id, name, role FROM users WHERE role IN ('employee','partner') AND status='approved' ORDER BY name").all();
    const result = await Promise.all(users.map(async (u) => {
      const [target, actual] = await Promise.all([
        db.prepare('SELECT * FROM targets WHERE user_id=? AND month=?').get(u.id, month),
        db.prepare(`SELECT COUNT(*) as requests,
          SUM(CASE WHEN status IN ('approved','transferred','fees_received') THEN 1 ELSE 0 END) as approved,
          COALESCE(SUM(CASE WHEN status='fees_received' THEN commission_amount ELSE 0 END),0) as revenue
          FROM requests WHERE user_id=? AND TO_CHAR(created_at,'YYYY-MM')=?`).get(u.id, month),
      ]);
      return { ...u, target: target || { target_requests: 0, target_approved: 0, target_revenue: 0 }, actual };
    }));
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.put('/targets/:userId/:month', adminMiddleware, async (req, res) => {
  try {
    const { target_requests, target_approved, target_revenue } = req.body;
    await db.prepare(`INSERT INTO targets (user_id, month, target_requests, target_approved, target_revenue, created_by)
      VALUES (?,?,?,?,?,?)
      ON CONFLICT(user_id, month) DO UPDATE SET
        target_requests=EXCLUDED.target_requests, target_approved=EXCLUDED.target_approved, target_revenue=EXCLUDED.target_revenue`
    ).run(req.params.userId, req.params.month, target_requests || 0, target_approved || 0, target_revenue || 0, req.user.id);

    await createNotification(req.params.userId, {
      type: 'update',
      title: 'تم تحديث هدفك الشهري',
      body: `الشهر ${req.params.month}: طلبات ${target_requests || 0} - معتمد ${target_approved || 0} - إيراد ${target_revenue || 0}`,
      link: '/dashboard',
    });
    res.json({ message: 'تم حفظ الهدف' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/targets/:userId/:month', adminMiddleware, async (req, res) => {
  try {
    await db.prepare('DELETE FROM targets WHERE user_id=? AND month=?').run(req.params.userId, req.params.month);
    res.json({ message: 'تم حذف الهدف' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.put('/requests/:id/commission', adminMiddleware, async (req, res) => {
  try {
    const amount = parseFloat(req.body.commission_amount);
    if (isNaN(amount) || amount < 0) return res.status(400).json({ error: 'مبلغ غير صالح' });
    await db.prepare('UPDATE requests SET commission_amount=? WHERE id=?').run(amount, req.params.id);
    res.json({ message: 'تم تحديث العمولة', commission_amount: amount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
