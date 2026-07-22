import {
    getUser, createUser, isFreeModeEnabled, toggleFreeMode,
    resetAllFreeRequests, getAdminStats, setUserPrompt, getAllUserIds, clearHistory,
    getSetting, setSetting, logPayment, addFreeRequests,
    setBlockStatus, adminSetTextBalance, adminSetImageBalance,
    getUsersTotal, getUsersPage, grantPackage, updateUserMeta,
    processPlategaPayment, updateLastActive, setStoreOpened, getUsersForRetargeting24h, mark24hPromoSent, getUsersForRetargetingStore, markStorePromoSent,
    createPromocode, activatePromocode, getPaymentHistory,
    getAllPromocodes, getPromocodeById, togglePromoStatus, togglePromoNewUsersOnly, deletePromocode, updatePromoField, getUsersForBonusNotify, markBonusNotified
} from './database.js';
import { createPlategaInvoice, checkPlategaInvoice } from './platega.js';
import { processReferral } from './referral.js';
import { aiQueue, startWorker } from './queue.js';
import { Telegraf, Markup } from 'telegraf';
import { broadcastQueue, startBroadcastWorker } from './broadcast.js';
import { promptTemplates } from './prompts.js';

import { setupHelp } from './handlers/help.js';
import { setupProfile } from './handlers/profile.js';
import { setupAi } from './handlers/ai_menu.js';

const requiredEnvs = ['BOT_TOKEN', 'ADMIN_ID', 'OPENROUTER_API_KEY', 'DATABASE_URL'];
for (const envName of requiredEnvs) {
    if (!process.env[envName]) {
        console.error(`[КРИТИЧЕСКАЯ ОШИБКА] Нет ключа: ${envName}`);
        process.exit(1);
    }
}

const bot = new Telegraf(process.env.BOT_TOKEN);
const ADMIN_ID = Number(process.env.ADMIN_ID);

// Единое хранилище состояний (и для админа, и для юзеров)
const userState = {};
const adminPromoDraft = {}; // Хранилище черновиков промокодов

const adminBroadcastMsg = {};
const lastMessageTime = {};
const adminTargetUser = {};

// Автоочистка памяти от старых сессий (каждые 15 минут)
setInterval(() => {
    const now = Date.now();
    for (const uid in lastMessageTime) {
        if (now - lastMessageTime[uid] > 30 * 60 * 1000) { // 30 минут неактивности
            delete lastMessageTime[uid];
            delete userState[uid];
        }
    }
}, 15 * 60 * 1000);

// === СЛОВАРЬ СТИЛЕЙ ПРОФИЛЯ ===
const themeConfig = {
    'flirt': { title: '❤️ Уровень близости', fill: '🔥', empty: '🤍', statuses: ['🧊 Во френдзоне', '🍷 Приятный собеседник', '😏 Близкий друг', '🔥 Главный фаворит'], max: '✨ Режим Бога' },
    'flirthot': { title: '❤️ Уровень близости', fill: '🔥', empty: '🤍', statuses: ['🧊 Во френдзоне', '🍷 Приятный собеседник', '😏 Близкий друг', '🔥 Главный фаворит'], max: '✨ Режим Бога' },
    'romance': { title: '❤️ Уровень близости', fill: '🔥', empty: '🤍', statuses: ['🧊 Во френдзоне', '🍷 Приятный собеседник', '😏 Близкий друг', '🔥 Главный фаворит'], max: '✨ Режим Бога' },
    'bold': { title: '❤️ Уровень близости', fill: '🔥', empty: '🤍', statuses: ['🧊 Во френдзоне', '🍷 Приятный собеседник', '😏 Близкий друг', '🔥 Главный фаворит'], max: '✨ Режим Бога' },
    'dom': { title: '⛓ Уровень подчинения', fill: '🔥', empty: '🤍', statuses: ['🧊 Непослушный', '🍷 На поводке', '😏 Покорный', '🔥 Идеальная игрушка'], max: '✨ Полная власть' },
    'hardcore': { title: '🖤 Уровень порока', fill: '😈', empty: '🤍', statuses: ['🧊 Скромник', '🍷 Грешник', '😏 Извращенец', '🔥 Абсолютный хардкор'], max: '✨ Владыка порока' },
    'truth_dare': { title: '🎲 Градус игры', fill: '🔥', empty: '🤍', statuses: ['🧊 Разминка', '🍷 Легкий флирт', '😏 Опасная зона', '🔥 На грани фола'], max: '✨ Мастер игры' },
    'eng': { title: '🇬🇧 Языковой барьер', fill: '🎓', empty: '📖', statuses: ['A1: London is the capital', 'B1: Уверенный турист', 'C1: Свободно мыслящий', 'C2: Почти британец'], max: '✨ Native Speaker' },
    'coder': { title: '💻 Опыт разработки', fill: '⚡️', empty: '🔋', statuses: ['Стажер (Гуглит)', 'Junior (Костылит)', 'Middle (Понимает)', 'Senior (Решает)'], max: '✨ Tech Lead' },
    'psych': { title: '🧘‍♀️ Осознанность', fill: '🌿', empty: '☁️', statuses: ['В поиске себя', 'На пути к гармонии', 'Глубоко осознанный', 'В полном балансе'], max: '✨ Дзен' },
    'default': { title: '🧠 Нейронная связь', fill: '💠', empty: '🌀', statuses: ['Базовый доступ', 'Продвинутый юзер', 'Синхронизация 99%', 'Мастер промптов'], max: '✨ Skynet' },
    'custom': { title: '🧠 Нейронная связь', fill: '💠', empty: '🌀', statuses: ['Базовый доступ', 'Продвинутый юзер', 'Синхронизация 99%', 'Мастер промптов'], max: '✨ Skynet' },
};

// === НАЗВАНИЯ РЕЖИМОВ ДЛЯ МЕНЮ ===
const modeNames = {
    'flirt': 'Легкий флирт', 'flirthot': 'Флирт (18+)', 'romance': 'Романтика', 'bold': 'Дерзкая',
    'dom': 'Доминирование', 'hardcore': 'БДСМ Хардкор', 'truth_dare': 'Правда или Действие',
    'eng': 'Репетитор English', 'coder': 'Senior Кодер', 'psych': 'Психолог', 
    'default': 'Дефолтный AI', 'custom': 'Свой системный промпт'
};

// Динамическое создание главной клавиатуры
function getMainKeyboard(userId) {
    const kb = [
        ['👤 Профиль', '🧠 Настройка ИИ'],
        ['👥 Рефералы', '🆘 Помощь'], // <-- ДОБАВИЛИ ПОМОЩЬ СЮДА
        ['🧹 Очистить контекст']
    ];
    if (userId === ADMIN_ID) {
        kb.push(['👑 Админ-панель']);
    }
    return Markup.keyboard(kb).resize();
}

// Функция-перехватчик: проверяет, принял ли юзер правила
async function requireTerms(ctx, userId) {
    let user = await getUser(userId);

    // Если юзера еще нет в базе - создаем
    if (!user) {
        await createUser(userId);
        user = await getUser(userId);
    }

    if (userId === ADMIN_ID) return true; // Админа пускаем всегда

    if (user.accepted_terms === false) {
        const kb = Markup.inlineKeyboard([
            [Markup.button.callback('📜 Политика конфиденциальности', 'tos_policy')],
            [Markup.button.callback('📄 Пользовательское соглашение', 'tos_agreement')],
            [Markup.button.callback('✅ Принять условия сервиса', 'tos_accept')]
        ]);
        await ctx.reply("👋 *Добро пожаловать!*\n\nПеред использованием сервиса необходимо ознакомиться и принять наши условия.", { parse_mode: 'Markdown', reply_markup: kb.reply_markup });
        return false; // Блокируем дальнейшее выполнение
    }
    return true; // Пропускаем дальше
}

// === MIDDLEWARE: ГЛОБАЛЬНАЯ ЗАЩИТА КНОПОК ===
bot.use(async (ctx, next) => {
    if (ctx.callbackQuery) {
        const userId = ctx.from.id;
        
        // Пропускаем кнопки самого соглашения, чтобы юзер мог их нажать и принять правила
        if (['tos_policy', 'tos_agreement', 'tos_accept'].includes(ctx.callbackQuery.data)) {
            return next();
        }
        
        // Для всех остальных кнопок жестко требуем ToS
        if (!(await requireTerms(ctx, userId))) {
            return ctx.answerCbQuery('⚠️ Сначала примите условия сервиса!', { show_alert: true }).catch(() => {});
        }
    }
    return next(); // Если условия приняты — пропускаем запрос дальше к нужной кнопке
});

// Раздел Реферальной системы

// === МЕНЮ ЕЖЕДНЕВНОГО БОНУСА ===



