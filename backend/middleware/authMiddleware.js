const jwt = require('jsonwebtoken');
const db = require('../database');

const jwtSecret = process.env.JWT_SECRET;

function isPrimaryAdminEmail(email = '') {
  const primaryAdminEmail = String(process.env.PRIMARY_ADMIN_EMAIL || '').trim().toLowerCase();
  return Boolean(primaryAdminEmail) && String(email || '').trim().toLowerCase() === primaryAdminEmail;
}

const authMiddleware = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'غير مصرح - يرجى تسجيل الدخول' });
  }
  const token = authHeader.split(' ')[1];
  try {
    if (!jwtSecret) return res.status(500).json({ error: 'إعدادات المصادقة غير مكتملة' });
    const decoded = jwt.verify(token, jwtSecret);
    const user = await db.prepare('SELECT id, name, email, role, status, phone, revoked_permissions FROM users WHERE id = ?').get(decoded.id);
    if (!user) return res.status(401).json({ error: 'المستخدم غير موجود' });
    if (user.status === 'blocked') return res.status(403).json({ error: 'تم حظر حسابك. تواصل مع الإدارة.' });
    if (user.status === 'pending') return res.status(403).json({ error: 'حسابك قيد المراجعة من الإدارة.' });

    // Load user permissions (admins have all permissions)
    if (user.role === 'admin') {
      const allPerms = await db.prepare('SELECT key FROM permissions').all();
      const revokedPermissions = Array.isArray(user.revoked_permissions)
        ? user.revoked_permissions
        : (() => { try { return JSON.parse(user.revoked_permissions || '[]'); } catch (_) { return []; } })();
      user.permissions = isPrimaryAdminEmail(user.email)
        ? allPerms.map(p => p.key)
        : allPerms.map(p => p.key).filter((key) => !revokedPermissions.includes(key));
    } else {
      const perms = await db.prepare('SELECT permission_key FROM user_permissions WHERE user_id = ?').all(user.id);
      user.permissions = perms.map(p => p.permission_key);
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'الجلسة منتهية، يرجى تسجيل الدخول مجدداً' });
  }
};

const adminMiddleware = async (req, res, next) => {
  await authMiddleware(req, res, () => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'هذه الصفحة للمدير فقط' });
    }
    next();
  });
};

// Check specific permission (admin always passes)
const hasPermission = (permKey) => (req, res, next) => {
  authMiddleware(req, res, () => {
    if (req.user.role === 'admin' || req.user.permissions.includes(permKey)) {
      return next();
    }
    return res.status(403).json({ error: 'ليس لديك صلاحية للقيام بهذه العملية' });
  });
};

const hasAnyPermission = (permKeys = []) => (req, res, next) => {
  authMiddleware(req, res, () => {
    if (req.user.role === 'admin') {
      return next();
    }
    if (permKeys.some((permKey) => req.user.permissions.includes(permKey))) {
      return next();
    }
    return res.status(403).json({ error: 'ليس لديك صلاحية للقيام بهذه العملية' });
  });
};

module.exports = { authMiddleware, adminMiddleware, hasPermission, hasAnyPermission };
