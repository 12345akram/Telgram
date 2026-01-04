require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const db = require('./database');

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
const ADMIN_ID = Number(process.env.ADMIN_ID);

const userStates = {};
const isAdmin = (id) => id === ADMIN_ID;

/* ================= START ================= */
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;

  db.run(
    'INSERT OR IGNORE INTO users (telegram_id, username) VALUES (?,?)',
    [chatId, msg.from.username || 'guest']
  );

  bot.sendMessage(chatId, '👋 مرحبًا بك في المتجر');
  showItems(chatId);
});

/* ================= SHOW ITEMS ================= */
function showItems(chatId) {
  db.all(
    "SELECT id,title,price FROM items WHERE status='available'",
    [],
    (err, items) => {
      if (err) return console.error(err);

      if (!items.length) {
        return bot.sendMessage(chatId, '❌ لا توجد منتجات متاحة حاليًا.');
      }

      const keyboard = items.map(i => ([
        { text: `${i.title} - $${i.price}`, callback_data: `buy_${i.id}` }
      ]));

      bot.sendMessage(chatId, '🛒 المنتجات المتاحة:', {
        reply_markup: { inline_keyboard: keyboard }
      });
    }
  );
}

/* ================= ADMIN ================= */
bot.onText(/\/admin/, (msg) => {
  const chatId = msg.chat.id;
  if (!isAdmin(chatId)) return bot.sendMessage(chatId, '❌ لست أدمن');

  const keyboard = [
    [{ text: '➕ إضافة عنصر', callback_data: 'admin_add' }],
    [{ text: '✏️ تعديل عنصر', callback_data: 'admin_edit' }],
    [{ text: '❌ حذف عنصر', callback_data: 'admin_delete' }],
    [{ text: '📦 الطلبات', callback_data: 'admin_orders' }]
  ];

  bot.sendMessage(chatId, '🛠️ لوحة التحكم', {
    reply_markup: { inline_keyboard: keyboard }
  });
});

