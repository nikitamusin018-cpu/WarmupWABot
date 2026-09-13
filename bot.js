import TelegramBot from 'node-telegram-bot-api';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import { createInvoice, checkInvoice } from './crypto.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BOT_TOKEN = '8976822140:AAFNTvd08gvnDcZhDHoK0kikCOEYzMxIGwQ';
const ADMIN_ID = 8378863051;
const SUPPORT_USERNAME = '@memoredt';

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
bot.deleteWebHook().catch(() => {});

const WARMUP_PRICE = 0.5;
const REGISTRATION_BONUS = 0.5;

// ========== ХРАНИЛИЩЕ ==========
const usersFile = path.join(__dirname, 'users.json');
let users = {};

if (fs.existsSync(usersFile)) {
    try {
        users = JSON.parse(fs.readFileSync(usersFile, 'utf-8'));
    } catch (e) {
        users = {};
    }
}

function saveUsers() {
    fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));
}

function getUser(userId) {
    if (!users[userId]) {
        users[userId] = {
            id: userId,
            registeredAt: Date.now(),
            accounts: [],
            warmupRunning: false,
            username: null,
            balance: REGISTRATION_BONUS,
            totalSpent: 0,
            totalTopups: 0,
            pendingInvoice: null,
            pendingWarmup: null,
            pendingStop: null,
            waitingForAmount: false
        };
        saveUsers();
    }
    const u = users[userId];
    if (typeof u.balance !== 'number') u.balance = REGISTRATION_BONUS;
    if (typeof u.totalSpent !== 'number') u.totalSpent = 0;
    if (typeof u.totalTopups !== 'number') u.totalTopups = 0;
    if (typeof u.warmupRunning !== 'boolean') u.warmupRunning = false;
    if (!Array.isArray(u.accounts)) u.accounts = [];
    if (u.pendingInvoice === undefined) u.pendingInvoice = null;
    if (u.pendingWarmup === undefined) u.pendingWarmup = null;
    if (u.pendingStop === undefined) u.pendingStop = null;
    if (u.waitingForAmount === undefined) u.waitingForAmount = false;
    return u;
}

const MAIN_KEYBOARD = {
    reply_markup: {
        keyboard: [
            [{ text: '📱 Мои аккаунты' }],
            [{ text: '➕ Добавить аккаунт' }, { text: '🔥 Прогрев' }],
            [{ text: '💰 Баланс' }, { text: '⚙️ Настройки' }],
            [{ text: '📊 Статус' }, { text: '⏹️ Остановить' }],
            [{ text: '❓ Помощь' }]
        ],
        resize_keyboard: true,
        is_persistent: true
    }
};

// ========== START ==========
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const userName = msg.from.username || msg.from.first_name || 'User';

    const isNewUser = !users[userId];
    const user = getUser(userId);
    user.username = userName;
    saveUsers();

    if (isNewUser && userId !== ADMIN_ID) {
        bot.sendMessage(ADMIN_ID, `
🆕 Новый пользователь!

👤 Имя: ${msg.from.first_name || 'Без имени'}
📛 Username: @${userName}
🆔 ID: ${userId}
💰 Баланс: $${REGISTRATION_BONUS} (бонус)
📅 ${new Date().toLocaleString('ru-RU')}
        `).catch(() => {});
    }

    let totalAccounts = 0, totalOnline = 0, myAccounts = 0, myOnline = 0;

    try {
        const allRes = await fetch('http://localhost:3000/api/accounts');
        const allAccounts = await allRes.json();
        totalAccounts = allAccounts.length;
        totalOnline = allAccounts.filter(a => a.status === 'connected').length;

        const myRes = await fetch(`http://localhost:3000/api/accounts?ownerId=${userId}`);
        const myAccountsList = await myRes.json();
        myAccounts = myAccountsList.length;
        myOnline = myAccountsList.filter(a => a.status === 'connected').length;

        user.accounts = myAccountsList.map(a => a.id);
        saveUsers();
    } catch (e) {}

    bot.sendMessage(chatId, `
╭──────────────╮
   👋 Добро пожаловать
╰──────────────╯

💰 Ваш баланс: $${user.balance.toFixed(2)}

🌐 В системе:
   📱 Всего аккаунтов: ${totalAccounts}
   🟢 Онлайн: ${totalOnline}

👤 У вас:
   📱 Ваших аккаунтов: ${myAccounts}
   🟢 Онлайн: ${myOnline}

💡 1 прогрев = $${WARMUP_PRICE}
🎁 Бесплатно: $${REGISTRATION_BONUS}

Выберите раздел ниже 👇
    `, MAIN_KEYBOARD);
});

