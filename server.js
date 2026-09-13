import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = createServer(app);
const io = new Server(server);

app.use(express.static('public'));
app.use(express.json());

// ========== ХРАНИЛИЩА ==========
const sessions = new Map();
const accountsOwners = new Map();
const accountSettings = new Map();
const pendingAuth = new Map();
const pendingQRCodes = new Map();
const qrState = new Map();
const qrRequested = new Map();
const warmupTasks = new Map();
let globalStats = { totalSent: 0 };

let globalWarmupSettings = {
    delaySeconds: 60,
    delayMin: 30,
    delayMax: 90,
    maxMessagesPerPair: 30,
    pauseEvery: 10,
    pauseMinMinutes: 2,
    pauseMaxMinutes: 5,
    delayStartMinutes: 3,
    autoRead: true,
    showTyping: true,
    photosEvery: 6
};

const ownersFile = path.join(__dirname, 'account-owners.json');
const settingsFile = path.join(__dirname, 'account-settings.json');
const globalSettingsFile = path.join(__dirname, 'global-settings.json');

try {
    if (fs.existsSync(ownersFile)) {
        const saved = JSON.parse(fs.readFileSync(ownersFile, 'utf8'));
        for (const [id, owner] of Object.entries(saved)) accountsOwners.set(id, owner);
    }
} catch (e) {}

try {
    if (fs.existsSync(settingsFile)) {
        const saved = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
        for (const [id, value] of Object.entries(saved)) accountSettings.set(id, value);
    }
} catch (e) {}

try {
    if (fs.existsSync(globalSettingsFile)) {
        const saved = JSON.parse(fs.readFileSync(globalSettingsFile, 'utf8'));
        Object.assign(globalWarmupSettings, saved);
    }
} catch (e) {}

function saveOwners() { fs.writeFileSync(ownersFile, JSON.stringify(Object.fromEntries(accountsOwners), null, 2)); }
function saveSettings() { fs.writeFileSync(settingsFile, JSON.stringify(Object.fromEntries(accountSettings), null, 2)); }
function saveGlobalSettings() { fs.writeFileSync(globalSettingsFile, JSON.stringify(globalWarmupSettings, null, 2)); }

function getAccountSettings(id) {
    if (!accountSettings.has(id)) {
        accountSettings.set(id, { messageLimit: 20, delaySeconds: 50 });
        saveSettings();
    }
    return accountSettings.get(id);
}

// ========== ПРОКСИ ==========
let proxies = [];
const proxiesFile = path.join(__dirname, 'proxies.txt');
if (fs.existsSync(proxiesFile)) {
    proxies = fs.readFileSync(proxiesFile, 'utf-8')
        .split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
}

// ========== ФОТО ==========
const photosDir = path.join(__dirname, 'photos');
if (!fs.existsSync(photosDir)) fs.mkdirSync(photosDir, { recursive: true });

function getRandomPhoto() {
    try {
        const files = fs.readdirSync(photosDir).filter(f => /\.(jpg|jpeg|png|gif|webp)$/i.test(f));
        if (!files.length) return null;
        return path.join(photosDir, files[Math.floor(Math.random() * files.length)]);
    } catch (e) { return null; }
}

