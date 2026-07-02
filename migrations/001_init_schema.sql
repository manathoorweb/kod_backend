-- ============================================================================
-- KOD Battle Arena Standalone PostgreSQL Schema Migration
-- Purpose: Initialize clean tables, enums, indexes, and triggers for PostgreSQL
-- Compatibility: Standalone PG (Postgres 13+) with Firebase Auth compatibility
-- ============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- ENUM TYPES (Idempotent creation)
-- ============================================================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
        CREATE TYPE user_role AS ENUM ('admin', 'dancer', 'judge', 'organizer', 'blogger', 'chief_editorial');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'gender_type') THEN
        CREATE TYPE gender_type AS ENUM ('male', 'female', 'non_binary', 'prefer_not_to_say');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'skill_level') THEN
        CREATE TYPE skill_level AS ENUM ('beginner', 'intermediate', 'advanced', 'professional');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'battle_status') THEN
        CREATE TYPE battle_status AS ENUM ('upcoming', 'live', 'completed', 'cancelled', 'pending');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'entry_status') THEN
        CREATE TYPE entry_status AS ENUM ('pending', 'approved', 'rejected', 'waitlisted');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'blog_status') THEN
        CREATE TYPE blog_status AS ENUM ('draft', 'published', 'archived');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_status') THEN
        CREATE TYPE order_status AS ENUM ('pending', 'completed', 'failed', 'refunded', 'cancelled');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_status') THEN
        CREATE TYPE payment_status AS ENUM ('initiated', 'success', 'failed', 'pending');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_method') THEN
        CREATE TYPE payment_method AS ENUM ('paytm', 'cash', 'other');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'job_status') THEN
        CREATE TYPE job_status AS ENUM ('pending', 'processing', 'completed', 'failed');
    END IF;
END $$;

-- ============================================================================
-- CORE TABLES
-- ============================================================================

-- 1. User Profiles (Primary Auth relation. Uses Firebase UID instead of UUID)
CREATE TABLE IF NOT EXISTS user_profiles (
    id VARCHAR(128) PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT, -- Nullable for social sign-in users
    first_name TEXT NOT NULL,
    last_name TEXT,
    phone TEXT,
    date_of_birth DATE,
    gender gender_type,
    country TEXT,
    city TEXT,
    roles user_role[] DEFAULT ARRAY['dancer'::user_role],
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 2. Dancer Profiles
CREATE TABLE IF NOT EXISTS dancer_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(128) NOT NULL UNIQUE REFERENCES user_profiles(id) ON DELETE CASCADE,
    stage_name TEXT NOT NULL,
    crew_name TEXT,
    years_experience INTEGER NOT NULL,
    primary_style TEXT NOT NULL,
    secondary_styles TEXT[],
    skill_level skill_level NOT NULL,
    profile_photo TEXT,
    wins INTEGER DEFAULT 0,
    global_rank INTEGER,
    signature_move TEXT,
    bio TEXT,
    social_media JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 3. Battles (Events)
CREATE TABLE IF NOT EXISTS battles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    battle_date DATE NOT NULL,
    battle_time TEXT DEFAULT '18:00',
    location TEXT NOT NULL,
    country TEXT DEFAULT 'India',
    image_alt TEXT,
    image_url TEXT, -- Cloudinary fallback url
    cloudinary_public_id TEXT,
    participants_count INTEGER DEFAULT 0,
    max_participants INTEGER DEFAULT 32,
    prize_pool TEXT,
    status battle_status DEFAULT 'upcoming'::battle_status,
    description TEXT,
    rules TEXT,
    battle_format TEXT DEFAULT '1v1',
    registration_fee DECIMAL(10, 2) DEFAULT 0.00,
    ticket_price DECIMAL(10, 2) DEFAULT 0.00,
    created_by VARCHAR(128) REFERENCES user_profiles(id) ON DELETE SET NULL,
    host_id VARCHAR(128) REFERENCES user_profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 4. Battle Entries (Registrations)
CREATE TABLE IF NOT EXISTS battle_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    battle_id UUID NOT NULL REFERENCES battles(id) ON DELETE CASCADE,
    dancer_id UUID NOT NULL REFERENCES dancer_profiles(id) ON DELETE CASCADE,
    user_id VARCHAR(128) NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    preferred_formats TEXT[],
    available_dates DATE[],
    travel_willingness TEXT,
    category_interest TEXT[],
    battle_history TEXT,
    video_link TEXT NOT NULL,
    references_text TEXT,
    social_media_link TEXT,
    entry_status entry_status DEFAULT 'pending'::entry_status,
    submitted_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    reviewed_at TIMESTAMPTZ,
    reviewed_by VARCHAR(128) REFERENCES user_profiles(id) ON DELETE SET NULL,
    UNIQUE(battle_id, dancer_id)
);

