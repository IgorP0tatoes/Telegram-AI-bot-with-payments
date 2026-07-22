import { Queue, Worker } from 'bullmq';
import { generateResponse } from './ai.js';
import { decrementFreeRequest } from './database.js';

// Парсим URL из .env и жестко задаем IPv4 (family: 4)
const redisUrl = new URL(process.env.REDIS_URL);
const connection = {
    host: redisUrl.hostname,
    port: parseInt(redisUrl.port, 10) || 6379,
    family: 4 // Спасает от ошибки EAI_AGAIN в Docker
};

export const aiQueue = new Queue('ai-requests', { connection });

export function startWorker(bot) {
    new Worker('ai-requests', async job => {
        const { userId, text, chatId, shouldDecrement, tempMsgId } = job.data;
        try {
            const response = await generateResponse(userId, text);
            
            if (shouldDecrement) {
                await decrementFreeRequest(userId);
            }
            
            // ЕСЛИ ЕСТЬ ФОТО - отправляем картинку и текст ОДНИМ сообщением (в виде подписи)
            if (response.photo) {
                try {
                    // Сначала удаляем временное сообщение "Печатаю ответ..."
                    if (tempMsgId) {
                        await bot.telegram.deleteMessage(chatId, tempMsgId).catch(() => {});
                    }
                    
                    // Защита от лимитов Telegram (максимальная длина подписи к фото - 1024 символа)
                    let captionText = response.text || "";
                    if (captionText.length > 1024) {
                        captionText = captionText.substring(0, 1020) + "...";
                    }
                    
                    // Отправляем фото с подписью
                    await bot.telegram.sendPhoto(chatId, response.photo, { 
                        caption: captionText, 
                        parse_mode: 'Markdown' 
                    });
                } catch (imgError) {
                    console.error(`[TELEGRAM ERROR] Не удалось отправить фото юзеру ${userId}:`, imgError.message);
                    const fallbackText = response.text + "\n\n❌ _Фото сгенерировано, но Telegram отказался его загружать._";
                    if (tempMsgId) {
                        await bot.telegram.editMessageText(chatId, tempMsgId, null, fallbackText, { parse_mode: 'Markdown' }).catch(() => {});
                    } else {
                        await bot.telegram.sendMessage(chatId, fallbackText, { parse_mode: 'Markdown' });
                    }
                }
            } else {
                // Если фото нет, отправляем текст
                const extraOptions = { parse_mode: 'Markdown' };
                
                // Если нейросеть сказала, что лимит исчерпан — прикрепляем кнопку
                if (response.showBuyButton) {
                    extraOptions.reply_markup = {
                        inline_keyboard: [[{ text: '⭐️ Перейти в магазин', callback_data: 'trigger_buy' }]]
                    };
                }

                if (tempMsgId) {
                    await bot.telegram.editMessageText(chatId, tempMsgId, null, response.text, extraOptions)
                        .catch(async () => {
                            await bot.telegram.sendMessage(chatId, response.text, extraOptions);
                        });
                } else {
                    await bot.telegram.sendMessage(chatId, response.text, extraOptions);
                }
            }
        } catch (error) {
            console.error(`[ОШИБКА ИИ] Юзер ${userId}:`, error);
            const errorMsg = "❌ _Извините, произошла ошибка генерации ответа._";
            if (tempMsgId) {
                await bot.telegram.editMessageText(chatId, tempMsgId, null, errorMsg, { parse_mode: 'Markdown' }).catch(() => {});
            } else {
                await bot.telegram.sendMessage(chatId, errorMsg, { parse_mode: 'Markdown' });
            }
        }
    }, { 
        connection,
        concurrency: 5 
    });
}