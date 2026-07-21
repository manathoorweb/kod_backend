-- Migration: Add stay fields to battle_entries table
ALTER TABLE battle_entries ADD COLUMN IF NOT EXISTS need_stay BOOLEAN DEFAULT false;
ALTER TABLE battle_entries ADD COLUMN IF NOT EXISTS stay_location TEXT;
