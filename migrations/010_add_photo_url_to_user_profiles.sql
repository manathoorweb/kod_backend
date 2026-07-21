-- Migration: Add photo_url column to user_profiles table
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS photo_url TEXT;
