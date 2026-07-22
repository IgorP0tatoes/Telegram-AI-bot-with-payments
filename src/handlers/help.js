import { Markup } from 'telegraf';
import { getSetting, getUser, acceptTerms } from '../database.js';

export function setupHelp(bot) {
    bot.hears('🆘 Помощь', showHelp);
    bot.action('menu_help', async (ctx) => { await ctx.answerCbQuery(); return showHelp(ctx); });

    bot.action('tos_policy', async (ctx) => {
        const text = await getSetting('policy_text', '<i>Политика не задана.</i>');
        const user = await getUser(ctx.from.id);
        let kb;
        
        if (!user || user.accepted_terms === false) {
            kb = [
                [Markup.button.callback('📄 Соглашение', 'tos_agreement')],
                [Markup.button.callback('✅ Принять', 'tos_accept')]
            ];
        } else {
            kb = [[Markup.button.callback('📄 Соглашение', 'tos_agreement')]];
        }
        await ctx.answerCbQuery();
        return ctx.editMessageText(`📜 <b>Политика конфиденциальности</b>\n\n${text}`, {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: kb }
        }).catch(() => {});
    });

    bot.action('tos_agreement', async (ctx) => {
        const text = await getSetting('agreement_text', '<i>Соглашение не задано.</i>');
        const user = await getUser(ctx.from.id);
        let kb;
        if (!user || user.accepted_terms === false) {
            kb = [
                [Markup.button.callback('📜 Политика', 'tos_policy')],
                [Markup.button.callback('✅ Принять', 'tos_accept')]
            ];
        } else {
            kb = [[Markup.button.callback('📜 Политика', 'tos_policy')]];
        }
        await ctx.answerCbQuery();
        return ctx.editMessageText(`📄 <b>Пользовательское соглашение</b>\n\n${text}`, {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: kb }
        }).catch(() => {});
    });

    bot.action('tos_accept', async (ctx) => {
        const userId = ctx.from.id;
        await acceptTerms(userId);
        await ctx.answerCbQuery("✅ Условия приняты!");
        await ctx.deleteMessage().catch(() => {});
        
        return ctx.reply("Добро пожаловать!", {
            reply_markup: {
                keyboard: [
                    [{ text: '👤 Профиль' }, { text: '🧠 Настройка ИИ' }],
                    [{ text: '👥 Рефералы' }, { text: '🆘 Помощь' }, { text: '🧹 Очистить контекст' }]
                ],
                resize_keyboard: true
            }
        });
    });
}

export async function showHelp(ctx) {
    // ДОСТАЕМ ТЕКСТЫ НАПРЯМУЮ ИЗ БАЗЫ (АДМИНКИ)
    const faqText = await getSetting('faq_text', 'Здесь пока пусто.', true);
    const supportUrl = await getSetting('support_url', '');

    const msg = `🆘 <b>Помощь и Поддержка</b>\n\n<b>FAQ:</b>\n${faqText}`;

    const kb = [
        [Markup.button.callback('📜 Политика', 'tos_policy'), Markup.button.callback('📄 Соглашение', 'tos_agreement')]
    ];

    // Если в админке указана ссылка на саппорт - добавляем кнопку
    if (supportUrl && supportUrl !== ' ' && supportUrl !== '') {
        kb.push([Markup.button.url('🎧 Написать в поддержку', supportUrl)]);
    }

    if (ctx.callbackQuery) {
        return ctx.editMessageText(msg, { parse_mode: 'HTML', reply_markup: { inline_keyboard: kb } }).catch(() => {});
    } else {
        return ctx.reply(msg, { parse_mode: 'HTML', reply_markup: { inline_keyboard: kb } });
    }
}