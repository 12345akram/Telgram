require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const mysql = require('mysql2/promise');

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
const ADMIN_ID = Number(process.env.ADMIN_ID);

const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME
});

const userStates = {};
const isAdmin = (id) => id === ADMIN_ID;

/* ================= INIT DATABASE ================= */
(async () => {
  try {
    const connection = await db.getConnection();
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
    await connection.query(sql);
    console.log('✅ جميع الجداول جاهزة في قاعدة البيانات!');
    connection.release();
  } catch (err) {
    console.error('❌ خطأ أثناء تهيئة قاعدة البيانات:', err);
  }
})();

/* ================= START BOT ================= */
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;

  await db.query(
    'INSERT IGNORE INTO users (telegram_id, username) VALUES (?,?)',
    [chatId, msg.from.username || 'guest']
  );

  bot.sendMessage(chatId, '👋 مرحبًا بك في المتجر');
  showItems(chatId);
});

/* ================= SHOW ITEMS ================= */
async function showItems(chatId) {
  const [items] = await db.query(
    "SELECT id,title,price FROM items WHERE status='available'"
  );

  if (!items.length) return bot.sendMessage(chatId, '❌ لا توجد منتجات متاحة');

  const keyboard = items.map(i => ([{ text: `${i.title} - $${i.price}`, callback_data: `buy_${i.id}` }]));

  bot.sendMessage(chatId, '🛒 المنتجات:', {
    reply_markup: { inline_keyboard: keyboard }
  });
}

/* ================= ADMIN DASHBOARD ================= */
bot.onText(/\/admin/, async (msg) => {
  const chatId = msg.chat.id;
  if (!isAdmin(chatId)) return bot.sendMessage(chatId, '❌ أنت لست أدمن');

  const keyboard = [
    [{ text: '➕ إضافة عنصر', callback_data: 'admin_add' }],
    [{ text: '✏️ تعديل عنصر', callback_data: 'admin_edit' }],
    [{ text: '❌ حذف عنصر', callback_data: 'admin_delete' }],
    [{ text: '📦 عرض الطلبات', callback_data: 'admin_orders' }]
  ];

  await bot.sendMessage(chatId, '🛠️ لوحة تحكم الأدمن', {
    reply_markup: { inline_keyboard: keyboard }
  });
});

/* ================= CALLBACK HANDLER ================= */
bot.on('callback_query', async (q) => {
  const chatId = q.message.chat.id;
  const data = q.data;

  // -------- CUSTOMER ACTIONS --------
  if (data.startsWith('buy_')) {
    const itemId = data.split('_')[1];
    await db.query('INSERT IGNORE INTO orders (user_id,item_id,payment_status) VALUES (?,?,?)', [chatId, itemId, 'pending']);

    return bot.sendMessage(chatId, 'اختر طريقة الدفع:', {
      reply_markup: {
        inline_keyboard: [
          [{ text: '⭐ Telegram Stars', callback_data: `star_${itemId}` }],
          [{ text: '💳 الدفع اليدوي', callback_data: `manual_${itemId}` }]
        ]
      }
    });
  }

  if (data.startsWith('star_')) {
    const itemId = data.split('_')[1];
    const [[item]] = await db.query("SELECT * FROM items WHERE id=?", [itemId]);

    return bot.sendInvoice({
      chat_id: chatId,
      title: item.title,
      description: 'شراء منتج',
      payload: `pay_${itemId}`,
      currency: 'XTR',
      prices: [{ label: item.title, amount: Number(item.price) }]
    });
  }

  if (data.startsWith('manual_')) {
    const itemId = data.split('_')[1];
    userStates[chatId] = { step: 'receipt', itemId };

    return bot.sendMessage(chatId,
`💳 الدفع اليدوي
📱 المحفظة: 77777777
📸 أرسل صورة الإيصال`,
      { parse_mode: 'Markdown' }
    );
  }

  // -------- ADMIN ACTIONS --------
  if (!isAdmin(chatId)) return;

  // إضافة عنصر
  if (data === 'admin_add') {
    userStates[chatId] = { step: 'add_title' };
    return bot.sendMessage(chatId, '📝 أدخل اسم العنصر:');
  }

  // تعديل عنصر
  if (data === 'admin_edit') {
    const [rows] = await db.query("SELECT * FROM items");
    if (!rows.length) return bot.sendMessage(chatId, 'لا توجد عناصر');

    const keyboard = rows.map(r => [{ text: r.title, callback_data: `edit_${r.id}` }]);
    return bot.sendMessage(chatId, 'اختر العنصر للتعديل:', { reply_markup: { inline_keyboard: keyboard } });
  }

  if (data.startsWith('edit_')) {
    const itemId = data.split('_')[1];
    userStates[chatId] = { step: 'edit_title', itemId };
    return bot.sendMessage(chatId, '📝 أدخل الاسم الجديد للعنصر:');
  }

  // حذف عنصر
  if (data === 'admin_delete') {
    const [rows] = await db.query("SELECT * FROM items");
    if (!rows.length) return bot.sendMessage(chatId, 'لا توجد عناصر');

    const keyboard = rows.map(r => [{ text: r.title, callback_data: `del_${r.id}` }]);
    return bot.sendMessage(chatId, 'اختر العنصر للحذف:', { reply_markup: { inline_keyboard: keyboard } });
  }

  if (data.startsWith('del_')) {
    const itemId = data.split('_')[1];
    await db.query("DELETE FROM items WHERE id=?", [itemId]);
    return bot.sendMessage(chatId, '✅ تم حذف العنصر بنجاح');
  }

  // عرض الطلبات
  if (data === 'admin_orders') {
    const [rows] = await db.query(
      `SELECT o.id,o.user_id,o.item_id,o.payment_status,i.title 
       FROM orders o JOIN items i ON o.item_id=i.id`
    );
    if (!rows.length) return bot.sendMessage(chatId, 'لا توجد طلبات');

    for (const r of rows) {
      const keyboard = [[{ text: '✅ تأكيد الدفع', callback_data: `confirm_${r.user_id}_${r.item_id}` }]];
      await bot.sendMessage(chatId,
`#${r.id} | المستخدم: ${r.user_id} | العنصر: ${r.title} | حالة الدفع: ${r.payment_status}`,
        { reply_markup: { inline_keyboard: keyboard } }
      );
    }
  }

  // تأكيد الدفع
  if (data.startsWith('confirm_')) {
    const [, userId, itemId] = data.split('_');

    await db.query('UPDATE orders SET payment_status="success" WHERE user_id=? AND item_id=?', [userId, itemId]);
    const [[item]] = await db.query('SELECT title,secret_value FROM items WHERE id=?', [itemId]);
    await db.query('UPDATE items SET status="sold" WHERE id=?', [itemId]);

    bot.sendMessage(userId,
`🎉 تم تأكيد الدفع
📦 ${item.title}
🔑 كود التفعيل:
${item.secret_value}`
    );

    bot.answerCallbackQuery(q.id, { text: '✅ تم إرسال كود التفعيل للمستخدم' });
  }
});

