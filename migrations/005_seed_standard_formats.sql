-- Migration: Seed standard battle formats organized by style
TRUNCATE TABLE battle_formats RESTART IDENTITY CASCADE;

INSERT INTO battle_formats (name, description) VALUES
('Hip Hop - 1v1', 'Solo Hip Hop battle'),
('Hip Hop - 2v2', '2v2 Hip Hop battle'),
('Hip Hop - 16 to Burn', '16 to Burn Hip Hop battle'),
('All Styles - 1v1', 'Solo All Styles battle'),
('All Styles - 2v2', '2v2 All Styles battle'),
('All Styles - 16 to Burn', '16 to Burn All Styles battle'),
('Afro - 1v1', 'Solo Afro battle'),
('Afro - 16 to Burn', '16 to Burn Afro battle'),
('Popping - 1v1', 'Solo Popping battle'),
('Popping - 16 to Burn', '16 to Burn Popping battle'),
('Breaking Boys - 1v1', 'Solo Breaking Boys battle'),
('Breaking Boys - 2v2', '2v2 Breaking Boys battle'),
('Breaking Boys - 16 to Burn', '16 to Burn Breaking Boys battle'),
('Breaking Girls - 1v1', 'Solo Breaking Girls battle'),
('Breaking Girls - 2v2', '2v2 Breaking Girls battle'),
('Breaking Girls - 16 to Burn', '16 to Burn Breaking Girls battle')
ON CONFLICT (name) DO NOTHING;
