CREATE TABLE IF NOT EXISTS portfolio_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_type VARCHAR(50) NOT NULL,
    symbol VARCHAR(50),
    quantity DECIMAL(20, 8),
    price DECIMAL(20, 8),
    cash_delta DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
    note TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS portfolio_events_created_at_idx ON portfolio_events (created_at);
