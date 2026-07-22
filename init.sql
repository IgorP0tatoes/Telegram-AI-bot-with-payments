CREATE TABLE IF NOT EXISTS users (
    telegram_id BIGINT PRIMARY KEY,
    free_requests_left INT DEFAULT 5,
    is_premium BOOLEAN DEFAULT FALSE,
    premium_until TIMESTAMP,
    referred_by BIGINT,
    current_prompt TEXT,
    total_api_cost NUMERIC DEFAULT 0,
    frozen_premium_seconds BIGINT DEFAULT 0,
    accepted_terms BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    user_id BIGINT REFERENCES users(telegram_id),
    role VARCHAR(20) NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS global_settings (
    key VARCHAR(50) PRIMARY KEY,
    value TEXT NOT NULL
);

INSERT INTO global_settings (key, value) VALUES 
('free_mode_enabled', 'false'),
('subscription_price', '50')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS payments (
    id SERIAL PRIMARY KEY,
    user_id BIGINT REFERENCES users(telegram_id),
    amount INT NOT NULL,
    currency VARCHAR(10) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);