// ========== INLINE-КНОПКИ ==========
bot.on('callback_query', async (query) => {
    const chatId = query.message?.chat?.id;
    const userId = query.from?.id;
    const data = query.data || '';
    try { await bot.answerCallbackQuery(query.id); } catch {}
    if (!chatId || !userId) return;
    const user = getUser(userId);

    if (data.startsWith('qr_new:')) {
        const accountId = data.slice(7);
        if (!user.accounts?.includes(accountId)) {
            return bot.sendMessage(chatId, '❌ Этот аккаунт вам не принадлежит.', MAIN_KEYBOARD);
        }
        try {
            await fetch(`http://localhost:3000/api/refresh-qr/${encodeURIComponent(accountId)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ownerId: userId })
            });
            await bot.sendMessage(chatId, '🔄 Запрашиваю новый QR...', MAIN_KEYBOARD);
        } catch (e) {}
    }

    // ========== ВЫБОР ДЛИТЕЛЬНОСТИ ==========
    if (data.startsWith('warmup_hours:')) {
        const hours = parseInt(data.slice(13));

        if (user.balance < WARMUP_PRICE) {
            return bot.sendMessage(chatId, `
❌ Недостаточно средств

💰 Ваш баланс: $${user.balance.toFixed(2)}
💵 Нужно: $${WARMUP_PRICE}

Пополните баланс в разделе 💰 Баланс
            `, MAIN_KEYBOARD);
        }

        user.pendingWarmup = { hours, price: WARMUP_PRICE };
        saveUsers();

        bot.sendMessage(chatId, `
🔥 Подтвердите запуск прогрева

⏱️ Длительность: ${hours} часов
💵 Стоимость: $${WARMUP_PRICE}
💰 Ваш баланс: $${user.balance.toFixed(2)}

⚠️ Списание произойдет после запуска.
Средства не возвращаются.

Подтвердить?
        `, {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '✅ Запустить', callback_data: `warmup_confirm:${hours}` },
                        { text: '❌ Отмена', callback_data: 'warmup_cancel' }
                    ]
                ]
            }
        });
    }

    // ========== ПОДТВЕРЖДЕНИЕ ==========
    if (data.startsWith('warmup_confirm:')) {
        const hours = parseInt(data.slice(15));

        if (user.balance < WARMUP_PRICE) {
            return bot.sendMessage(chatId, '❌ Недостаточно средств', MAIN_KEYBOARD);
        }

        try {
            const res = await fetch('http://localhost:3000/api/warmup/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ duration: hours, ownerId: userId })
            });
            const result = await res.json();

            if (result.success) {
                user.warmupRunning = true;
                user.pendingWarmup = { hours, price: WARMUP_PRICE };
                saveUsers();

                bot.sendMessage(chatId, `
✅ Прогрев запущен!

⏱️ Длительность: ${hours} часов
💵 Стоимость: $${WARMUP_PRICE}
⏰ Старт через: ${result.delayMinutes} мин
📱 Аккаунтов: ${result.accountsCount}
👀 Синие галки + имитация печати
                `, MAIN_KEYBOARD);
            } else {
                user.warmupRunning = false;
                user.pendingWarmup = null;
                saveUsers();
                bot.sendMessage(chatId, `
❌ Не удалось запустить прогрев

${result.message || 'Ошибка'}

💡 Убедитесь что в системе минимум 2 аккаунта
                `, MAIN_KEYBOARD);
            }
        } catch (e) {
            user.warmupRunning = false;
            user.pendingWarmup = null;
            saveUsers();
            bot.sendMessage(chatId, '❌ Ошибка', MAIN_KEYBOARD);
        }
    }

    if (data === 'warmup_cancel') {
        user.pendingWarmup = null;
        saveUsers();
        bot.sendMessage(chatId, '❌ Отменено', MAIN_KEYBOARD);
    }

    // ========== ПОПОЛНЕНИЕ ==========
    if (data === 'topup_manual') {
        user.waitingForAmount = true;
        saveUsers();
        bot.sendMessage(chatId, `
💰 Пополнение баланса

Введите сумму в долларах ($):

Пример: 5 или 10.5

💡 Минимум: $0.5
        `, MAIN_KEYBOARD);
    }

    if (data.startsWith('check_payment:')) {
        const invoiceId = data.slice(14);
        const result = await checkInvoice(invoiceId);

        if (result.success && result.paid) {
            const amount = parseFloat(result.amount);

            user.balance += amount;
            user.totalTopups += amount;
            user.pendingInvoice = null;
            saveUsers();

            bot.sendMessage(chatId, `
✅ Платёж получен!

💵 Сумма: $${amount.toFixed(2)}
💰 Новый баланс: $${user.balance.toFixed(2)}
            `, MAIN_KEYBOARD);
        } else {
            bot.sendMessage(chatId, '⏳ Платёж ещё не получен. Попробуйте позже.', {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔄 Проверить снова', callback_data: `check_payment:${invoiceId}` }]
                    ]
                }
            });
        }
    }

    // ========== ОСТАНОВКА (СПИСЫВАЕТ) ==========
    if (data === 'stop_confirm') {
        try {
            await fetch('http://localhost:3000/api/warmup/stop', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ownerId: userId })
            });

            // СПИСЫВАЕМ СРЕДСТВА ПРИ ОСТАНОВКЕ
            const price = user.pendingWarmup?.price || WARMUP_PRICE;
            user.balance -= price;
            user.totalSpent += price;

            user.warmupRunning = false;
            user.pendingStop = null;
            user.pendingWarmup = null;
            saveUsers();

            bot.sendMessage(chatId, `
⏹️ Прогрев остановлен

💵 Списано: $${price}
💰 Новый баланс: $${user.balance.toFixed(2)}

⚠️ Средства списаны, так как прогрев был запущен.
            `, MAIN_KEYBOARD);
        } catch (e) {
            bot.sendMessage(chatId, '❌ Ошибка', MAIN_KEYBOARD);
        }
    }

    if (data === 'stop_cancel') {
        user.pendingStop = null;
        saveUsers();
        bot.sendMessage(chatId, '✅ Прогрев продолжается', MAIN_KEYBOARD);
    }

    // ========== НАСТРОЙКИ ==========
    if (data.startsWith('set_start_delay:')) {
        const minutes = parseInt(data.slice(15));
        try {
            await fetch('http://localhost:3000/api/global-settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ delayStartMinutes: minutes })
            });
            bot.sendMessage(chatId, `✅ Старт через: ${minutes} мин`, MAIN_KEYBOARD);
        } catch (e) {}
    }

    if (data === 'set_autoread_on') {
        try {
            await fetch('http://localhost:3000/api/global-settings', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ autoRead: true })
            });
            bot.sendMessage(chatId, '✅ Авто-чтение включено', MAIN_KEYBOARD);
        } catch (e) {}
    }
    if (data === 'set_autoread_off') {
        try {
            await fetch('http://localhost:3000/api/global-settings', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ autoRead: false })
            });
            bot.sendMessage(chatId, '❌ Авто-чтение отключено', MAIN_KEYBOARD);
        } catch (e) {}
    }
    if (data === 'set_typing_on') {
        try {
            await fetch('http://localhost:3000/api/global-settings', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ showTyping: true })
            });
            bot.sendMessage(chatId, '✅ Имитация печати включена', MAIN_KEYBOARD);
        } catch (e) {}
    }
    if (data === 'set_typing_off') {
        try {
            await fetch('http://localhost:3000/api/global-settings', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ showTyping: false })
            });
            bot.sendMessage(chatId, '❌ Имитация печати отключена', MAIN_KEYBOARD);
        } catch (e) {}
    }
});

// ========== ОБРАБОТКА ТЕКСТА ==========
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = msg.text;

    if (!text || text.startsWith('/')) return;
    const user = getUser(userId);

    // ===== ВВОД СУММЫ =====
    if (user.waitingForAmount) {
        const amount = parseFloat(text.replace(',', '.'));

        if (isNaN(amount) || amount < 0.5) {
            return bot.sendMessage(chatId, '❌ Введите число от 0.5 и выше\n\nПример: 5 или 10.5', MAIN_KEYBOARD);
        }

        user.waitingForAmount = false;
        saveUsers();

        bot.sendMessage(chatId, '⏳ Создаю счёт...');

        const invoice = await createInvoice(amount, userId, `Пополнение баланса на $${amount}`);

        if (!invoice.success) {
            return bot.sendMessage(chatId, `❌ Ошибка: ${invoice.error}`, MAIN_KEYBOARD);
        }

        user.pendingInvoice = {
            id: invoice.invoiceId,
            amount: amount,
            createdAt: Date.now()
        };
        saveUsers();

        bot.sendMessage(chatId, `
💳 Счёт создан

💵 Сумма: $${amount.toFixed(2)}
📅 Действует: 1 час

Нажмите кнопку ниже чтобы оплатить:
        `, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: `💳 Оплатить $${amount.toFixed(2)}`, url: invoice.payUrl }],
                    [{ text: '🔄 Проверить оплату', callback_data: `check_payment:${invoice.invoiceId}` }]
                ]
            }
        });
        return;
    }

    // ===== МОИ АККАУНТЫ =====
    if (text === '📱 Мои аккаунты') {
        try {
            const res = await fetch(`http://localhost:3000/api/accounts?ownerId=${userId}`);
            const accounts = await res.json();

            if (!accounts.length) {
                return bot.sendMessage(chatId, '📭 У вас нет добавленных аккаунтов\n\nНажмите "➕ Добавить аккаунт" чтобы начать', MAIN_KEYBOARD);
            }

            let msgText = '📱 Мои аккаунты\n\n';
            accounts.forEach((acc, i) => {
                msgText += `${i+1}. ${acc.name}\n`;
                msgText += `📞 ${acc.number}\n`;
                msgText += `🟢 Онлайн\n\n`;
            });
            bot.sendMessage(chatId, msgText, MAIN_KEYBOARD);
        } catch (e) {
            bot.sendMessage(chatId, '❌ Ошибка', MAIN_KEYBOARD);
        }
    }

    // ===== ДОБАВИТЬ АККАУНТ =====
    else if (text === '➕ Добавить аккаунт') {
        const accountId = `acc_${userId}_${Date.now()}`;
        user.newAccountId = accountId;
        if (!Array.isArray(user.accounts)) user.accounts = [];
        if (!user.accounts.includes(accountId)) user.accounts.push(accountId);
        saveUsers();

        await bot.sendMessage(chatId, '🔄 Создаю QR-код...', MAIN_KEYBOARD);

        try {
            await fetch('http://localhost:3000/api/add-account', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ accountId, ownerId: userId })
            });
        } catch (e) {
            bot.sendMessage(chatId, '❌ Сервис недоступен', MAIN_KEYBOARD);
        }
    }

    // ===== ПРОГРЕВ =====
    else if (text === '🔥 Прогрев') {
        try {
            const allRes = await fetch('http://localhost:3000/api/accounts');
            const allAccounts = await allRes.json();
            const globalConnected = allAccounts.filter(a => a.status === 'connected');

            const ownRes = await fetch(`http://localhost:3000/api/accounts?ownerId=${userId}`);
            const ownAccounts = await ownRes.json();
            const ownConnected = ownAccounts.filter(a => a.status === 'connected');

            if (globalConnected.length < 2) {
                return bot.sendMessage(chatId, `
⚠️ Прогрев недоступен

🌐 В системе: ${globalConnected.length} аккаунт(ов)
👤 Ваших: ${ownConnected.length}

💡 Для прогрева нужно минимум 2 аккаунта в системе.

Как только появится второй — сможете запустить прогрев.
            `, MAIN_KEYBOARD);
            }

            bot.sendMessage(chatId, `
🔥 Настройка прогрева

🌐 В системе: ${globalConnected.length}
👤 Ваших: ${ownConnected.length}
💰 Баланс: $${user.balance.toFixed(2)}

💵 Стоимость: $${WARMUP_PRICE} (за любой период)

⚠️ Списание после запуска. Не возвращается.

⏱️ Выберите длительность:
            `, {
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '⏱️ 3 часа', callback_data: 'warmup_hours:3' },
                            { text: '⏱️ 6 часов', callback_data: 'warmup_hours:6' }
                        ],
                        [
                            { text: '⏱️ 12 часов', callback_data: 'warmup_hours:12' }
                        ]
                    ]
                }
            });
        } catch (e) {
            bot.sendMessage(chatId, '❌ Ошибка', MAIN_KEYBOARD);
        }
    }

    // ===== БАЛАНС =====
    else if (text === '💰 Баланс') {
        bot.sendMessage(chatId, `
💰 Ваш баланс

💵 Баланс: $${user.balance.toFixed(2)}

📊 Статистика:
📥 Пополнено: $${user.totalTopups.toFixed(2)}
📤 Потрачено: $${user.totalSpent.toFixed(2)}

💡 1 прогрев = $${WARMUP_PRICE}

Нажмите кнопку ниже для пополнения:
        `, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '💳 Пополнить баланс', callback_data: 'topup_manual' }]
                ]
            }
        });
    }

    // ===== НАСТРОЙКИ =====
    else if (text === '⚙️ Настройки') {
        try {
            const res = await fetch('http://localhost:3000/api/global-settings');
            const data = await res.json();
            const s = data.settings;

            bot.sendMessage(chatId, `
⚙️ Настройки прогрева

📨 Задержка: ${s.delayMin}-${s.delayMax} сек
⏰ Задержка старта: ${s.delayStartMinutes} мин
👀 Авто-чтение: ${s.autoRead ? '✅ ВКЛ' : '❌ ВЫКЛ'}
💬 Имитация печати: ${s.showTyping ? '✅ ВКЛ' : '❌ ВЫКЛ'}
📨 Лимит на пару: ${s.maxMessagesPerPair} сообщений
            `, MAIN_KEYBOARD);

            bot.sendMessage(chatId, '⏰ Задержка старта:', {
                reply_markup: {
                    inline_keyboard: [[
                        { text: '1 мин', callback_data: 'set_start_delay:1' },
                        { text: '3 мин', callback_data: 'set_start_delay:3' },
                        { text: '5 мин', callback_data: 'set_start_delay:5' }
                    ]]
                }
            });

            bot.sendMessage(chatId, '👀 Авто-чтение:', {
                reply_markup: {
                    inline_keyboard: [[
                        { text: '✅ Вкл', callback_data: 'set_autoread_on' },
                        { text: '❌ Выкл', callback_data: 'set_autoread_off' }
                    ]]
                }
            });

            bot.sendMessage(chatId, '💬 Имитация печати:', {
                reply_markup: {
                    inline_keyboard: [[
                        { text: '✅ Вкл', callback_data: 'set_typing_on' },
                        { text: '❌ Выкл', callback_data: 'set_typing_off' }
                    ]]
                }
            });
        } catch (e) {
            bot.sendMessage(chatId, '❌ Ошибка', MAIN_KEYBOARD);
        }
    }

    // ===== ОСТАНОВИТЬ =====
    else if (text === '⏹️ Остановить') {
        if (!user.warmupRunning) {
            return bot.sendMessage(chatId, '❌ Нет активного прогрева', MAIN_KEYBOARD);
        }

        user.pendingStop = true;
        saveUsers();

        bot.sendMessage(chatId, `
⚠️ Подтверждение остановки

Вы уверены что хотите остановить прогрев?

💵 Внимание:
• С баланса спишется $${WARMUP_PRICE}
• Средства НЕ возвращаются
• Прогрев будет отменён

Подтвердить остановку?
        `, {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '✅ Подтвердить', callback_data: 'stop_confirm' },
                        { text: '❌ Отмена', callback_data: 'stop_cancel' }
                    ]
                ]
            }
        });
    }

    // ===== СТАТУС =====
    else if (text === '📊 Статус') {
        try {
            const statsRes = await fetch('http://localhost:3000/api/warmup-stats');
            const stats = await statsRes.json();

            bot.sendMessage(chatId, `
📊 Статус системы

💰 Баланс: $${user.balance.toFixed(2)}

🔥 Прогрев: ${user.warmupRunning ? '🟢 Активен' : '🔴 Остановлен'}
📨 Отправлено: ${stats.stats?.totalSent || 0}
            `, MAIN_KEYBOARD);
        } catch (e) {
            bot.sendMessage(chatId, '❌ Ошибка', MAIN_KEYBOARD);
        }
    }

    // ===== ПОМОЩЬ =====
    else if (text === '❓ Помощь') {
        bot.sendMessage(chatId, `
❓ Помощь

Как добавить аккаунт:
1. Нажмите "➕ Добавить аккаунт"
2. QR-код придёт в этот чат
3. Отсканируйте в WhatsApp

Как запустить прогрев:
1. Пополните баланс (💰 Баланс)
2. Нажмите "🔥 Прогрев"
3. Выберите длительность
4. Подтвердите запуск

Цена:
• 1 прогрев = $${WARMUP_PRICE}
• 3 / 6 / 12 часов — одинаково

Оплата:
Через CryptoBot (@send) — USDT

Списание:
• ✅ Успешный прогрев — списывается
• ❌ Ошибка прогрева — НЕ списывается
• ⏹️ Остановка — списывается

Стартовый бонус:
• $${REGISTRATION_BONUS} при регистрации

💬 По вопросам: ${SUPPORT_USERNAME}
        `, MAIN_KEYBOARD);
    }
});

