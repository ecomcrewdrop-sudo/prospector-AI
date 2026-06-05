const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'prospector.db'), { verbose: null });

db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

// ── Tablas core ──────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT,
    status TEXT DEFAULT 'DISCONNECTED',
    isActive INTEGER DEFAULT 1,
    antiBanBaseDelay INTEGER DEFAULT 180,
    antiBanBatchSize INTEGER DEFAULT 5,
    antiBanBatchPause INTEGER DEFAULT 900,
    antiBanIntraDelay INTEGER DEFAULT 25,
    activeSources TEXT DEFAULT 'google_maps',
    lastUsed TEXT DEFAULT CURRENT_TIMESTAMP,
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS prospects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    city TEXT,
    niche TEXT,
    hasWebsite INTEGER DEFAULT 0,
    website TEXT,
    instagram TEXT,
    status TEXT DEFAULT 'new',
    stage TEXT DEFAULT 'new',
    tags TEXT,
    source TEXT DEFAULT 'google_maps',
    score INTEGER DEFAULT 50,
    rating REAL,
    reviews TEXT,
    address TEXT,
    lat REAL,
    lon REAL,
    sessionId TEXT DEFAULT 'session-1',
    lastContactedAt TEXT,
    lastCampaignId TEXT,
    notes TEXT,
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS campaigns (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    nicheFilter TEXT,
    messages TEXT NOT NULL,
    imageUrl TEXT,
    imageCaption TEXT,
    abMessages TEXT,
    sequenceId TEXT,
    status TEXT DEFAULT 'draft',
    sent INTEGER DEFAULT 0,
    failed INTEGER DEFAULT 0,
    repliesCount INTEGER DEFAULT 0,
    totalTargets INTEGER DEFAULT 0,
    dailyLimit INTEGER DEFAULT 80,
    delayBetween INTEGER DEFAULT 180,
    intraDelay INTEGER DEFAULT 25,
    sessionId TEXT DEFAULT 'session-1',
    scheduledAt TEXT,
    startedAt TEXT,
    completedAt TEXT,
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    content TEXT NOT NULL,
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaignId TEXT,
    time TEXT,
    type TEXT,
    msg TEXT,
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS replies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sessionId TEXT,
    fromPhone TEXT,
    prospectId TEXT,
    prospectName TEXT,
    message TEXT,
    timestamp TEXT,
    isRead INTEGER DEFAULT 0,
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS blacklist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT UNIQUE NOT NULL,
    reason TEXT,
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS sequences (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    steps TEXT NOT NULL,
    sessionId TEXT,
    isActive INTEGER DEFAULT 1,
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prospectId TEXT NOT NULL,
    sessionId TEXT,
    type TEXT,
    data TEXT,
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS prospect_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prospectId TEXT NOT NULL,
    sessionId TEXT,
    content TEXT NOT NULL,
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS settings (
    key       TEXT PRIMARY KEY,
    value     TEXT NOT NULL,
    updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
  );
`);


// ── Migraciones seguras ──────────────────────────────────────
const migrations = [
  { table: 'sessions',   col: 'status',           sql: "ALTER TABLE sessions ADD COLUMN status TEXT DEFAULT 'DISCONNECTED'" },
  { table: 'sessions',   col: 'lastUsed',          sql: "ALTER TABLE sessions ADD COLUMN lastUsed TEXT DEFAULT CURRENT_TIMESTAMP" },
  { table: 'sessions',   col: 'antiBanBaseDelay',  sql: "ALTER TABLE sessions ADD COLUMN antiBanBaseDelay INTEGER DEFAULT 180" },
  { table: 'sessions',   col: 'antiBanBatchSize',  sql: "ALTER TABLE sessions ADD COLUMN antiBanBatchSize INTEGER DEFAULT 5" },
  { table: 'sessions',   col: 'antiBanBatchPause', sql: "ALTER TABLE sessions ADD COLUMN antiBanBatchPause INTEGER DEFAULT 900" },
  { table: 'sessions',   col: 'antiBanIntraDelay', sql: "ALTER TABLE sessions ADD COLUMN antiBanIntraDelay INTEGER DEFAULT 25" },
  { table: 'sessions',   col: 'activeSources',     sql: "ALTER TABLE sessions ADD COLUMN activeSources TEXT DEFAULT 'google_maps'" },
  { table: 'prospects',  col: 'email',             sql: "ALTER TABLE prospects ADD COLUMN email TEXT" },
  { table: 'prospects',  col: 'source',            sql: "ALTER TABLE prospects ADD COLUMN source TEXT DEFAULT 'google_maps'" },
  { table: 'prospects',  col: 'score',             sql: "ALTER TABLE prospects ADD COLUMN score INTEGER DEFAULT 50" },
  { table: 'prospects',  col: 'rating',            sql: "ALTER TABLE prospects ADD COLUMN rating REAL" },
  { table: 'prospects',  col: 'reviews',           sql: "ALTER TABLE prospects ADD COLUMN reviews TEXT" },
  { table: 'prospects',  col: 'address',           sql: "ALTER TABLE prospects ADD COLUMN address TEXT" },
  { table: 'prospects',  col: 'website',           sql: "ALTER TABLE prospects ADD COLUMN website TEXT" },
  { table: 'prospects',  col: 'stage',             sql: "ALTER TABLE prospects ADD COLUMN stage TEXT DEFAULT 'new'" },
  { table: 'prospects',  col: 'tags',              sql: "ALTER TABLE prospects ADD COLUMN tags TEXT" },
  { table: 'prospects',  col: 'lat',               sql: "ALTER TABLE prospects ADD COLUMN lat REAL" },
  { table: 'prospects',  col: 'lon',               sql: "ALTER TABLE prospects ADD COLUMN lon REAL" },
  { table: 'campaigns',  col: 'scheduledAt',       sql: "ALTER TABLE campaigns ADD COLUMN scheduledAt TEXT" },
  { table: 'campaigns',  col: 'repliesCount',      sql: "ALTER TABLE campaigns ADD COLUMN repliesCount INTEGER DEFAULT 0" },
  { table: 'campaigns',  col: 'targetIds',         sql: "ALTER TABLE campaigns ADD COLUMN targetIds TEXT" },
  { table: 'campaigns',  col: 'imageUrl',          sql: "ALTER TABLE campaigns ADD COLUMN imageUrl TEXT" },
  { table: 'campaigns',  col: 'imageCaption',      sql: "ALTER TABLE campaigns ADD COLUMN imageCaption TEXT" },
  { table: 'campaigns',  col: 'abMessages',        sql: "ALTER TABLE campaigns ADD COLUMN abMessages TEXT" },
  { table: 'campaigns',  col: 'sequenceId',        sql: "ALTER TABLE campaigns ADD COLUMN sequenceId TEXT" },
];

for (const m of migrations) {
  try {
    const cols = db.prepare(`PRAGMA table_info(${m.table})`).all();
    if (!cols.some(c => c.name === m.col)) db.exec(m.sql);
  } catch (err) {
    console.error(`[DB Migration] ${m.table}.${m.col}:`, err.message);
  }
}

// ── Índices de performance ───────────────────────────────────
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_prospects_session_status ON prospects(sessionId, status);
  CREATE INDEX IF NOT EXISTS idx_prospects_session ON prospects(sessionId);
  CREATE INDEX IF NOT EXISTS idx_prospects_stage ON prospects(sessionId, stage);
  CREATE INDEX IF NOT EXISTS idx_prospects_lat_lon ON prospects(lat, lon);
  CREATE INDEX IF NOT EXISTS idx_campaigns_session ON campaigns(sessionId);
  CREATE INDEX IF NOT EXISTS idx_logs_campaign ON logs(campaignId);
  CREATE INDEX IF NOT EXISTS idx_replies_session ON replies(sessionId);
  CREATE INDEX IF NOT EXISTS idx_replies_phone ON replies(fromPhone);
  CREATE INDEX IF NOT EXISTS idx_activities_prospect ON activities(prospectId);
  CREATE INDEX IF NOT EXISTS idx_notes_prospect ON prospect_notes(prospectId);
  CREATE INDEX IF NOT EXISTS idx_blacklist_phone ON blacklist(phone);
`);

// Sesión por defecto garantizada
if (!db.prepare('SELECT id FROM sessions WHERE id = ?').get('session-1')) {
  db.prepare("INSERT INTO sessions (id, name) VALUES ('session-1', 'Principal')").run();
}

console.log('📦 Database initialized.');
module.exports = db;