// === СПИСОК ПРОМОКОДОВ ===
bot.action('admin_promo_list', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const promos = await getAllPromocodes();
    
    let msg = `🎫 *Список промокодов*\n\n`;
    const kb = [];
    
    if (promos.length === 0) {
        msg += `_Промокодов пока нет._`;
    } else {
        promos.forEach(p => {
            const statusIcon = p.is_active ? '✅' : '❌';
            const usesDone = p.max_uses_total - p.uses_left;
            msg += `${statusIcon} 🎁 *${p.code}*\n`;
            msg += `📊 Использований: ${usesDone}/${p.max_uses_total}\n`;
            if (p.discount_amount > 0) msg += `💰 Скидка: ${p.discount_amount} %\n`;
            if (p.text_reward > 0) msg += `✉️ Сообщений: +${p.text_reward}\n`;
            msg += `\n`;
            
            kb.push([Markup.button.callback(`🎫 ${p.code}`, `p_manage_${p.id}`)]);
        });
    }
    
    kb.push([Markup.button.callback('➕ Создать', 'p_create')]);
    kb.push([Markup.button.callback('⬅️ Назад', 'admin_back')]);
    
    return ctx.editMessageText(msg, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: kb } }).catch(() => {});
});

// === УПРАВЛЕНИЕ КОНКРЕТНЫМ ПРОМОКОДОМ ===
bot.action(/p_manage_(\d+)/, async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const promoId = parseInt(ctx.match[1], 10);
    const p = await getPromocodeById(promoId);
    
    if (!p) return ctx.answerCbQuery('Промокод не найден');
    
    const usesDone = p.max_uses_total - p.uses_left;
    const statusText = p.is_active ? 'Активен' : 'Отключен';
    const statusIcon = p.is_active ? '✅' : '❌';
    const newOnlyIcon = p.is_new_users_only ? '✅' : '❌';
    
    const dateStr = new Date(p.created_at).toLocaleDateString('ru-RU');

    const msg = `🎫 *Управление промокодом*\n\n` +
                `🎁 Код: *${p.code}*\n` +
                `${statusIcon} Статус: ${statusText}\n` +
                `📊 Использований: ${usesDone}/${p.max_uses_total}\n` +
                `🆕 Только первая покупка: ${newOnlyIcon}\n` +
                `📅 Создан: ${dateStr}\n\n` +
                `*Бонусы:*\n` +
                `✉️ Текст: ${p.text_reward} | 📸 Фото: ${p.img_reward} | 💰 Скидка: ${p.discount_amount}%`;

    const kb = [
        [Markup.button.callback('✏️ Изменить бонусы и лимит', `p_edit_bonuses_${p.id}`)], 
        [Markup.button.callback('🔄 Переключить статус', `p_tgl_stat_${p.id}`)],
        [Markup.button.callback(`🆕 Первая покупка: ${newOnlyIcon}`, `p_tgl_new_${p.id}`)],
        [Markup.button.callback('🗑 Удалить', `p_del_${p.id}`)],
        [Markup.button.callback('⬅️ К списку', 'admin_promo_list')]
    ];

    return ctx.editMessageText(msg, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: kb } }).catch(() => {});
});

bot.action(/p_tgl_stat_(\d+)/, async (ctx) => {
    await togglePromoStatus(parseInt(ctx.match[1], 10));
    return bot.handleUpdate({ ...ctx.update, callback_query: { ...ctx.callbackQuery, data: `p_manage_${ctx.match[1]}` } });
});

bot.action(/p_tgl_new_(\d+)/, async (ctx) => {
    await togglePromoNewUsersOnly(parseInt(ctx.match[1], 10));
    return bot.handleUpdate({ ...ctx.update, callback_query: { ...ctx.callbackQuery, data: `p_manage_${ctx.match[1]}` } });
});

bot.action(/p_del_(\d+)/, async (ctx) => {
    await deletePromocode(parseInt(ctx.match[1], 10));
    await ctx.answerCbQuery('🗑 Промокод удален!', { show_alert: true });
    return bot.handleUpdate({ ...ctx.update, callback_query: { ...ctx.callbackQuery, data: 'admin_promo_list' } });
});

// === МЕНЮ РЕДАКТИРОВАНИЯ СУЩЕСТВУЮЩЕГО ПРОМО ===
bot.action(/p_edit_bonuses_(\d+)/, async (ctx) => {
    const id = ctx.match[1];
    const kb = [
        [Markup.button.callback('✉️ Текст', `p_ed_text_${id}`), Markup.button.callback('📸 Фото', `p_ed_img_${id}`)],
        [Markup.button.callback('💰 Скидка', `p_ed_disc_${id}`), Markup.button.callback('📊 Лимит юзов', `p_ed_uses_${id}`)],
        [Markup.button.callback('⬅️ Назад', `p_manage_${id}`)]
    ];
    return ctx.editMessageText('Что именно вы хотите изменить у этого промокода?', { reply_markup: { inline_keyboard: kb } });
});

bot.action(/p_ed_(text|img|disc|uses)_(\d+)/, async (ctx) => {
    const field = ctx.match[1];
    const id = ctx.match[2];
    userState[ctx.from.id] = `WAITING_PEDIT_${field.toUpperCase()}_${id}`;
    await ctx.answerCbQuery();
    return ctx.reply(`Введите новое числовое значение:`, {
        reply_markup: { inline_keyboard: [[{ text: 'Отмена', callback_data: `p_manage_${id}` }]] }
    });
});

// === СОЗДАНИЕ ПРОМОКОДА (ЧЕРНОВИК) ===
bot.action('p_create', async (ctx) => {
    userState[ctx.from.id] = 'WAITING_NEW_PROMO_CODE';
    await ctx.answerCbQuery();
    return ctx.editMessageText("📝 Введите текст для нового промокода (например: `SALE20`):", {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: 'Отмена', callback_data: 'admin_promo_list' }]] }
    });
});

async function renderPromoDraft(ctx) {
    const draft = adminPromoDraft[ctx.from.id];
    if (!draft) return ctx.reply('Ошибка черновика.', { reply_markup: { inline_keyboard: [[{ text: 'В меню', callback_data: 'admin_promo_list' }]] } });

    const msg = `🛠 *Создание промокода*\n\n` +
                `Код: *${draft.code}*\n` +
                `Лимит использований: ${draft.uses}\n` +
                `Только первая покупка: ${draft.newOnly ? '✅' : '❌'}\n\n` +
                `*Бонусы:*\n` +
                `Текст: +${draft.textReward} | Фото: +${draft.imgReward} | Скидка: ${draft.discount} %\n\n` +
                `_Настройте параметры и нажмите "Сохранить"_`;

    const kb = [
        [Markup.button.callback(`✉️ Текст (${draft.textReward})`, 'pdraft_text'), Markup.button.callback(`📸 Фото (${draft.imgReward})`, 'pdraft_img')],
        [Markup.button.callback(`💰 Скидка (${draft.discount}%)`, 'pdraft_disc'), Markup.button.callback(`📊 Лимит (${draft.uses})`, 'pdraft_uses')],
        [Markup.button.callback(`🆕 Первая покупка: ${draft.newOnly ? '✅' : '❌'}`, 'pdraft_newonly')],
        [Markup.button.callback('💾 Сохранить в базу', 'pdraft_save')],
        [Markup.button.callback('Отмена', 'admin_promo_list')]
    ];

    if (ctx.callbackQuery) {
        return ctx.editMessageText(msg, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: kb } }).catch(() => {});
    }
    return ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: kb } });
}

bot.action(/pdraft_(text|img|disc|uses)/, async (ctx) => {
    const field = ctx.match[1];
    userState[ctx.from.id] = `WAITING_PDRAFT_${field.toUpperCase()}`;
    await ctx.answerCbQuery();
    return ctx.reply(`Введите новое числовое значение:`, {
        reply_markup: { inline_keyboard: [[{ text: 'Отмена', callback_data: 'pdraft_cancel_input' }]] }
    });
});

bot.action('pdraft_newonly', async (ctx) => {
    if (adminPromoDraft[ctx.from.id]) adminPromoDraft[ctx.from.id].newOnly = !adminPromoDraft[ctx.from.id].newOnly;
    return renderPromoDraft(ctx);
});

bot.action('pdraft_cancel_input', async (ctx) => {
    delete userState[ctx.from.id];
    await ctx.deleteMessage().catch(()=>{});
    return renderPromoDraft(ctx);
});

bot.action('pdraft_save', async (ctx) => {
    const draft = adminPromoDraft[ctx.from.id];
    if (!draft) return ctx.answerCbQuery('Ошибка');
    
    // Сохраняем в БД только при нажатии этой кнопки!
    await createPromocode(draft.code, draft.uses, draft.textReward, draft.imgReward, draft.discount, 1, draft.newOnly);
    delete adminPromoDraft[ctx.from.id];
    await ctx.answerCbQuery('✅ Промокод сохранен!', { show_alert: true });
    return bot.handleUpdate({ ...ctx.update, callback_query: { ...ctx.callbackQuery, data: 'admin_promo_list' } });
});



// --- ОБРАБОТКА ДОКУМЕНТОВ И СОГЛАШЕНИЙ ---



// === СКРЫВАЕМ СЫРЫЕ ПРОМПТЫ В МЕНЮ ИИ ===