// ========== ОТПРАВКА QR ==========
export async function sendQRToBot(ownerId, accountId, qrDataUrl) {
    try {
        const match = String(qrDataUrl).match(/^data:image\/[^;]+;base64,(.+)$/);
        if (!match) throw new Error('Неверный формат QR');
        const imageBuffer = Buffer.from(match[1], 'base64');

        await bot.sendPhoto(ownerId, imageBuffer, {
            caption: `📱 QR-код\n\nАккаунт: ${accountId}\n\nОткройте WhatsApp → Настройки → Связанные устройства → Привязать устройство`,
            reply_markup: { inline_keyboard: [[{ text: '🔄 Получить новый QR', callback_data: `qr_new:${accountId}` }]] }
        }, {
            filename: `qr-${accountId}.png`,
            contentType: 'image/png'
        });
    } catch (error) {
        console.error('Ошибка отправки QR:', error.message);
    }
}

// ========== УВЕДОМЛЕНИЯ ==========
export async function notifyAdmin(message) {
    try { await bot.sendMessage(ADMIN_ID, `🔔 ${message}`); } catch (e) {}
}

export async function notifyAccountConnected(ownerId, accountId, name, number) {
    if (!ownerId) return;
    try {
        await bot.sendMessage(ownerId, `╭──────────────╮\n   ✅ Аккаунт подключён\n╰──────────────╯\n\n📱 ${name || 'WhatsApp'}\n📞 ${number || '---'}\n🆔 ${accountId}`, MAIN_KEYBOARD);
    } catch (e) {}
}

