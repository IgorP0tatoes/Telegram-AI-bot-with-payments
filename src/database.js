import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// --- СТРОГАЯ ОЧЕРЕДНОСТЬ ИНИЦИАЛИЗАЦИИ БД ---
async function initDB() {
    try {
        // 1. СНАЧАЛА создаем новые таблицы, если их нет
        await pool.query(`
        CREATE TABLE IF NOT EXISTS promocodes (
            id SERIAL PRIMARY KEY,
            code VARCHAR(255) UNIQUE NOT NULL,
            uses_left INT DEFAULT 1,
            text_reward INT DEFAULT 0,
            img_reward INT DEFAULT 0,
            discount_amount INT DEFAULT 0,
            created_at TIMESTAMP DEFAULT NOW()
        )`);

        await pool.query(`
        CREATE TABLE IF NOT EXISTS user_promocodes (
            id SERIAL PRIMARY KEY,
            user_id BIGINT NOT NULL,
            promo_id INT NOT NULL,
            uses_count INT DEFAULT 0,
            UNIQUE(user_id, promo_id)
        )`);

        // 2. ЗАТЕМ безопасно добавляем колонки к таблицам
        await pool.query('ALTER TABLE messages ADD COLUMN IF NOT EXISTS cost NUMERIC DEFAULT 0');
        await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN DEFAULT FALSE');
        await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS text_balance INT DEFAULT 10');
        await pool.query('ALTER TABLE users ALTER COLUMN text_balance SET DEFAULT 10');
        await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS image_balance INT DEFAULT 1');
        await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS has_purchased BOOLEAN DEFAULT FALSE');
        await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name VARCHAR(255)');
        await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS username VARCHAR(255)');
        await pool.query('ALTER TABLE payments ADD COLUMN IF NOT EXISTS tx_id VARCHAR(255) UNIQUE');
        await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS current_discount INT DEFAULT 0');
        
        await pool.query('ALTER TABLE promocodes ADD COLUMN IF NOT EXISTS max_uses_total INT DEFAULT 100');
        await pool.query('ALTER TABLE promocodes ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE');
        await pool.query('ALTER TABLE promocodes ADD COLUMN IF NOT EXISTS is_new_users_only BOOLEAN DEFAULT FALSE');
        await pool.query('ALTER TABLE promocodes ADD COLUMN IF NOT EXISTS max_uses_per_user INT DEFAULT 1');
        await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS bonus_notified BOOLEAN DEFAULT FALSE');

        await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS roleplay_mode VARCHAR(255) DEFAULT \'default\'');
        await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMP DEFAULT NOW()');
        await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_bonus_claimed_at TIMESTAMP');
        await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS store_opened_at TIMESTAMP');
        await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS has_received_24h_promo BOOLEAN DEFAULT FALSE');
        await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS has_received_store_promo BOOLEAN DEFAULT FALSE');
        await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_api_cost NUMERIC DEFAULT 0');

        console.log('✅ База данных успешно инициализирована');
    } catch (e) {
        console.error('❌ Ошибка обновления структуры БД:', e);
    }
}

initDB(); // Запускаем при старте файла

export function validateUserId(userId) {
    const id = Number(userId);
    if (!Number.isInteger(id) || id <= 0) throw new Error("Неверный формат Telegram ID");
    return id;
}

export async function getUser(userId) {
    const safeId = validateUserId(userId);
    const res = await pool.query('SELECT * FROM users WHERE telegram_id = $1', [safeId]);
    return res.rows[0];
}

export async function createUser(userId, referrerId = null) {
    await pool.query(
        'INSERT INTO users (telegram_id, referred_by) VALUES ($1, $2) ON CONFLICT (telegram_id) DO NOTHING',
        [userId, referrerId]
    );
}

export async function setUserPrompt(userId, prompt, mode = 'flirt') {
    await pool.query('UPDATE users SET current_prompt = $1, roleplay_mode = $2 WHERE telegram_id = $3', [prompt, mode, userId]);
}

// Защита от отрицательного баланса сообщений
export async function decrementFreeRequest(userId) {
    await pool.query('UPDATE users SET text_balance = GREATEST(text_balance - 1, 0) WHERE telegram_id = $1', [userId]);
}

export async function saveMessage(userId, role, content, cost = 0) {
    await pool.query('INSERT INTO messages (user_id, role, content, cost) VALUES ($1, $2, $3, $4)', [userId, role, content, cost]);
}

