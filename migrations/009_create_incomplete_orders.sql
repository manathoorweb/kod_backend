-- Migration: Create incomplete_orders table to track draft registrations and tickets
CREATE TABLE IF NOT EXISTS incomplete_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type VARCHAR(50) NOT NULL, -- 'registration' | 'ticket'
  program_id UUID REFERENCES programs(id) ON DELETE CASCADE,
  user_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