-- 5. Blog Categories
CREATE TABLE IF NOT EXISTS blog_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    slug TEXT NOT NULL UNIQUE,
    icon TEXT,
    description TEXT,
    post_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 6. Blog Authors
CREATE TABLE IF NOT EXISTS blog_authors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(128) REFERENCES user_profiles(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    role TEXT,
    bio TEXT,
    avatar TEXT,
    avatar_alt TEXT,
    articles_count INTEGER DEFAULT 0,
    followers_count TEXT,
    social_links JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 7. Blog Posts
CREATE TABLE IF NOT EXISTS blog_posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    excerpt TEXT NOT NULL,
    content TEXT NOT NULL,
    category_id UUID REFERENCES blog_categories(id) ON DELETE SET NULL,
    author_id UUID REFERENCES blog_authors(id) ON DELETE SET NULL,
    image TEXT,
    image_alt TEXT,
    featured BOOLEAN DEFAULT false,
    status blog_status DEFAULT 'draft'::blog_status,
    read_time TEXT,
    views_count INTEGER DEFAULT 0,
    published_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 8. Orders
CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id TEXT NOT NULL UNIQUE,
    user_id VARCHAR(128) NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    order_type TEXT NOT NULL, -- 'ticket', 'registration', 'merchandise', etc.
    item_id UUID, -- Reference to battle_id, event_id, etc.
    item_name TEXT NOT NULL,
    quantity INTEGER DEFAULT 1,
    amount DECIMAL(10, 2) NOT NULL,
    currency TEXT DEFAULT 'INR',
    status order_status DEFAULT 'pending'::order_status,
    customer_name TEXT,
    customer_email TEXT,
    customer_phone TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMPTZ
);

-- 9. Payment Entries
CREATE TABLE IF NOT EXISTS payment_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    payment_method payment_method DEFAULT 'paytm'::payment_method,
    transaction_id TEXT, -- Paytm TXNID
    gateway_order_id TEXT, -- Paytm ORDERID
    amount DECIMAL(10, 2) NOT NULL,
    currency TEXT DEFAULT 'INR',
    status payment_status DEFAULT 'initiated'::payment_status,
    gateway_response JSONB DEFAULT '{}'::jsonb,
    checksum_verified BOOLEAN DEFAULT false,
    bank_name TEXT,
    bank_transaction_id TEXT,
    payment_mode TEXT, -- 'CC', 'DC', 'NB', 'UPI', etc.
    initiated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMPTZ,
    failed_at TIMESTAMPTZ
);

-- 10. Gallery Images
CREATE TABLE IF NOT EXISTS gallery_images (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    url TEXT NOT NULL,
    public_id TEXT,
    title TEXT,
    event_id UUID REFERENCES battles(id) ON DELETE SET NULL,
    media_type TEXT DEFAULT 'photo', -- 'photo' or 'video'
    uploaded_by VARCHAR(128) REFERENCES user_profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    metadata JSONB DEFAULT '{}'::jsonb
);

-- 11. Blog Editorial Comments
CREATE TABLE IF NOT EXISTS blog_editorial_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id UUID NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
    author_id VARCHAR(128) NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    block_id TEXT, -- ID of the content block in BlogEditor
    comment TEXT NOT NULL,
    is_resolved BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 12. Refresh Tokens (Used for JWT Refresh Token Rotation)
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(128) NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    parent_token TEXT, -- Tracks the previous token for lineage detection
    is_used BOOLEAN DEFAULT false,
    is_revoked BOOLEAN DEFAULT false,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 13. User FCM Device Tokens
