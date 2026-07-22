import { getUser, createUser, addFreeRequests } from './database.js';

export async function processReferral(ctx) {
    const userId = ctx.from.id;
    const payload = ctx.payload; // Текст после /start (например, ref_12345)

    let referrerId = null;
    if (payload && payload.startsWith('ref_')) {
        referrerId = parseInt(payload.split('_')[1], 10);
    }

    const existingUser = await getUser(userId);

    if (!existingUser) {
        await createUser(userId, referrerId);
        
        // Если пришел по рефке и не по своей собственной
        if (referrerId && referrerId !== userId) {
            await addFreeRequests(referrerId, 10);
            try {
                await ctx.telegram.sendMessage(referrerId, "🎉 По вашей ссылке зарегистрировался новый пользователь!\nВам начислено *+10 бесплатных запросов*.", { parse_mode: 'Markdown' });
            } catch (e) {
                // Игнорируем ошибку, если юзер заблокировал бота
            }
            await addFreeRequests(userId, 5); 
        }
    }
}