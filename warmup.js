const socket = io();
let currentUserId = localStorage.getItem('userId') || '';
let accounts = [];
let selectedAccounts = new Set();
let selectedHours = 3;
let warmupRunning = false;
let totalSent = 0;

if (!currentUserId) {
    alert('Сначала введите ваш Telegram ID на главной странице');
    window.location.href = '/';
}

// Кнопки длительности
document.querySelectorAll('.duration-btn').forEach(btn => {
    btn.addEventListener('click', function() {
        document.querySelectorAll('.duration-btn').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        selectedHours = parseInt(this.dataset.hours);
    });
});

async function loadAccounts() {
    try {
        const res = await fetch(`/api/accounts?ownerId=${currentUserId}`);
        const data = await res.json();
        accounts = data.filter(a => a.status === 'connected');
        renderAccounts();
        document.getElementById('totalAccounts').textContent = accounts.length;
    } catch (e) {}
}

function renderAccounts() {
    const list = document.getElementById('accountsList');
    if (!accounts.length) {
        list.innerHTML = '<div style="text-align:center;padding:40px;color:#999;">Нет подключенных аккаунтов</div>';
        return;
    }
    list.innerHTML = accounts.map((acc, i) => {
        const active = selectedAccounts.has(acc.id);
        return `
            <div class="account-item ${active ? 'active' : ''}" onclick="toggleAccount('${acc.id}')">
                <span class="num">#${i+1}</span>
                <div class="info">
                    <div style="font-weight:500;">${acc.name}</div>
                    <div style="font-size:12px;color:#999;">${acc.number}</div>
                </div>
                <div class="checkbox ${active ? 'checked' : ''}"><i class="fas fa-check"></i></div>
            </div>
        `;
    }).join('');
}

function toggleAccount(id) {
    if (selectedAccounts.has(id)) selectedAccounts.delete(id);
    else selectedAccounts.add(id);
    renderAccounts();
    document.getElementById('selectedCount').textContent = selectedAccounts.size;
}

document.getElementById('startBtn').addEventListener('click', async function() {
    if (warmupRunning) {
        await fetch('/api/warmup/stop', { method: 'POST' });
        warmupRunning = false;
        this.innerHTML = '<i class="fas fa-play"></i> Запустить прогрев';
        this.classList.remove('running');
        document.getElementById('status').textContent = '⏹️ Остановлен';
        return;
    }

    if (selectedAccounts.size < 2) {
        showToast('❌ Выберите минимум 2 аккаунта');
        return;
    }

    try {
        const res = await fetch('/api/warmup/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                accountIds: Array.from(selectedAccounts),
                duration: selectedHours,
                delayBetween: 50,
                ownerId: currentUserId
            })
        });
        const data = await res.json();
        
        if (data.success) {
            warmupRunning = true;
            this.innerHTML = '<i class="fas fa-stop"></i> Остановить';
            this.classList.add('running');
            document.getElementById('status').textContent = `🔥 Запущен на ${selectedHours}ч. Начнется через 20 минут`;
            document.getElementById('status').className = 'status running';
            showToast('✅ Прогрев запущен!');
            
            // Очищаем лог
            document.getElementById('log').innerHTML = '';
        } else {
            showToast('❌ ' + data.message);
        }
    } catch (e) {
        showToast('❌ Ошибка');
    }
});

// Сокет - получаем прогресс
socket.on('warmup_progress', (data) => {
    const log = document.getElementById('log');
    if (log.children.length === 1 && log.children[0].textContent.includes('Лог появится')) {
        log.innerHTML = '';
    }
    
    const isLike = data.status === 'sent';
    const item = document.createElement('div');
    item.className = `log-item ${isLike ? 'like' : 'dislike'}`;
    item.innerHTML = `
        <span class="icon">${isLike ? '✅' : '❌'}</span>
        <div class="text">
            <strong>${data.fromAcc}</strong> → <strong>${data.toAcc}</strong>
            <div style="font-size:12px;color:#666;">${data.message || data.error || ''}</div>
        </div>
        <span class="time">${new Date().toLocaleTimeString()}</span>
    `;
    log.appendChild(item);
    log.scrollTop = log.scrollHeight;
    
    if (isLike) {
        totalSent++;
        document.getElementById('sentCount').textContent = totalSent;
    }
});

socket.on('warmup_error', (data) => {
    showToast(`❌ Ошибка с аккаунтом ${data.accountId}. Прогрев остановлен!`);
    warmupRunning = false;
    document.getElementById('startBtn').innerHTML = '<i class="fas fa-play"></i> Запустить прогрев';
    document.getElementById('startBtn').classList.remove('running');
    document.getElementById('status').textContent = `❌ Остановлен: проверьте ${data.accountId}`;
    document.getElementById('status').className = 'status';
});

function showToast(msg) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
}

loadAccounts();
setInterval(loadAccounts, 15000);