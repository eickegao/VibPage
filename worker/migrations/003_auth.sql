-- Add Clerk and Stripe fields to users table
ALTER TABLE users ADD COLUMN clerk_user_id TEXT;
ALTER TABLE users ADD COLUMN plan TEXT NOT NULL DEFAULT 'free';
ALTER TABLE users ADD COLUMN stripe_customer_id TEXT;
ALTER TABLE users ADD COLUMN stripe_subscription_id TEXT;

-- Add unique index on clerk_user_id
CREATE UNIQUE INDEX idx_users_clerk_user_id ON users(clerk_user_id);