async function sendQRExpired(ownerId, accountId) {
    return bot.sendMessage(ownerId, `⚠️ QR устарел (${accountId})`, {
        reply_markup: { inline_keyboard: [[{ text: '🔄 Новый QR', callback_data: `qr_new:${accountId}` }]] }
    });
}

// ========== HTTP BRIDGE ==========
const qrBridge = http.createServer(async (req, res) => {
    const allowed = ['/internal/qr', '/internal/qr-expired', '/internal/account-connected', '/internal/warmup-done'];
    if (req.method !== 'POST' || !allowed.includes(req.url)) {
        res.writeHead(404);
        return res.end('Not found');
    }
    let body = '';
    req.on('data', chunk => {
        body += chunk;
        if (body.length > 8 * 1024 * 1024) req.destroy();
    });
    req.on('end', async () => {
        try {
            const data = JSON.parse(body);

            if (req.url === '/internal/warmup-done') {
                const user = users[data.ownerId];
                if (user && user.pendingWarmup) {
                    // ===== СПИСЫВАЕМ ТОЛЬКО ПРИ УСПЕШНОМ ЗАВЕРШЕНИИ =====
                    // Если data.success !== false — то успех
                    if (data.success !== false) {
                        const price = user.pendingWarmup.price;
                        user.balance -= price;
                        user.totalSpent += price;
                        user.warmupRunning = false;
                        user.pendingWarmup = null;
                        saveUsers();

                        await bot.sendMessage(data.ownerId, `
✅ Прогрев завершён!

📨 Отправлено: ${data.sent || 0} сообщений
💵 Списано: $${price}
💰 Новый баланс: $${user.balance.toFixed(2)}
                        `, MAIN_KEYBOARD);
                    } else {
                        // Ошибка — не списываем
                        user.warmupRunning = false;
                        user.pendingWarmup = null;
                        saveUsers();

                        await bot.sendMessage(data.ownerId, `
❌ Прогрев завершён с ошибкой

💵 Средства НЕ списаны
💰 Баланс: $${user.balance.toFixed(2)}
                        `, MAIN_KEYBOARD);
                    }
                }
            } else {
                if (!data.ownerId || !data.accountId) throw new Error('Неполные данные');
                if (req.url === '/internal/qr-expired') {
                    await sendQRExpired(data.ownerId, data.accountId);
                } else if (req.url === '/internal/account-connected') {
                    await notifyAccountConnected(data.ownerId, data.accountId, data.name, data.number);
                } else {
                    if (!data.qr) throw new Error('Нет QR');
                    await sendQRToBot(data.ownerId, data.accountId, data.qr);
                }
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
        } catch (e) {
            console.error('❌ Bridge:', e.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: e.message }));
        }
    });
});

