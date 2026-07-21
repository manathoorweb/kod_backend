-- Migration: Create programs, battle_formats, workshops tables, and alter battles table
CREATE TABLE IF NOT EXISTS programs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    description TEXT,
    start_date DATE NOT NULL,
    end_date DATE,
    location TEXT NOT NULL,
    country TEXT DEFAULT 'India',
    image_url TEXT,
    cloudinary_public_id TEXT,
    status TEXT DEFAULT 'upcoming',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS battle_formats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS workshops (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    program_id UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    instructor TEXT,
    price DECIMAL(10, 2) DEFAULT 0.00,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Alter battles to support link to parent program
ALTER TABLE battles ADD COLUMN IF NOT EXISTS program_id UUID REFERENCES programs(id) ON DELETE CASCADE;
ALTER TABLE battles ALTER COLUMN battle_date DROP NOT NULL;
ALTER TABLE battles ALTER COLUMN location DROP NOT NULL;

-- Seed default battle formats
INSERT INTO battle_formats (name, description) VALUES
('1v1 Breaking', 'Solo breaking battle format'),
('2v2 Popping', 'Popping battle format for duos'),
('1v1 All-Styles', 'Solo open styles dance battle'),
('1v1 Hip-Hop', 'Solo Hip Hop dance battle')
ON CONFLICT (name) DO NOTHING;