export async function getHistory(userId, limit = 10) {
    const res = await pool.query(
        'SELECT role, content FROM messages WHERE user_id = $1 ORDER BY id DESC LIMIT $2', 
        [userId, limit]
    );
    return res.rows.reverse();
}

export async function isFreeModeEnabled() {
    const res = await pool.query("SELECT value FROM global_settings WHERE key = 'free_mode_enabled'");
    return res.rows[0]?.value === 'true';
}

export async function toggleFreeMode(isEnabled) {
    await pool.query(
        "INSERT INTO global_settings (key, value) VALUES ('free_mode_enabled', $1) " +
        "ON CONFLICT (key) DO UPDATE SET value = $1",
        [String(isEnabled)]
    );
}

export function escapeHtml(unsafe) {
    if (typeof unsafe !== 'string') return unsafe;
    return unsafe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// Универсальное получение любой настройки из базы (с установкой дефолтного значения)
export async function getSetting(key, defaultValue, applyEscape = false) {
    const res = await pool.query('SELECT value FROM global_settings WHERE key = $1', [key]);
    const val = res.rows.length > 0 ? res.rows[0].value : String(defaultValue);
    
    if (res.rows.length === 0) {
        await pool.query('INSERT INTO global_settings (key, value) VALUES ($1, $2) ON CONFLICT DO NOTHING', [key, val]);
    }
    return applyEscape ? escapeHtml(val) : val;
}

// Универсальное сохранение любой настройки
export async function setSetting(key, value) {
    await pool.query(
        "INSERT INTO global_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2",
        [key, String(value)]
    );
}

export async function resetAllFreeRequests(textCount = 10, imageCount = 1) {
    // Теперь сбрасываем и баланс текстов, и баланс фото
    await pool.query('UPDATE users SET text_balance = $1, image_balance = $2', [textCount, imageCount]);
}

export async function addFreeRequests(userId, count) {
    // Теперь реферальные бонусы падают на баланс текстов
    await pool.query('UPDATE users SET text_balance = GREATEST(text_balance, 0) + $1 WHERE telegram_id = $2', [count, userId]);
}

export async function logPayment(userId, amount, currency) {
    await pool.query('INSERT INTO payments (user_id, amount, currency) VALUES ($1, $2, $3)', [userId, amount, currency]);
}

export async function getAdminStats() {
    const stats = {};
    const usersQuery = `
        SELECT 
            COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '1 day') as day,
            COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') as week,
            COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') as month,
            COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '365 days') as year,
            COUNT(*) as total
        FROM users;
    `;
    const usersRes = await pool.query(usersQuery);
    stats.users = usersRes.rows[0];
    
    const revRes = await pool.query(`
        SELECT 
            COALESCE(SUM(amount) FILTER (WHERE currency = 'XTR'), 0) as stars_total,
            COALESCE(SUM(amount) FILTER (WHERE currency = 'RUB'), 0) as rub_total
        FROM payments;
    `);
    // (Старый код revenueQuery и usersQuery оставляем на месте)
    // ...
    const costRes = await pool.query('SELECT COALESCE(SUM(total_api_cost), 0) as api_cost FROM users');
    
    // --- НОВЫЙ БЛОК: СТАТИСТИКА РАСХОДОВ ПО ВРЕМЕНИ ---
    const costTimeQuery = `
        SELECT 
            COALESCE(SUM(cost) FILTER (WHERE created_at >= NOW() - INTERVAL '1 minute'), 0) as min,
            COALESCE(SUM(cost) FILTER (WHERE created_at >= NOW() - INTERVAL '1 hour'), 0) as hour,
            COALESCE(SUM(cost) FILTER (WHERE created_at >= NOW() - INTERVAL '1 day'), 0) as day,
            COALESCE(SUM(cost) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days'), 0) as week,
            COALESCE(SUM(cost) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days'), 0) as month,
            COALESCE(SUM(cost), 0) as total
        FROM messages;
    `;
    const costTimeRes = await pool.query(costTimeQuery);

    const funnelQuery = `
        SELECT
            (SELECT COUNT(*) FROM users) as total_users,
            (SELECT COUNT(*) FROM users WHERE text_balance < 10) as spent_free,
            (SELECT COUNT(*) FROM users WHERE store_opened_at IS NOT NULL) as store_opened,
            (SELECT COUNT(*) FROM users WHERE has_purchased = TRUE) as paid
    `;
    const funnelRes = await pool.query(funnelQuery);
    stats.funnel = funnelRes.rows[0];

    stats.api_costs_time = costTimeRes.rows[0];
    // --- КОНЕЦ НОВОГО БЛОКА ---

    stats.revenue = revRes.rows[0];
    stats.api_cost = costRes.rows[0].api_cost; // Старый тотал (для совместимости)
    
    return stats;
}

export async function getReferralsCount(userId) {
    const res = await pool.query('SELECT COUNT(*) FROM users WHERE referred_by = $1', [userId]);
    return parseInt(res.rows[0].count, 10);
}

// Получение ID всех пользователей для рассылки
export async function getAllUserIds() {
    const res = await pool.query('SELECT telegram_id FROM users');
    return res.rows.map(row => row.telegram_id);
}

// Очистка истории диалога (сброс контекста)
export async function clearHistory(userId) {
    await pool.query('DELETE FROM messages WHERE user_id = $1', [userId]);
}

export async function addApiCost(userId, cost) {
    await pool.query('UPDATE users SET total_api_cost = COALESCE(total_api_cost, 0) + $1, daily_api_cost = COALESCE(daily_api_cost, 0) + $1 WHERE telegram_id = $2', [cost, userId]);
}

// Подтверждение пользовательского соглашения
export async function acceptTerms(userId) {
    await pool.query('UPDATE users SET accepted_terms = TRUE WHERE telegram_id = $1', [userId]);
}

// --- ФУНКЦИИ УПРАВЛЕНИЯ ПОЛЬЗОВАТЕЛЯМИ (АДМИН) ---
export async function setBlockStatus(userId, isBlocked) {
    await pool.query('UPDATE users SET is_blocked = $1 WHERE telegram_id = $2', [isBlocked, userId]);
}

export async function adminSetRequests(userId, count) {
    await pool.query('UPDATE users SET free_requests_left = $1 WHERE telegram_id = $2', [count, userId]);
}

export async function grantPackage(userId, textCount, imageCount, amount, currency) {
    await pool.query(
        'UPDATE users SET text_balance = GREATEST(text_balance, 0) + $1, image_balance = GREATEST(image_balance, 0) + $2, has_purchased = TRUE, current_discount = 0 WHERE telegram_id = $3',
        [textCount, imageCount, userId]
    );
    await logPayment(userId, amount, currency);
}

export async function getUsersTotal() {
    const res = await pool.query('SELECT COUNT(*) FROM users');
    return parseInt(res.rows[0].count, 10);
}

// Сохраняем имя и юзернейм при каждом сообщении
export async function updateUserMeta(userId, firstName, username) {
    await pool.query('UPDATE users SET first_name = $1, username = $2 WHERE telegram_id = $3', [firstName, username, userId]);
}

export async function getUsersPage(limit, offset) {
    const res = await pool.query('SELECT telegram_id, first_name, username, is_blocked FROM users ORDER BY created_at DESC LIMIT $1 OFFSET $2', [limit, offset]);
    return res.rows;
}

// Ручное изменение баланса текстов (Админ)
export async function adminSetTextBalance(userId, count) {
    const safeCount = Number(count);
    if (!Number.isInteger(safeCount) || safeCount < 0) throw new Error("Неверное число");
    await pool.query('UPDATE users SET text_balance = $1 WHERE telegram_id = $2', [safeCount, userId]);
}
export async function adminSetImageBalance(userId, count) {
    const safeCount = Number(count);
    if (!Number.isInteger(safeCount) || safeCount < 0) throw new Error("Неверное число");
    await pool.query('UPDATE users SET image_balance = $1 WHERE telegram_id = $2', [safeCount, userId]);
}

export async function decrementImageBalance(userId) {
    await pool.query('UPDATE users SET image_balance = GREATEST(image_balance - 1, 0) WHERE telegram_id = $1', [userId]);
}



export async function processPlategaPayment(userId, amount, textCount, imgCount, txId) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // Блокируем строку юзера, чтобы 2 процесса не начислили одновременно
        await client.query('SELECT telegram_id FROM users WHERE telegram_id = $1 FOR UPDATE', [userId]);
        
        await client.query('INSERT INTO payments (user_id, amount, currency, tx_id) VALUES ($1, $2, $3, $4)', [userId, amount, 'RUB', txId]);
        
        await client.query(
            'UPDATE users SET text_balance = GREATEST(text_balance, 0) + $1, image_balance = GREATEST(image_balance, 0) + $2, has_purchased = TRUE, current_discount = 0 WHERE telegram_id = $3',
            [textCount, imgCount, userId]
        );
        
        await client.query('COMMIT');
        return true;
    } catch (e) {
        await client.query('ROLLBACK');
        return false; // Если платеж уже есть, вернет false
    } finally {
        client.release();
    }
}

