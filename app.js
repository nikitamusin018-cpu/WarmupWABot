const socket = io();
let currentUserId = localStorage.getItem('userId') || '';
let currentAccountIdForChats = null;

document.getElementById('userIdInput').value = currentUserId;

function saveUserId() {
    const input = document.getElementById('userIdInput').value.trim();
    if (!input) {
        showToast('❌ Введите ID');
        return;
    }
    currentUserId = input;
    localStorage.setItem('userId', currentUserId);
    showToast('✅ ID сохранен');
    loadAccounts();
}

async function addAccountFromSite() {
    if (!currentUserId) {
        showToast('❌ Сначала укажите Telegram ID');
        return;
    }

    const accountId = `web_${currentUserId}_${Date.now()}`;
    const modal = document.getElementById('qrModal');
    document.getElementById('qrTitle').textContent = 'Создание QR-кода';
    document.getElementById('qrStatus').textContent = 'Подключаем WhatsApp…';
    document.getElementById('qrImage').style.display = 'none';
    document.getElementById('qrLoader').style.display = 'block';
    modal.style.display = 'block';

    try {
        const res = await fetch('/api/add-account', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accountId, ownerId: currentUserId })
        });
        const data = await res.json();
        if (!data.success) {
            document.getElementById('qrStatus').textContent = '❌ ' + (data.message || 'Не удалось создать QR');
            document.getElementById('qrLoader').style.display = 'none';
        }
    } catch (e) {
        document.getElementById('qrStatus').textContent = '❌ Сервер недоступен';
        document.getElementById('qrLoader').style.display = 'none';
    }
}

function closeQRModal() {
    document.getElementById('qrModal').style.display = 'none';
}

async function loadAccounts() {
    if (!currentUserId) {
        document.getElementById('userStatus').textContent = '⚠️ Введите ваш Telegram ID';
        return;
    }
    
    try {
        const res = await fetch(`/api/accounts?ownerId=${currentUserId}`);
        const accounts = await res.json();
        renderAccounts(accounts);
        updateSendSelect(accounts);
        document.getElementById('userStatus').textContent = `📱 Аккаунтов: ${accounts.length}`;
    } catch (e) {
        showToast('❌ Ошибка загрузки');
    }
}