qrBridge.listen(3001, '127.0.0.1', () => console.log('🔗 Bridge: http://127.0.0.1:3001'));

// ========== АВТОПРОВЕРКА ПЛАТЕЖЕЙ ==========
setInterval(async () => {
    for (const [userId, user] of Object.entries(users)) {
        if (user.pendingInvoice) {
            const invoiceId = user.pendingInvoice.id;
            const result = await checkInvoice(invoiceId);

            if (result.success && result.paid) {
                const amount = parseFloat(result.amount);

                user.balance += amount;
                user.totalTopups += amount;
                user.pendingInvoice = null;
                saveUsers();

                try {
                    await bot.sendMessage(userId, `
✅ Платёж получен автоматически!

💵 Сумма: $${amount.toFixed(2)}
💰 Новый баланс: $${user.balance.toFixed(2)}
                    `, MAIN_KEYBOARD);
                } catch (e) {}
            } else if (Date.now() - user.pendingInvoice.createdAt > 3600000) {
                user.pendingInvoice = null;
                saveUsers();
            }
        }
    }
}, 30000);

console.log('🤖 Bot started!');
console.log('💰 Баланс + Криптоплатежи активированы');
console.log(`💵 Цена прогрева: $${WARMUP_PRICE}`);
console.log(`🎁 Стартовый баланс: $${REGISTRATION_BONUS}`);
console.log(`💬 Support: ${SUPPORT_USERNAME}`);