// ========== БАЗА СООБЩЕНИЙ ==========
const MESSAGES = [
    '👋 Привет! Как дела?', 'Здравствуйте! Рады познакомиться 😊', 'Hello! How are you?',
    'Приветствую! Как прошел день?', 'Добрый день! 🌞', 'Всем привет! 👋',
    'Как ваши дела? 😊', 'Что нового?', 'Чем занимаетесь?', 'Привет, как жизнь?',
    'Здорово! Как настроение?', 'Салют! Что нового?', 'Приветик! 👋',
    'Доброе утро! ☀️', 'Добрый вечер! 🌅', 'Как ты?', 'Как оно?',
    'Хэй! Как сам?', 'Привет-привет!', 'Здрасьте!', 'Йо!',
    'Хеллоу!', 'Приветствую!', 'Доброго времени суток!', 'Рад видеть!',
    'О, привет!', 'Ку-ку!', 'Хай!', 'Хелло!', 'Салют!',
    'Привет, друг!', 'Привет, подруга!', 'Дарова!', 'Здорово, брат!',
    'Приветствую тебя!', 'Пламенный привет!', 'Горячий привет!', 'Ледяной привет!',
    'Космический привет!', 'Солнечный привет!', 'Звёздный привет!', 'Морской привет!',
    'Воздушный привет!', 'Огненный привет!', 'Водный привет!', 'Земной привет!',
    'Небесный привет!', 'Лунный привет!', 'Марсианский привет!', 'Юпитерский привет!',
    'Всем-всем привет!', 'Огромный привет!', 'Тёплый привет!', 'Летний привет!',
    'Зимний привет!', 'Осенний привет!', 'Весенний привет!', 'Утренний привет!',
    'Вечерний привет!', 'Ночной привет!', 'Полуночный привет!', 'Рассветный привет!',
    'Закатный привет!', 'Радужный привет!', 'Сказочный привет!', 'Волшебный привет!',
    'Дружеский привет!', 'Товарищеский привет!', 'Братский привет!', 'Сестринский привет!',
    'Родной привет!', 'Близкий привет!', 'Тёплый-тёплый привет!', 'Очень тёплый привет!',
    'Мега-привет!', 'Супер-привет!', 'Гипер-привет!', 'Ультра-привет!',
    'Приветище!', 'Хэллоу!', 'Салам!', 'Ас-саляму алейкум!',

    'Какие планы на вечер?', 'Как прошел день?', 'Есть ли новости? 📰',
    'Как успехи?', 'Что делаешь?', 'Как настроение сегодня?', 'Чем увлекаешься?',
    'Какие планы на выходные?', 'Как работа?', 'Что интересного произошло?',
    'Как погода?', 'Как самочувствие?', 'Как семья?', 'Как друзья?',
    'Как хобби?', 'Как спорт?', 'Как учеба?', 'Как здоровье?',
    'Как день проходит?', 'Как выходные?', 'Как отдыхаешь?', 'Как развлекаешься?',
    'Как питаешься?', 'Как спишь?', 'Как читаешь?', 'Как смотришь?', 'Как слушаешь?',
    'Как играешь?', 'Как гуляешь?', 'Как путешествуешь?', 'Как мечтаешь?',
    'Как планируешь?', 'Как думаешь?', 'Как чувствуешь?', 'Как живёшь?',
    'Как поживаешь?', 'Как делишки?', 'Как жизнь молодая?', 'Как сам?',
    'Как ты там?', 'Как оно вообще?', 'Как всё?', 'Как вообще?', 'Как жизнь?',
    'Что слышно?', 'Что видно?', 'Что чувствуешь?', 'Что думаешь?',
    'Что нового узнал?', 'Что интересного видел?', 'Что читал?', 'Что смотрел?',
    'Что слушал?', 'Что готовил?', 'Что кушал?', 'Что пил?', 'Что видел во сне?',
    'Куда ходил?', 'Куда ездил?', 'Куда летал?', 'Куда собираешься?',
    'С кем виделся?', 'С кем общался?', 'Кому звонил?', 'Кому писал?',

    'Отличная работа! 👏', 'Вы классный! 🌟', 'Красиво выглядите! 😍',
    'У вас отличный вкус! ✨', 'Вы вдохновляете! 💫', 'Ты лучший!',
    'Шикарно выглядишь!', 'Умничка!', 'Ты супер!', 'Ты классный!',
    'Ты замечательный!', 'Ты потрясающий!', 'Ты великолепный!', 'Ты блестящий!',
    'Ты изумительный!', 'Ты восхитительный!', 'Ты невероятный!', 'Ты фантастический!',
    'Ты удивительный!', 'Ты исключительный!', 'Ты особенный!', 'Ты уникальный!',
    'Ты неповторимый!', 'Ты лучший в мире!', 'Ты лучший в галактике!',
    'Ты лучший во вселенной!', 'Ты лучший в истории!', 'Ты легенда!',
    'Ты гений!', 'Ты талант!', 'Ты звезда! 🌟', 'Ты солнце! ☀️',
    'Ты луна! 🌙', 'Ты море! 🌊', 'Ты горы! ⛰️', 'Ты небо! ☁️',
    'Ты огонь! 🔥', 'Ты лёд! ❄️', 'Ты ветер! 💨', 'Ты земля! 🌍',
    'Ты космос! 🌌', 'Ты вселенная! 🌠', 'Ты галактика! ✨',
    'Ты чудо!', 'Ты волшебство!', 'Ты магия!', 'Ты сказка!',
    'Ты мечта!', 'Ты сон!', 'Ты реальность!', 'Ты мечта всей жизни!',
    'Ты лучший собеседник!', 'С тобой легко!', 'С тобой весело!', 'С тобой интересно!',
    'Ты очень умный!', 'Ты очень добрый!', 'Ты очень честный!', 'Ты очень смелый!',
    'Ты очень заботливый!', 'Ты очень внимательный!', 'Ты очень отзывчивый!', 'Ты очень надёжный!',
    'Ты очень весёлый!', 'Ты очень милый!', 'Ты очень обаятельный!', 'Ты очень приятный!',
    'Ты просто чудо!', 'Ты просто прелесть!', 'Ты просто сказка!', 'Ты просто мечта!',
    'Ты просто космос!', 'Ты просто огонь!', 'Ты просто супер!', 'Ты просто класс!',
    'Ты просто лучший!', 'Ты просто неповторимый!', 'Ты просто уникальный!', 'Ты просто золото!',
    'У тебя красивая улыбка!', 'У тебя красивые глаза!', 'У тебя красивый голос!',
    'У тебя золотые руки!', 'У тебя светлая голова!', 'У тебя доброе сердце!',

    '😊 Как настроение?', '🔥 Ты просто огонь!', '💪 Все получится!',
    '🌟 Ты суперзвезда!', '🎉 Ура! Поздравляю!', '❤️ Спасибо большое!',
    '🤝 Отличная команда!', '😍 Ты классный!', '💯 100% успеха!',
    '🎯 Точно в цель!', '🚀 Вперёд к звёздам!', '🌈 Радужного дня!',
    '🦋 Лёгкости тебе!', '🌸 Красоты вокруг!', '🌺 Цветочного настроения!',
    '🌻 Солнечного дня!', '🌼 Ясного неба!', '🌷 Весеннего настроения!',
    '🌹 Розового настроения!', '💐 Букет удачи!', '🍀 Удачи!',
    '⭐ Звёздного пути!', '🌙 Лунной ночи!', '☀️ Солнечного утра!',
    '🌅 Красивого заката!', '🌄 Красивого рассвета!', '⛅ Хорошей погоды!',
    '🌧️ Дождливого настроения!', '⛈️ Грозовой энергии!', '❄️ Снежного настроения!',
    '☃️ Зимней сказки!', '🎄 Новогоднего чуда!', '🎁 Подарков!',
    '🎈 Воздушного настроения!', '🎉 Праздника!', '🎊 Веселья!',
    '🥳 Отрывайся!', '🤩 Восхищайся!', '😎 Будь крутым!',
    '🤗 Обнимаю!', '😘 Целую!', '🥰 Люблю!',
    '😻 Ты милашка!', '🐱 Мур-мур!', '🐶 Гав-гав!',
    '🐼 Панда-настроение!', '🦊 Хитрый лис!', '🐺 Одинокий волк!',
    '🦁 Царь зверей!', '🐯 Тигр!', '🐻 Медведь!',
    '🦄 Единорог!', '🐉 Дракон!', '🦅 Орёл!', '🦉 Сова!',

    'Давайте обсудим проект 💼', 'Есть идея для нового проекта 💡',
    'Надо собраться и обсудить 📅', 'Будем двигаться дальше 🚀',
    'Успехов в работе! 💪', 'Отличная работа над проектом!',
    'Продуктивного дня!', 'Вперед к новым вершинам!', 'Работа кипит! 🔥',
    'Есть чем заняться?', 'Много работы?', 'Как проект?',
    'Как дела на работе?', 'Как коллеги?', 'Как начальство?',
    'Как зарплата?', 'Как отпуск?', 'Как повышение?',
    'Как карьера?', 'Как бизнес?', 'Как стартап?',
    'Как идея?', 'Как реализация?', 'Как план?',
    'Как стратегия?', 'Как тактика?', 'Как цель?',
    'Как задача?', 'Как дедлайн?', 'Как встреча?',

    'Давай увидимся! 🍕', 'Хочешь в кино? 🎬', 'Пошли гулять! 🌳',
    'Ты офигенный друг! 🥰', 'Спасибо что ты есть! 💖',
    'Ты лучший друг!', 'Не представляю жизни без тебя!',
    'Ты всегда поддерживаешь!', 'С тобой весело!',
    'Ты невероятный человек!', 'Лучший в своем деле!',
    'Ты — пример для подражания!', 'Спасибо за твою энергию!',
    'Ты делаешь мир лучше!', 'У тебя золотое сердце!',
    'Ты всегда вдохновляешь!', 'Твой талант поражает!',
    'Ты — звезда! 🌟', 'Ты великолепен!', 'Твоя улыбка зажигает!',
    'Ты — мой герой!', 'С тобой легко и просто!', 'Ты — моя опора!',
    'Ты — моя поддержка!', 'Ты — моя сила!', 'Ты — моё вдохновение!',
    'Ты — моя муза!', 'Ты — моя радость!', 'Ты — моё счастье!',

    'Верь в себя! 🌟', 'Ты сможешь! 💪', 'Не сдавайся! 🔥',
    'Будь сильным! ⚡', 'Иди к своей цели! 🎯', 'Все получится!',
    'Успех ждет тебя!', 'Ты на правильном пути!', 'Никогда не останавливайся!',
    'Мечтай больше!', 'Действуй смелее!', 'Живи ярче!',
    'Люби сильнее!', 'Смейся громче!', 'Пой от души!',
    'Танцуй свободно!', 'Твори смело!', 'Создавай новое!',
    'Меняй мир!', 'Делай добро!', 'Помогай другим!',
    'Будь собой!', 'Будь счастлив!', 'Будь здоров!',
    'Будь успешен!', 'Будь любим!', 'Будь нужен!',

    'Жизнь прекрасна! 🌸', 'Всё будет хорошо!', 'Время лечит',
    'Главное — верить!', 'Мечты сбываются!', 'Всё в твоих руках!',
    'Дорогу осилит идущий!', 'Счастье внутри нас!', 'Будь здесь и сейчас!',
    'Живи настоящим!', 'Прошлое — урок, будущее — мечта!', 'Настоящее — подарок!',
    'Каждый день — новый шанс!', 'Утро вечера мудренее!',
    'Всё проходит — и это пройдёт!', 'Ничто не вечно!',

    'Ок!', 'Хорошо!', 'Конечно!', 'Да!', 'Нет!',
    'Круто!', 'Класс!', 'Супер!', 'Отлично!', 'Прекрасно!',
    'Здорово!', 'Понял!', 'Принял!', 'Согласен!',
    'Точно!', 'Верно!', 'Правильно!', 'Именно!', 'Ага!'
];

