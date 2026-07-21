-- Migration: Add order_id column to ticket_orders table to ensure synced tracking
ALTER TABLE ticket_orders ADD COLUMN IF NOT EXISTS order_id TEXT;
