const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const db = require('../database');
const { authMiddleware } = require('../middleware/authMiddleware');
const { notifyAdmins } = require('../services/notificationService');
const { ensureEmailConfig, sendPasswordResetCodeEmail } = require('../services/emailService');

const router = express.Router();
const jwtSecret = process.env.JWT_SECRET;
const PASSWORD_RESET_CODE_TTL_MINUTES = 10;
const PASSWORD_RESET_MAX_ATTEMPTS = 5;

function isPrimaryAdminEmail(email = '') {
  const primaryAdminEmail = String(process.env.PRIMARY_ADMIN_EMAIL || '').trim().toLowerCase();
  return Boolean(primaryAdminEmail) && String(email || '').trim().toLowerCase() === primaryAdminEmail;
}

function normalizeEmail(value = '') {
  return String(value || '').trim().toLowerCase();
}

function hashResetCode(code = '') {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

function generateResetCode() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

async function findUserForPasswordReset(email) {
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail) {
    return { error: 'بيانات التحقق غير صحيحة' };
  }

  const user = await db.prepare('SELECT id, email, status FROM users WHERE email = ?').get(normalizedEmail);
  if (!user) return { error: 'تعذر التحقق من بيانات الحساب' };
  if (user.status === 'blocked') return { error: 'الحساب محظور. تواصل مع الإدارة.' };

  return { user, normalizedEmail };
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, role, partner_type, phone } = req.body;
    if (!name || !email || !password || !role) return res.status(400).json({ error: 'جميع الحقول المطلوبة يجب ملؤها' });
    if (!['employee', 'partner'].includes(role)) return res.status(400).json({ error: 'نوع الحساب غير صحيح' });
    if (password.length < 8) return res.status(400).json({ error: 'كلمة المرور يجب أن لا تقل عن 8 أحرف' });
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) return res.status(400).json({ error: 'البريد الإلكتروني غير صحيح' });

    const existing = await db.prepare('SELECT id FROM users WHERE email = ?').get(normalizeEmail(email));
    if (existing) return res.status(409).json({ error: 'البريد الإلكتروني مستخدم بالفعل' });

    const hashed = await bcrypt.hash(password, 12);
    const result = await db.prepare(`
      INSERT INTO users (name, email, password, role, partner_type, phone, status)
      VALUES (?, ?, ?, ?, ?, ?, 'pending')
    `).run(name.trim(), normalizeEmail(email), hashed, role, partner_type || null, phone || null);

    await notifyAdmins({
      type: 'general',
      title: 'طلب تسجيل جديد',
      body: `${name.trim()} سجل حساباً جديداً بصفة ${role === 'employee' ? 'موظف' : 'شريك'}`,
      link: '/users',
    });

    res.status(201).json({ message: 'تم التسجيل بنجاح. سيتم مراجعة حسابك من قبل المدير قريباً.', userId: result.lastInsertRowid });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'خطأ في الخادم، حاول مجدداً' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    if (!jwtSecret) return res.status(500).json({ error: 'إعدادات المصادقة غير مكتملة' });
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'البريد وكلمة المرور مطلوبان' });

    const user = await db.prepare('SELECT * FROM users WHERE email = ?').get(normalizeEmail(email));
    if (!user) return res.status(401).json({ error: 'بيانات الدخول غير صحيحة' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'بيانات الدخول غير صحيحة' });

    if (user.status === 'blocked') return res.status(403).json({ error: 'تم حظر حسابك. تواصل مع الإدارة.' });
    if (user.status === 'pending') return res.status(403).json({ error: 'حسابك قيد المراجعة من الإدارة.' });

    const token = jwt.sign(
      { id: user.id, role: user.role },
      jwtSecret,
      { expiresIn: '7d' }
    );

    let permissions;
    if (user.role === 'admin') {
      const allPermissions = (await db.prepare('SELECT key FROM permissions').all()).map(p => p.key);
      const revokedPermissions = Array.isArray(user.revoked_permissions)
        ? user.revoked_permissions
        : (() => { try { return JSON.parse(user.revoked_permissions || '[]'); } catch (_) { return []; } })();
      permissions = isPrimaryAdminEmail(user.email)
        ? allPermissions
        : allPermissions.filter((key) => !revokedPermissions.includes(key));
    } else {
      permissions = (await db.prepare('SELECT permission_key FROM user_permissions WHERE user_id = ?').all(user.id)).map(p => p.permission_key);
    }

    res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role, phone: user.phone, permissions } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

// POST /api/auth/forgot-password/request-code
router.post('/forgot-password/request-code', async (req, res) => {
  try {
    ensureEmailConfig();
    const { email } = req.body;
    const result = await findUserForPasswordReset(email);
    if (result.error) {
      return res.status(result.error.includes('محظور') ? 403 : 400).json({ error: result.error });
    }

    const { user, normalizedEmail } = result;
    const code = generateResetCode();
    const codeHash = hashResetCode(code);

    await db.prepare('DELETE FROM password_reset_codes WHERE user_id = ? AND used_at IS NULL').run(user.id);
    await db.prepare(`
      INSERT INTO password_reset_codes (user_id, code_hash, expires_at, attempts)
      VALUES (?, ?, NOW() + INTERVAL '${PASSWORD_RESET_CODE_TTL_MINUTES} minutes', 0)
    `).run(user.id, codeHash);

    await sendPasswordResetCodeEmail({
      to: normalizedEmail,
      code,
      expiryMinutes: PASSWORD_RESET_CODE_TTL_MINUTES,
    });

    return res.json({ message: 'تم إرسال رمز التحقق إلى بريدك الإلكتروني.' });
  } catch (err) {
    console.error('Forgot password request-code error:', err);
    if (err.code === 'SMTP_NOT_CONFIGURED') {
      return res.status(503).json({ error: 'خدمة البريد غير مهيأة حالياً. أكمل إعدادات SMTP أولاً.' });
    }
    return res.status(500).json({ error: 'خطأ في الخادم، حاول مجدداً' });
  }
});

