-- ============================================================================
-- Client Portal: pre-call AI intake quiz, magic-link portal auth, call
-- booking (Calendly-backed, plan-tier limited), and two-way portal messaging.
--
-- Mirrors conduit-next's borrower_portal_tokens pattern for client-facing
-- auth (token in the URL, verified in-handler, not a Clerk session).
-- ============================================================================

-- ── Portal tokens (magic-link client auth) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS portal_tokens (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  borrower_id       uuid NOT NULL UNIQUE REFERENCES borrowers(id) ON DELETE CASCADE,
  token             text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  expires_at        timestamptz DEFAULT (now() + interval '180 days'),
  last_accessed_at  timestamptz,
  page_views        integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_portal_tokens_token ON portal_tokens(token);
ALTER TABLE portal_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "portal_tokens_org_all" ON portal_tokens FOR ALL
  USING (org_id = public.get_org_id()) WITH CHECK (org_id = public.get_org_id());
CREATE POLICY "portal_tokens_service_select" ON portal_tokens FOR SELECT USING (true);
CREATE POLICY "portal_tokens_service_update" ON portal_tokens FOR UPDATE USING (true);

-- ── Intake quiz: question bank (coach-editable) ─────────────────────────────
CREATE TABLE IF NOT EXISTS intake_quiz_questions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  question_order    integer NOT NULL,
  question_key      text, -- stable key for special-cased questions (e.g. 'self_reported_score', 'primary_goal') read by scoring/AI-summary code
  prompt            text NOT NULL,
  question_type     text NOT NULL CHECK (question_type IN ('single_choice', 'multi_choice', 'scale', 'text', 'number')),
  options           jsonb, -- [{value, label, path_weight: {tier, points}}] for choice types
  helper_text       text,
  is_required       boolean NOT NULL DEFAULT true,
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, question_order)
);
ALTER TABLE intake_quiz_questions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "intake_quiz_questions_org" ON intake_quiz_questions FOR ALL
  USING (org_id = public.get_org_id()) WITH CHECK (org_id = public.get_org_id());
CREATE POLICY "intake_quiz_questions_service_select" ON intake_quiz_questions FOR SELECT USING (true);

-- ── Intake quiz: responses (one send/attempt per borrower) ──────────────────
CREATE TABLE IF NOT EXISTS intake_quiz_responses (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                    uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  borrower_id               uuid NOT NULL REFERENCES borrowers(id) ON DELETE CASCADE,
  status                    text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'started', 'completed', 'expired')),
  sent_at                   timestamptz NOT NULL DEFAULT now(),
  started_at                timestamptz,
  completed_at              timestamptz,
  smartcredit_link_clicked_at timestamptz, -- best-effort: set when the client hits the referral link from the portal
  self_reported_score       integer,
  primary_goal              text,
  recommended_plan_tier     text CHECK (recommended_plan_tier IN ('credit_coaching', 'wealth_coaching', 'investor_path')),
  recommended_focus         text, -- short, deterministic rationale (not AI-generated — always available even if the AI call fails)
  path_score                jsonb, -- {credit_coaching: n, wealth_coaching: n, investor_path: n} scoring breakdown
  ai_summary                text, -- Haiku-generated coach-facing consultation prep brief
  coach_reviewed_at         timestamptz,
  coach_reviewed_by         uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at                timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_quiz_responses_borrower ON intake_quiz_responses(org_id, borrower_id);
CREATE INDEX IF NOT EXISTS idx_quiz_responses_review_queue ON intake_quiz_responses(org_id, status) WHERE status = 'completed' AND coach_reviewed_at IS NULL;
ALTER TABLE intake_quiz_responses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "intake_quiz_responses_org" ON intake_quiz_responses FOR ALL
  USING (org_id = public.get_org_id()) WITH CHECK (org_id = public.get_org_id());
CREATE POLICY "intake_quiz_responses_service_all" ON intake_quiz_responses FOR ALL USING (true) WITH CHECK (true);

-- ── Intake quiz: per-question raw answers (audit trail) ─────────────────────
CREATE TABLE IF NOT EXISTS intake_quiz_answers (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  response_id       uuid NOT NULL REFERENCES intake_quiz_responses(id) ON DELETE CASCADE,
  question_id       uuid NOT NULL REFERENCES intake_quiz_questions(id) ON DELETE CASCADE,
  answer            jsonb NOT NULL, -- raw value: string, string[], or number depending on question_type
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (response_id, question_id)
);
ALTER TABLE intake_quiz_answers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "intake_quiz_answers_org" ON intake_quiz_answers FOR ALL
  USING (org_id = public.get_org_id()) WITH CHECK (org_id = public.get_org_id());
CREATE POLICY "intake_quiz_answers_service_all" ON intake_quiz_answers FOR ALL USING (true) WITH CHECK (true);

-- ── Coach Calendly links (v1: one scheduling link per coach) ────────────────
CREATE TABLE IF NOT EXISTS coach_calendly_links (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                    uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  profile_id                uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  scheduling_url            text NOT NULL, -- e.g. https://calendly.com/coach-name/consult
  calendly_event_type_uri   text, -- optional, for future API-based lookups
  is_active                 boolean NOT NULL DEFAULT true,
  created_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, profile_id)
);
ALTER TABLE coach_calendly_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "coach_calendly_links_org" ON coach_calendly_links FOR ALL
  USING (org_id = public.get_org_id()) WITH CHECK (org_id = public.get_org_id());
CREATE POLICY "coach_calendly_links_service_select" ON coach_calendly_links FOR SELECT USING (true);

