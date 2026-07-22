import { Markup } from 'telegraf';
import { getUser, createUser, isFreeModeEnabled, getReferralsCount, claimDailyBonus, getSetting } from '../database.js';

export function setupProfile(bot, userState, themeConfig) {
    bot.hears('👤 Профиль', (ctx) => showProfile(ctx, userState, themeConfig));
    bot.action('menu_profile', async (ctx) => { await ctx.answerCbQuery(); return showProfile(ctx, userState, themeConfig); });

    bot.hears('👥 Рефералы', showRefs);
    bot.action('menu_refs', async (ctx) => { await ctx.answerCbQuery(); return showRefs(ctx); });

    // Обработчики Ежедневного бонуса
    bot.hears('🎁 Ежедневный бонус', showDailyBonus);
    bot.action('claim_daily_bonus', async (ctx) => { 
        await ctx.answerCbQuery().catch(()=>{}); 
        return showDailyBonus(ctx); 
    });

    // Обработчик проверки подписки на канал и выдачи бонуса
    bot.action('check_bonus_sub', async (ctx) => {
        const channelId = await getSetting('bonus_channel_id', '');
        
        if (channelId && channelId.length > 2) {
            // Жесткая очистка ID от невидимых символов
            const cleanChannelId = channelId.replace(/['"\s\u200B-\u200D\uFEFF]/g, '');
            try {
                const member = await ctx.telegram.getChatMember(cleanChannelId, ctx.from.id);
                if (!['member', 'administrator', 'creator'].includes(member.status)) {
                    return ctx.answerCbQuery('❌ Вы не подписались на канал!', { show_alert: true });
                }
            } catch (e) {
                console.error("Ошибка проверки подписки:", e);
                return ctx.answerCbQuery('⚠️ Ошибка системы. Убедитесь, что бот - администратор в канале!', { show_alert: true });
            }
        }

        // Выдача бонуса (success - это boolean true/false)
        const success = await claimDailyBonus(ctx.from.id);
        if (success) {
            await ctx.answerCbQuery('✅ Бонус успешно начислен!', { show_alert: true });
            return showProfile(ctx, userState, themeConfig);
        } else {
            await ctx.answerCbQuery('⏳ Ты уже забирал бонус сегодня! Приходи завтра.', { show_alert: true });
        }
    });

    bot.action('enter_promocode', async (ctx) => {
        userState[ctx.from.id] = 'WAITING_FOR_PROMOCODE';
        await ctx.answerCbQuery();
        return ctx.reply("🎫 Введите промокод:", {
            reply_markup: { inline_keyboard: [[{ text: '❌ Отмена', callback_data: 'cancel_input' }]] }
        });
    });
}

// Отрисовка меню Ежедневного бонуса
async function showDailyBonus(ctx) {
    const channelId = await getSetting('bonus_channel_id', '');
    const channelUrl = await getSetting('bonus_channel_url', '');

    const msg = `🎁 *Ежедневный бонус*\n\nЗаходи каждый день и получай случайным образом от *1 до 3 бесплатных сообщений*!\n\n` +
                (channelId && channelUrl ? `⚠️ *Обязательное условие:* Для получения бонуса необходимо быть подписанным на наш канал.` : `Жми кнопку ниже, чтобы забрать свои сообщения.`);

    const kb = [];
    if (channelId && channelUrl) {
        kb.push([Markup.button.url('📢 Подписаться на канал', channelUrl)]);
    }
    kb.push([Markup.button.callback('✅ Проверить и забрать', 'check_bonus_sub')]);
    kb.push([Markup.button.callback('⬅️ В профиль', 'menu_profile')]);

    if (ctx.callbackQuery) {
        return ctx.editMessageText(msg, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: kb } }).catch(() => {});
    } else {
        return ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: kb } });
    }
}

export async function showProfile(ctx, userState, themeConfig) {
    if (userState) delete userState[ctx.from.id];
    const userId = ctx.from.id;
    let user = await getUser(userId);
    if (!user) {
        await createUser(userId);
        user = await getUser(userId);
    }
    
    const freeMode = await isFreeModeEnabled();
    const mode = user.roleplay_mode || 'flirt'; 
    const theme = themeConfig[mode] || themeConfig['default'];
    
    const maxLevel = 150; 
    let percent = 0;
    let fillCount = 0;
    let statusText = theme.max;

    if (freeMode) {
        percent = 100;
        fillCount = 10;
    } else {
        percent = Math.min(100, Math.round((user.text_balance / maxLevel) * 100));
        fillCount = Math.floor(percent / 10);
        if (user.text_balance > 0 && fillCount === 0) fillCount = 1;
        
        if (!user.has_purchased && user.text_balance === 0) statusText = "💔 Забытый (Жми на магазин!)";
        else if (user.text_balance > 150) statusText = theme.statuses[3];
        else if (user.text_balance > 50)  statusText = theme.statuses[2];
        else if (user.text_balance > 10)  statusText = theme.statuses[1];
        else statusText = theme.statuses[0];
    }

    const progressBar = theme.fill.repeat(fillCount) + theme.empty.repeat(10 - fillCount);
    const levelText = freeMode ? 'MAX' : `${percent}%`;

    const msg = `👤 *Твой профиль*\n\n` +
                `🔑 Твой ID: \`${userId}\`\n\n` +
                `*${theme.title}:* ${levelText}\n` +
                `[${progressBar}]\n` +
                `💬 Статус: *${statusText}*\n\n` +
                `✉️ Сообщений: *${user.text_balance}*\n` +
                `📸 Фото: *${user.image_balance}*`;

    const kb = Markup.inlineKeyboard([
        [Markup.button.callback('⭐️ Пополнить баланс', 'trigger_buy')],
        [Markup.button.callback('🎁 Ежедневный бонус', 'claim_daily_bonus')],
        [Markup.button.callback('🎫 Ввести промокод', 'enter_promocode')]
    ]);

    if (ctx.callbackQuery) {
        return ctx.editMessageText(msg, { parse_mode: 'Markdown', reply_markup: kb.reply_markup }).catch(() => {});
    }
    return ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: kb.reply_markup });
}

export async function showRefs(ctx) {
    const userId = ctx.from.id;
    const refCount = await getReferralsCount(userId);
    const botUsername = ctx.botInfo.username;
    const msg = `👥 *Партнерская программа*\n\n` +
                `Приглашай друзей и получай бонусы!\n\n` +
                `🔸 За каждого приглашенного друга: *+5 сообщений*.\n` +
                `🔸 Если пригласили тебя: *+10 сообщений*.\n\n` +
                `👤 Приглашено:* ${refCount} чел.\n\n` +
                `🔗 Твоя ссылка:*\n` +
                `\`https://t.me/${botUsername}?start=ref_${userId}\``;
    return ctx.reply(msg, { parse_mode: 'Markdown' });
}