/* ================= CALLBACK ================= */
bot.on('callback_query', (q) => {
  const chatId = q.message.chat.id;
  const data = q.data;

  /* -------- BUY -------- */
  if (data.startsWith('buy_')) {
    const itemId = data.split('_')[1];

    db.run(
      'INSERT INTO orders (user_id,item_id,payment_status) VALUES (?,?,?)',
      [chatId, itemId, 'pending']
    );

    return bot.sendMessage(chatId, 'اختر طريقة الدفع:', {
      reply_markup: {
        inline_keyboard: [
          [{ text: '💳 دفع يدوي', callback_data: `manual_${itemId}` }]
        ]
      }
    });
  }

  if (data.startsWith('manual_')) {
    const itemId = data.split('_')[1];
    userStates[chatId] = { step: 'receipt', itemId };

    return bot.sendMessage(chatId,
      `💳 الدفع اليدوي
📱 المحفظة: 77777777
📸 أرسل صورة الإيصال`
    );
  }

  /* -------- ADMIN -------- */
  if (!isAdmin(chatId)) return;

  if (data === 'admin_add') {
    userStates[chatId] = { step: 'add_title' };
    return bot.sendMessage(chatId, '📝 اسم المنتج:');
  }

  if (data === 'admin_edit') {
    db.all("SELECT * FROM items", [], (err, rows) => {
      if (!rows.length) return bot.sendMessage(chatId, 'لا توجد عناصر');

      const keyboard = rows.map(r => (
        [{ text: r.title, callback_data: `edit_${r.id}` }]
      ));

      bot.sendMessage(chatId, 'اختر عنصرًا:', {
        reply_markup: { inline_keyboard: keyboard }
      });
    });
  }

  if (data.startsWith('edit_')) {
    const itemId = data.split('_')[1];
    userStates[chatId] = { step: 'edit_title', itemId };
    return bot.sendMessage(chatId, '📝 الاسم الجديد:');
  }

  if (data === 'admin_delete') {
    db.all("SELECT * FROM items", [], (err, rows) => {
      const keyboard = rows.map(r => (
        [{ text: r.title, callback_data: `del_${r.id}` }]
      ));

      bot.sendMessage(chatId, 'اختر للحذف:', {
        reply_markup: { inline_keyboard: keyboard }
      });
    });
  }

  if (data.startsWith('del_')) {
    const id = data.split('_')[1];
    db.run("DELETE FROM items WHERE id=?", [id]);
    return bot.sendMessage(chatId, '✅ تم الحذف');
  }

  if (data === 'admin_orders') {
    db.all(`
      SELECT o.id,o.user_id,i.title,o.payment_status
      FROM orders o JOIN items i ON o.item_id=i.id
      WHERE o.payment_status!='success'
    `, [], (err, rows) => {
      if (!rows.length) return bot.sendMessage(chatId, 'لا طلبات');

      rows.forEach(r => {
        bot.sendMessage(chatId,
          `طلب #${r.id}
👤 المستخدم: ${r.user_id}
📦 المنتج: ${r.title}
📌 الحالة: ${r.payment_status}`,
          {
            reply_markup: {
              inline_keyboard: [[
                { text: '✅ تأكيد', callback_data: `confirm_${r.user_id}_${r.id}` }
              ]]
            }
          }
        );
      });
    });
  }

  if (data.startsWith('confirm_')) {
    const [, userId, orderId] = data.split('_');

    db.get(`
      SELECT i.title,i.secret_value,i.id AS itemId
      FROM orders o JOIN items i ON o.item_id=i.id
      WHERE o.id=?
    `, [orderId], (err, item) => {
      if (!item) return;

      db.run("UPDATE orders SET payment_status='success' WHERE id=?", [orderId]);
      db.run("UPDATE items SET status='sold' WHERE id=?", [item.itemId]);

      bot.sendMessage(userId,
        `🎉 تم تأكيد الدفع
📦 المنتج: ${item.title}
🔑 الكود:
\`${item.secret_value}\``,
        { parse_mode: 'Markdown' }
      );
    });
  }
});

/* ================= MESSAGE ================= */
bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const state = userStates[chatId];
  if (!state || msg.text?.startsWith('/')) return;

  if (state.step === 'add_title') {
    state.title = msg.text;
    state.step = 'add_secret';
    return bot.sendMessage(chatId, '🔑 الكود السري:');
  }

  if (state.step === 'add_secret') {
    state.secret = msg.text;
    state.step = 'add_price';
    return bot.sendMessage(chatId, '💲 السعر:');
  }

  if (state.step === 'add_price') {
    db.run(
      'INSERT INTO items (title,secret_value,price) VALUES (?,?,?)',
      [state.title, state.secret, Number(msg.text)]
    );
    delete userStates[chatId];
    return bot.sendMessage(chatId, '✅ تمت الإضافة');
  }

  if (state.step === 'edit_title') {
    state.newTitle = msg.text;
    state.step = 'edit_price';
    return bot.sendMessage(chatId, '💲 السعر الجديد:');
  }

  if (state.step === 'edit_price') {
    db.run(
      'UPDATE items SET title=?,price=? WHERE id=?',
      [state.newTitle, Number(msg.text), state.itemId]
    );
    delete userStates[chatId];
    return bot.sendMessage(chatId, '✅ تم التعديل');
  }

  if (state.step === 'receipt' && msg.photo) {
    db.run(
      "UPDATE orders SET payment_status='review' WHERE user_id=? AND item_id=?",
      [chatId, state.itemId]
    );

    const photoId = msg.photo.at(-1).file_id;
    bot.sendPhoto(ADMIN_ID, photoId, {
      caption: `🧾 إيصال جديد\n👤 ${chatId}`
    });

    delete userStates[chatId];
    return bot.sendMessage(chatId, '⏳ بانتظار المراجعة');
  }
});

console.log('🤖 Bot is running...');