async function renderAdminPanel(ctx, isEdit = false) {
    const stats = await getAdminStats();
    const freeMode = await isFreeModeEnabled();
    
    // Безопасное получение данных воронки
    const f = stats.funnel || { total_users: 1, spent_free: 0, store_opened: 0, paid: 0 };
    const total = parseInt(f.total_users) || 1; // Защита от деления на ноль
    const spent = parseInt(f.spent_free) || 0;
    const opened = parseInt(f.store_opened) || 0;
    const paid = parseInt(f.paid) || 0;

    // Считаем конверсию в %
    const pSpent = Math.round((spent / total) * 100);
    const pOpened = Math.round((opened / total) * 100);
    const pPaid = Math.round((paid / total) * 100);

    const message = `👑 *Панель администратора*\n\n` +
                    `📊 *Юзеры:*\n` +
                    `├ За день: ${stats.users.day}\n` +
                    `├ За неделю: ${stats.users.week}\n` +
                    `└ Всего: ${stats.users.total}\n\n` +
                    `💸 *Финансы:*\n` +
                    `├ Выручка: ${stats.revenue.rub_total || 0} RUB | ${stats.revenue.stars_total || 0} XTR\n` +
                    `└ Расход API: $${parseFloat(stats.api_costs_time.total || 0).toFixed(4)}\n\n` +
                    `🧲 *Воронка конверсии:*\n` +
                    `1️⃣ Зашли в бота: ${total} чел.\n` +
                    `2️⃣ Потратили лимит: ${spent} чел. (${pSpent}%)\n` +
                    `3️⃣ Открыли магазин: ${opened} чел. (${pOpened}%)\n` +
                    `4️⃣ Оплатили пакет: ${paid} чел. (${pPaid}%)\n\n` +
                    `⚙️ *Режим работы:* ${freeMode ? '🟢 Free Mode (Безлимит)' : '🔴 Лимиты включены'}`;

    // Переработанная, компактная клавиатура
    const keyboard = Markup.inlineKeyboard([
        // Блок 1: Маркетинг
        [Markup.button.callback('📢 Рассылка', 'start_broadcast'), Markup.button.callback('🎁 Промокоды', 'admin_promo_list')],
        // Блок 2: Пользователи
        [Markup.button.callback('👥 Все юзеры', 'users_page_1'), Markup.button.callback('🔍 Найти по ID', 'mu_start')],
        // Блок 3: Контент и настройки
        [Markup.button.callback('📦 Цены', 'admin_edit_pkgs'), Markup.button.callback('📝 Тексты', 'edit_texts_menu')],
        [Markup.button.callback('🔗 Ссылка на "Звезды"', 'edit_stars_url')],
        // Блок 4: Глобальные действия (Опасная зона)
        [Markup.button.callback('🔄 Сбросить лимиты всем (Подарок)', 'reset_free_limits')],
        [Markup.button.callback(freeMode ? '🔴 Включить лимиты' : '🟢 Включить Free Mode', 'toggle_free_mode')]
    ]);

    if (isEdit) {
        return ctx.editMessageText(message, { parse_mode: 'Markdown', reply_markup: keyboard.reply_markup }).catch(()=>({}));
    }
    return ctx.replyWithMarkdown(message, keyboard);
}

bot.command('admin', (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    delete userState[ctx.from.id];
    return renderAdminPanel(ctx, false);
});

bot.action('toggle_free_mode', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const currentStatus = await isFreeModeEnabled();
    await toggleFreeMode(!currentStatus);
    ctx.answerCbQuery(`Бесплатный режим ${!currentStatus ? 'включен' : 'выключен'}`);
    return renderAdminPanel(ctx, true);
});

bot.action('admin_back', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    return renderAdminPanel(ctx, true);
});

bot.action('edit_texts_menu', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const kb = Markup.inlineKeyboard([
        [Markup.button.callback('📜 Политика', 'edit_policy'), Markup.button.callback('📜 Соглашение', 'edit_agreement')],
        [Markup.button.callback('❓ FAQ', 'edit_faq')],
        [Markup.button.callback('🎧 Саппорт (URL)', 'edit_support')],
        [Markup.button.callback('📢 Канал бонуса (ID)', 'edit_bonus_channel_id'), Markup.button.callback('🔗 Ссылка бонуса', 'edit_bonus_channel_url')],
        [Markup.button.callback('⬅️ Назад', 'admin_back')]
    ]);
    const msg = `📝 <b>Настройка текстов и ссылок</b>\n\n` +
                `<i>Поддерживаются HTML-теги:</i>\n` +
                `<code>&lt;b&gt;жирный&lt;/b&gt;</code>\n` +
                `<code>&lt;i&gt;курсив&lt;/i&gt;</code>\n` +
                `<code>&lt;a href="ссылка"&gt;текст&lt;/a&gt;</code>\n\n` +
                `🔗 <b>Для канала бонуса:</b>\n` +
                `<b>ID:</b> <code>@username</code> или <code>-100...</code> (бот должен быть админом в канале!)\n` +
                `<b>Ссылка:</b> <code>https://t.me/...</code> для кнопки перехода.`;
    return ctx.editMessageText(msg, { parse_mode: 'HTML', ...kb });
});

// Экшены ожидания ввода новых значений
const adminWaitActions = ['edit_stars_url', 'edit_policy', 'edit_agreement', 'edit_faq', 'edit_support', 'edit_bonus_channel_id', 'edit_bonus_channel_url'];
adminWaitActions.forEach(action => {
    bot.action(action, async (ctx) => {
        if (ctx.from.id !== ADMIN_ID) return;
        userState[ctx.from.id] = `WAITING_${action.toUpperCase()}`;
        await ctx.answerCbQuery();
        return ctx.editMessageText("💬 Отправьте новое значение в чат:", {
            reply_markup: { inline_keyboard: [[{ text: '❌ Отмена', callback_data: 'cancel_input' }]] }
        });
    });
});

bot.action('cancel_input', async (ctx) => {
    delete userState[ctx.from.id];
    await ctx.answerCbQuery('Действие отменено');
    await ctx.deleteMessage().catch(() => {});
    if (ctx.from.id === ADMIN_ID) return renderAdminPanel(ctx, false);
});

bot.action('start_broadcast', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    userState[ctx.from.id] = 'WAITING_FOR_BROADCAST';
    await ctx.answerCbQuery();
    return ctx.editMessageText("📢 Отправьте мне текст сообщения для массовой рассылки (поддерживается разметка Markdown):", {
        reply_markup: { inline_keyboard: [[{ text: '❌ Отмена', callback_data: 'cancel_input' }]] }
    });
});

// --- УПРАВЛЕНИЕ ПАКЕТАМИ (CRM) ---
bot.action('admin_edit_pkgs', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const kb = Markup.inlineKeyboard([
        // Тексты
        [Markup.button.callback('💬 50 шт.', 'edit_pkg_t50'), Markup.button.callback('💬 200 шт.', 'edit_pkg_t200'), Markup.button.callback('💬 500 шт.', 'edit_pkg_t500')],
        // Фото
        [Markup.button.callback('📸 5 шт.', 'edit_pkg_i5'), Markup.button.callback('📸 15 шт.', 'edit_pkg_i15'), Markup.button.callback('📸 50 шт.', 'edit_pkg_i50')],
        // Комбо
        [Markup.button.callback('🎁 Lite', 'edit_pkg_lite'), Markup.button.callback('🎁 Medium', 'edit_pkg_medium')],
        [Markup.button.callback('🎁 Hard', 'edit_pkg_hard'), Markup.button.callback('🎁 Full', 'edit_pkg_full')],
        // Назад
        [Markup.button.callback('⬅️ Назад', 'admin_back')]
    ]);
    return ctx.editMessageText("📦 *Настройка цен и пакетов*\n\nВыберите пакет для изменения его стоимости и лимитов:", { parse_mode: 'Markdown', reply_markup: kb.reply_markup });
});

['lite', 'medium', 'hard', 'full', 't50', 't200', 't500', 'i5', 'i15', 'i50'].forEach(pkg => {
    bot.action(`edit_pkg_${pkg}`, async (ctx) => {
        userState[ctx.from.id] = `WAITING_EDIT_PKG_${pkg.toUpperCase()}`;
        await ctx.answerCbQuery();
        return ctx.editMessageText(`✏️ Редактирование пакета *${pkg.toUpperCase()}*.\n\nВведите 4 числа через пробел:\n\`Звезды Рубли Тексты Фото\`\n\n_Например (35 звёзд, 50 руб, 50 текстов, 0 фото):_\n\`35 50 50 0\``, {
            parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '❌ Отмена', callback_data: 'cancel_input' }]] }
        });
    });
});

// Кнопки ожидания для пакетов
['lite', 'medium', 'hard', 'full'].forEach(pkg => {
    bot.action(`edit_pkg_${pkg}`, async (ctx) => {
        userState[ctx.from.id] = `WAITING_EDIT_PKG_${pkg.toUpperCase()}`;
        await ctx.answerCbQuery();
        return ctx.editMessageText(`💬 Отправьте новые настройки для пакета *${pkg.toUpperCase()}* в чат.\n\nФормат (четыре числа через пробел): \`ЦенаXTR ЦенаRUB Тексты Фото\`\nПример: \`35 25 50 5\``, {
            parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '❌ Отмена', callback_data: 'cancel_input' }]] }
        });
    });
});