function getRandomMessage() {
    return MESSAGES[Math.floor(Math.random() * MESSAGES.length)];
}

function getRandomDelay(minSec, maxSec) {
    return Math.floor(minSec + Math.random() * (maxSec - minSec));
}

// ========== СОХРАНЕНИЕ КОНТАКТА ==========
async function saveContact(sock, jid, name) {
    try {
        await sock.addOrEditContact(jid, { displayName: name || 'Контакт' });
        console.log(`📇 Контакт ${jid} сохранен как "${name}"`);
        return true;
    } catch (e) {
        console.error(`⚠️ Не удалось сохранить контакт ${jid}:`, e.message);
        return false;
    }
}

// ========== ПОДКЛЮЧЕНИЕ АККАУНТА ==========
async function connectAccount(accountId, phoneNumber = null, ownerId = null) {
    if (sessions.has(accountId)) return sessions.get(accountId);

    const authFolder = path.join(__dirname, 'auth_data', accountId);
    if (!fs.existsSync(authFolder)) fs.mkdirSync(authFolder, { recursive: true });

    if (ownerId) {
        accountsOwners.set(accountId, String(ownerId));
        saveOwners();
        getAccountSettings(accountId);
    }

    const { state, saveCreds } = await useMultiFileAuthState(authFolder);

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: ['Chrome (Linux)', '', ''],
        phoneNumber: phoneNumber || undefined,
        markOnlineOnConnect: true,
        syncFullHistory: false,
        generateHighQualityLinkPreview: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        const owner = accountsOwners.get(accountId);

        if (qr) {
            try {
                const qrImage = await QRCode.toDataURL(qr, { width: 420, margin: 2 });
                const qrStatus = qrState.get(accountId) || { sent: false, expiredNotified: false };
                io.emit('qr', { accountId, ownerId: owner || null, qr: qrImage });

                const requested = qrRequested.get(accountId) === true;
                if (owner && (!qrStatus.sent || requested)) {
                    try {
                        const tgRes = await fetch('http://127.0.0.1:3001/internal/qr', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ ownerId: owner, accountId, qr: qrImage })
                        });
                        if (!tgRes.ok) throw new Error(`HTTP ${tgRes.status}`);
                        qrState.set(accountId, { sent: true, expiredNotified: false });
                        qrRequested.delete(accountId);
                    } catch (e) {
                        pendingQRCodes.set(accountId, { ownerId: owner, qrImage, requested: true });
                    }
                } else if (owner && qrStatus.sent && !qrStatus.expiredNotified) {
                    fetch('http://127.0.0.1:3001/internal/qr-expired', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ ownerId: owner, accountId })
                    }).catch(() => {});
                    qrState.set(accountId, { sent: true, expiredNotified: true });
                }
            } catch (e) {}
        }

        if (connection === 'open') {
            console.log(`✅ Аккаунт ${accountId} подключен`);
            io.emit('status', { accountId, status: 'connected', name: sock.user?.name });
            sessions.set(accountId, sock);
            pendingAuth.delete(accountId);
            qrState.delete(accountId);
            qrRequested.delete(accountId);
            pendingQRCodes.delete(accountId);

            // НЕ ЗАПУСКАЕМ ПРОГРЕВ АВТОМАТИЧЕСКИ!
            // Пользователь сам нажмёт "🔥 Прогрев" в боте.

            if (owner) {
                fetch('http://127.0.0.1:3001/internal/account-connected', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        ownerId: owner,
                        accountId,
                        name: sock.user?.name || 'WhatsApp',
                        number: sock.user?.id?.split(':')[0] || '---'
                    })
                }).catch(() => {});
            }
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            if (statusCode !== DisconnectReason.loggedOut) {
                setTimeout(() => connectAccount(accountId, phoneNumber, ownerId), 5000);
            } else {
                sessions.delete(accountId);
                qrState.delete(accountId);
                qrRequested.delete(accountId);
                pendingQRCodes.delete(accountId);
                io.emit('status', { accountId, status: 'disconnected' });
                accountsOwners.delete(accountId);
                saveOwners();
                accountSettings.delete(accountId);
                saveSettings();
                const authFolder2 = path.join(__dirname, 'auth_data', accountId);
                fs.rmSync(authFolder2, { recursive: true, force: true });
            }
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg || msg.key.fromMe) return;

        const chatId = msg.key.remoteJid;
        const sender = msg.key.participant || chatId;
        const message = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '📎 Media';

        if (globalWarmupSettings.autoRead) {
            try { await sock.readMessages([msg.key]); } catch (e) {}
        }

        io.emit('new_message', {
            accountId, chatId, sender, message,
            timestamp: Date.now(),
            ownerId: accountsOwners.get(accountId)
        });
    });

    return sock;
}

