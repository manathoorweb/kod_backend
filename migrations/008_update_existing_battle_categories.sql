-- Migration: Update existing battle categories to match the style parsed from battle_format
UPDATE battles 
SET category = REGEXP_REPLACE(LOWER(TRIM(SPLIT_PART(battle_format, ' - ', 1))), '\s+', '-', 'g');