// ОБНОВЛЕННЫЙ СПИСОК ЮЗЕРОВ (С ИМЕНАМИ)
bot.action(/users_page_(\d+)/, async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const page = parseInt(ctx.match[1], 10);
    const limit = 8;
    const offset = (page - 1) * limit;

    const totalUsers = await getUsersTotal();
    const totalPages = Math.ceil(totalUsers / limit) || 1;
    const users = await getUsersPage(limit, offset);

    const kb = [];
    users.forEach(u => {
        const status = u.is_blocked ? '🚫' : '✅';
        const name = u.first_name ? u.first_name.substring(0, 15) : 'Без имени';
        kb.push([Markup.button.callback(`${status} ID: ${u.telegram_id} | ${name}`, `mu_open_${u.telegram_id}`)]);
    });

    const nav = [];
    if (page > 1) nav.push(Markup.button.callback('⬅️', `users_page_${page - 1}`));
    nav.push(Markup.button.callback(`${page}/${totalPages}`, 'ignore'));
    if (page < totalPages) nav.push(Markup.button.callback('➡️', `users_page_${page + 1}`));
    kb.push(nav);
    kb.push([Markup.button.callback('🔍 Поиск по ID', 'mu_start')]);
    kb.push([Markup.button.callback('🔙 В админ-панель', 'admin_back')]);

    return ctx.editMessageText(`👥 <b>Список пользователей</b>\nНажмите на пользователя для управления:`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: kb } }).catch(() => {});
});



// Проваливаемся в карточку при клике на юзера в списке
bot.action(/mu_open_(\d+)/, async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const targetId = parseInt(ctx.match[1], 10);
    adminTargetUser[ctx.from.id] = targetId;
    return renderUserManagePanel(ctx, targetId);
});
bot.action('ignore', async (ctx) => ctx.answerCbQuery());

async function renderUserManagePanel(ctx, targetId) {
    const tUser = await getUser(targetId);
    if (!tUser) return ctx.reply("Пользователь не найден.");

    const nameStr = tUser.first_name ? tUser.first_name : 'Неизвестно';
    const userStr = tUser.username ? `@${tUser.username}` : 'Нет';

    const msg = `👤 <b>Карточка юзера:</b> <code>${targetId}</code>\n` +
                `📝 <b>Имя:</b> ${nameStr} (${userStr})\n\n` +
                `💬 <b>Баланс сообщений:</b> ${tUser.text_balance || 0}\n` +
                `📸 <b>Баланс фото:</b> ${tUser.image_balance || 0}\n` +
                `💎 <b>Статус (Has Purchased):</b> ${tUser.has_purchased ? '✅ Да' : '❌ Нет'}\n` +
                `🚫 <b>Блокировка:</b> ${tUser.is_blocked ? 'Заблокирован' : 'Активен'}`;

    const kb = Markup.inlineKeyboard([
        [Markup.button.callback('💬 Ред. Сообщения', 'mu_edit_text'), Markup.button.callback('📸 Ред. Фото', 'mu_edit_img')],
        [Markup.button.callback('📦 Выдать пакет', 'mu_set_package')],
        [Markup.button.callback('👑 Выдать VIP', 'mu_give_vip'), Markup.button.callback('💳 Платежи', 'mu_payments')],
        [Markup.button.callback(tUser.is_blocked ? '✅ Разблокировать' : '🚫 Заблокировать', 'mu_block')],
        [Markup.button.callback('✉️ Написать', 'mu_msg')],
        [Markup.button.callback('🔙 Назад', 'admin_back')]
    ]);

    if (ctx.callbackQuery) {
        return ctx.editMessageText(msg, { parse_mode: 'HTML', reply_markup: kb.reply_markup }).catch(() => {});
    } else {
        return ctx.reply(msg, { parse_mode: 'HTML', reply_markup: kb.reply_markup });
    }
}

// Запрос ID для поиска
bot.action('mu_start', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    userState[ctx.from.id] = 'WAITING_MU_ID';
    await ctx.answerCbQuery();
    return ctx.editMessageText("🔍 Отправьте <b>Telegram ID</b> пользователя (только цифры):", {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: '❌ Отмена', callback_data: 'cancel_input' }]] }
    });
});

// --- ОБРАБОТЧИКИ КАРТОЧКИ ПОЛЬЗОВАТЕЛЯ ---
bot.action('mu_edit_text', async (ctx) => {
    userState[ctx.from.id] = 'WAITING_MU_TEXT';
    await ctx.answerCbQuery();
    return ctx.reply("💬 Введите новое количество текстов (число):", { reply_markup: { inline_keyboard: [[{ text: '❌ Отмена', callback_data: 'cancel_input' }]] } });
});

bot.action('mu_edit_img', async (ctx) => {
    userState[ctx.from.id] = 'WAITING_MU_IMG';
    await ctx.answerCbQuery();
    return ctx.reply("📸 Введите новое количество фото (число):", { reply_markup: { inline_keyboard: [[{ text: '❌ Отмена', callback_data: 'cancel_input' }]] } });
});

// Меню выдачи пакета из админки
bot.action('mu_set_package', async (ctx) => {
    const kb = Markup.inlineKeyboard([
        [Markup.button.callback('📦 Lite (50/5)', 'mu_give_pkg_50_5')],
        [Markup.button.callback('💼 Medium (200/20)', 'mu_give_pkg_200_20')],
        [Markup.button.callback('🔥 Hard (500/50)', 'mu_give_pkg_500_50')],
        [Markup.button.callback('👑 Full (1000/100)', 'mu_give_pkg_1000_100')],
        [Markup.button.callback('🔙 Назад', 'mu_back_to_user')]
    ]);
    return ctx.editMessageText("📦 Выберите пакет для зачисления этому юзеру:", { reply_markup: kb.reply_markup });
});

// Возврат в карточку
bot.action('mu_back_to_user', async (ctx) => {
    return renderUserManagePanel(ctx, adminTargetUser[ctx.from.id]);
});

// Непосредственно выдача пакета админом
bot.action(/mu_give_pkg_(\d+)_(\d+)/, async (ctx) => {
    const targetId = adminTargetUser[ctx.from.id];
    const textCount = parseInt(ctx.match[1], 10);
    const imgCount = parseInt(ctx.match[2], 10);

    // Используем уже готовую функцию из database.js!
    await grantPackage(targetId, textCount, imgCount, 0, 'ADMIN');

    await ctx.answerCbQuery('✅ Пакет успешно начислен!');
    return renderUserManagePanel(ctx, targetId);
});


bot.action('mu_give_vip', async (ctx) => {
    const targetId = adminTargetUser[ctx.from.id];
    // VIP - это просто много текстов и фото
    await grantPackage(targetId, 99999, 9999, 0, 'ADMIN_VIP');
    await ctx.answerCbQuery('✅ VIP статус успешно выдан (99999 текстов, 9999 фото)!');
    return renderUserManagePanel(ctx, targetId);
});

bot.action('mu_payments', async (ctx) => {
    const targetId = adminTargetUser[ctx.from.id];
    const payments = await getPaymentHistory(targetId);

    if (payments.length === 0) {
        return ctx.answerCbQuery('У пользователя нет платежей.', { show_alert: true });
    }

    let msg = `💳 <b>История платежей (ID: ${targetId}):</b>\n\n`;
    for (const p of payments) {
        msg += `• ${new Date(p.created_at).toLocaleString('ru-RU')} - ${p.amount} ${p.currency}\n`;
    }

    return ctx.reply(msg, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '❌ Закрыть', callback_data: 'cancel_input' }]] } });
});

bot.action('mu_msg', async (ctx) => {
    userState[ctx.from.id] = 'WAITING_MU_MSG';
    await ctx.answerCbQuery();
    return ctx.reply("Введите текст сообщения, которое получит этот пользователь:", { reply_markup: { inline_keyboard: [[{ text: '❌ Отмена', callback_data: 'cancel_input' }]] } });
});

bot.action('mu_block', async (ctx) => {
    const targetId = adminTargetUser[ctx.from.id];
    const tUser = await getUser(targetId);
    if (!tUser) return ctx.answerCbQuery('Ошибка');

    await setBlockStatus(targetId, !tUser.is_blocked);
    await ctx.answerCbQuery(!tUser.is_blocked ? 'Пользователь заблокирован' : 'Пользователь разблокирован');
    return renderUserManagePanel(ctx, targetId);
});

bot.action(/broadcast_btn_(.+)/, async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const btnType = ctx.match[1];

    if (!adminBroadcastMsg[ctx.from.id]) return ctx.answerCbQuery('Ошибка: текст рассылки потерян');

    adminBroadcastMsg[ctx.from.id].btn = btnType;
    userState[ctx.from.id] = 'CONFIRM_BROADCAST';

    const msgData = adminBroadcastMsg[ctx.from.id];
    let previewText = `🔍 *Предпросмотр рассылки:*\n\n`;
    if (msgData.type === 'text') previewText += msgData.text;
    else previewText += `[Медиа: ${msgData.type}] ` + (msgData.caption || '');

    previewText += `\n\nКнопка: ${btnType}\n_Начинаем отправку всем пользователям?_`;

    let kb = [];
    if (btnType !== 'none') {
        const btnNames = { profile: '👤 Профиль', ai: '🧠 Настройка ИИ', refs: '👥 Рефералы', help: '🆘 Помощь', store: '⭐️ Магазин' };
        kb.push([{ text: btnNames[btnType] || btnType, callback_data: 'ignore' }]); // Для предпросмотра
    }
    kb.push([{ text: '✅ Отправить всем', callback_data: 'confirm_broadcast' }]);
    kb.push([{ text: '❌ Отмена', callback_data: 'cancel_input' }]);

    await ctx.answerCbQuery();

    if (msgData.type === 'photo') {
        return ctx.replyWithPhoto(msgData.file_id, {
            caption: previewText,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: kb }
        });
    } else if (msgData.type === 'video') {
        return ctx.replyWithVideo(msgData.file_id, {
            caption: previewText,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: kb }
        });
    } else if (msgData.type === 'document') {
        return ctx.replyWithDocument(msgData.file_id, {
            caption: previewText,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: kb }
        });
    } else if (msgData.type === 'animation') {
        return ctx.replyWithAnimation(msgData.file_id, {
            caption: previewText,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: kb }
        });
    } else {
        return ctx.editMessageText(previewText, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: kb }
        });
    }
});