export async function updateLastActive(userId) {
    await pool.query('UPDATE users SET last_active_at = NOW() WHERE telegram_id = $1', [userId]);
}

export async function setStoreOpened(userId) {
    await pool.query('UPDATE users SET store_opened_at = NOW() WHERE telegram_id = $1', [userId]);
}

export async function claimDailyBonus(userId) {
    const res = await pool.query(`
        UPDATE users
        SET daily_bonus_claimed_at = NOW(), text_balance = GREATEST(text_balance, 0) + $1, bonus_notified = FALSE
        WHERE telegram_id = $2 AND (daily_bonus_claimed_at IS NULL OR daily_bonus_claimed_at < NOW() - INTERVAL '24 hours')
        RETURNING text_balance
    `, [Math.floor(Math.random() * 3) + 1, userId]); // 1-3 сообщения
    return res.rowCount > 0; // true если обновилось
}

export async function createPromocode(code, uses_left, text_reward, img_reward, discount_amount, max_uses_per_user = 1, is_new_users_only = false) {
    const query = `
        INSERT INTO promocodes (code, uses_left, text_reward, img_reward, discount_amount, max_uses_per_user, max_uses_total, is_new_users_only)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (code) DO UPDATE SET 
            uses_left = EXCLUDED.uses_left,
            text_reward = EXCLUDED.text_reward,
            img_reward = EXCLUDED.img_reward,
            discount_amount = EXCLUDED.discount_amount,
            max_uses_per_user = EXCLUDED.max_uses_per_user,
            max_uses_total = EXCLUDED.max_uses_total,
            is_new_users_only = EXCLUDED.is_new_users_only
    `;
    await pool.query(query, [code, uses_left, text_reward, img_reward, discount_amount, max_uses_per_user, uses_left, is_new_users_only]);
}