function getAllConnectedAccounts() {
    const result = [];
    for (const [accId, sock] of sessions) {
        if (sock && sock.user) result.push(accId);
    }
    return result;
}

// ========== API ==========

app.post('/api/add-account', async (req, res) => {
    const { accountId, ownerId } = req.body;
    try {
        await connectAccount(accountId, null, ownerId);
        res.json({ success: true, message: 'QR-код создается' });
    } catch (error) {
        res.json({ success: false, message: error.message });
    }
});

app.get('/api/accounts', (req, res) => {
    const { ownerId, includeOffline } = req.query;
    const accounts = [];
    const authDir = path.join(__dirname, 'auth_data');
    if (!fs.existsSync(authDir)) return res.json([]);
    for (const id of fs.readdirSync(authDir)) {
        const owner = accountsOwners.get(id);
        if (ownerId && String(owner) !== String(ownerId)) continue;
        const sock = sessions.get(id);
        const connected = !!sock;
        if (!includeOffline && !connected) continue;
        accounts.push({
            id,
            ownerId: owner || null,
            status: connected ? 'connected' : 'disconnected',
            name: sock?.user?.name || 'Unknown',
            number: sock?.user?.id?.split(':')[0] || '---',
            settings: getAccountSettings(id)
        });
    }
    res.json(accounts);
});