bot.action('confirm_broadcast', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const msgData = adminBroadcastMsg[ctx.from.id];
    if (!msgData) return ctx.answerCbQuery('Ошибка: текст не найден');

    delete adminBroadcastMsg[ctx.from.id];
    const userIds = await getAllUserIds();

    for (const uid of userIds) {
        await broadcastQueue.add('send-msg', { userId: uid, msgData: msgData });
    }

    await ctx.answerCbQuery('Рассылка запущена!');
    return ctx.reply(`✅ Рассылка запущена в фоновом режиме!\nСообщений в очереди: *${userIds.length}*`, { parse_mode: 'Markdown' });
});

bot.action('reset_free_limits', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    await resetAllFreeRequests(10, 1);
    return ctx.answerCbQuery('Лимиты всем пользователям успешно сброшены до 10 текстов и 1 фото!', { show_alert: true });
});

// --- ОТРИСОВКА МАГАЗИНА ---
async function getSafePkg(key, defaultVal) {
    let val = await getSetting(key, defaultVal);
    let parts = val.split('_');
    
    // Поддержка старых пакетов из 3 значений (если они остались в базе)
    if (parts.length === 3) {
        const stars = parts[0];
        let rub = '35'; 
        if (stars === '100') rub = '150';
        if (stars === '200') rub = '300';
        if (stars === '350') rub = '500';
        val = `${parts[0]}_${rub}_${parts[1]}_${parts[2]}`;
        await setSetting(key, val);
        parts = val.split('_');
    }
    return parts;
}

// Универсальная функция-помощник для получения цен всех пакетов
async function getPackageData(pkgName) {
    let defaultVals = '35_49_50_0'; // fallback
    
    // Тексты (Звезды_Рубли_Тексты_Фото)
    if(pkgName === 't50') defaultVals = '35_50_50_0';
    if(pkgName === 't200') defaultVals = '125_150_200_0';
    if(pkgName === 't500') defaultVals = '250_300_500_0';
    
    // Фото (Звезды_Рубли_Тексты_Фото)
    if(pkgName === 'i5') defaultVals = '35_50_0_5';
    if(pkgName === 'i15') defaultVals = '125_150_0_15';
    if(pkgName === 'i50') defaultVals = '300_390_0_50';
    
    // Комбо (Звезды_Рубли_Тексты_Фото)
    if(pkgName === 'lite') defaultVals = '65_80_50_5';
    if(pkgName === 'medium') defaultVals = '150_200_200_20';
    if(pkgName === 'hard') defaultVals = '350_500_500_50';
    if(pkgName === 'full') defaultVals = '750_999_1000_100'; // Если захочешь вернуть пакет Full

    // getSafePkg проверит, есть ли в базе старые цены. Если есть - возьмет их, если нет - запишет новые defaultVals.
    const pkgData = await getSafePkg(`pkg_${pkgName}`, defaultVals);
    
    return {
        stars: parseInt(pkgData[0], 10),
        rub: parseInt(pkgData[1], 10),
        text: parseInt(pkgData[2], 10),
        img: parseInt(pkgData[3], 10)
    };
}

async function sendInvoiceHelper(ctx) {
    try {
        const user = await getUser(ctx.from.id);
        const discount = user.current_discount || 0; // Теперь это ПРОЦЕНТЫ

        const buyStarsUrl = await getSetting('buy_stars_url', 'Не задан');

        // Получаем все данные пакетов
        const t50 = await getPackageData('t50');
        const t200 = await getPackageData('t200');
        const t500 = await getPackageData('t500');

        const i5 = await getPackageData('i5');
        const i15 = await getPackageData('i15');
        const i50 = await getPackageData('i50');

        const lite = await getPackageData('lite');
        const medium = await getPackageData('medium');
        const hard = await getPackageData('hard');

        // Функция применения % скидки к любой цене
        const calcPrice = (price) => discount > 0 ? Math.max(1, Math.round(price * (1 - discount / 100))) : price;

        const msg = `🛒 *Магазин пакетов*\n\n` +
                    (discount > 0 ? `🎉 *Твоя персональная скидка: ${discount}%*\n\n` : ``) +
                    `💬 *Только сообщения:*\n` +
                    `• 50 шт. — ${calcPrice(t50.rub)}₽ | ${calcPrice(t50.stars)}⭐️\n` +
                    `• 200 шт. — ${calcPrice(t200.rub)}₽ | ${calcPrice(t200.stars)}⭐️\n` +
                    `• 500 шт. — ${calcPrice(t500.rub)}₽ | ${calcPrice(t500.stars)}⭐️\n\n` +
                    `📸 *Только генерация фото:*\n` +
                    `• 5 шт. — ${calcPrice(i5.rub)}₽ | ${calcPrice(i5.stars)}⭐️\n` +
                    `• 15 шт. — ${calcPrice(i15.rub)}₽ | ${calcPrice(i15.stars)}⭐️\n` +
                    `• 50 шт. — ${calcPrice(i50.rub)}₽ | ${calcPrice(i50.stars)}⭐️\n\n` +
                    `🎁 *Комбо (Сообщения + Фото):*\n` +
                    `• Lite (50💬 + 5📸) — ${calcPrice(lite.rub)}₽ | ${calcPrice(lite.stars)}⭐️\n` +
                    `• Medium (200💬 + 20📸) — ${calcPrice(medium.rub)}₽ | ${calcPrice(medium.stars)}⭐️\n` +
                    `• Hard (500💬 + 50📸) — ${calcPrice(hard.rub)}₽ | ${calcPrice(hard.stars)}⭐️\n`;

        // Красивая сетка кнопок (3х3)
        const kb = [
            [Markup.button.callback(`💬 50`, `select_pay_t50`), Markup.button.callback(`💬 200`, `select_pay_t200`), Markup.button.callback(`💬 500`, `select_pay_t500`)],
            [Markup.button.callback(`📸 5`, `select_pay_i5`), Markup.button.callback(`📸 15`, `select_pay_i15`), Markup.button.callback(`📸 50`, `select_pay_i50`)],
            [Markup.button.callback(`🎁 Lite`, `select_pay_lite`), Markup.button.callback(`🎁 Medium`, `select_pay_medium`), Markup.button.callback(`🎁 Hard`, `select_pay_hard`)]
        ];

        if (buyStarsUrl !== 'Не задан' && buyStarsUrl !== '') {
            kb.push([Markup.button.url('⭐️ Где купить звезды?', buyStarsUrl)]);
        }

        if (ctx.callbackQuery) {
            return await ctx.editMessageText(msg, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: kb } });
        } else {
            return await ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: kb } });
        }
    } catch (e) {
        console.error("[МАГАЗИН ОШИБКА ОТРИСОВКИ]:", e);
        return ctx.reply("❌ Произошла ошибка. Обратитесь к администратору.");
    }
}

bot.command('buy', sendInvoiceHelper);
bot.action('trigger_buy', async (ctx) => {
    await setStoreOpened(ctx.from.id).catch(() => {});
    await ctx.answerCbQuery().catch(() => {});
    return sendInvoiceHelper(ctx);
});

// 1. Выбор метода оплаты (с пересчетом %)
bot.action(/select_pay_([a-z0-9]+)/, async (ctx) => {
    try {
        const user = await getUser(ctx.from.id);
        const discount = user.current_discount || 0;
        const pkgName = ctx.match[1];
        
        const p = await getPackageData(pkgName);
        let stars = p.stars;
        let rub = p.rub;

        if (discount > 0) {
            rub = Math.max(1, Math.round(rub * (1 - discount / 100)));
            stars = Math.max(1, Math.round(stars * (1 - discount / 100)));
        }

        let title = '';
        if (pkgName.startsWith('t')) title = 'Пакет Сообщений';
        else if (pkgName.startsWith('i')) title = 'Пакет Фото';
        else title = `Комбо-пакет ${pkgName.toUpperCase()}`;

        const kb = Markup.inlineKeyboard([
            [Markup.button.callback(`⭐️ Telegram Stars (${stars} ⭐️)`, `pay_stars_${pkgName}`)],
            [Markup.button.callback(`🇷🇺 СБП (QR) (${rub} ₽)`, `pay_platega_2_${pkgName}`)],
            [Markup.button.callback(`🪙 Криптовалюта (${rub} ₽)`, `pay_platega_13_${pkgName}`)],
            [Markup.button.callback(`🔙 Назад`, `trigger_buy`)]
        ]);

        return await ctx.editMessageText(`Выбран *${title}*:\nВыберите способ оплаты:`, { parse_mode: 'Markdown', ...kb });
    } catch (e) { console.error("[МАГАЗИН ОШИБКА ВЫБОРА ОПЛАТЫ]:", e); }
});

