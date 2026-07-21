-- Migration: Add full_info column to user_profiles table
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS full_info BOOLEAN DEFAULT false;