// POST /api/auth/forgot-password/verify-code
router.post('/forgot-password/verify-code', async (req, res) => {
  try {
    if (!jwtSecret) return res.status(500).json({ error: 'إعدادات المصادقة غير مكتملة' });
    const { email, code } = req.body;
    if (!email || !code) {
      return res.status(400).json({ error: 'البريد والرمز مطلوبان' });
    }

    if (!/^\d{4}$/.test(String(code).trim())) {
      return res.status(400).json({ error: 'رمز التحقق يجب أن يكون 4 أرقام' });
    }

    const result = await findUserForPasswordReset(email);
    if (result.error) {
      return res.status(result.error.includes('محظور') ? 403 : 400).json({ error: result.error });
    }

    const { user } = result;
    const resetRecord = await db.prepare(`
      SELECT * FROM password_reset_codes
      WHERE user_id = ? AND used_at IS NULL AND expires_at > NOW()
      ORDER BY created_at DESC
      LIMIT 1
    `).get(user.id);

    if (!resetRecord) {
      return res.status(400).json({ error: 'الرمز غير موجود أو انتهت صلاحيته. اطلب رمزاً جديداً.' });
    }

    if (Number(resetRecord.attempts || 0) >= PASSWORD_RESET_MAX_ATTEMPTS) {
      await db.prepare('UPDATE password_reset_codes SET used_at = NOW() WHERE id = ?').run(resetRecord.id);
      return res.status(400).json({ error: 'تم تجاوز عدد المحاولات المسموح. اطلب رمزاً جديداً.' });
    }

    const submittedCodeHash = hashResetCode(String(code).trim());
    if (submittedCodeHash !== resetRecord.code_hash) {
      const nextAttempts = Number(resetRecord.attempts || 0) + 1;
      if (nextAttempts >= PASSWORD_RESET_MAX_ATTEMPTS) {
        await db.prepare('UPDATE password_reset_codes SET attempts = ?, used_at = NOW() WHERE id = ?').run(nextAttempts, resetRecord.id);
        return res.status(400).json({ error: 'الرمز غير صحيح وتم إيقافه بعد تكرار المحاولات. اطلب رمزاً جديداً.' });
      }

      await db.prepare('UPDATE password_reset_codes SET attempts = ? WHERE id = ?').run(nextAttempts, resetRecord.id);
      return res.status(400).json({ error: `الرمز غير صحيح. تبقى ${PASSWORD_RESET_MAX_ATTEMPTS - nextAttempts} محاولات.` });
    }

    await db.prepare('UPDATE password_reset_codes SET used_at = NOW() WHERE id = ?').run(resetRecord.id);

    const resetToken = jwt.sign(
      { id: user.id, purpose: 'password-reset' },
      jwtSecret,
      { expiresIn: '10m' }
    );

    return res.json({ message: 'تم التحقق من الرمز بنجاح.', resetToken });
  } catch (err) {
    console.error('Forgot password verify-code error:', err);
    return res.status(500).json({ error: 'خطأ في الخادم، حاول مجدداً' });
  }
});

// POST /api/auth/forgot-password/reset-password
router.post('/forgot-password/reset-password', async (req, res) => {
  try {
    if (!jwtSecret) return res.status(500).json({ error: 'إعدادات المصادقة غير مكتملة' });
    const { resetToken, password } = req.body;
    if (!resetToken || !password) {
      return res.status(400).json({ error: 'رمز الجلسة وكلمة المرور الجديدة مطلوبان' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'كلمة المرور يجب أن لا تقل عن 8 أحرف' });
    }

    let payload;
    try {
      payload = jwt.verify(resetToken, jwtSecret);
    } catch (error) {
      return res.status(400).json({ error: 'جلسة استعادة كلمة المرور غير صالحة أو منتهية' });
    }

    if (payload?.purpose !== 'password-reset' || !payload?.id) {
      return res.status(400).json({ error: 'جلسة استعادة كلمة المرور غير صالحة' });
    }

    const user = await db.prepare('SELECT id, status FROM users WHERE id = ?').get(payload.id);
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
    if (user.status === 'blocked') return res.status(403).json({ error: 'الحساب محظور. تواصل مع الإدارة.' });

    const hashedPassword = await bcrypt.hash(password, 12);
    await db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashedPassword, user.id);

    return res.json({ message: 'تم تحديث كلمة المرور بنجاح. يمكنك تسجيل الدخول الآن.' });
  } catch (err) {
    console.error('Forgot password reset-password error:', err);
    return res.status(500).json({ error: 'خطأ في الخادم، حاول مجدداً' });
  }
});

// GET /api/auth/me
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const user = await db.prepare('SELECT id, name, email, role, partner_type, phone, status FROM users WHERE id = ?').get(req.user.id);
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
    const permissions = user.role === 'admin'
      ? (await db.prepare('SELECT key FROM permissions').all()).map(p => p.key)
      : (await db.prepare('SELECT permission_key FROM user_permissions WHERE user_id = ?').all(user.id)).map(p => p.permission_key);
    res.json({ ...user, permissions });
  } catch (err) {
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

module.exports = router;
