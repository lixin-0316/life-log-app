const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3456;
const JWT_SECRET = process.env.JWT_SECRET || 'sui-shou-ji-secret-' + Math.random().toString(36).slice(2);
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'life-log.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

// ── Database ──
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT UNIQUE,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL DEFAULT 'general',
    title TEXT NOT NULL,
    content TEXT DEFAULT '',
    date TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_records_user_date ON records(user_id, date);
`);

// Migration: add phone column if missing (for existing DBs from v1)
try { db.exec('ALTER TABLE users ADD COLUMN phone TEXT UNIQUE'); } catch(e) {}

// Auto-create admin
const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
if (userCount === 0) {
  const hash = bcrypt.hashSync('admin123', 10);
  db.prepare('INSERT INTO users (phone, username, password_hash, role) VALUES (?, ?, ?, ?)').run(null, 'admin', hash, 'admin');
  console.log('✓ 默认管理员账号: admin / admin123');
}

// ── Verification Code Store (in-memory, 5 min expiry) ──
const codeStore = new Map(); // phone -> { code, expires, attempts }
const CODE_EXPIRY = 5 * 60 * 1000; // 5 minutes
const CODE_MAX_ATTEMPTS = 5;

// Clean expired codes every minute
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of codeStore) { if (v.expires < now) codeStore.delete(k); }
}, 60000);

// ── SMS Sender (dev mode: print to console; prod: replace with real SMS API) ──
async function sendSMS(phone, code) {
  // In development mode, just log to console
  if (process.env.NODE_ENV !== 'production') {
    console.log(`\n📱 [短信验证码] 手机号: ${phone}  验证码: ${code}\n`);
    return true;
  }
  // TODO: Replace with real SMS API (e.g., 阿里云短信 / 腾讯云短信)
  // await aliSMS.send({ phone, template: 'SMS_xxx', params: { code } });
  console.log(`\n📱 [短信验证码] 手机号: ${phone}  验证码: ${code}  (生产环境请替换为真实短信服务)\n`);
  return true;
}

// ── Middleware ──
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: '请先登录' });
  }
  try {
    req.user = jwt.verify(header.slice(7), JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: '登录已过期，请重新登录' });
  }
}

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: '仅管理员可操作' });
  next();
}

// ── Auth Routes ──

// Send verification code
app.post('/api/send-code', (req, res) => {
  const { phone, scene } = req.body; // scene: 'register' | 'reset'
  if (!phone) return res.status(400).json({ error: '请输入手机号' });
  if (!/^1[3-9]\d{9}$/.test(phone)) return res.status(400).json({ error: '手机号格式不正确' });

  // Rate limit: 60s between sends
  const existing = codeStore.get(phone);
  if (existing && (Date.now() - existing.expires + CODE_EXPIRY) < 60000) {
    return res.status(429).json({ error: '请 60 秒后再试' });
  }

  // For registration, check if phone already exists
  if (scene === 'register') {
    const dup = db.prepare('SELECT id FROM users WHERE phone = ?').get(phone);
    if (dup) return res.status(409).json({ error: '该手机号已注册' });
  }
  // For reset, check if phone exists
  if (scene === 'reset') {
    const user = db.prepare('SELECT id FROM users WHERE phone = ?').get(phone);
    if (!user) return res.status(404).json({ error: '该手机号未注册' });
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));
  codeStore.set(phone, { code, expires: Date.now() + CODE_EXPIRY, attempts: 0 });
  sendSMS(phone, code);
  // Dev mode: include code in response for testing
  const devCode = process.env.NODE_ENV === 'production' ? undefined : code;
  res.json({ ok: true, msg: '验证码已发送', devCode });
});

// Register
app.post('/api/register', (req, res) => {
  const { phone, code, password, nickname } = req.body;
  if (!phone || !code || !password) return res.status(400).json({ error: '手机号、验证码和密码不能为空' });
  if (!/^1[3-9]\d{9}$/.test(phone)) return res.status(400).json({ error: '手机号格式不正确' });
  if (password.length < 4) return res.status(400).json({ error: '密码至少 4 位' });

  const dup = db.prepare('SELECT id FROM users WHERE phone = ?').get(phone);
  if (dup) return res.status(409).json({ error: '该手机号已注册' });

  // Verify code
  const stored = codeStore.get(phone);
  if (!stored) return res.status(400).json({ error: '请先获取验证码' });
  if (stored.expires < Date.now()) { codeStore.delete(phone); return res.status(400).json({ error: '验证码已过期' }); }
  stored.attempts++;
  if (stored.attempts > CODE_MAX_ATTEMPTS) { codeStore.delete(phone); return res.status(429).json({ error: '尝试次数过多，请重新获取验证码' }); }
  if (stored.code !== code) return res.status(400).json({ error: '验证码错误' });

  codeStore.delete(phone); // one-time use

  const hash = bcrypt.hashSync(password, 10);
  const username = nickname || ('用户' + phone.slice(-4));
  const result = db.prepare('INSERT INTO users (phone, username, password_hash, role) VALUES (?, ?, ?, ?)').run(phone, username, hash, 'user');
  const token = jwt.sign({ id: result.lastInsertRowid, username, role: 'user' }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user: { id: result.lastInsertRowid, username, role: 'user', phone } });
});

// Login (phone or username)
app.post('/api/login', (req, res) => {
  const { phone, username, password } = req.body;
  if (!password) return res.status(400).json({ error: '请输入密码' });

  let user;
  if (phone) {
    user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
  } else if (username) {
    user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  } else {
    return res.status(400).json({ error: '请输入手机号或用户名' });
  }

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: '手机号或密码错误' });
  }

  const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user: { id: user.id, username: user.username, role: user.role, phone: user.phone } });
});

// Reset password
app.post('/api/reset-password', (req, res) => {
  const { phone, code, password } = req.body;
  if (!phone || !code || !password) return res.status(400).json({ error: '手机号、验证码和新密码不能为空' });
  if (password.length < 4) return res.status(400).json({ error: '新密码至少 4 位' });

  const user = db.prepare('SELECT id FROM users WHERE phone = ?').get(phone);
  if (!user) return res.status(404).json({ error: '该手机号未注册' });

  const stored = codeStore.get(phone);
  if (!stored) return res.status(400).json({ error: '请先获取验证码' });
  if (stored.expires < Date.now()) { codeStore.delete(phone); return res.status(400).json({ error: '验证码已过期' }); }
  stored.attempts++;
  if (stored.attempts > CODE_MAX_ATTEMPTS) { codeStore.delete(phone); return res.status(429).json({ error: '尝试次数过多，请重新获取验证码' }); }
  if (stored.code !== code) return res.status(400).json({ error: '验证码错误' });

  codeStore.delete(phone);
  const hash = bcrypt.hashSync(password, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);
  res.json({ ok: true, msg: '密码重置成功，请使用新密码登录' });
});

app.get('/api/me', auth, (req, res) => {
  const user = db.prepare('SELECT id, username, role, phone FROM users WHERE id = ?').get(req.user.id);
  res.json({ user });
});

// ── Records Routes ──
app.get('/api/records', auth, (req, res) => {
  const { date, type, search, all } = req.query;
  let sql, params;

  if (all === 'true' && req.user.role === 'admin') {
    sql = 'SELECT r.*, u.username FROM records r JOIN users u ON r.user_id = u.id WHERE 1=1';
    params = [];
  } else {
    sql = 'SELECT r.*, u.username FROM records r JOIN users u ON r.user_id = u.id WHERE r.user_id = ?';
    params = [req.user.id];
  }

  if (date) { sql += ' AND r.date = ?'; params.push(date); }
  if (type) { sql += ' AND r.type = ?'; params.push(type); }
  if (search) { sql += ' AND (r.title LIKE ? OR r.content LIKE ?)'; params.push('%'+search+'%', '%'+search+'%'); }

  sql += ' ORDER BY r.date DESC, r.id DESC';
  const records = db.prepare(sql).all(...params);
  res.json({ records });
});

app.post('/api/records', auth, (req, res) => {
  const { type, title, content, date } = req.body;
  if (!title || !date) return res.status(400).json({ error: '标题和日期不能为空' });
  const result = db.prepare('INSERT INTO records (user_id, type, title, content, date) VALUES (?, ?, ?, ?, ?)').run(req.user.id, type || 'general', title, content || '', date);
  const record = db.prepare('SELECT * FROM records WHERE id = ?').get(result.lastInsertRowid);
  res.json({ record });
});

app.put('/api/records/:id', auth, (req, res) => {
  const { id } = req.params;
  const record = db.prepare('SELECT * FROM records WHERE id = ?').get(id);
  if (!record) return res.status(404).json({ error: '记录不存在' });
  if (record.user_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: '无权修改' });
  const { type, title, content, date, done } = req.body;
  db.prepare('UPDATE records SET type=?, title=?, content=?, date=?, done=? WHERE id=?').run(
    type ?? record.type, title ?? record.title, content ?? record.content,
    date ?? record.date, done !== undefined ? (done ? 1 : 0) : record.done, id
  );
  res.json({ record: db.prepare('SELECT * FROM records WHERE id = ?').get(id) });
});

app.delete('/api/records/:id', auth, (req, res) => {
  const { id } = req.params;
  const record = db.prepare('SELECT * FROM records WHERE id = ?').get(id);
  if (!record) return res.status(404).json({ error: '记录不存在' });
  if (record.user_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: '无权删除' });
  db.prepare('DELETE FROM records WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ── Admin: Export / Import ──
app.get('/api/admin/export', auth, adminOnly, (req, res) => {
  const users = db.prepare('SELECT id, phone, username, password_hash, role, created_at FROM users').all();
  const records = db.prepare('SELECT * FROM records').all();
  const data = { version: 1, exportedAt: new Date().toISOString(), users, records };
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename="life-log-backup-' + new Date().toISOString().slice(0,10) + '.json"');
  res.json(data);
});

app.post('/api/admin/import', auth, adminOnly, (req, res) => {
  const { users, records } = req.body;
  if (!users || !records) return res.status(400).json({ error: '无效的备份文件' });
  try {
    db.exec('BEGIN');
    db.prepare('DELETE FROM records').run();
    db.prepare('DELETE FROM users WHERE role != ?').run('admin');
    const insUser = db.prepare('INSERT OR IGNORE INTO users (id, phone, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    for (const u of users) insUser.run(u.id, u.phone, u.username, u.password_hash || '', u.role, u.created_at);
    const insRec = db.prepare('INSERT OR IGNORE INTO records (id, user_id, type, title, content, date, done, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    for (const r of records) insRec.run(r.id, r.user_id, r.type, r.title, r.content || '', r.date, r.done || 0, r.created_at);
    db.exec('COMMIT');
    const n = db.prepare('SELECT COUNT(*) as c FROM records').get().c;
    res.json({ ok: true, msg: '导入成功，共 ' + n + ' 条记录' });
  } catch (e) { db.exec('ROLLBACK'); res.status(500).json({ error: '导入失败：' + e.message }); }
});

app.get('/api/admin/users', auth, adminOnly, (req, res) => {
  const users = db.prepare('SELECT id, phone, username, role, created_at FROM users ORDER BY id').all();
  res.json({ users });
});

// ── Admin Center ──
const crypto = require('crypto');
const ADMIN_PASSWORD = '222316';
const adminTokens = new Map();
const APPS_FILE = path.join(__dirname, 'admin-apps.json');

function loadApps() {
  try { return JSON.parse(fs.readFileSync(APPS_FILE, 'utf-8')); }
  catch { return []; }
}
function saveApps(apps) { fs.writeFileSync(APPS_FILE, JSON.stringify(apps, null, 2), 'utf-8'); }

function adminAuth(req, res, next) {
  const hdr = req.headers.authorization || '';
  const t = hdr.replace('Bearer ', '');
  if (!t || !adminTokens.has(t)) return res.status(401).json({ error: '未登录' });
  next();
}

app.post('/api/admin-center/login', (req, res) => {
  if (req.body.password !== ADMIN_PASSWORD) return res.status(401).json({ error: '密码错误' });
  const token = crypto.randomBytes(32).toString('hex');
  adminTokens.set(token, Date.now() + 24*3600*1000); // 24h expiry
  res.json({ ok: true, token });
});

app.get('/api/admin-center/apps', adminAuth, (req, res) => {
  res.json({ apps: loadApps() });
});

app.post('/api/admin-center/apps', adminAuth, (req, res) => {
  const apps = loadApps();
  const { icon, name, category, description, url } = req.body;
  if (!name || !url) return res.status(400).json({ error: '名称和地址不能为空' });
  const newId = apps.length ? Math.max(...apps.map(a => a.id)) + 1 : 1;
  const app = { id: newId, name, category: category || '其他', description: description || '', url, icon: icon || '📦', createdAt: new Date().toISOString().slice(0,10) };
  apps.push(app);
  saveApps(apps);
  res.json({ ok: true, app });
});

app.put('/api/admin-center/apps/:id', adminAuth, (req, res) => {
  const apps = loadApps();
  const idx = apps.findIndex(a => a.id === parseInt(req.params.id));
  if (idx < 0) return res.status(404).json({ error: '应用不存在' });
  const { icon, name, category, description, url } = req.body;
  if (name !== undefined) apps[idx].name = name;
  if (category !== undefined) apps[idx].category = category;
  if (description !== undefined) apps[idx].description = description;
  if (url !== undefined) apps[idx].url = url;
  if (icon !== undefined) apps[idx].icon = icon;
  saveApps(apps);
  res.json({ ok: true, app: apps[idx] });
});

app.delete('/api/admin-center/apps/:id', adminAuth, (req, res) => {
  const apps = loadApps();
  const idx = apps.findIndex(a => a.id === parseInt(req.params.id));
  if (idx < 0) return res.status(404).json({ error: '应用不存在' });
  apps.splice(idx, 1);
  saveApps(apps);
  res.json({ ok: true });
});

// ── Health ──
app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.listen(PORT, () => {
  console.log(`\n  随手记服务 → http://localhost:${PORT}`);
  console.log(`  管理员账号: admin / admin123`);
  console.log(`  验证码模式: ${process.env.NODE_ENV === 'production' ? '真实短信' : '开发模式（控制台输出）'}\n`);
});
