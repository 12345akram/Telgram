require('dotenv').config();
const mysql = require('mysql2/promise');

(async () => {
  try {
    const db = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME
    });

    const sql = `
    CREATE TABLE IF NOT EXISTS users (
      telegram_id BIGINT NOT NULL PRIMARY KEY,
      username VARCHAR(100),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS items (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      secret_value VARCHAR(255),
      price DECIMAL(10,2),
      status ENUM('available','sold') DEFAULT 'available'
    );
    CREATE TABLE IF NOT EXISTS orders (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT NOT NULL,
      item_id INT NOT NULL,
      payment_status ENUM('pending','review','success') DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    `;
    await db.query(sql);
    console.log('✅ جميع الجداول جاهزة!');
    process.exit(0);
  } catch (err) {
    console.error('❌ خطأ في إنشاء الجداول:', err);
    process.exit(1);
  }
})();
