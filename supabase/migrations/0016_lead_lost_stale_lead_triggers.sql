-- ============================================================================
-- 0016_lead_lost_stale_lead_triggers.sql
--
-- Two new automated nurture sequences (2026-07-29 gap-fill pass):
--   1. Win-back on lead_status = 'lost'  — new trigger type 'lead_lost',
--      fired from PATCH /api/leads/[id] when a coach marks a lead lost.
--   2. Stale-lead nurture — new trigger type 'stale_lead', fired from the
--      new daily cron scan at /api/cron/stale-leads for 'new' leads
--      untouched 14+ days.
-- Also seeds a third campaign for the win-back-on-exited case, which needed
-- NO code change — journey_stage_enter with trigger_config {"stage":"exited"}
-- already fires today via lib/journey.ts's existing transitionStage() call.
--
-- All three campaigns are seeded PAUSED, not active — the copy below is a
-- real, ready-to-send starting draft, but nothing here should start
-- messaging real clients/leads without a human reviewing it in the
-- Campaigns UI first and flipping status to 'active'.
-- ============================================================================

ALTER TABLE campaigns DROP CONSTRAINT IF EXISTS campaigns_trigger_type_check;
ALTER TABLE campaigns ADD CONSTRAINT campaigns_trigger_type_check
  CHECK (trigger_type IN (
    'manual', 'client_enrolled', 'journey_stage_enter', 'dispute_response_received',
    'goal_achieved', 'stack_promo_expiring', 'loan_ready_reached', 'scheduled',
    'lead_lost', 'stale_lead'
  ));

-- ---------------------------------------------------------------------------
-- Templates — seeded per existing org, skipped if a same-named template
-- already exists for that org (idempotent re-run safety).
-- ---------------------------------------------------------------------------
INSERT INTO message_templates (org_id, name, channel, subject, body)
SELECT o.id, t.name, t.channel, t.subject, t.body
FROM organizations o
CROSS JOIN (VALUES
  ('Win-back (paused coaching) — email 1', 'email',
   'The door''s still open, {{first_name}}',
   E'Hi {{first_name}},\n\nIt''s {{coach_first_name}} — I noticed your credit coaching plan is on pause. No pressure at all; life gets in the way sometimes.\n\nIf you''re ready to pick back up, I''m here. We can jump back in right where you left off, or start fresh if your situation''s changed.\n\nJust reply to this email or give us a call whenever you''re ready.\n\n{{coach_first_name}}\n\n---\nDon''t want these emails? Unsubscribe: {{unsubscribe_url}}'),
  ('Win-back (paused coaching) — sms 2', 'sms', NULL,
   'Hi {{first_name}}, it''s {{coach_first_name}} from CreditCoachIQ. Just checking in — want to pick your credit coaching back up? Reply YES and I''ll call you, or STOP to opt out.'),
  ('Win-back (paused coaching) — email 3', 'email',
   'One thing before we close your file',
   E'Hi {{first_name}},\n\nI wanted to reach out one more time. Your credit goals don''t have to wait — whenever you''re ready to restart, we''ll pick up right where you left off, no penalty for the pause.\n\nIf now''s genuinely not the right time, no hard feelings — just let us know and we''ll check back down the road.\n\n{{coach_first_name}}\n\n---\nUnsubscribe: {{unsubscribe_url}}'),
  ('Win-back (lost lead) — email 1', 'email',
   'Still exploring credit coaching, {{first_name}}?',
   E'Hi {{first_name}},\n\nThanks for taking the time to talk with us. I know the timing wasn''t right, but I wanted to leave the door open — credit coaching isn''t a one-time-window kind of thing.\n\nIf anything''s changed, or you''d just like to ask a few more questions, I''m happy to talk whenever works for you.\n\n{{coach_first_name}}\n\n---\nUnsubscribe: {{unsubscribe_url}}'),
  ('Win-back (lost lead) — sms 2', 'sms', NULL,
   'Hi {{first_name}}, it''s {{coach_first_name}}. Just following up — any questions about credit coaching I can answer? Reply YES to chat, or STOP to opt out.'),
  ('Win-back (lost lead) — email 3', 'email',
   'No pressure — just checking in',
   E'Hi {{first_name}},\n\nLast note from me for now. If credit coaching becomes a fit down the road, we''d love to help — just reach out.\n\nWishing you the best either way.\n\n{{coach_first_name}}\n\n---\nUnsubscribe: {{unsubscribe_url}}'),
  ('Stale lead nurture — email 1', 'email',
   'A few things that actually move your credit score',
   E'Hi {{first_name}},\n\nI know reaching out about credit coaching can feel like a big step, so I wanted to share something useful either way: two of the biggest levers most people don''t know about are utilization timing and dispute-worthy reporting errors — both of which we help clients act on directly.\n\nIf you''d like a free rundown of what we''re seeing, just reply here or grab time on our calendar.\n\n{{coach_first_name}}\n\n---\nUnsubscribe: {{unsubscribe_url}}'),
  ('Stale lead nurture — sms 2', 'sms', NULL,
   'Hi {{first_name}}, it''s {{coach_first_name}} from CreditCoachIQ — still interested in a quick, free credit review? Reply YES and I''ll reach out, or STOP to opt out.'),
  ('Stale lead nurture — email 3', 'email',
   'Last check-in from us',
   E'Hi {{first_name}},\n\nI don''t want to fill your inbox, so this is my last note for now. If you ever want to talk through your credit or financing goals, we''re here — no obligation.\n\nTake care,\n{{coach_first_name}}\n\n---\nUnsubscribe: {{unsubscribe_url}}')
) AS t(name, channel, subject, body)
WHERE NOT EXISTS (
  SELECT 1 FROM message_templates mt WHERE mt.org_id = o.id AND mt.name = t.name
);