CREATE TABLE IF NOT EXISTS user_fcm_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(128) NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    token TEXT NOT NULL,
    device_type TEXT, -- 'web', 'ios', 'android'
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, token)
);

-- 14. Job Queue (Postgres-Backed Task Queue)
CREATE TABLE IF NOT EXISTS job_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_type TEXT NOT NULL,
    payload JSONB DEFAULT '{}'::jsonb,
    status job_status DEFAULT 'pending'::job_status,
    error_message TEXT,
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,
    run_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    locked_at TIMESTAMPTZ,
    locked_by TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMPTZ
);

-- ============================================================================
-- INDEXES
-- ============================================================================
CREATE INDEX idx_user_profiles_email ON user_profiles(email);
CREATE INDEX idx_refresh_tokens_token ON refresh_tokens(token);
CREATE INDEX idx_user_fcm_tokens_user ON user_fcm_tokens(user_id);
CREATE INDEX idx_job_queue_status_run ON job_queue(status, run_at);
CREATE INDEX idx_dancer_profiles_user_id ON dancer_profiles(user_id);
CREATE INDEX idx_dancer_profiles_skill_level ON dancer_profiles(skill_level);
CREATE INDEX idx_battles_status ON battles(status);
CREATE INDEX idx_battles_battle_date ON battles(battle_date);
CREATE INDEX idx_battle_entries_battle_id ON battle_entries(battle_id);
CREATE INDEX idx_battle_entries_dancer_id ON battle_entries(dancer_id);
CREATE INDEX idx_battle_entries_status ON battle_entries(entry_status);
CREATE INDEX idx_blog_posts_category_id ON blog_posts(category_id);
CREATE INDEX idx_blog_posts_author_id ON blog_posts(author_id);
CREATE INDEX idx_blog_posts_status ON blog_posts(status);
CREATE INDEX idx_blog_posts_featured ON blog_posts(featured);
CREATE INDEX idx_blog_posts_published_at ON blog_posts(published_at);
CREATE INDEX idx_orders_user_id ON orders(user_id);
CREATE INDEX idx_orders_order_id ON orders(order_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX idx_payment_entries_order_id ON payment_entries(order_id);
CREATE INDEX idx_payment_entries_transaction_id ON payment_entries(transaction_id);
CREATE INDEX idx_payment_entries_status ON payment_entries(status);
CREATE INDEX idx_payment_entries_gateway_order_id ON payment_entries(gateway_order_id);

-- ============================================================================
-- TRIGGER FUNCTIONS
-- ============================================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to increment/decrement battle participants count
CREATE OR REPLACE FUNCTION update_battle_participants_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' AND NEW.entry_status = 'approved' THEN
        UPDATE battles
        SET participants_count = participants_count + 1
        WHERE id = NEW.battle_id;
    ELSIF TG_OP = 'UPDATE' AND OLD.entry_status != 'approved' AND NEW.entry_status = 'approved' THEN
        UPDATE battles
        SET participants_count = participants_count + 1
        WHERE id = NEW.battle_id;
    ELSIF TG_OP = 'UPDATE' AND OLD.entry_status = 'approved' AND NEW.entry_status != 'approved' THEN
        UPDATE battles
        SET participants_count = participants_count - 1
        WHERE id = NEW.battle_id;
    ELSIF TG_OP = 'DELETE' AND OLD.entry_status = 'approved' THEN
        UPDATE battles
        SET participants_count = participants_count - 1
        WHERE id = OLD.battle_id;
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Function to update blog category post count
CREATE OR REPLACE FUNCTION update_category_post_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' AND NEW.status = 'published' THEN
        UPDATE blog_categories
        SET post_count = post_count + 1
        WHERE id = NEW.category_id;
    ELSIF TG_OP = 'UPDATE' AND OLD.status != 'published' AND NEW.status = 'published' THEN
        UPDATE blog_categories
        SET post_count = post_count + 1
        WHERE id = NEW.category_id;
    ELSIF TG_OP = 'UPDATE' AND OLD.status = 'published' AND NEW.status != 'published' THEN
        UPDATE blog_categories
        SET post_count = post_count - 1
        WHERE id = OLD.category_id;
    ELSIF TG_OP = 'DELETE' AND OLD.status = 'published' THEN
        UPDATE blog_categories
        SET post_count = post_count - 1
        WHERE id = OLD.category_id;
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Triggers for auto-updating updated_at columns
DROP TRIGGER IF EXISTS update_user_profiles_updated_at ON user_profiles;
CREATE TRIGGER update_user_profiles_updated_at BEFORE UPDATE ON user_profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_dancer_profiles_updated_at ON dancer_profiles;
CREATE TRIGGER update_dancer_profiles_updated_at BEFORE UPDATE ON dancer_profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_battles_updated_at ON battles;
CREATE TRIGGER update_battles_updated_at BEFORE UPDATE ON battles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_battle_entries_updated_at ON battle_entries;
CREATE TRIGGER update_battle_entries_updated_at BEFORE UPDATE ON battle_entries FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_blog_posts_updated_at ON blog_posts;
CREATE TRIGGER update_blog_posts_updated_at BEFORE UPDATE ON blog_posts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_orders_updated_at ON orders;
CREATE TRIGGER update_orders_updated_at BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_blog_editorial_comments_updated_at ON blog_editorial_comments;
CREATE TRIGGER update_blog_editorial_comments_updated_at BEFORE UPDATE ON blog_editorial_comments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_user_fcm_tokens_updated_at ON user_fcm_tokens;
CREATE TRIGGER update_user_fcm_tokens_updated_at BEFORE UPDATE ON user_fcm_tokens FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_job_queue_updated_at ON job_queue;
CREATE TRIGGER update_job_queue_updated_at BEFORE UPDATE ON job_queue FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Triggers for relational counting
DROP TRIGGER IF EXISTS trg_update_battle_participants_count ON battle_entries;
CREATE TRIGGER trg_update_battle_participants_count AFTER INSERT OR UPDATE OR DELETE ON battle_entries FOR EACH ROW EXECUTE FUNCTION update_battle_participants_count();

DROP TRIGGER IF EXISTS trg_update_category_post_count ON blog_posts;
CREATE TRIGGER trg_update_category_post_count AFTER INSERT OR UPDATE OR DELETE ON blog_posts FOR EACH ROW EXECUTE FUNCTION update_category_post_count();

-- ============================================================================
-- SEED DATA
-- ============================================================================
INSERT INTO "user_profiles" ("id", "email", "first_name", "last_name", "phone", "date_of_birth", "gender", "country", "city", "roles", "is_active", "created_at", "updated_at") VALUES 
('0de6dca9-de7e-4102-83fd-0806bd73fc18', 'manathoor06@gmail.com', 'ok', 'ok', null, null, 'male', 'india', null, ARRAY['admin'::user_role], true, '2026-03-07 08:49:17.482107+00', '2026-03-12 15:53:40.547806+00'), 
('394d55a9-d3a3-43e5-ad00-55fc99cf6bef', 'anitajrachel2104@gmail.com', 'Anita', 'Rachel', null, null, 'female', null, null, ARRAY['blogger'::user_role], true, '2026-03-24 09:31:21+00', '2026-03-24 09:37:36.805964+00'), 
('e52ad498-e3a2-4657-b95b-20dcddca8962', 'Sonamwadkar89@gmail.com', 'Sonam', 'Wadkar', null, '2000-03-29', 'female', null, null, ARRAY['chief_editorial'::user_role], true, '2026-03-29 08:47:44+00', '2026-03-29 08:47:46+00'), 
('e5a96dc3-1d76-45a7-98ff-6f32fce6b286', 'manathoorweb@gmail.com', 'Manathoor', 'web', null, null, null, null, null, ARRAY['admin'::user_role], true, '2026-03-07 10:00:00.165334+00', '2026-06-30 06:19:46.530215+00')
ON CONFLICT (id) DO NOTHING;

INSERT INTO "battles" (
  "id", "title", "category", "battle_date", "location", "image_url", "image_alt", 
  "participants_count", "max_participants", "prize_pool", "status", "description", 
  "rules", "battle_format", "created_by", "created_at", "updated_at", "host_id", 
  "cloudinary_public_id", "registration_fee", "ticket_price", "country", "battle_time"
) VALUES (
  '5c5dd774-b8d4-4147-842d-e86090c945b7', 'KoD Solo Breaking ', 'breaking', '2024-07-27', 'bangalore', 
  'https://res.cloudinary.com/do6moetbe/image/upload/v1772875019/kod/battles/helhrqffbyiqeocyrive.jpg', '', 
  0, 50, '20000', 'completed', '', '', '1v1', null, '2026-03-07 08:57:14.66957+00', '2026-03-07 08:57:14.66957+00', 
  '0de6dca9-de7e-4102-83fd-0806bd73fc18', null, 800.00, 300.00, 'India', '18:00'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO "gallery_images" ("id", "url", "public_id", "title", "event_id", "media_type", "uploaded_by", "created_at", "metadata") VALUES 
('0d1ce561-71a1-4036-bb80-c8ba978be861', 'https://res.cloudinary.com/do6moetbe/image/upload/v1772875408/kod/gallery/fkskufsqbelx97tt6zgo.jpg', 'kod/gallery/fkskufsqbelx97tt6zgo', '_RIT1150', '5c5dd774-b8d4-4147-842d-e86090c945b7', 'photo', '0de6dca9-de7e-4102-83fd-0806bd73fc18', '2026-03-07 09:23:54.449632+00', '{}'::jsonb), 
('14c62b5a-ab4d-44d8-ba8c-a8b6ca7214e2', 'https://res.cloudinary.com/do6moetbe/image/upload/v1772875583/kod/gallery/zmvmtrwlv8pq2mf14fgp.jpg', 'kod/gallery/zmvmtrwlv8pq2mf14fgp', '_RIT0941', '5c5dd774-b8d4-4147-842d-e86090c945b7', 'photo', '0de6dca9-de7e-4102-83fd-0806bd73fc18', '2026-03-07 09:27:02.194689+00', '{}'::jsonb), 
('1d38711a-214e-4f38-964f-f5c7edcb7f8b', 'https://res.cloudinary.com/do6moetbe/image/upload/v1772875426/kod/gallery/uxzpvhq0oiulkawm3lyr.jpg', 'kod/gallery/uxzpvhq0oiulkawm3lyr', '_RIT1040', '5c5dd774-b8d4-4147-842d-e86090c945b7', 'photo', '0de6dca9-de7e-4102-83fd-0806bd73fc18', '2026-03-07 09:23:54.449632+00', '{}'::jsonb), 
('23493b47-fdda-47a0-9155-e297b168e9f1', 'https://res.cloudinary.com/do6moetbe/image/upload/v1772875411/kod/gallery/uhy7eqwzgkkgm84y4mtk.jpg', 'kod/gallery/uhy7eqwzgkkgm84y4mtk', '_RIT1109', '5c5dd774-b8d4-4147-842d-e86090c945b7', 'photo', '0de6dca9-de7e-4102-83fd-0806bd73fc18', '2026-03-07 09:23:54.449632+00', '{}'::jsonb), 
('23e8248b-f95a-4779-b9aa-b530f210d69a', 'https://res.cloudinary.com/do6moetbe/image/upload/v1772875415/kod/gallery/lhbpbpvovecgpc9at1eo.jpg', 'kod/gallery/lhbpbpvovecgpc9at1eo', '_RIT1096', '5c5dd774-b8d4-4147-842d-e86090c945b7', 'photo', '0de6dca9-de7e-4102-83fd-0806bd73fc18', '2026-03-07 09:23:54.449632+00', '{}'::jsonb), 
('362bce94-d3d6-422d-88c8-7f231e7527c0', 'https://res.cloudinary.com/do6moetbe/image/upload/v1772875703/kod/gallery/frr2n6nswklqjy3r9iuf.jpg', 'kod/gallery/frr2n6nswklqjy3r9iuf', '_RIT0791', '5c5dd774-b8d4-4147-842d-e86090c945b7', 'photo', '0de6dca9-de7e-4102-83fd-0806bd73fc18', '2026-03-07 09:29:12.305849+00', '{}'::jsonb), 
('48cbe52f-96cf-4bd8-902c-d5bfcf6247df', 'https://res.cloudinary.com/do6moetbe/image/upload/v1772875706/kod/gallery/sown6p1xqvhflgevaifg.jpg', 'kod/gallery/sown6p1xqvhflgevaifg', '_RIT0493', '5c5dd774-b8d4-4147-842d-e86090c945b7', 'photo', '0de6dca9-de7e-4102-83fd-0806bd73fc18', '2026-03-07 09:29:12.305849+00', '{}'::jsonb), 
('4d55ba9f-70fc-4649-856e-eb62a0c1bc3d', 'https://res.cloudinary.com/do6moetbe/image/upload/v1772875423/kod/gallery/n48wh3rayigaoxehxm2x.jpg', 'kod/gallery/n48wh3rayigaoxehxm2x', '_RIT1062', '5c5dd774-b8d4-4147-842d-e86090c945b7', 'photo', '0de6dca9-de7e-4102-83fd-0806bd73fc18', '2026-03-07 09:23:54.449632+00', '{}'::jsonb), 
('666ea767-7207-41f3-b0be-a03301360b83', 'https://res.cloudinary.com/do6moetbe/image/upload/v1772875617/kod/gallery/tnehxaauglurefbhjh1q.jpg', 'kod/gallery/tnehxaauglurefbhjh1q', '_RIT0790', '5c5dd774-b8d4-4147-842d-e86090c945b7', 'photo', '0de6dca9-de7e-4102-83fd-0806bd73fc18', '2026-03-07 09:27:02.194689+00', '{}'::jsonb), 
('67a9387d-6f9c-4e10-b538-e4b2981b840f', 'https://res.cloudinary.com/do6moetbe/image/upload/v1772875613/kod/gallery/oz0oqpczlqbzxbl6uru6.jpg', 'kod/gallery/oz0oqpczlqbzxbl6uru6', '_RIT0792', '5c5dd774-b8d4-4147-842d-e86090c945b7', 'photo', '0de6dca9-de7e-4102-83fd-0806bd73fc18', '2026-03-07 09:27:02.194689+00', '{}'::jsonb), 
('6d76124d-4588-4776-858c-f5500bbdd84d', 'https://res.cloudinary.com/do6moetbe/image/upload/v1772875594/kod/gallery/f33skvxk6crxg1fwnraw.jpg', 'kod/gallery/f33skvxk6crxg1fwnraw', '_RIT0805', '5c5dd774-b8d4-4147-842d-e86090c945b7', 'photo', '0de6dca9-de7e-4102-83fd-0806bd73fc18', '2026-03-07 09:27:02.194689+00', '{}'::jsonb), 
('7dd0698f-d8b4-432f-a9e6-a8c6fbf25564', 'https://res.cloudinary.com/do6moetbe/image/upload/v1772875605/kod/gallery/ax2diwg1s3ujaduqqb58.jpg', 'kod/gallery/ax2diwg1s3ujaduqqb58', '_RIT0796', '5c5dd774-b8d4-4147-842d-e86090c945b7', 'photo', '0de6dca9-de7e-4102-83fd-0806bd73fc18', '2026-03-07 09:27:02.194689+00', '{}'::jsonb), 
('82c916b7-2734-40b9-8c80-b319dd3ad98a', 'https://res.cloudinary.com/do6moetbe/image/upload/v1772875602/kod/gallery/azbjrrdsdlejmonmc9mh.jpg', 'kod/gallery/azbjrrdsdlejmonmc9mh', '_RIT0799', '5c5dd774-b8d4-4147-842d-e86090c945b7', 'photo', '0de6dca9-de7e-4102-83fd-0806bd73fc18', '2026-03-07 09:27:02.194689+00', '{}'::jsonb), 
('83b7e505-e8d2-4bca-9c25-ffd839e7bd10', 'https://res.cloudinary.com/do6moetbe/image/upload/v1772875400/kod/gallery/gjsxtcixilef5qj6eupf.jpg', 'kod/gallery/gjsxtcixilef5qj6eupf', '_RIT1231', '5c5dd774-b8d4-4147-842d-e86090c945b7', 'photo', '0de6dca9-de7e-4102-83fd-0806bd73fc18', '2026-03-07 09:23:54.449632+00', '{}'::jsonb), 
('9484c75c-c06b-4454-bf68-d6eb2ac13201', 'https://res.cloudinary.com/do6moetbe/image/upload/v1772875609/kod/gallery/xr3nx4dobhprd2ig2ofy.jpg', 'kod/gallery/xr3nx4dobhprd2ig2ofy', '_RIT0795', '5c5dd774-b8d4-4147-842d-e86090c945b7', 'photo', '0de6dca9-de7e-4102-83fd-0806bd73fc18', '2026-03-07 09:27:02.194689+00', '{}'::jsonb), 
('c9fa61fe-5e8a-4427-b0f2-2ee59a3adffa', 'https://res.cloudinary.com/do6moetbe/image/upload/v1772875429/kod/gallery/qwfm03tzzezubowg5zhv.jpg', 'kod/gallery/qwfm03tzzezubowg5zhv', '_RIT1012', '5c5dd774-b8d4-4147-842d-e86090c945b7', 'photo', '0de6dca9-de7e-4102-83fd-0806bd73fc18', '2026-03-07 09:23:54.449632+00', '{}'::jsonb), 
('dc28ba1b-6c52-46ff-8bcd-bbf0b46a2af1', 'https://res.cloudinary.com/do6moetbe/image/upload/v1772875579/kod/gallery/l2vu2bnjoftmaxiedds1.jpg', 'kod/gallery/l2vu2bnjoftmaxiedds1', '_RIT1098', '5c5dd774-b8d4-4147-842d-e86090c945b7', 'photo', '0de6dca9-de7e-4102-83fd-0806bd73fc18', '2026-03-07 09:27:02.194689+00', '{}'::jsonb), 
('dd0f872a-ccd5-433f-ac2a-eea2e1b062bc', 'https://res.cloudinary.com/do6moetbe/image/upload/v1772875419/kod/gallery/mphjb4bc0mqtqrmg8pxg.jpg', 'kod/gallery/mphjb4bc0mqtqrmg8pxg', '_RIT1071', '5c5dd774-b8d4-4147-842d-e86090c945b7', 'photo', '0de6dca9-de7e-4102-83fd-0806bd73fc18', '2026-03-07 09:23:54.449632+00', '{}'::jsonb), 
('f4ac7b2d-5b8a-48b3-9159-437a067629ea', 'https://res.cloudinary.com/do6moetbe/image/upload/v1772875598/kod/gallery/pkztsa0flnmuq01ztsez.jpg', 'kod/gallery/pkztsa0flnmuq01ztsez', '_RIT0803', '5c5dd774-b8d4-4147-842d-e86090c945b7', 'photo', '0de6dca9-de7e-4102-83fd-0806bd73fc18', '2026-03-07 09:27:02.194689+00', '{}'::jsonb), 
('f574e0dc-06b9-477a-bb70-429a5a64951c', 'https://res.cloudinary.com/do6moetbe/image/upload/v1772875405/kod/gallery/cbo9ycum21ucralfgpoi.jpg', 'kod/gallery/cbo9ycum21ucralfgpoi', '_RIT1196', '5c5dd774-b8d4-4147-842d-e86090c945b7', 'photo', '0de6dca9-de7e-4102-83fd-0806bd73fc18', '2026-03-07 09:23:54.449632+00', '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;