-- ── Call bookings (source of truth = Calendly webhook, not client claim) ────
CREATE TABLE IF NOT EXISTS call_bookings (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  borrower_id           uuid REFERENCES borrowers(id) ON DELETE SET NULL,
  coach_id              uuid REFERENCES profiles(id) ON DELETE SET NULL,
  plan_tier_at_booking  text,
  calendly_event_uri    text UNIQUE, -- Calendly's event URI; dedupe key for webhook replays
  calendly_invitee_uri  text,
  scheduled_at          timestamptz,
  status                text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'canceled', 'no_show')),
  booked_via            text NOT NULL DEFAULT 'portal',
  created_at            timestamptz NOT NULL DEFAULT now(),
  canceled_at           timestamptz
);
CREATE INDEX IF NOT EXISTS idx_call_bookings_borrower ON call_bookings(org_id, borrower_id);
CREATE INDEX IF NOT EXISTS idx_call_bookings_coach ON call_bookings(coach_id, scheduled_at);
ALTER TABLE call_bookings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "call_bookings_org" ON call_bookings FOR ALL
  USING (org_id = public.get_org_id()) WITH CHECK (org_id = public.get_org_id());
CREATE POLICY "call_bookings_service_select" ON call_bookings FOR SELECT USING (true);

-- ── Portal messages (two-way coach <-> client thread) ────────────────────────
CREATE TABLE IF NOT EXISTS portal_messages (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  borrower_id       uuid NOT NULL REFERENCES borrowers(id) ON DELETE CASCADE,
  sender            text NOT NULL CHECK (sender IN ('borrower', 'coach')),
  sender_profile_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  body              text NOT NULL,
  read_at           timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_portal_messages_thread ON portal_messages(org_id, borrower_id, created_at);
ALTER TABLE portal_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "portal_messages_org" ON portal_messages FOR ALL
  USING (org_id = public.get_org_id()) WITH CHECK (org_id = public.get_org_id());
CREATE POLICY "portal_messages_service_all" ON portal_messages FOR ALL USING (true) WITH CHECK (true);

-- ============================================================================
-- Seed a default intake quiz for every existing org. Coaches can edit/add
-- questions later via the quiz question API — this just means the portal
-- isn't empty on day one. Scoring weights are a starting heuristic, not
-- fixed: adjust `options->path_weight` per question as real data comes in.
-- ============================================================================
INSERT INTO intake_quiz_questions (org_id, question_order, question_key, prompt, question_type, options, helper_text, is_required)
SELECT o.id, q.question_order, q.question_key, q.prompt, q.question_type, q.options::jsonb, q.helper_text, q.is_required
FROM organizations o
CROSS JOIN (VALUES
  (1, 'primary_goal', 'What''s your main goal right now?', 'single_choice',
    '[
      {"value":"buy_home","label":"Buy a home in the next 12 months","path_weight":{"tier":"credit_coaching","points":2}},
      {"value":"build_wealth","label":"Build savings / pay off debt","path_weight":{"tier":"wealth_coaching","points":2}},
      {"value":"investor","label":"Become a real estate investor","path_weight":{"tier":"investor_path","points":3}},
      {"value":"not_sure","label":"Not sure yet — I need guidance","path_weight":{"tier":"credit_coaching","points":1}}
    ]', NULL, true),
  (2, 'self_reported_score', 'What''s your approximate credit score today? (Check your SmartCredit report if you''ve pulled one — otherwise your best estimate is fine.)', 'number',
    NULL, 'Optional but helps us prep. Not required to continue.', false),
  (3, NULL, 'Which of these currently apply to you? (select all that apply)', 'multi_choice',
    '[
      {"value":"collections_on_report","label":"I have collections or negative items on my report","path_weight":{"tier":"credit_coaching","points":3}},
      {"value":"own_llc_or_planning_to","label":"I own or plan to open a business entity (LLC)","path_weight":{"tier":"investor_path","points":3}},
      {"value":"no_budget_tracking","label":"I don''t currently track a budget","path_weight":{"tier":"wealth_coaching","points":2}},
      {"value":"good_standing_ready_to_grow","label":"My credit is in good standing and I want to grow capital","path_weight":{"tier":"investor_path","points":2}}
    ]', NULL, false),
  (4, 'business_credit_interest', 'Are you interested in building business credit for real estate investing (credit stacking)?', 'single_choice',
    '[
      {"value":"yes","label":"Yes, that''s exactly why I''m here","path_weight":{"tier":"investor_path","points":4}},
      {"value":"maybe","label":"Maybe — tell me more","path_weight":{"tier":"wealth_coaching","points":1}},
      {"value":"no","label":"No, I just want to fix my credit / manage money better","path_weight":{"tier":"wealth_coaching","points":1}}
    ]', NULL, true),
  (5, 'timeline', 'How soon do you want to be loan-ready?', 'single_choice',
    '[
      {"value":"0_6mo","label":"0–6 months","path_weight":{"tier":"investor_path","points":2}},
      {"value":"6_12mo","label":"6–12 months","path_weight":{"tier":"wealth_coaching","points":1}},
      {"value":"12mo_plus","label":"12+ months / just exploring","path_weight":{"tier":"credit_coaching","points":1}}
    ]', NULL, true),
  (6, 'goal_notes', 'Anything else you want your coach to know before your first call?', 'text',
    NULL, 'Optional — share as much or as little as you''d like.', false)
) AS q(question_order, question_key, prompt, question_type, options, helper_text, is_required)
ON CONFLICT (org_id, question_order) DO NOTHING;
