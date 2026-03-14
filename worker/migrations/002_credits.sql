-- Add credits_consumed to usage_log
ALTER TABLE usage_log ADD COLUMN credits_consumed REAL NOT NULL DEFAULT 0;

-- Update balance comment: balance is now in credits (1 credit = $0.01)
-- Note: SQLite doesn't support ALTER COLUMN, but balance already works as REAL
