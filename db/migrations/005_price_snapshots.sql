CREATE TABLE IF NOT EXISTS price_snapshots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    symbol VARCHAR(50) NOT NULL,
    price DECIMAL(20, 8) NOT NULL,
    source VARCHAR(50) NOT NULL DEFAULT 'yfinance',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS price_snapshots_symbol_created_idx
    ON price_snapshots (symbol, created_at);