// 2. Оплата Звездами (с учетом скидки)
bot.action(/pay_stars_([a-z0-9]+)/, async (ctx) => {
    try {
        const pkgName = ctx.match[1];
        const p = await getPackageData(pkgName);
        let price = p.stars;

        const user = await getUser(ctx.from.id);
        const discount = user.current_discount || 0;
        if (discount > 0) {
            price = Math.max(1, Math.round(price * (1 - discount / 100)));
        }

        await ctx.answerCbQuery();
        return await ctx.replyWithInvoice({
            title: `Пакет ${pkgName.toUpperCase()}`,
            description: `Доступ к ${p.text} сообщениям и ${p.img} уникальным фото.`,
            payload: `pkg_${p.text}_${p.img}`, // Формат для совместимости с успешным платежом
            provider_token: '',
            currency: 'XTR',
            prices: [{ label: 'Цена', amount: price }]
        });
    } catch (e) {
        console.error("[МАГАЗИН ОШИБКА ЗВЕЗД]:", e);
    }
});

// 3. Создание платежа Platega (СБП или Крипта)
bot.action(/pay_platega_(\d+)_([a-z0-9]+)/, async (ctx) => {
    try {
        const methodId = parseInt(ctx.match[1], 10);
        const pkgName = ctx.match[2];
        const p = await getPackageData(pkgName);
        let rubPrice = p.rub;
        const userId = ctx.from.id;

        const user = await getUser(userId);
        const discount = user.current_discount || 0;
        if (discount > 0) {
            rubPrice = Math.max(1, Math.round(rubPrice * (1 - discount / 100)));
        }

        await ctx.answerCbQuery('Создаем платеж, подождите...');

        const payloadStr = `pkg_${pkgName}_${userId}`; // Передаем ИМЯ пакета для проверки

        const invoice = await createPlategaInvoice(rubPrice, methodId, payloadStr);
        if (!invoice || !invoice.transactionId) {
            return await ctx.editMessageText("❌ Ошибка при создании платежа. Платёжная система временно недоступна.", {
                reply_markup: { inline_keyboard: [[Markup.button.callback(`🔙 Назад`, `select_pay_${pkgName}`)]] }
            });
        }

        const payUrl = invoice.redirect || invoice.url || invoice.paymentUrl;

        if (!payUrl) {
            return await ctx.editMessageText("❌ Ошибка: Платёжная система не вернула ссылку на оплату.", {
                reply_markup: { inline_keyboard: [[Markup.button.callback(`🔙 Назад`, `select_pay_${pkgName}`)]] }
            });
        }

        const methodText = methodId === 2 ? 'СБП (QR)' : 'Криптовалюта';
        const msg = `💳 Оплата через Platega (🪙 ${methodText})\n\n` +
                    `💰 Сумма: *${rubPrice} ₽*\n` +
                    `🆔 ID транзакции: \`${invoice.transactionId}\`\n\n` +
                    `📱 *Инструкция:*\n` +
                    `1. Нажмите кнопку «Оплатить»\n` +
                    `2. Следуйте подсказкам системы Platega\n` +
                    `3. Подтвердите перевод\n` +
                    `4. Возвращайтесь сюда и нажмите «Проверить статус»\n\n` +
                    `_Средства зачисляются автоматически в течение 1-2 минут._`;

        const kb = Markup.inlineKeyboard([
            [Markup.button.url(`💳 Оплатить`, payUrl)],
            [Markup.button.callback(`📊 Проверить статус`, `chk_pl_${invoice.transactionId}_${pkgName}`)],
            [Markup.button.callback(`🔙 Назад`, `select_pay_${pkgName}`)]
        ]);

        await ctx.editMessageText(msg, { parse_mode: 'Markdown', ...kb });

        startPlategaAutoCheck(bot, invoice.transactionId, userId, p.text, p.img, rubPrice, ctx.chat.id);
    } catch (e) {
        console.error("[МАГАЗИН ОШИБКА PLATEGA CREATE]:", e);
    }
});

// 4. Ручная проверка статуса Platega
bot.action(/chk_pl_(.+)_(.+)/, async (ctx) => {
    try {
        await ctx.answerCbQuery('Проверяем статус...').catch(() => {});

        const txId = ctx.match[1];
        const pkgName = ctx.match[2];
        const p = await getPackageData(pkgName);
        const userId = ctx.from.id;

        const statusData = await checkPlategaInvoice(txId);

        if (!statusData) {
            const msg = await ctx.reply('❌ Платежная система отвечает слишком долго или временно недоступна. Попробуйте нажать кнопку еще раз чуть позже.');
            setTimeout(() => ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id).catch(()=> {}), 5000);
            return;
        }

        if (statusData.status === 'CONFIRMED') {
            const user = await getUser(userId);
            let finalRub = p.rub;
            if (user.current_discount > 0) finalRub = Math.max(1, Math.round(finalRub * (1 - user.current_discount / 100)));

            const isNew = await processPlategaPayment(userId, finalRub, p.text, p.img, txId);
            if (isNew) {
                await clearHistory(userId);
                await ctx.editMessageText(`🎉 *Оплата успешно найдена!*\n\nТвой пакет активирован! Добавлено:\n💬 Сообщений: *+${p.text}*\n📸 Фото: *+${p.img}*`, { parse_mode: 'Markdown' });
            } else {
                const msg = await ctx.reply('⚠️ Этот платеж уже был зачислен ранее.');
                setTimeout(() => ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id).catch(()=> {}), 5000);
            }
        } else if (statusData.status === 'PENDING') {
            const msg = await ctx.reply('⏳ Платеж еще не поступил. Обычно это занимает 1-2 минуты. Попробуйте проверить чуть позже.');
            setTimeout(() => ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id).catch(()=> {}), 5000);
        } else {
            const msg = await ctx.reply(`❌ Статус платежа: ${statusData.status}`);
            setTimeout(() => ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id).catch(()=> {}), 5000);
        }
    } catch (e) {
        console.error("[МАГАЗИН ОШИБКА РУЧНОЙ ПРОВЕРКИ]:", e);
    }
});

// 5. Автоматическая фоновая проверка
function startPlategaAutoCheck(botInstance, txId, userId, textCount, imgCount, rubPrice, chatId) {
    let attempts = 0;
    const maxAttempts = 60; // 30 минут

    const interval = setInterval(async () => {
        attempts++;
        if (attempts > maxAttempts) {
            clearInterval(interval);
            return;
        }

        try {
            const statusData = await checkPlategaInvoice(txId);
            if (statusData && statusData.status === 'CONFIRMED') {
                clearInterval(interval);
                const isNew = await processPlategaPayment(userId, rubPrice, textCount, imgCount, txId);
                if (isNew) {
                    await clearHistory(userId);
                    await botInstance.telegram.sendMessage(chatId, `🎉 *Оплата (ID: ${txId.substring(0,6)}...) прошла автоматически!*\n\nТвой пакет активирован! Добавлено:\n💬 Сообщений: *+${textCount}*\n📸 Фото: *+${imgCount}*`, { parse_mode: 'Markdown' });
                }
            } else if (statusData && (statusData.status === 'CANCELED' || statusData.status === 'CHARGEBACKED')) {
                clearInterval(interval);
            }
        } catch (e) {
            console.error("[МАГАЗИН ОШИБКА АВТОПРОВЕРКИ]:", e);
        }
    }, 30000);
}

bot.on('pre_checkout_query', (ctx) => ctx.answerPreCheckoutQuery(true).catch(console.error));
// ... дальше идет bot.on('successful_payment' ...

bot.on('pre_checkout_query', (ctx) => ctx.answerPreCheckoutQuery(true).catch(console.error));
bot.on('successful_payment', async (ctx) => {
    const userId = ctx.from.id;
    const payload = ctx.message.successful_payment.invoice_payload;
    const amount = ctx.message.successful_payment.total_amount;
    const currency = ctx.message.successful_payment.currency;

    await clearHistory(userId);

    let user = await getUser(userId);
    const currentPrompt = user.current_prompt || promptTemplates['prompt_flirt'];
    if (currentPrompt === promptTemplates['prompt_flirt']) {
        await setUserPrompt(userId, promptTemplates['prompt_default']);
    }

    if (payload.startsWith('pkg_')) {
        const parts = payload.split('_');
        const textCount = parseInt(parts[1], 10);
        const imgCount = parseInt(parts[2], 10);

        // Зачисляем пакет и меняем статус has_purchased на TRUE
        await grantPackage(userId, textCount, imgCount, amount, currency);

        await ctx.reply(`🎉 *Оплата прошла успешно!*\n\nТвой пакет активирован! Добавлено:\n💬 Сообщений: *+${textCount}*\n📸 Фото: *+${imgCount}*\n\n_Теперь нейросеть будет генерировать для тебя уникальные снимки!_`, { parse_mode: 'Markdown' });
    }
});

// Добавляем динамическую клавиатуру при команде /start
bot.start(async (ctx) => {
    await processReferral(ctx);
    if (!(await requireTerms(ctx, ctx.from.id))) return; // <-- ДОБАВИЛИ ЭТО
    ctx.reply("Привет! Я нейросеть. Воспользуйся меню ниже для настройки и управления профилем 👇", getMainKeyboard(ctx.from.id));
});

