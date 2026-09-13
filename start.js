import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

console.log('🚀 Запуск WhatsApp Panel...\n');

// ========== ЗАПУСК СЕРВЕРА ==========
const server = spawn('node', ['server.js'], {
    cwd: __dirname,
    stdio: 'inherit',
    shell: true
});

server.on('error', (err) => {
    console.error('❌ Ошибка запуска сервера:', err.message);
});

server.on('exit', (code) => {
    if (code !== 0) {
        console.log(`⚠️ Сервер завершился с кодом ${code}`);
    }
});

// ========== ЗАПУСК БОТА (с задержкой 3 сек) ==========
setTimeout(() => {
    console.log('\n🤖 Запуск Telegram бота...\n');
    
    const bot = spawn('node', ['bot.js'], {
        cwd: __dirname,
        stdio: 'inherit',
        shell: true
    });

    bot.on('error', (err) => {
        console.error('❌ Ошибка запуска бота:', err.message);
    });

    bot.on('exit', (code) => {
        if (code !== 0) {
            console.log(`⚠️ Бот завершился с кодом ${code}`);
        }
    });

    // Graceful shutdown
    process.on('SIGINT', () => {
        console.log('\n⏹️ Остановка всех процессов...');
        server.kill();
        bot.kill();
        process.exit(0);
    });

    process.on('SIGTERM', () => {
        server.kill();
        bot.kill();
        process.exit(0);
    });

}, 3000);

// Обработка выхода сервера
process.on('exit', () => {
    try { server.kill(); } catch (e) {}
    try { bot?.kill(); } catch (e) {}
});