-- ---------------------------------------------------------------------------
-- Campaigns — one per sequence, per org. Paused by default (see header note).
-- ---------------------------------------------------------------------------
INSERT INTO campaigns (org_id, name, description, trigger_type, trigger_config, status)
SELECT o.id, c.name, c.description, c.trigger_type, c.trigger_config::jsonb, 'paused'
FROM organizations o
CROSS JOIN (VALUES
  ('Win-back — paused coaching', 'Re-engages a client whose journey_stage becomes ''exited''.', 'journey_stage_enter', '{"stage":"exited"}'),
  ('Win-back — lost lead', 'Re-engages a lead marked lost.', 'lead_lost', '{}'),
  ('Stale lead nurture', 'Nudges a ''new'' lead that has gone 14+ days without contact.', 'stale_lead', '{}')
) AS c(name, description, trigger_type, trigger_config)
WHERE NOT EXISTS (
  SELECT 1 FROM campaigns existing WHERE existing.org_id = o.id AND existing.name = c.name
);

-- ---------------------------------------------------------------------------
-- Steps — wired to the templates above by name. delay_hours is relative to
-- the PREVIOUS step (see lib/messaging/enroll.ts advanceEnrollment), so
-- 0 -> 72 -> 168 means immediate, then +3 days, then +7 more days (~day 10).
-- ---------------------------------------------------------------------------
INSERT INTO campaign_steps (org_id, campaign_id, step_order, channel, template_id, delay_hours)
SELECT o.id, camp.id, s.step_order, s.channel, tmpl.id, s.delay_hours
FROM organizations o
JOIN campaigns camp ON camp.org_id = o.id AND camp.name = 'Win-back — paused coaching'
CROSS JOIN (VALUES
  (1, 'email', 'Win-back (paused coaching) — email 1', 0),
  (2, 'sms', 'Win-back (paused coaching) — sms 2', 72),
  (3, 'email', 'Win-back (paused coaching) — email 3', 168)
) AS s(step_order, channel, template_name, delay_hours)
JOIN message_templates tmpl ON tmpl.org_id = o.id AND tmpl.name = s.template_name
WHERE NOT EXISTS (
  SELECT 1 FROM campaign_steps existing WHERE existing.campaign_id = camp.id AND existing.step_order = s.step_order
);

INSERT INTO campaign_steps (org_id, campaign_id, step_order, channel, template_id, delay_hours)
SELECT o.id, camp.id, s.step_order, s.channel, tmpl.id, s.delay_hours
FROM organizations o
JOIN campaigns camp ON camp.org_id = o.id AND camp.name = 'Win-back — lost lead'
CROSS JOIN (VALUES
  (1, 'email', 'Win-back (lost lead) — email 1', 0),
  (2, 'sms', 'Win-back (lost lead) — sms 2', 120),
  (3, 'email', 'Win-back (lost lead) — email 3', 216)
) AS s(step_order, channel, template_name, delay_hours)
JOIN message_templates tmpl ON tmpl.org_id = o.id AND tmpl.name = s.template_name
WHERE NOT EXISTS (
  SELECT 1 FROM campaign_steps existing WHERE existing.campaign_id = camp.id AND existing.step_order = s.step_order
);

INSERT INTO campaign_steps (org_id, campaign_id, step_order, channel, template_id, delay_hours)
SELECT o.id, camp.id, s.step_order, s.channel, tmpl.id, s.delay_hours
FROM organizations o
JOIN campaigns camp ON camp.org_id = o.id AND camp.name = 'Stale lead nurture'
CROSS JOIN (VALUES
  (1, 'email', 'Stale lead nurture — email 1', 0),
  (2, 'sms', 'Stale lead nurture — sms 2', 96),
  (3, 'email', 'Stale lead nurture — email 3', 120)
) AS s(step_order, channel, template_name, delay_hours)
JOIN message_templates tmpl ON tmpl.org_id = o.id AND tmpl.name = s.template_name
WHERE NOT EXISTS (
  SELECT 1 FROM campaign_steps existing WHERE existing.campaign_id = camp.id AND existing.step_order = s.step_order
);
