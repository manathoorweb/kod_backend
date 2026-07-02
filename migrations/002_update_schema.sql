-- ============================================================================
-- KOD Battle Arena Database Update Migration (002)
-- Purpose: Apply updates to pre-existing Supabase schemas: add password auth, FCM, and jobs
-- ============================================================================

-- 1. Ensure UUID extension is enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. Create job_status enum type if it does not exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'job_status') THEN
        CREATE TYPE job_status AS ENUM ('pending', 'processing', 'completed', 'failed');
    END IF;
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
END $$;

-- 3. Update battles column alignments (format -> battle_format, drop image)
DO $$
BEGIN
    -- Rename format to battle_format if format exists and battle_format does not
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'battles' AND column_name = 'format')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'battles' AND column_name = 'battle_format') THEN
        ALTER TABLE battles RENAME COLUMN format TO battle_format;
    END IF;

    -- Drop duplicate image column if it exists (retaining image_url)
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'battles' AND column_name = 'image') THEN
        ALTER TABLE battles DROP COLUMN image;
    END IF;
END $$;

-- 4. Update user_profiles (add password_hash for standalone credentials support)
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- 5. Create new tables if they do not exist
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(128) NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    parent_token TEXT,
    is_used BOOLEAN DEFAULT false,
    is_revoked BOOLEAN DEFAULT false,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_fcm_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(128) NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    token TEXT NOT NULL,
    device_type TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, token)
);

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

-- 6. Create indexes for new tables
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token ON refresh_tokens(token);
CREATE INDEX IF NOT EXISTS idx_user_fcm_tokens_user ON user_fcm_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_job_queue_status_run ON job_queue(status, run_at);

-- 7. Add auto-update triggers
DROP TRIGGER IF EXISTS update_user_fcm_tokens_updated_at ON user_fcm_tokens;
CREATE TRIGGER update_user_fcm_tokens_updated_at BEFORE UPDATE ON user_fcm_tokens FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_job_queue_updated_at ON job_queue;
CREATE TRIGGER update_job_queue_updated_at BEFORE UPDATE ON job_queue FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 8. Idempotent Seed Data Inserts
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
('83b7e505-e8d2-4bca-9c25-ffd839e7bd10', 'https://res.cloudinary.com/do6moetbe/image/upload/v1772875400/kod/gallery/gjsxtcixilef5qj6eupf.jpg', 'kod/gallery/gjsxtcixilef5qj6eupf', '_RIT1231', '5c5dd774-b8d4-4147-842d-e86090c945b7', 'photo', '0de6dca9-de7e-4102-83fd-0806bd73fc18', '2026-03-07 09:23:54.449632+00', '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;
