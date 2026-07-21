-- Migration: Add ticket_prices JSONB column to programs table
ALTER TABLE programs ADD COLUMN IF NOT EXISTS ticket_prices JSONB DEFAULT '[]'::jsonb;
