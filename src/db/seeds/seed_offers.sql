INSERT INTO offers (id, name, event_type, target_url)
VALUES ('00000000-0000-0000-0000-000000000001'::uuid, 'Test Offer', 'join_group', 'https://t.me/example')
ON CONFLICT (id) DO NOTHING;