/* ================= MESSAGE HANDLER ================= */
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const state = userStates[chatId];
  if (!state) return;

  try {
    // ------------- إضافة عنصر -------------
    if (state.step === 'add_title') {
      state.title = msg.text;
      state.step = 'add_secret';
      return bot.sendMessage(chatId, '🔑 أدخل الكود السري للعنصر:');
    }
    if (state.step === 'add_secret') {
      state.secret = msg.text;
      state.step = 'add_price';
      return bot.sendMessage(chatId, '💲 أدخل السعر:');
    }
    if (state.step === 'add_price') {
      const price = parseFloat(msg.text);
      if (isNaN(price)) return bot.sendMessage(chatId, '❌ السعر غير صالح، أدخل رقم.');
      await db.query('INSERT INTO items (title, secret_value, price) VALUES (?,?,?)', [state.title, state.secret, price]);
      delete userStates[chatId];
      return bot.sendMessage(chatId, '✅ تم إضافة العنصر بنجاح!');
    }

    // ------------- تعديل عنصر -------------
    if (state.step === 'edit_title') {
      state.newTitle = msg.text;
      state.step = 'edit_price';
      return bot.sendMessage(chatId, '💲 أدخل السعر الجديد للعنصر:');
    }
    if (state.step === 'edit_price') {
      const price = parseFloat(msg.text);
      if (isNaN(price)) return bot.sendMessage(chatId, '❌ السعر غير صالح، أدخل رقم.');
      await db.query('UPDATE items SET title=?, price=? WHERE id=?', [state.newTitle, price, state.itemId]);
      delete userStates[chatId];
      return bot.sendMessage(chatId, '✅ تم تعديل العنصر بنجاح!');
    }

    // ------------- دفع يدوي للمستخدم -------------
    if (state.step === 'receipt' && msg.photo) {
      await db.query('UPDATE orders SET payment_status="review" WHERE user_id=? AND item_id=?', [chatId, state.itemId]);
      const photoId = msg.photo[msg.photo.length - 1].file_id;
      await bot.sendPhoto(ADMIN_ID, photoId, {
        caption: `🧾 إيصال جديد\n👤 المستخدم: ${chatId}`,
        reply_markup: { inline_keyboard: [[{ text: '✅ تأكيد الدفع', callback_data: `confirm_${chatId}_${state.itemId}` }]] }
      });
      delete userStates[chatId];
      return bot.sendMessage(chatId, '⏳ بانتظار موافقة الإدارة');
    }
  } catch (err) {
    console.error(err);
    bot.sendMessage(chatId, '❌ حدث خطأ أثناء معالجة الرسالة');
  }
});

/* ================= STARS PAYMENT SUCCESS ================= */
bot.on('successful_payment', async (msg) => {
  const itemId = msg.successful_payment.invoice_payload.split('_')[1];
  await db.query('UPDATE orders SET payment_status="success" WHERE user_id=? AND item_id=?', [msg.chat.id, itemId]);
  const [[item]] = await db.query('SELECT title,secret_value FROM items WHERE id=?', [itemId]);
  await db.query('UPDATE items SET status="sold" WHERE id=?', [itemId]);

  bot.sendMessage(msg.chat.id,
`🎉 تم الدفع بنجاح
🔑 كود التفعيل:
${item.secret_value}`
  );
});

/* ================= PRE-CHECKOUT ================= */
bot.on('pre_checkout_query', q => bot.answerPreCheckoutQuery(q.id, true));
