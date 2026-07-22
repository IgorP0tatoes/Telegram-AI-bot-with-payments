import { Queue, Worker } from 'bullmq';

// Парсим URL из .env и жестко задаем IPv4 (family: 4)
const redisUrl = new URL(process.env.REDIS_URL);
const connection = {
    host: redisUrl.hostname,
    port: parseInt(redisUrl.port, 10) || 6379,
    family: 4 // Спасает от ошибки EAI_AGAIN в Docker
};

export const broadcastQueue = new Queue('broadcast', { connection });

export function startBroadcastWorker(bot) {
    new Worker('broadcast', async job => {
        const { userId, msgData } = job.data;
        // Для обратной совместимости, если в очереди остались старые задачи
        const data = msgData || { type: 'text', text: job.data.messageText, btn: 'none' };

        try {
            let replyMarkup = {};
            if (data.btn && data.btn !== 'none') {
                const btnNames = { profile: '👤 Профиль', ai: '🧠 Настройка ИИ', refs: '👥 Рефералы', help: '🆘 Помощь', store: '⭐️ Магазин' };
                const cbData = { profile: 'menu_profile', ai: 'menu_ai', refs: 'menu_refs', help: 'menu_help', store: 'trigger_buy' };
                replyMarkup = {
                    inline_keyboard: [[{ text: btnNames[data.btn] || data.btn, callback_data: cbData[data.btn] || data.btn }]]
                };
            }

            if (data.type === 'text') {
                await bot.telegram.sendMessage(userId, data.text, {
                    parse_mode: 'HTML',
                    reply_markup: replyMarkup.inline_keyboard ? replyMarkup : undefined
                });
            } else if (data.type === 'photo') {
                await bot.telegram.sendPhoto(userId, data.file_id, {
                    caption: data.caption,
                    parse_mode: 'HTML',
                    reply_markup: replyMarkup.inline_keyboard ? replyMarkup : undefined
                });
            } else if (data.type === 'video') {
                await bot.telegram.sendVideo(userId, data.file_id, {
                    caption: data.caption,
                    parse_mode: 'HTML',
                    reply_markup: replyMarkup.inline_keyboard ? replyMarkup : undefined
                });
            } else if (data.type === 'document') {
                await bot.telegram.sendDocument(userId, data.file_id, {
                    caption: data.caption,
                    parse_mode: 'HTML',
                    reply_markup: replyMarkup.inline_keyboard ? replyMarkup : undefined
                });
            } else if (data.type === 'animation') {
                await bot.telegram.sendAnimation(userId, data.file_id, {
                    caption: data.caption,
                    parse_mode: 'HTML',
                    reply_markup: replyMarkup.inline_keyboard ? replyMarkup : undefined
                });
            }

            // Пауза от спам-лимитов (35 сообщений в секунду Telegram)
            await new Promise(resolve => setTimeout(resolve, 35));
        } catch (error) {
            // Игнорируем ошибки (например, юзер заблокировал бота)
        }
    }, {
        connection,
        concurrency: 1 // Строго по одному сообщению
    });
}
