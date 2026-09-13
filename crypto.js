import crypto from 'crypto';

// ====================================================
// НАСТРОЙКИ CRYPTOBOT
// ====================================================
// 1. Открой @CryptoBot в Telegram
// 2. /start → Crypto Pay → Create App
// 3. Получи токен и вставь сюда
const CRYPTO_PAY_TOKEN = '633863:AABsUfzqlWrE4dcMztxPckrM1i82p78BCSA';
// ====================================================

const API_URL = 'https://pay.crypt.bot/api';

// ========== СОЗДАТЬ СЧЁТ ==========
export async function createInvoice(amount, userId, description = 'Пополнение баланса') {
    try {
        const res = await fetch(`${API_URL}/createInvoice`, {
            method: 'POST',
            headers: {
                'Crypto-Pay-API-Token': CRYPTO_PAY_TOKEN,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                asset: 'USDT',
                amount: amount.toString(),
                description: description,
                payload: JSON.stringify({ userId }),
                paid_btn_name: 'callback',
                paid_btn_url: 'https://t.me/your_bot_username',
                expires_in: 3600
            })
        });
        
        const data = await res.json();
        if (!data.ok) throw new Error(data.description || 'Ошибка API');
        
        return {
            success: true,
            invoiceId: data.result.invoice_id,
            payUrl: data.result.bot_invoice_url,
            amount: data.result.amount
        };
    } catch (error) {
        console.error('CryptoBot error:', error);
        return { success: false, error: error.message };
    }
}

// ========== ПРОВЕРИТЬ СТАТУС ==========
export async function checkInvoice(invoiceId) {
    try {
        const res = await fetch(`${API_URL}/getInvoices?invoice_ids=${invoiceId}`, {
            headers: {
                'Crypto-Pay-API-Token': CRYPTO_PAY_TOKEN
            }
        });
        
        const data = await res.json();
        if (!data.ok) return { success: false };
        
        const invoice = data.result.items[0];
        return {
            success: true,
            paid: invoice.status === 'paid',
            amount: invoice.amount,
            payload: invoice.payload
        };
    } catch (error) {
        return { success: false };
    }
}

// ========== СОЗДАТЬ ЧЕК (для быстрой оплаты) ==========
export async function createCheck(amount, userId) {
    try {
        const res = await fetch(`${API_URL}/createCheck`, {
            method: 'POST',
            headers: {
                'Crypto-Pay-API-Token': CRYPTO_PAY_TOKEN,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                asset: 'USDT',
                amount: amount.toString(),
                pin_to_user_id: userId
            })
        });
        
        const data = await res.json();
        if (!data.ok) throw new Error(data.description);
        
        return {
            success: true,
            checkUrl: data.result.bot_check_url
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
}