function renderAccounts(accounts) {
    const grid = document.getElementById('accountsGrid');
    if (!accounts.length) {
        grid.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-robot"></i>
                <p>Нет аккаунтов</p>
                <p style="font-size:14px;">Добавьте аккаунт через Telegram бота</p>
            </div>
        `;
        return;
    }
    grid.innerHTML = accounts.map((acc, i) => `
        <div class="account-card ${acc.status === 'disconnected' ? 'disconnected' : ''}">
            <div class="account-header">
                <span class="account-index">#${i + 1}</span>
                <span class="account-status ${acc.status === 'disconnected' ? 'disconnected' : ''}">
                    ${acc.status === 'connected' ? '✅ Онлайн' : '❌ Офлайн'}
                </span>
            </div>
            <div class="account-name">${acc.name}</div>
            <div class="account-number"><i class="fas fa-phone"></i> ${acc.number}</div>
            <div class="account-actions">
                <button class="btn-login" onclick="loginAccount('${acc.id}')" ${acc.status === 'disconnected' ? 'disabled' : ''}>
                    <i class="fas fa-comments"></i> Чаты
                </button>
            </div>
        </div>
    `).join('');
}

function updateSendSelect(accounts) {
    const select = document.getElementById('sendAccountSelect');
    const connected = accounts.filter(a => a.status === 'connected');
    select.innerHTML = '<option value="">Выберите аккаунт</option>';
    connected.forEach(acc => {
        const opt = document.createElement('option');
        opt.value = acc.id;
        opt.textContent = `${acc.name} (${acc.number})`;
        select.appendChild(opt);
    });
}

async function loginAccount(id) {
    try {
        const res = await fetch(`/api/login/${id}`, { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            currentAccountIdForChats = id;
            document.getElementById('chatAccountName').innerHTML = `<i class="fas fa-whatsapp" style="color:#25d366;"></i> ${data.account.name}`;
            document.getElementById('chatModal').style.display = 'block';
            loadChats(id);
        }
    } catch (e) {
        showToast('❌ Ошибка');
    }
}

async function loadChats(id) {
    document.getElementById('chatList').innerHTML = '<div style="text-align:center;padding:40px;"><div class="loader"></div></div>';
    try {
        const res = await fetch(`/api/chats/${id}`);
        const data = await res.json();
        const list = document.getElementById('chatList');
        if (data.success && data.chats.length) {
            list.innerHTML = data.chats.map(chat => `
                <div style="padding:12px;border-bottom:1px solid #f0f0f0;cursor:pointer;" onclick="openChat('${chat.id}', '${chat.name.replace(/'/g, "\\'")}')">
                    <div style="font-weight:bold;">${chat.name}</div>
                    <div style="font-size:13px;color:#666;">${chat.lastMessage}</div>
                </div>
            `).join('');
        } else {
            list.innerHTML = '<div style="text-align:center;padding:40px;color:#999;">Нет чатов</div>';
        }
    } catch (e) {
        showToast('❌ Ошибка');
    }
}

function openChat(chatId, name) {
    const message = prompt(`Сообщение для ${name}:`);
    if (!message) return;
    
    fetch('/api/send-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: currentAccountIdForChats, chatId, message })
    }).then(r => r.json()).then(data => {
        if (data.success) showToast('✅ Отправлено');
        else showToast('❌ Ошибка');
    });
}

async function sendMessageByNumber() {
    const accountId = document.getElementById('sendAccountSelect').value;
    const phone = document.getElementById('sendPhone').value.trim();
    const msg = document.getElementById('sendMessage').value.trim();
    
    if (!accountId) return showToast('❌ Выберите аккаунт');
    if (!phone) return showToast('❌ Введите номер');
    if (!msg) return showToast('❌ Введите сообщение');
    
    try {
        const res = await fetch('/api/send-message-number', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accountId, phoneNumber: phone, message: msg })
        });
        const data = await res.json();
        if (data.success) {
            showToast('✅ Отправлено');
            document.getElementById('sendMessage').value = '';
        } else {
            showToast('❌ ' + data.message);
        }
    } catch (e) {
        showToast('❌ Ошибка');
    }
}

// ========== ПРОКСИ ==========
function showProxies() {
    document.getElementById('proxyModal').style.display = 'block';
    fetch('/api/proxies').then(r => r.json()).then(data => {
        document.getElementById('proxyTextarea').value = (data.proxies || []).join('\n');
    });
}

function closeProxies() {
    document.getElementById('proxyModal').style.display = 'none';
}

async function saveProxies() {
    const text = document.getElementById('proxyTextarea').value;
    try {
        await fetch('/api/proxies', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ proxies: text })
        });
        showToast('✅ Прокси сохранены');
        closeProxies();
    } catch (e) {
        showToast('❌ Ошибка');
    }
}

function showToast(msg) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
}

// ========== SOCKET ==========
socket.on('qr', (data) => {
    if (!data || !data.qr) return;
    if (currentUserId && data.ownerId && String(data.ownerId) !== String(currentUserId)) return;

    const modal = document.getElementById('qrModal');
    document.getElementById('qrTitle').textContent = 'Вход в WhatsApp';
    document.getElementById('qrStatus').textContent = 'Откройте WhatsApp → Связанные устройства → Привязать устройство и отсканируйте QR';
    const img = document.getElementById('qrImage');
    img.src = data.qr;
    img.style.display = 'block';
    document.getElementById('qrLoader').style.display = 'none';
    modal.style.display = 'block';
});

socket.on('status', (data) => {
    showToast(`📱 ${data.status === 'connected' ? 'Подключен' : 'Отключен'}`);
    loadAccounts();
});

loadAccounts();
setInterval(loadAccounts, 15000);