// НОВАЯ ФУНКЦИЯ ДЛЯ РЕДАКТИРОВАНИЯ СУЩЕСТВУЮЩИХ
export async function updatePromoField(id, field, value) {
    if (field === 'text') await pool.query('UPDATE promocodes SET text_reward = $1 WHERE id = $2', [value, id]);
    if (field === 'img') await pool.query('UPDATE promocodes SET img_reward = $1 WHERE id = $2', [value, id]);
    if (field === 'disc') await pool.query('UPDATE promocodes SET discount_amount = $1 WHERE id = $2', [value, id]);
    if (field === 'uses') {
        // Умный пересчет лимитов: меняем общий лимит и корректируем оставшиеся активации
        await pool.query('UPDATE promocodes SET uses_left = GREATEST(0, uses_left + ($1 - max_uses_total)), max_uses_total = $1 WHERE id = $2', [value, id]);
    }
}

export async function activatePromocode(userId, code) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        const promoRes = await client.query('SELECT * FROM promocodes WHERE code = $1 FOR UPDATE', [code]);
        if (promoRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return 'NOT_FOUND'; 
        }
        
        const promo = promoRes.rows[0];

        if (!promo.is_active) {
            await client.query('ROLLBACK');
            return 'INACTIVE';
        }

        if (promo.uses_left <= 0) {
            await client.query('ROLLBACK');
            return 'LIMIT_EXCEEDED';
        }

        // Проверка на "только для новых"
        if (promo.is_new_users_only) {
            const userRes = await client.query('SELECT has_purchased FROM users WHERE telegram_id = $1', [userId]);
            if (userRes.rows[0] && userRes.rows[0].has_purchased) {
                await client.query('ROLLBACK');
                return 'ONLY_NEW';
            }
        }

        const userPromoRes = await client.query('SELECT uses_count FROM user_promocodes WHERE user_id = $1 AND promo_id = $2', [userId, promo.id]);
        let userUses = 0;
        if (userPromoRes.rows.length > 0) {
            userUses = userPromoRes.rows[0].uses_count;
        }
        
        if (userUses >= promo.max_uses_per_user) {
            await client.query('ROLLBACK');
            return 'ALREADY_USED'; 
        }

        // Выдаем тексты и фото
        if (promo.text_reward > 0 || promo.img_reward > 0) {
            await client.query(
                'UPDATE users SET text_balance = GREATEST(text_balance, 0) + $1, image_balance = GREATEST(image_balance, 0) + $2 WHERE telegram_id = $3',
                [promo.text_reward, promo.img_reward, userId]
            );
        }
        
        // Начисляем скидку
        if (promo.discount_amount > 0) {
            await client.query('UPDATE users SET current_discount = $1 WHERE telegram_id = $2', [promo.discount_amount, userId]);
        }

        await client.query('UPDATE promocodes SET uses_left = uses_left - 1 WHERE id = $1', [promo.id]);
        await client.query(
            'INSERT INTO user_promocodes (user_id, promo_id, uses_count) VALUES ($1, $2, 1) ON CONFLICT (user_id, promo_id) DO UPDATE SET uses_count = user_promocodes.uses_count + 1',
            [userId, promo.id]
        );
        
        await client.query('COMMIT');
        return promo;
    } catch (e) {
        await client.query('ROLLBACK');
        console.error("Ошибка активации промокода:", e);
        return null;
    } finally {
        client.release();
    }
}