// Кнопка Админ-панели на клавиатуре
bot.hears('👑 Админ-панель', (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    delete userState[ctx.from.id];
    return renderAdminPanel(ctx, false);
});

// ---------------- ГЛАВНЫЙ ОБРАБОТЧИК ТЕКСТА ----------------
setupHelp(bot);
setupProfile(bot, userState, themeConfig);
setupAi(bot, userState, modeNames);

bot.on(['photo', 'video', 'document', 'animation'], async (ctx) => {
    const userId = ctx.from.id;
    if (userId === ADMIN_ID && userState[userId] === 'WAITING_FOR_BROADCAST') {
        userState[userId] = 'WAITING_FOR_BROADCAST_BTN';

        let msgType = 'photo';
        let fileId = '';
        if (ctx.message.photo) {
            msgType = 'photo';
            fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
        } else if (ctx.message.video) {
            msgType = 'video';
            fileId = ctx.message.video.file_id;
        } else if (ctx.message.document) {
            msgType = 'document';
            fileId = ctx.message.document.file_id;
        } else if (ctx.message.animation) {
            msgType = 'animation';
            fileId = ctx.message.animation.file_id;
        }

        adminBroadcastMsg[userId] = {
            type: msgType,
            file_id: fileId,
            caption: ctx.message.caption || '',
            btn: 'none'
        };

        return ctx.reply(`Медиа получено. Хотите добавить кнопку к рассылке? Выберите из меню ниже:`, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '👤 Профиль', callback_data: 'broadcast_btn_profile' }, { text: '🧠 Настройка ИИ', callback_data: 'broadcast_btn_ai' }],
                    [{ text: '👥 Рефералы', callback_data: 'broadcast_btn_refs' }, { text: '🆘 Помощь', callback_data: 'broadcast_btn_help' }],
                    [{ text: '⭐️ Магазин', callback_data: 'broadcast_btn_store' }],
                    [{ text: 'Без кнопки', callback_data: 'broadcast_btn_none' }],
                    [{ text: '❌ Отмена', callback_data: 'cancel_input' }]
                ]
            }
        });
    }
});

bot.on('text', async (ctx) => {
    const userId = ctx.from.id;
    const text = ctx.message.text;

    await updateUserMeta(userId, ctx.from.first_name, ctx.from.username);
    await updateLastActive(userId).catch(() => {});

    // --- ОБРАБОТЧИК ВВОДА ДЛЯ УПРАВЛЕНИЯ ЮЗЕРАМИ (АДМИН) ---
    if (userId === ADMIN_ID) {
        if (userState[userId] === 'WAITING_MU_ID') {
            const targetId = parseInt(text.trim(), 10);
            if (isNaN(targetId)) return ctx.reply("❌ Ошибка: нужно отправить только ID (цифры).");
            adminTargetUser[userId] = targetId;
            delete userState[userId];
            await ctx.deleteMessage().catch(() => {});
            return renderUserManagePanel(ctx, targetId);
        }

        const targetId = adminTargetUser[userId];
        if (targetId) {
            if (userState[userId] === 'WAITING_MU_TEXT') {
                const count = parseInt(text.trim(), 10);
                if (isNaN(count) || count < 0) return ctx.reply("❌ Введите положительное число.");

                await adminSetTextBalance(targetId, count); // Используем чистую функцию

                delete userState[userId];
                await ctx.reply("✅ Количество запросов изменено!");
                return renderUserManagePanel(ctx, targetId);
            }
            if (userState[userId] === 'WAITING_MU_IMG') {
                const count = parseInt(text.trim(), 10);
                if (isNaN(count) || count < 0) return ctx.reply("❌ Введите положительное число.");

                await adminSetImageBalance(targetId, count); // Используем чистую функцию

                delete userState[userId];
                await ctx.reply("✅ Количество фото изменено!");
                return renderUserManagePanel(ctx, targetId);
            }
            if (userState[userId] === 'WAITING_MU_MSG') {
                delete userState[userId];
                try {
                    await bot.telegram.sendMessage(targetId, `💬 <b>Сообщение от администрации:</b>\n\n${text}`, { parse_mode: 'HTML' });
                    await ctx.reply("✅ Сообщение успешно доставлено пользователю!");
                } catch (e) {
                    await ctx.reply("❌ Ошибка доставки (возможно, пользователь заблокировал бота).");
                }
                return renderUserManagePanel(ctx, targetId);
            }
        }
    }
    // --- КОНЕЦ БЛОКА ВВОДА ---

    // Создаем юзера, если его нет в базе
    let user = await getUser(userId);
    if (!user) {
        await createUser(userId);
        user = await getUser(userId);
    }

    // --- ЗАЩИТА ОТ ЗАБЛОКИРОВАННЫХ ПОЛЬЗОВАТЕЛЕЙ ---
    if (user.is_blocked && userId !== ADMIN_ID) {
        return ctx.reply("❌ Ваш аккаунт заблокирован за нарушение правил сервиса. Вы больше не можете отправлять запросы.");
    }

    // ПЕРЕХВАТЧИК ВВОДА ДЛЯ НАСТРОЙКИ ПАКЕТОВ
    if (userId === ADMIN_ID && userState[userId] && userState[userId].startsWith('WAITING_EDIT_PKG_')) {
        const pkgType = userState[userId].replace('WAITING_EDIT_PKG_', '').toLowerCase();
        const parts = text.trim().split(/\s+/);

        // Теперь мы требуем 4 значения: Звезды Рубли Сообщения Фото
        if (parts.length !== 4 || parts.some(p => isNaN(p))) {
            return ctx.reply("❌ Ошибка! Введите ровно 4 числа через пробел (Звезды Рубли Сообщения Фото).\nПример: 25 35 50 5");
        }

        await setSetting(`pkg_${pkgType}`, `${parts[0]}_${parts[1]}_${parts[2]}_${parts[3]}`);
        delete userState[userId];
        await ctx.reply(`✅ Настройки пакета ${pkgType.toUpperCase()} успешно обновлены!`);
        return renderAdminPanel(ctx, false);
    }

    // ПЕРЕХВАТЧИК ОСТАЛЬНЫХ НАСТРОЕК АДМИНА
    const adminStates = {
        'WAITING_EDIT_STARS_URL': 'buy_stars_url',
        'WAITING_EDIT_POLICY': 'policy_text',
        'WAITING_EDIT_AGREEMENT': 'agreement_text',
        'WAITING_EDIT_FAQ': 'faq_text',
        'WAITING_EDIT_SUPPORT': 'support_url',
        'WAITING_EDIT_BONUS_CHANNEL_ID': 'bonus_channel_id',
        'WAITING_EDIT_BONUS_CHANNEL_URL': 'bonus_channel_url'
    };

    // --- ПЕРЕХВАТЧИК СОГЛАШЕНИЯ (ВОТ ЗДЕСЬ ЕМУ САМОЕ МЕСТО) ---
    if (userId !== ADMIN_ID && !adminStates[userState[userId]]) {
        if (!(await requireTerms(ctx, userId))) return;
    }
    // --- КОНЕЦ ПЕРЕХВАТЧИКА СОГЛАШЕНИЯ ---

    if (userId === ADMIN_ID && adminStates[userState[userId]]) {
        const settingKey = adminStates[userState[userId]];
        // Исключаем новые ключи
        if (!['vip_channel_id', 'vip_channel_url', 'buy_stars_url', 'policy_text', 'agreement_text', 'faq_text', 'support_url', 'bonus_channel_id', 'bonus_channel_url'].includes(settingKey)) {
            const num = parseInt(text.trim(), 10);
            if (isNaN(num) || num < 1) return ctx.reply("❌ Ошибка: введите число.");
            await setSetting(settingKey, num);
        } else {
            await setSetting(settingKey, text.trim());
        }
        delete userState[userId];
        await ctx.reply(`✅ Сохранено!`, { parse_mode: 'Markdown' });
        return renderAdminPanel(ctx, false);
    }

    if (userState[userId] === 'WAITING_FOR_PROMOCODE') {
        const promo = await activatePromocode(userId, text.trim().toUpperCase());
        delete userState[userId];
        
        if (promo === 'NOT_FOUND') return ctx.reply("❌ Промокод не найден.");
        if (promo === 'INACTIVE') return ctx.reply("❌ Этот промокод больше не активен.");
        if (promo === 'LIMIT_EXCEEDED') return ctx.reply("❌ Количество активаций этого промокода исчерпано.");
        if (promo === 'ALREADY_USED') return ctx.reply("❌ Вы уже использовали этот промокод.");
        if (promo === 'ONLY_NEW') return ctx.reply("❌ Этот промокод действует только для новых пользователей на первую покупку.");
        
        if (promo) {
            let msg = "✅ *Промокод успешно активирован!*\n";
            if (promo.text_reward > 0) msg += `\n✉️ Сообщений: +${promo.text_reward}`;
            if (promo.img_reward > 0) msg += `\n📸 Фото: +${promo.img_reward}`;
            if (promo.discount_amount > 0) msg += `\n💰 Скидка на покупку: ${promo.discount_amount} %`;
            return ctx.reply(msg, { parse_mode: 'Markdown' });
        }
    }


    // 1. Поймали имя нового промокода для черновика
    if (userId === ADMIN_ID && userState[userId] === 'WAITING_NEW_PROMO_CODE') {
        const code = text.trim().replace(/\s+/g, '_').toUpperCase();
        adminPromoDraft[userId] = { code: code, uses: 100, textReward: 10, imgReward: 1, discount: 0, newOnly: false };
        delete userState[userId];
        await ctx.deleteMessage().catch(()=>{});
        return renderPromoDraft(ctx);
    }

    // 2. Ввод чисел для ЧЕРНОВИКА (до сохранения)
    if (userId === ADMIN_ID && userState[userId] && userState[userId].startsWith('WAITING_PDRAFT_')) {
        const field = userState[userId].replace('WAITING_PDRAFT_', '').toLowerCase();
        const num = parseInt(text.trim(), 10);
        if (isNaN(num) || num < 0) return ctx.reply("❌ Введите положительное число.");
        
        let draft = adminPromoDraft[userId];
        if (field === 'uses') draft.uses = num;
        else if (field === 'text') draft.textReward = num;
        else if (field === 'img') draft.imgReward = num;
        else if (field === 'disc') draft.discount = num;
        
        delete userState[userId];
        await ctx.deleteMessage().catch(()=>{});
        const lastMsgId = ctx.message.message_id - 1; 
        await bot.telegram.deleteMessage(ctx.chat.id, lastMsgId).catch(() => {});
        return renderPromoDraft(ctx);
    }

    // 3. Ввод чисел для СУЩЕСТВУЮЩЕГО промокода
    if (userId === ADMIN_ID && userState[userId] && userState[userId].startsWith('WAITING_PEDIT_')) {
        const parts = userState[userId].split('_'); // WAITING_PEDIT_FIELD_ID
        const field = parts[2].toLowerCase();
        const id = parseInt(parts[3], 10);
        const num = parseInt(text.trim(), 10);
        
        if (isNaN(num) || num < 0) return ctx.reply("❌ Введите положительное число.");
        
        await updatePromoField(id, field, num);
        
        delete userState[userId];
        return ctx.reply("✅ Параметр успешно обновлен в базе!", {
            reply_markup: { inline_keyboard: [[{ text: 'Вернуться к промокоду', callback_data: `p_manage_${id}` }]] }
        });
    }


    // ПЕРЕХВАТЧИК: Админ пишет текст для рассылки
    if (userId === ADMIN_ID && userState[userId] === 'WAITING_FOR_BROADCAST') {
        userState[userId] = 'WAITING_FOR_BROADCAST_BTN'; // Меняем статус
        adminBroadcastMsg[userId] = { type: 'text', text: text, btn: 'none' }; // Сохраняем текст в память

        return ctx.reply(`Хотите добавить кнопку к рассылке? Выберите из меню ниже:`, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '👤 Профиль', callback_data: 'broadcast_btn_profile' }, { text: '🧠 Настройка ИИ', callback_data: 'broadcast_btn_ai' }],
                    [{ text: '👥 Рефералы', callback_data: 'broadcast_btn_refs' }, { text: '🆘 Помощь', callback_data: 'broadcast_btn_help' }],
                    [{ text: '⭐️ Магазин', callback_data: 'broadcast_btn_store' }],
                    [{ text: 'Без кнопки', callback_data: 'broadcast_btn_none' }],
                    [{ text: '❌ Отмена', callback_data: 'cancel_input' }]
                ]
            }
        });
    }

    if (userState[userId] === 'WAITING_FOR_CUSTOM_PROMPT') {
        const MAX_PROMPT_LENGTH = 1000;
        if (text.length > MAX_PROMPT_LENGTH) {
            return ctx.reply(`❌ *Слишком длинный текст!*\nМаксимум ${MAX_PROMPT_LENGTH} символов (у вас ${text.length}).\n\n_Попробуйте еще раз._`, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '❌ Отмена', callback_data: 'cancel_input' }]] }
            });
        }
        
        // Сохраняем кастомный промпт с флагом режима custom
        await setUserPrompt(userId, text, 'custom');
        await clearHistory(userId);
        delete userState[userId];
        return ctx.reply(`✅ Готово!\n_Свой системный промпт успешно установлен. Контекст диалога очищен._\n\n*Новый режим:*\n🔸 _Свой системный промпт_`, { parse_mode: 'Markdown' });
    }

    // --- ОГРАНИЧЕНИЕ ДЛИНЫ ЗАПРОСА К ИИ ---
    const MAX_QUERY_LENGTH = 1000;
    if (userId !== ADMIN_ID && text.length > MAX_QUERY_LENGTH) {
        return ctx.reply(`⚠️ *Ваш запрос слишком длинный!*\nПожалуйста, сократите текст до ${MAX_QUERY_LENGTH} символов (сейчас в нем ${text.length}).\n\n_Большие тексты лучше разбивать на несколько сообщений._`, { parse_mode: 'Markdown' });
    }
    // --- КОНЕЦ ОГРАНИЧЕНИЯ ---

    // --- ЗАЩИТА ОТ СПАМА (ЗАДЕРЖКА 5 СЕКУНД) ---
    const now = Date.now();
    const cooldownMs = 5000;

    if (userId !== ADMIN_ID) {
        const userLastMsgTime = lastMessageTime[userId] || 0;
        const timePassed = now - userLastMsgTime;

        if (timePassed < cooldownMs) {
            const secLeft = Math.ceil((cooldownMs - timePassed) / 1000);
            return ctx.reply(`⏳ *Анти-спам:*\nПожалуйста, подождите ${secLeft} сек. перед следующим запросом.`, { parse_mode: 'Markdown' });
        }
        lastMessageTime[userId] = now;
    }
    // --- КОНЕЦ ЗАЩИТЫ ---

    const freeModeActive = await isFreeModeEnabled();
    if (!freeModeActive) {
        if (user.text_balance <= 0) { // Проверяем новый баланс текстов
            return ctx.reply("У вас закончились сообщения 😔\nВыберите удобный пакет в магазине 💎", {
                reply_markup: { inline_keyboard: [[{ text: '⭐️ Магазин', callback_data: 'trigger_buy' }]] }
            });
        }
    }

    const shouldDecrement = !freeModeActive;

    // 1. Отправляем временное сообщение ("заглушку")
    const tempMsg = await ctx.reply("⏳ _Печатаю ответ..._", { parse_mode: 'Markdown' });

    // 2. Передаем ID временного сообщения в очередь, чтобы потом его отредактировать
    await aiQueue.add('ask-ai', { userId, text, chatId: ctx.chat.id, shouldDecrement, tempMsgId: tempMsg.message_id });
});


