const { Pool, types } = require('pg');
const bcrypt = require('bcryptjs');

const PASSWORD_RESET_CODE_TTL_MINUTES = 10;

// Parse PostgreSQL BIGINT (COUNT(*) returns bigint) as JavaScript integer
types.setTypeParser(20, parseInt);

require('dotenv').config();

const primaryAdminName = (process.env.PRIMARY_ADMIN_NAME || '?????? ???????').trim();
const primaryAdminEmail = (process.env.PRIMARY_ADMIN_EMAIL || '').trim().toLowerCase();
const primaryAdminPassword = process.env.PRIMARY_ADMIN_PASSWORD || '';

const pool = new Pool(
  process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }
    : { ssl: { rejectUnauthorized: false } }
);

// Convert ? placeholders -> $1, $2, ... for PostgreSQL
function toPostgresParams(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

// Flatten spread arguments (handles .all(id, ...arrayParam) pattern)
function flatArgs(args) {
  const out = [];
  for (const a of args) {
    if (Array.isArray(a)) out.push(...a);
    else if (a !== undefined) out.push(a);
  }
  return out;
}

const db = {
  query: (sql, params) => pool.query(sql, params),

  prepare(sql) {
    const pgSQL = toPostgresParams(sql);
    const isInsert = pgSQL.trim().toUpperCase().startsWith('INSERT');
    return {
      all: async (...args) => {
        const params = flatArgs(args);
        const res = await pool.query(pgSQL, params.length ? params : undefined);
        return res.rows;
      },
      get: async (...args) => {
        const params = flatArgs(args);
        const res = await pool.query(pgSQL, params.length ? params : undefined);
        return res.rows[0] || null;
      },
      run: async (...args) => {
        const params = flatArgs(args);
        let finalSQL = pgSQL;
        if (isInsert && !pgSQL.toUpperCase().includes('RETURNING')) {
          finalSQL += ' RETURNING id';
        }
        const res = await pool.query(finalSQL, params.length ? params : undefined);
        return {
          lastInsertRowid: res.rows[0]?.id ?? null,
          changes: res.rowCount
        };
      }
    };
  }
};

// ========== DATABASE INITIALIZATION ==========
async function initDatabase() {
  await pool.query(`CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'employee',
    partner_type TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    phone TEXT,
    last_seen_at TIMESTAMP,
    last_presence_notification_at TIMESTAMP,
    revoked_permissions TEXT DEFAULT '[]',
    created_at TIMESTAMP DEFAULT NOW()
  )`);

  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMP`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_presence_notification_at TIMESTAMP`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS revoked_permissions TEXT DEFAULT '[]'`);

  await pool.query(`CREATE TABLE IF NOT EXISTS permissions (
    id SERIAL PRIMARY KEY,
    key TEXT UNIQUE NOT NULL,
    label TEXT NOT NULL,
    description TEXT,
    category TEXT DEFAULT '???',
    created_at TIMESTAMP DEFAULT NOW()
  )`);

  await pool.query(`CREATE TABLE IF NOT EXISTS user_permissions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    permission_key TEXT NOT NULL,
    granted_by INTEGER NOT NULL,
    granted_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(user_id, permission_key)
  )`);

  await pool.query(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TIMESTAMP DEFAULT NOW()
  )`);

  await pool.query(`CREATE TABLE IF NOT EXISTS funding_entities (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    priority INTEGER DEFAULT 0,
    min_pos_amount REAL DEFAULT 0,
    min_deposit_amount REAL DEFAULT 0,
    min_transfer_amount REAL DEFAULT 0,
    min_deposit_transfer_amount REAL DEFAULT 0,
    annual_deposit_amount REAL DEFAULT 0,
    min_months INTEGER DEFAULT 6,
    product_types TEXT DEFAULT '[]',
    required_documents TEXT DEFAULT '[]',
    notes TEXT,
    whatsapp_number TEXT,
    additional_whatsapp_numbers TEXT DEFAULT '[]',
    is_active INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
  )`);

  await pool.query(`ALTER TABLE funding_entities ADD COLUMN IF NOT EXISTS annual_deposit_amount REAL DEFAULT 0`);
  await pool.query(`
    UPDATE funding_entities
    SET annual_deposit_amount = COALESCE(NULLIF(annual_deposit_amount, 0), min_deposit_transfer_amount, min_deposit_amount, min_pos_amount, 0)
    WHERE annual_deposit_amount IS NULL OR annual_deposit_amount = 0
  `);
  await pool.query(`
    UPDATE funding_entities
    SET min_deposit_transfer_amount = COALESCE(NULLIF(min_deposit_transfer_amount, 0), annual_deposit_amount, min_deposit_amount, min_pos_amount, 0)
    WHERE min_deposit_transfer_amount IS NULL OR min_deposit_transfer_amount = 0
  `);

  await pool.query(`CREATE TABLE IF NOT EXISTS funding_entity_contacts (
    id SERIAL PRIMARY KEY,
    funding_entity_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    phone TEXT,
    product_types TEXT DEFAULT '[]',
    notes TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
  )`);

  await pool.query(`CREATE TABLE IF NOT EXISTS requests (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    company_name TEXT NOT NULL,
    owner_name TEXT,
    owner_phone TEXT,
    entity_type TEXT NOT NULL DEFAULT '????',
    ownership_type TEXT DEFAULT '?????',
    funding_type TEXT DEFAULT '???? ???',
    owners_count TEXT DEFAULT '??? ????',
    status TEXT NOT NULL DEFAULT 'draft',
    rejection_reason TEXT,
    funding_entity_id INTEGER,
    analysis_result TEXT DEFAULT '{}',
    product_details TEXT DEFAULT '{}',
    total_pos REAL DEFAULT 0,
    total_deposit REAL DEFAULT 0,
    total_transfer REAL DEFAULT 0,
    statement_months INTEGER DEFAULT 0,
    notes TEXT,
    funding_amount REAL DEFAULT 0,
    operating_expenses REAL DEFAULT 0,
    net_revenue REAL DEFAULT 0,
    commission_amount REAL DEFAULT 0,
    referred_by_id INTEGER,
    complete_file_path TEXT,
    complete_file_name TEXT,
    delete_reason TEXT,
    consultation_contract_path TEXT,
    consultation_contract_name TEXT,
    funding_contract_path TEXT,
    funding_contract_name TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
  )`);

  await pool.query(`ALTER TABLE requests ADD COLUMN IF NOT EXISTS funding_amount REAL DEFAULT 0`);
  await pool.query(`ALTER TABLE requests ADD COLUMN IF NOT EXISTS operating_expenses REAL DEFAULT 0`);
  await pool.query(`ALTER TABLE requests ADD COLUMN IF NOT EXISTS net_revenue REAL DEFAULT 0`);
  await pool.query(`ALTER TABLE requests ADD COLUMN IF NOT EXISTS commission_amount REAL DEFAULT 0`);

  await pool.query(`CREATE TABLE IF NOT EXISTS companies (
    id SERIAL PRIMARY KEY,
    company_name TEXT NOT NULL,
    entity_type TEXT DEFAULT '????',
    owner_name TEXT,
    owner_phone TEXT,
    request_id INTEGER,
    user_id INTEGER,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
  )`);

  await pool.query(`CREATE TABLE IF NOT EXISTS bank_statements (
    id SERIAL PRIMARY KEY,
    request_id INTEGER NOT NULL,
    file_path TEXT NOT NULL,
    file_name TEXT NOT NULL,
    period_label TEXT DEFAULT '',
    pos_amount REAL DEFAULT 0,
    deposit_amount REAL DEFAULT 0,
    transfer_amount REAL DEFAULT 0,
    analysis_status TEXT DEFAULT 'pending',
    analysis_data TEXT DEFAULT '{}',
    uploaded_at TIMESTAMP DEFAULT NOW()
  )`);

  await pool.query(`CREATE TABLE IF NOT EXISTS accounting_entries (
    id SERIAL PRIMARY KEY,
    entry_type TEXT NOT NULL DEFAULT 'expense',
    category TEXT NOT NULL DEFAULT 'عام',
    label TEXT NOT NULL,
    vendor_name TEXT,
    amount REAL NOT NULL DEFAULT 0,
    entry_month TEXT NOT NULL,
    notes TEXT,
    created_by INTEGER,
    created_at TIMESTAMP DEFAULT NOW()
  )`);

  await pool.query(`CREATE TABLE IF NOT EXISTS accounting_documents (
    id SERIAL PRIMARY KEY,
    entry_id INTEGER,
    document_type TEXT NOT NULL DEFAULT 'invoice',
    vendor_name TEXT,
    amount REAL DEFAULT 0,
    entry_month TEXT,
    file_path TEXT NOT NULL,
    file_name TEXT NOT NULL,
    uploaded_by INTEGER,
    created_at TIMESTAMP DEFAULT NOW()
  )`);

  await pool.query(`CREATE TABLE IF NOT EXISTS documents (
    id SERIAL PRIMARY KEY,
    request_id INTEGER,
    document_type TEXT NOT NULL DEFAULT 'invoice',
    document_number TEXT,
    client_name TEXT,
    company_name TEXT,
    email TEXT,
    issue_month TEXT NOT NULL,
    total_amount REAL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'draft',
    file_path TEXT,
    file_name TEXT,
    notes TEXT,
    sent_via_email INTEGER DEFAULT 0,
    created_by INTEGER,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
  )`);

  await pool.query(`ALTER TABLE documents ADD COLUMN IF NOT EXISTS request_id INTEGER`);

  await pool.query(`CREATE TABLE IF NOT EXISTS document_email_logs (
    id SERIAL PRIMARY KEY,
    document_id INTEGER NOT NULL,
    email TEXT NOT NULL,
    subject TEXT,
    sent_at TIMESTAMP DEFAULT NOW(),
    result TEXT DEFAULT 'sent'
  )`);

  await pool.query(`CREATE TABLE IF NOT EXISTS account_statements (
    id SERIAL PRIMARY KEY,
    request_id INTEGER NOT NULL,
    file_path TEXT NOT NULL,
    file_name TEXT NOT NULL,
    uploaded_at TIMESTAMP DEFAULT NOW()
  )`);

  await pool.query(`CREATE TABLE IF NOT EXISTS tax_documents (
    id SERIAL PRIMARY KEY,
    request_id INTEGER NOT NULL,
    file_path TEXT NOT NULL,
    file_name TEXT NOT NULL,
    uploaded_at TIMESTAMP DEFAULT NOW()
  )`);

  await pool.query(`CREATE TABLE IF NOT EXISTS campaigns (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    message TEXT,
    image_path TEXT,
    status TEXT DEFAULT 'draft',
    sent_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
  )`);

  await pool.query(`CREATE TABLE IF NOT EXISTS request_documents (
    id SERIAL PRIMARY KEY,
    request_id INTEGER NOT NULL,
    document_name TEXT NOT NULL,
    file_path TEXT,
    file_name TEXT,
    expiry_date TEXT,
    status TEXT DEFAULT 'missing',
    uploaded_at TIMESTAMP
  )`);

  await pool.query(`CREATE TABLE IF NOT EXISTS status_history (
    id SERIAL PRIMARY KEY,
    request_id INTEGER NOT NULL,
    status TEXT NOT NULL,
    note TEXT,
    created_by INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
  )`);

  await pool.query(`CREATE TABLE IF NOT EXISTS request_messages (
    id SERIAL PRIMARY KEY,
    request_id INTEGER NOT NULL,
    sender_id INTEGER NOT NULL,
    message TEXT NOT NULL,
    attachment_path TEXT,
    attachment_name TEXT,
    created_at TIMESTAMP DEFAULT NOW()
  )`);

  await pool.query(`ALTER TABLE requests ADD COLUMN IF NOT EXISTS product_details TEXT DEFAULT '{}'`);
  await pool.query(`ALTER TABLE request_messages ADD COLUMN IF NOT EXISTS attachment_path TEXT`);
  await pool.query(`ALTER TABLE request_messages ADD COLUMN IF NOT EXISTS attachment_name TEXT`);

  await pool.query(`CREATE TABLE IF NOT EXISTS message_reads (
    user_id INTEGER NOT NULL,
    request_id INTEGER NOT NULL,
    last_read_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (user_id, request_id)
  )`);

  await pool.query(`CREATE TABLE IF NOT EXISTS missing_items_alerts (
    id SERIAL PRIMARY KEY,
    request_id INTEGER NOT NULL,
    recipient_id INTEGER NOT NULL,
    recipient_type TEXT NOT NULL DEFAULT 'employee',
    alert_type TEXT NOT NULL DEFAULT 'missing_items',
    missing_items TEXT DEFAULT '[]',
    message TEXT,
    phone_number TEXT NOT NULL,
    alert_sent_at TIMESTAMP DEFAULT NOW(),
    reminder_sent_at TIMESTAMP,
    is_completed INTEGER DEFAULT 0,
    completed_at TIMESTAMP,
    created_by INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
  )`);

  await pool.query(`CREATE TABLE IF NOT EXISTS attendance (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    check_in TIMESTAMP,
    check_in_lat REAL,
    check_in_lng REAL,
    check_in_address TEXT,
    check_out TIMESTAMP,
    check_out_lat REAL,
    check_out_lng REAL,
    check_out_address TEXT,
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW()
  )`);

  await pool.query(`CREATE TABLE IF NOT EXISTS targets (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    month TEXT NOT NULL,
    target_requests INTEGER DEFAULT 0,
    target_approved INTEGER DEFAULT 0,
    target_revenue REAL DEFAULT 0,
    created_by INTEGER,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(user_id, month)
  )`);

  await pool.query(`CREATE TABLE IF NOT EXISTS brokers (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    added_by_id INTEGER NOT NULL,
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW()
  )`);

  await pool.query(`CREATE TABLE IF NOT EXISTS contracts (
    id SERIAL PRIMARY KEY,
    request_id INTEGER NOT NULL,
    contract_type TEXT NOT NULL DEFAULT 'consultation',
    file_path TEXT NOT NULL,
    file_name TEXT NOT NULL,
    uploaded_by INTEGER NOT NULL,
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW()
  )`);


  await pool.query(`CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL DEFAULT 'general',
    title TEXT NOT NULL,
    body TEXT,
    link TEXT,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW()
  )`);

  await pool.query(`CREATE TABLE IF NOT EXISTS password_reset_codes (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    code_hash TEXT NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    used_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
  )`);

  await pool.query(`DELETE FROM password_reset_codes WHERE used_at IS NOT NULL OR expires_at < NOW() - INTERVAL '${PASSWORD_RESET_CODE_TTL_MINUTES} minutes'`);

  // ===== Seed default settings =====
  const defaultSettings = [
    ['ai_provider', 'openai'],
    ['ai_model', 'gpt-4o'],
    ['ai_api_key', ''],
    ['platform_name', '???? ???? ??? ???? ???????'],
    ['admin_whatsapp', ''],
  ];
  for (const [key, value] of defaultSettings) {
    await pool.query(
      'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING',
      [key, value]
    );
  }

  // ===== Seed default permissions =====
  const defaultPermissions = [
    { key: 'view_all_requests',    label: '??? ???? ???????',           description: '?????? ???? ????? ???? ???????? ????????',        category: '???????' },
    { key: 'update_request_status',label: '????? ???? ???????',          description: '?????? ????? ???? ?? ???',                       category: '???????' },
    { key: 'send_missing_docs',    label: '????? ????? ??????',          description: '?????? ??? ??????? ????? ?? ??????',             category: '???????' },
    { key: 'send_to_funding',      label: '????? ????? ????? ?????????', description: '???? ?? ?? ??????? ??? ?????? ????? ?????????',  category: '???????' },
    { key: 'send_to_employee',     label: '??????? ?? ?????? ?????????', description: '?????? ????? ??? ?? ?????? ??????',             category: '???????' },
    { key: 'create_requests',      label: 'إنشاء الطلبات',               description: 'يستطيع إنشاء طلب جديد من الواجهة',            category: 'الطلبات' },
    { key: 'delete_requests',      label: 'حذف الطلبات',                 description: 'يستطيع حذف الطلبات نهائياً أو اعتماد حذفها',   category: 'الطلبات' },
    { key: 'approve_users',        label: '???????? ??? ??????????',      description: '?????? ????? ?? ??? ?????????? ?????',          category: '??????????' },
    { key: 'manage_users',         label: 'إدارة المستخدمين',            description: 'يستطيع إنشاء وتعديل وحذف المستخدمين غير الأدمن', category: 'المستخدمون' },
    { key: 'manage_user_permissions', label: 'إدارة صلاحيات المستخدمين', description: 'يستطيع منح وسحب الصلاحيات للمستخدمين',        category: 'المستخدمون' },
    { key: 'delete_admins',        label: 'حذف الأدمن',                  description: 'يستطيع حذف حسابات الأدمن بما فيها الأدمن الأساسي', category: 'المستخدمون' },
    { key: 'manage_funding',       label: '????? ?????? ?????????',       description: '?????? ????? ?????? ???? ?????? ?????????',     category: '?????? ?????????' },
    { key: 'manage_settings',      label: '?????? ?????????',             description: '?????? ????? ??????? ?????? ??????? ?????????', category: '?????????' },
    { key: 'manage_establishments',label: 'إدارة المنشآت',               description: 'يستطيع عرض وإضافة وتعديل وحذف المنشآت',        category: 'المنشآت' },
    { key: 'view_attendance_admin',label: 'عرض سجل الحضور',              description: 'يستطيع مشاهدة سجلات حضور الموظفين',           category: 'الحضور' },
    { key: 'delete_attendance_records', label: 'حذف سجلات الحضور',       description: 'يستطيع حذف سجلات حضور الموظفين',              category: 'الحضور' },
    { key: 'view_performance',     label: 'عرض تحليل الأداء',            description: 'يستطيع مشاهدة تقارير أداء الموظفين',          category: 'التقارير' },
    { key: 'view_reports',         label: 'عرض التقارير',                description: 'يستطيع مشاهدة التقارير والتحليلات',            category: 'التقارير' },
  ];
  for (const p of defaultPermissions) {
    await pool.query(
      'INSERT INTO permissions (key, label, description, category) VALUES ($1, $2, $3, $4) ON CONFLICT (key) DO NOTHING',
      [p.key, p.label, p.description, p.category]
    );
  }

  // ===== Seed or sync primary admin user from environment =====
  const adminCheck = await pool.query("SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1");
  if (primaryAdminEmail && primaryAdminPassword) {
    const hashed = await bcrypt.hash(primaryAdminPassword, 12);
    if (adminCheck.rows.length === 0) {
      await pool.query(
        "INSERT INTO users (name, email, password, role, status) VALUES ($1, $2, $3, 'admin', 'approved')",
        [primaryAdminName, primaryAdminEmail, hashed]
      );
    } else {
      await pool.query(
        "UPDATE users SET name = $1, email = $2, password = $3, status = 'approved' WHERE id = $4",
        [primaryAdminName, primaryAdminEmail, hashed, adminCheck.rows[0].id]
      );
    }
    console.log(`? ?? ????? ???? ?????? ???????: ${primaryAdminEmail}`);
  } else if (adminCheck.rows.length === 0) {
    console.warn('?? ?? ??? ????? ???? ???? ??????? ??? PRIMARY_ADMIN_EMAIL ?? PRIMARY_ADMIN_PASSWORD ??? ???????');
  }

  // ===== Seed default funding entities =====
  const defaultEntities = [
    { name: '???? ???????',            priority: 1, product_types: '["???? ???", "???", "?????", "??????? ??????"]' },
    { name: '?????',                   priority: 2, product_types: '["???? ???"]' },
    { name: '???? ?????? ???????',     priority: 3, product_types: '["???? ???", "???", "?????"]' },
    { name: '???? ?????',              priority: 4, product_types: '["???"]' },
    { name: '??? ???',                 priority: 5, product_types: '["??????"]' },
    { name: '???? ??????? ???????',    priority: 6, product_types: '["???? ???", "??????"]' },
    { name: '???? ??????? ???????',    priority: 7, product_types: '["???", "??? ?????", "??? ?????? ??????"]' },
  ];
  for (const e of defaultEntities) {
    const exists = await pool.query('SELECT id FROM funding_entities WHERE name = $1', [e.name]);
    if (exists.rows.length === 0) {
      await pool.query(
        'INSERT INTO funding_entities (name, priority, product_types, min_deposit_transfer_amount, annual_deposit_amount, whatsapp_number) VALUES ($1, $2, $3, 0, 0, $4)',
        [e.name, e.priority, e.product_types, '']
      );
    }
  }

  console.log('? ????? ?????? Supabase PostgreSQL ?????');
}

db.initDatabase = initDatabase;
module.exports = db;
