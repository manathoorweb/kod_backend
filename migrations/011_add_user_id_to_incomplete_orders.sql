-- Migration: Add user_id column to incomplete_orders table
ALTER TABLE incomplete_orders ADD COLUMN IF NOT EXISTS user_id VARCHAR(128) REFERENCES user_profiles(id) ON DELETE CASCADE;
