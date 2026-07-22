import { Markup } from 'telegraf';
import { getUser, setUserPrompt, clearHistory } from '../database.js';
import { promptTemplates } from '../prompts.js';

export function setupAi(bot, userState, modeNames) {
    bot.hears('🧠 Настройка ИИ', (ctx) => showAi(ctx, modeNames));
    bot.action('menu_ai', async (ctx) => { await ctx.answerCbQuery(); return showAi(ctx, modeNames); });

    bot.action(/prompt_(default|psych|coder|eng|flirthot|flirt|romance|bold|dom|hardcore|truth_dare)/, async (ctx) => {
        const mode = ctx.match[1];
        const action = ctx.match[0]; // Название экшена, например 'prompt_flirt'
        const text = promptTemplates[action]; // Берем текст промпта из словаря
        
        const modeName = modeNames[mode] || 'Неизвестно';
        const userId = ctx.from.id;

        // Сохраняем новый промпт и режим в базу данных
        await setUserPrompt(userId, text, mode);
        await clearHistory(userId); // Очищаем историю

        await ctx.answerCbQuery(`Режим изменен: ${modeName}`);
        const msg = `✅ *Режим успешно изменен!*\n\n_Память прошлого диалога очищена._\n\n*Текущий режим:*\n🎭 _${modeName}_`;
        
        return ctx.editMessageText(msg, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'menu_ai' }]]
            }
        }).catch(() => {});
    });

    bot.action('prompt_custom', async (ctx) => {
        const userId = ctx.from.id;
        userState[userId] = 'WAITING_FOR_CUSTOM_PROMPT';
        await ctx.answerCbQuery();
        return ctx.editMessageText(
            `⚙️ *Свой системный промпт*\n\n` +
            `Отправьте мне текст, который опишет, как бот должен с вами общаться.\n\n` +
            `_Например: "Отвечай только стихами" или "Веди себя как 18 летняя студентка"_\n\n` +
            `👇 *Жду ваш текст (до 1000 символов):*`,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[{ text: '❌ Отмена', callback_data: 'cancel_input' }]]
                }
            }
        ).catch(() => {});
    });

    bot.hears('🧹 Очистить контекст', async (ctx) => {
        await clearHistory(ctx.from.id);
        return ctx.reply("🧹 Память бота очищена. Начинаем с чистого листа!");
    });
}

export async function showAi(ctx, modeNames) {
    const user = await getUser(ctx.from.id);
    const currentMode = user.roleplay_mode || 'flirt';
    const modeName = modeNames[currentMode] || 'Неизвестно';

    const msg = `🧠 *Настройки ИИ*\n\nВыберите роль и характер для бота. При смене режима текущий диалог будет очищен.\n\n*Текущий режим:*\n🎭 _${modeName}_`;

    const kb = Markup.inlineKeyboard([
        [Markup.button.callback('💕 Романтика', 'prompt_romance'), Markup.button.callback('😏 Дерзкая', 'prompt_bold')],
        [Markup.button.callback('👠 Доминантка', 'prompt_dom'), Markup.button.callback('🖤 Хардкор', 'prompt_hardcore')],
        [Markup.button.callback('🎲 Правда или действие', 'prompt_truth_dare')],
        [Markup.button.callback('🤖 Обычный AI (GPT)', 'prompt_default')],
        [Markup.button.callback('🧘‍♀️ Психолог', 'prompt_psych'), Markup.button.callback('💻 Программист', 'prompt_coder')],
        [Markup.button.callback('🇬🇧 Учитель English', 'prompt_eng')],
        [Markup.button.callback('🌶 Виртуальная девушка (18+)', 'prompt_flirthot')],
        [Markup.button.callback('🌸 Милая девушка', 'prompt_flirt')],
        [Markup.button.callback('⚙️ Свой промпт', 'prompt_custom')]
    ]);

    if (ctx.callbackQuery) {
        return ctx.editMessageText(msg, { parse_mode: 'Markdown', reply_markup: kb.reply_markup }).catch(() => {});
    }
    return ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: kb.reply_markup });
}