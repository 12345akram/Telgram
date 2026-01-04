const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// ملف قاعدة البيانات
const dbPath = path.join(__dirname, 'database.sqlite');

// الاتصال
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('❌ فشل الاتصال بقاعدة البيانات', err);
  } else {
    console.log('✅ تم الاتصال بـ SQLite بنجاح');
  }
});

// إنشاء الجداول
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id INTEGER UNIQUE,
      username TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      secret_value TEXT,
      price REAL,
      status TEXT DEFAULT 'available',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      item_id INTEGER,
      payment_status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log('✅ تم إنشاء الجداول بنجاح');
});

module.exports = db;
