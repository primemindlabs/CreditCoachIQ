-- ============================================================================
-- 0022_fix_em_dash_seed_copy.sql
--
-- Migration 0016 seeded win-back/stale-lead templates and campaigns with
-- em dashes in the name, subject, and body. Since 0016 already ran, that
-- copy is already sitting in message_templates/campaigns. This corrects the
-- already-inserted rows to match the em-dash-free version now in 0016.sql
-- (which only affects orgs created AFTER this point, not already-seeded
-- rows). Matches by the OLD name, updates name + subject + body/description
-- together so nothing drifts out of sync with the campaign_steps rows that
-- still reference these templates by id (not name, so this is safe).
-- ============================================================================

UPDATE message_templates SET
  name = 'Win-back (paused coaching), email 1',
  body = E'Hi {{first_name}},\n\nIt''s {{coach_first_name}}. I noticed your credit coaching plan is on pause. No pressure at all; life gets in the way sometimes.\n\nIf you''re ready to pick back up, I''m here. We can jump back in right where you left off, or start fresh if your situation''s changed.\n\nJust reply to this email or give us a call whenever you''re ready.\n\n{{coach_first_name}}\n\n---\nDon''t want these emails? Unsubscribe: {{unsubscribe_url}}'
WHERE name = 'Win-back (paused coaching) — email 1';

UPDATE message_templates SET
  name = 'Win-back (paused coaching), sms 2',
  body = 'Hi {{first_name}}, it''s {{coach_first_name}} from CreditCoachIQ. Just checking in. Want to pick your credit coaching back up? Reply YES and I''ll call you, or STOP to opt out.'
WHERE name = 'Win-back (paused coaching) — sms 2';

UPDATE message_templates SET
  name = 'Win-back (paused coaching), email 3',
  body = E'Hi {{first_name}},\n\nI wanted to reach out one more time. Your credit goals don''t have to wait. Whenever you''re ready to restart, we''ll pick up right where you left off, no penalty for the pause.\n\nIf now''s genuinely not the right time, no hard feelings, just let us know and we''ll check back down the road.\n\n{{coach_first_name}}\n\n---\nUnsubscribe: {{unsubscribe_url}}'
WHERE name = 'Win-back (paused coaching) — email 3';

UPDATE message_templates SET
  name = 'Win-back (lost lead), email 1',
  body = E'Hi {{first_name}},\n\nThanks for taking the time to talk with us. I know the timing wasn''t right, but I wanted to leave the door open. Credit coaching isn''t a one-time-window kind of thing.\n\nIf anything''s changed, or you''d just like to ask a few more questions, I''m happy to talk whenever works for you.\n\n{{coach_first_name}}\n\n---\nUnsubscribe: {{unsubscribe_url}}'
WHERE name = 'Win-back (lost lead) — email 1';

UPDATE message_templates SET
  name = 'Win-back (lost lead), sms 2',
  body = 'Hi {{first_name}}, it''s {{coach_first_name}}. Just following up. Any questions about credit coaching I can answer? Reply YES to chat, or STOP to opt out.'
WHERE name = 'Win-back (lost lead) — sms 2';

UPDATE message_templates SET
  name = 'Win-back (lost lead), email 3',
  subject = 'No pressure, just checking in',
  body = E'Hi {{first_name}},\n\nLast note from me for now. If credit coaching becomes a fit down the road, we''d love to help, just reach out.\n\nWishing you the best either way.\n\n{{coach_first_name}}\n\n---\nUnsubscribe: {{unsubscribe_url}}'
WHERE name = 'Win-back (lost lead) — email 3';

UPDATE message_templates SET
  name = 'Stale lead nurture, email 1',
  body = E'Hi {{first_name}},\n\nI know reaching out about credit coaching can feel like a big step, so I wanted to share something useful either way: two of the biggest levers most people don''t know about are utilization timing and dispute-worthy reporting errors, both of which we help clients act on directly.\n\nIf you''d like a free rundown of what we''re seeing, just reply here or grab time on our calendar.\n\n{{coach_first_name}}\n\n---\nUnsubscribe: {{unsubscribe_url}}'
WHERE name = 'Stale lead nurture — email 1';

UPDATE message_templates SET
  name = 'Stale lead nurture, sms 2',
  body = 'Hi {{first_name}}, it''s {{coach_first_name}} from CreditCoachIQ. Still interested in a quick, free credit review? Reply YES and I''ll reach out, or STOP to opt out.'
WHERE name = 'Stale lead nurture — sms 2';

UPDATE message_templates SET
  name = 'Stale lead nurture, email 3',
  body = E'Hi {{first_name}},\n\nI don''t want to fill your inbox, so this is my last note for now. If you ever want to talk through your credit or financing goals, we''re here, no obligation.\n\nTake care,\n{{coach_first_name}}\n\n---\nUnsubscribe: {{unsubscribe_url}}'
WHERE name = 'Stale lead nurture — email 3';

UPDATE campaigns SET name = 'Win-back, paused coaching' WHERE name = 'Win-back — paused coaching';
UPDATE campaigns SET name = 'Win-back, lost lead' WHERE name = 'Win-back — lost lead';