app.get('/api/stats', (req, res) => {
    const { ownerId } = req.query;
    const authDir = path.join(__dirname, 'auth_data');
    let total = 0, totalOnline = 0, mine = 0, mineOnline = 0;

    if (fs.existsSync(authDir)) {
        const dirs = fs.readdirSync(authDir);
        total = dirs.length;

        dirs.forEach(id => {
            const sock = sessions.get(id);
            const owner = accountsOwners.get(id);
            if (sock) {
                totalOnline++;
                if (ownerId && String(owner) === String(ownerId)) mineOnline++;
            }
            if (ownerId && String(owner) === String(ownerId)) mine++;
        });
    }

    res.json({ success: true, total, totalOnline, mine, mineOnline });
});

app.get('/api/global-settings', (req, res) => {
    res.json({ success: true, settings: globalWarmupSettings });
});

app.post('/api/global-settings', (req, res) => {
    const allowed = ['delaySeconds', 'delayMin', 'delayMax', 'maxMessagesPerPair',
                     'pauseEvery', 'pauseMinMinutes', 'pauseMaxMinutes',
                     'delayStartMinutes', 'autoRead', 'showTyping', 'photosEvery'];
    for (const key of allowed) {
        if (req.body[key] !== undefined) {
            globalWarmupSettings[key] = req.body[key];
        }
    }
    saveGlobalSettings();
    res.json({ success: true, settings: globalWarmupSettings });
});