export async function getUsersForRetargeting24h() {
    const res = await pool.query(`
        SELECT telegram_id FROM users
        WHERE last_active_at < NOW() - INTERVAL '24 hours'
        AND last_active_at > NOW() - INTERVAL '48 hours'
        AND has_received_24h_promo = FALSE
        AND is_blocked = FALSE
    `);
    return res.rows.map(r => r.telegram_id);
}

export async function mark24hPromoSent(userId) {
    await pool.query('UPDATE users SET has_received_24h_promo = TRUE WHERE telegram_id = $1', [userId]);
}

export async function getUsersForRetargetingStore() {
    const res = await pool.query(`
        SELECT telegram_id FROM users
        WHERE store_opened_at < NOW() - INTERVAL '2 hours'
        AND has_purchased = FALSE
        AND has_received_store_promo = FALSE
        AND is_blocked = FALSE
    `);
    return res.rows.map(r => r.telegram_id);
}

export async function markStorePromoSent(userId) {
    await pool.query('UPDATE users SET has_received_store_promo = TRUE WHERE telegram_id = $1', [userId]);
}

export async function getPaymentHistory(userId) {
    const res = await pool.query('SELECT * FROM payments WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10', [userId]);
    return res.rows;
}

export async function getAllPromocodes() {
    const res = await pool.query('SELECT * FROM promocodes ORDER BY created_at DESC LIMIT 10');
    return res.rows;
}

export async function getPromocodeById(id) {
    const res = await pool.query('SELECT * FROM promocodes WHERE id = $1', [id]);
    return res.rows[0];
}

export async function togglePromoStatus(id) {
    await pool.query('UPDATE promocodes SET is_active = NOT is_active WHERE id = $1', [id]);
}

export async function togglePromoNewUsersOnly(id) {
    await pool.query('UPDATE promocodes SET is_new_users_only = NOT is_new_users_only WHERE id = $1', [id]);
}

export async function deletePromocode(id) {
    await pool.query('DELETE FROM user_promocodes WHERE promo_id = $1', [id]);
    await pool.query('DELETE FROM promocodes WHERE id = $1', [id]);
}

export async function getUsersForBonusNotify() {
    const res = await pool.query(`
        SELECT telegram_id FROM users
        WHERE (daily_bonus_claimed_at < NOW() - INTERVAL '24 hours' OR daily_bonus_claimed_at IS NULL)
        AND bonus_notified = FALSE
        AND is_blocked = FALSE
    `);
    return res.rows.map(r => r.telegram_id);
}

export async function markBonusNotified(userId) {
    await pool.query('UPDATE users SET bonus_notified = TRUE WHERE telegram_id = $1', [userId]);
}

export async function closeDB() {
    await pool.end();
}

export async function logPaymentFailure(errorText) {
    await pool.query('CREATE TABLE IF NOT EXISTS payment_failures (id SERIAL PRIMARY KEY, error_text TEXT, created_at TIMESTAMP DEFAULT NOW())');
    await pool.query('INSERT INTO payment_failures (error_text) VALUES ($1)', [errorText]);
}