-- Add date_of_birth and instagram_tag columns to dancer_profiles
ALTER TABLE dancer_profiles ADD COLUMN IF NOT EXISTS date_of_birth DATE;
ALTER TABLE dancer_profiles ADD COLUMN IF NOT EXISTS instagram_tag TEXT;