function startAutoFunnels() {
    setInterval(async () => {
        try {
            // 1. "Скучаю" (24 часа)
            const inactive24h = await getUsersForRetargeting24h();
            for (const uid of inactive24h) {
                try {
                    await bot.telegram.sendMessage(uid, "🤫 Я приготовила для тебя кое-что особенное, но ты почему-то молчишь... Возвращайся в диалог!");
                    await mark24hPromoSent(uid);
                    await new Promise(r => setTimeout(r, 50)); 
                } catch (e) { /* Игнор отписки */ }
            }

            // 2. Брошенная корзина (Магазин открыт > 2ч назад)
            const cartAbandoners = await getUsersForRetargetingStore();
            for (const uid of cartAbandoners) {
                try {
                    const promoCode = "SALE20_" + uid + "_" + Math.floor(Math.random() * 1000);
                    await createPromocode(promoCode, 1, 5, 0, 20);

                    const msg = `Вижу, ты заглядывал в магазин 👀\n\n🔥 Я тут договорилась... держи персональный промокод на скидку 20% и +5 бесплатных текстов: <code>${promoCode}</code>\n\nДействует только для тебя, успей использовать!`;
                    await bot.telegram.sendMessage(uid, msg, { parse_mode: 'HTML' });
                    await markStorePromoSent(uid);
                    await new Promise(r => setTimeout(r, 50));
                } catch (e) { /* Игнор отписки */ }
            }

            // 3. Уведомление о ежедневном бонусе
            const bonusUsers = await getUsersForBonusNotify();
            for (const uid of bonusUsers) {
                try {
                    await bot.telegram.sendMessage(uid, `🎁 *Твой ежедневный бонус готов!*\n\nЗайди в профиль, чтобы забрать бесплатные сообщения.`, { 
                        parse_mode: 'Markdown', 
                        reply_markup: { inline_keyboard: [[{text: '👤 Забрать бонус', callback_data: 'menu_profile'}]] } 
                    });
                    await markBonusNotified(uid);
                    await new Promise(r => setTimeout(r, 50));
                } catch (e) { /* Игнорируем блокировки */ }
            }
        } catch (e) {
            console.error("[Автоворонка] Ошибка:", e);
        }
    }, 5 * 60 * 1000); // Тестовые 30 секунд
}

startAutoFunnels();

startWorker(bot);
startBroadcastWorker(bot);
bot.launch().then(() => console.log('🚀 Бот успешно запущен и подключен к Telegram!'));

import { closeDB } from './database.js';

async function gracefulShutdown(signal) {
    console.log(`\n[SHUTDOWN] Выключаем бота и закрываем базу (${signal})...`);
    bot.stop(signal);
    await aiQueue.close();
    await broadcastQueue.close();
    await closeDB();
    process.exit(0);
}

process.once('SIGINT', () => gracefulShutdown('SIGINT'));
process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));