app.post('/api/refresh-qr/:id', async (req, res) => {
    const id = req.params.id;
    const owner = accountsOwners.get(id);
    if (!owner || String(owner) !== String(req.body.ownerId)) {
        return res.status(403).json({ success: false });
    }
    const old = sessions.get(id);
    if (old) {
        try { old.end(new Error('QR refresh')); } catch {}
        sessions.delete(id);
    }
    qrState.delete(id);
    qrRequested.set(id, true);
    pendingQRCodes.delete(id);
    try {
        await connectAccount(id, null, owner);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.delete('/api/remove-account/:id', async (req, res) => {
    const { id } = req.params;
    if (sessions.has(id)) {
        sessions.get(id).end(new Error('Removing'));
        sessions.delete(id);
    }
    accountsOwners.delete(id);
    accountSettings.delete(id);
    saveOwners();
    saveSettings();
    qrState.delete(id);
    pendingQRCodes.delete(id);
    const authFolder = path.join(__dirname, 'auth_data', id);
    if (fs.existsSync(authFolder)) fs.rmSync(authFolder, { recursive: true, force: true });
    res.json({ success: true });
});

app.post('/api/login/:id', async (req, res) => {
    const { id } = req.params;
    const sock = sessions.get(id);
    if (!sock) return res.json({ success: false, message: 'Аккаунт не найден' });
    res.json({
        success: true,
        account: {
            name: sock.user?.name || 'No name',
            number: sock.user?.id?.split(':')[0] || '---'
        }
    });
});

app.get('/api/chats/:id', async (req, res) => {
    const { id } = req.params;
    const sock = sessions.get(id);
    if (!sock) return res.json({ success: false, message: 'Аккаунт не найден', chats: [] });
    try {
        const chats = await sock.chats?.all?.() || [];
        const chatList = chats.slice(0, 50).map(chat => ({
            id: chat.id,
            name: chat.name || chat.id.split('@')[0] || 'Chat',
            lastMessage: chat.lastMessage?.message?.conversation || 'Нет сообщений',
            unread: chat.unreadCount || 0
        }));
        res.json({ success: true, chats: chatList });
    } catch (error) {
        res.json({ success: false, message: error.message, chats: [] });
    }
});

app.post('/api/send-message', async (req, res) => {
    const { accountId, chatId, message } = req.body;
    const sock = sessions.get(accountId);
    if (!sock) return res.status(404).json({ success: false, message: 'Аккаунт не найден' });
    try {
        await sock.sendMessage(chatId, { text: message });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/send-message-number', async (req, res) => {
    const { accountId, phoneNumber, message } = req.body;
    const sock = sessions.get(accountId);
    if (!sock) return res.status(404).json({ success: false, message: 'Аккаунт не найден' });
    try {
        let number = phoneNumber.replace(/\D/g, '');
        if (!number.endsWith('@s.whatsapp.net')) number = number + '@s.whatsapp.net';
        await sock.sendMessage(number, { text: message });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/api/proxies', (req, res) => res.json({ proxies }));

app.post('/api/proxies', (req, res) => {
    const { proxies: text } = req.body;
    const lines = (text || '').split('\n').map(l => l.trim()).filter(l => l);
    fs.writeFileSync(proxiesFile, lines.join('\n'));
    proxies = lines;
    res.json({ success: true });
});

// ========== API ПРОГРЕВА ==========

app.post('/api/warmup/start', async (req, res) => {
    const { duration = 3, ownerId } = req.body;

    const allConnected = getAllConnectedAccounts();

    console.log(`🔥 Запрос прогрева. В системе: ${allConnected.length}`);

    // Проверяем что в системе достаточно аккаунтов
    if (allConnected.length < 2) {
        return res.json({
            success: false,
            message: `В системе только ${allConnected.length} аккаунт(ов). Нужно минимум 2.`,
            accountsCount: allConnected.length
        });
    }

    // Запускаем прогрев
    const taskId = 'task_' + Date.now();
    warmupTasks.set(taskId, {
        running: true,
        accounts: allConnected,
        duration: duration * 3600,
        startedAt: Date.now() + (globalWarmupSettings.delayStartMinutes * 60 * 1000),
        sent: 0,
        ownerId,
        pairCounts: {},
        messageCounter: 0
    });

    runWarmup(taskId);

    res.json({
        success: true,
        taskId,
        accountsCount: allConnected.length,
        delayMinutes: globalWarmupSettings.delayStartMinutes,
        message: `Прогрев запущен с ${allConnected.length} аккаунтами`
    });
});

app.post('/api/warmup/stop', (req, res) => {
    const { ownerId } = req.body || {};
    warmupTasks.forEach(task => {
        if (!ownerId || String(task.ownerId) === String(ownerId)) task.running = false;
    });
    res.json({ success: true });
});

app.get('/api/warmup-stats', (req, res) => {
    const tasks = Array.from(warmupTasks.values());
    res.json({
        success: true,
        stats: {
            totalSent: globalStats.totalSent,
            running: tasks.some(t => t.running),
            tasks: tasks.map(t => ({
                running: t.running,
                sent: t.sent,
                startedAt: t.startedAt,
                accounts: t.accounts
            }))
        }
    });
});

// ========== ЛОГИКА ПРОГРЕВА ==========
async function runWarmup(taskId) {
    const task = warmupTasks.get(taskId);
    if (!task) return;

    const delayMin = globalWarmupSettings.delayStartMinutes;
    console.log(`⏰ Прогрев ${taskId} начнется через ${delayMin} минут...`);
    await new Promise(r => setTimeout(r, delayMin * 60 * 1000));

    if (!task.running) return;
    console.log(`🔥 Прогрев ${taskId} начался!`);

    const endTime = Date.now() + task.duration * 1000;
    let pauseCounter = 0;

    function buildPairs(accounts) {
        const pairs = [];
        for (let i = 0; i < accounts.length; i++) {
            for (let j = 0; j < accounts.length; j++) {
                if (i !== j) pairs.push([accounts[i], accounts[j]]);
            }
        }
        for (let i = pairs.length - 1; i > 0; i--) {
            const k = Math.floor(Math.random() * (i + 1));
            [pairs[i], pairs[k]] = [pairs[k], pairs[i]];
        }
        return pairs;
    }

    let pairs = buildPairs(task.accounts);

    while (task.running && Date.now() < endTime) {
        const currentConnected = getAllConnectedAccounts();
        if (currentConnected.length !== task.accounts.length) {
            task.accounts = currentConnected;
            pairs = buildPairs(task.accounts);
            console.log(`🔄 Пересобраны пары. Аккаунтов: ${task.accounts.length}`);
        }

        for (const [fromAcc, toAcc] of pairs) {
            if (!task.running) break;
            if (Date.now() >= endTime) break;

            const fromSock = sessions.get(fromAcc);
            const toSock = sessions.get(toAcc);

            if (!fromSock || !toSock) continue;

            const toNumber = toSock.user?.id?.split(':')[0];
            if (!toNumber) continue;

            const pairKey = `${fromAcc}→${toAcc}`;
            const pairCount = task.pairCounts[pairKey] || 0;
            
            if (pairCount >= globalWarmupSettings.maxMessagesPerPair) {
                continue;
            }

            const jid = toNumber + '@s.whatsapp.net';

            // ========== СОХРАНЕНИЕ КОНТАКТА ПЕРЕД НОВОЙ ПАРОЙ ==========
            if (pairCount === 0) {
                console.log(`📇 Сохраняю контакт для новой пары ${fromAcc} → ${toAcc}`);
                const contactName = toSock.user?.name || toNumber;
                try {
                    await saveContact(fromSock, jid, contactName);
                    await new Promise(r => setTimeout(r, 1500));
                } catch (e) {
                    console.error(`⚠️ Ошибка сохранения:`, e.message);
                }
            }
            // ============================================================

            pauseCounter++;
            if (pauseCounter >= globalWarmupSettings.pauseEvery) {
                pauseCounter = 0;
                const pauseSec = getRandomDelay(globalWarmupSettings.pauseMinMinutes * 60, globalWarmupSettings.pauseMaxMinutes * 60);
                
                console.log(`⏸️ Пауза ${Math.round(pauseSec / 60)} мин...`);
                io.emit('warmup_progress', {
                    taskId, status: 'pause',
                    message: `⏸️ Пауза ${Math.round(pauseSec / 60)} минут`
                });
                
                await new Promise(r => setTimeout(r, pauseSec * 1000));
                if (!task.running) break;
            }

            const msg = getRandomMessage();
            const usePhoto = (task.messageCounter > 0 && task.messageCounter % globalWarmupSettings.photosEvery === 0);

            try {
                if (globalWarmupSettings.showTyping) {
                    try {
                        await fromSock.sendPresenceUpdate('composing', jid);
                        io.emit('warmup_progress', {
                            taskId, fromAcc, toAcc,
                            status: 'typing',
                            message: 'печатает...'
                        });
                    } catch (e) {}

                    const typingDelay = 2000 + Math.random() * 3000;
                    await new Promise(r => setTimeout(r, typingDelay));

                    try { await fromSock.sendPresenceUpdate('paused', jid); } catch (e) {}
                }

                let result;
                if (usePhoto) {
                    const photoPath = getRandomPhoto();
                    if (photoPath) {
                        result = await fromSock.sendMessage(jid, {
                            image: fs.readFileSync(photoPath),
                            caption: msg
                        });
                    } else {
                        result = await fromSock.sendMessage(jid, { text: msg });
                    }
                } else {
                    result = await fromSock.sendMessage(jid, { text: msg });
                }

                task.sent++;
                task.messageCounter++;
                task.pairCounts[pairKey] = pairCount + 1;
                globalStats.totalSent++;

                if (globalWarmupSettings.autoRead) {
                    const readDelay = 1000 + Math.random() * 3000;
                    setTimeout(async () => {
                        try { await toSock.readMessages([result.key]); } catch (e) {}
                    }, readDelay);
                }

                io.emit('warmup_progress', {
                    taskId, fromAcc, toAcc,
                    message: msg,
                    type: usePhoto ? 'photo' : 'text',
                    status: 'sent',
                    sent: task.sent,
                    pairCount: pairCount + 1,
                    pairLimit: globalWarmupSettings.maxMessagesPerPair
                });

            } catch (error) {
                console.error(`❌ Ошибка ${fromAcc} → ${toAcc}:`, error.message);
                io.emit('warmup_progress', {
                    taskId, fromAcc, toAcc, status: 'error', error: error.message
                });
            }

            const delay = getRandomDelay(globalWarmupSettings.delayMin, globalWarmupSettings.delayMax);
            await new Promise(r => setTimeout(r, delay * 1000));
        }
    }

    task.running = false;
    console.log(`⏹️ Прогрев ${taskId} завершен. Отправлено: ${task.sent}`);
    
    if (task.ownerId && task.sent > 0) {
        fetch('http://127.0.0.1:3001/internal/warmup-done', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ownerId: task.ownerId,
                taskId,
                sent: task.sent,
                duration: task.duration
            })
        }).catch(() => {});
    }
}

// ========== SOCKET ==========
io.on('connection', (socket) => {
    console.log('📱 Client connected');
});

// ========== ЗАПУСК ==========
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📁 Фото: ${photosDir}`);
    console.log(`🌐 Прокси: ${proxies.length}`);
    console.log(`💬 Сообщений в базе: ${MESSAGES.length}`);
    console.log(`⏱️ Задержка: ${globalWarmupSettings.delayMin}-${globalWarmupSettings.delayMax} сек`);
    console.log(`📨 Лимит на пару: ${globalWarmupSettings.maxMessagesPerPair}`);
});