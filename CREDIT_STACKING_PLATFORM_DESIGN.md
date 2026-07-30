# Credit Stacking Platform — Design Spec
*Informed by a live teardown of trulli.ai (2026-07-29). This document translates what Trulli does well into a concrete build plan for CreditCoachIQ's credit stacking module plus a platform-wide document vault.*

---

## 1. What "that feel" actually is

Trulli doesn't feel polished because of visual design alone — it feels polished because every screen answers "what do I do next" without the user having to think. Three structural things create that:

1. **One deal-type mental model everywhere.** Credit Stacking / Revenue Funding / Credit Repair are the same three tabs on the dashboard's "start a deal" box, the Funding Analysis tool, and the Deal Manager's pipeline filter. The user never has to remember which tool handles which product — the product selector is the first decision on every entry point.
2. **A saved-output artifact, not just a live record.** Every analysis produces a "Funding Report" that lives in a library, can be reopened, and can be turned into a sellable/shareable deliverable. CreditCoachIQ's credit-report parsing already produces real analysis (scores, tradelines, dispute recommendations) — right now that analysis is trapped inside the upload event. It should become a persistent, revisitable artifact the same way.
3. **Command-center density on the pipeline view, simplicity everywhere else.** The Deal Manager is dense (six KPIs, nine saved views, four view modes) because that's the one screen a power user lives in all day. The Clients list, client detail, and intake forms stay comparatively simple. Don't spread that density everywhere — concentrate it on one pipeline screen.

---

## 2. Document Vault (platform-wide, not just credit stacking)

This is the piece you asked for directly. Trulli's pattern, adapted to CreditCoachIQ's schema:

**Two scopes, one tab.** A client's Documents tab shows client-level documents (general — ID, proof of income, signed disclosures) *and*, read-only, documents attached to that client's deals/enrollments, with a note explaining the split and a click-through to the deal for anything deal-scoped. This maps directly onto CreditCoachIQ's existing model: `borrowers` (client-level) vs `credit_repair_enrollments` / a future `credit_stack_applications` deal (deal-level).

**Concrete build:**
- New table `borrower_documents`: `id, org_id, borrower_id, enrollment_id (nullable — null = client-level), doc_type, storage_path, file_name, mime_type, size_bytes, uploaded_by, created_at`. Storage in Supabase Storage, same bucket pattern already used for credit report uploads (`credit-report-uploads`); add a parallel `borrower-documents` bucket.
- Doc type taxonomy, adapted from Trulli's list to CreditCoachIQ's actual products: **Government ID, Proof of Income, Bank Statement, CROA Disclosure (signed), Dispute Correspondence, Credit Report, Business Formation Docs, EIN Letter, Voided Check, Other.** Store as a CHECK-constrained column, not freeform.
- Upload UI: file + doc-type dropdown + upload button, PDF/PNG/JPG up to 20MB (Trulli's exact limit — sane default). Reuse the pattern already built for coach-notes/funding-status edits on the client detail page.
- List UI: table with doc type, filename, uploaded-by, date, and a delete action (soft-delete — set `deleted_at`, don't hard-delete anything with compliance relevance, consistent with the append-only audit posture already used elsewhere in this codebase).
- The credit report upload flow (`app/api/credit-reports`) should *also* write a `borrower_documents` row pointing at the same storage object, so a coach sees the actual PDF listed alongside everything else, not just the extracted data.

This is a genuinely missing piece right now — there's no general document storage on a client at all, only the single-purpose credit-report-upload pipeline.

---

## 3. Credit Stacking module (the core ask)

Trulli's credit stacking flow, and how it maps onto what CreditCoachIQ already has:

**Deal intake mirrors what's already built.** Trulli's "Credit-based funding analysis" screen is functionally identical to CreditCoachIQ's existing credit-report upload (`lib/creditReport/parse.ts` already does AI extraction with tri-merge awareness). What's missing is the framing and the output:
- **Stacking Mode toggle**: "Autonomous" (AI builds the optimal stack) vs. "Build Your Own Stack" — the latter gated as a premium/pro tier in Trulli. For CreditCoachIQ, the equivalent is: AI recommends which cards/lines to apply for and in what order (based on the existing `credit_stack_applications` data model), with a manual override for coaches who want to curate.
- **Input method choice**: Manual entry vs. PDF upload, both feeding the same downstream analysis. CreditCoachIQ already supports PDF upload; manual entry is a smaller, worthwhile add for clients without a fresh report.
- **A tri-merge callout**: "Recommended: tri-merge report (all 3 bureaus) — single-bureau reports supported but yield fewer matches." Worth adding as UI copy — it sets expectations and nudges toward better data quality without blocking anything.
- **"Generate Funding Plan" as the terminal action**, producing a saved artifact (see below), not just an inline result that disappears on refresh.

**Funding Reports → a saved artifact library.** Every stacking analysis should persist as a report: inputs used, AI recommendation (which lines, what order, projected available capital), and a timestamp. New table `stacking_reports` (or extend `credit_stack_applications` with a summary/report layer). List view with the same KPI-header pattern as Trulli's (`Total Reports`, `Avg Credit Score`, `Total Funding`, `Completed`) — cheap to build, high perceived value, and it's genuinely useful for a coach reviewing a client's history.

**The "sellable blueprint" idea is worth a deliberate no for now.** Trulli lets a broker turn a report into a paid digital product via Stripe Connect. That's solving a different business model (self-serve marketplace) than CreditCoachIQ's coached-relationship model — recommend skipping this rather than building toward it, unless the actual plan is to open up a self-serve tier later.

---

## 4. Deal Manager pattern — apply to the unified Clients/Pipeline view

This is the single highest-leverage thing to borrow, and it upgrades the Clients page tonight's session already rebuilt:

- **KPI header**: Active deals, pipeline value, projected commission, funded this period, win rate — computed the same way the existing analytics endpoints already aggregate, just surfaced above the list instead of on a separate Analytics page.
- **Saved views as a first-class object**, not just the fixed tabs already built: "My Priority," "Awaiting Docs," "Stale >7d," "Funded This Month." A `saved_views` table (`org_id, profile_id, name, filters jsonb`) lets a coach define and reuse their own filter combinations — cheap to build on top of the filters already shipped tonight.
- **Board (kanban) view as a second mode alongside the table**, not a replacement — Trulli's Pipeline/Board/Calendar/Insights tab switcher over the *same underlying data* is a good pattern. A kanban view over `journey_stage` (drag between stages) is a natural fit for CreditCoachIQ's existing stage model and would meaningfully upgrade the coach's day-to-day workflow beyond the dropdown-based `JourneyRoadmap` component.
- **"Stale >Nd" and "Hot only" as real filters**, not just badges — this connects directly to the churn-risk work already built this session; a "days in stage" filter is one query away from what already exists.

---

## 5. Embed — public lead capture (net-new for CreditCoachIQ)

Trulli's Embed tool is a genuinely different capability CreditCoachIQ doesn't have: a coach gets a hosted, brandable intake form (`app.trulli.ai/marketplace/{slug}`) they can link to or iframe on their own site, which drops straight into the Leads pipeline with source/referrer/device tracking.

For CreditCoachIQ, this would be: a public route `creditcoachiq.com/apply/{org-slug}` (or embeddable iframe) collecting name/contact/interest, writing directly to `borrowers` with `lead_source = 'embed'`, `external_source` tracking the referring domain. This is a real net-new lead-gen channel, not just a UI nicety — worth prioritizing if EquityNest wants inbound leads beyond manual/referral entry. Analytics on top (impressions → starts → submissions, device breakdown, UTM tracking) is the same shape as any funnel-tracking build and can wait for v2.

---

## 6. Branding — one settings page, many outputs

Trulli's "branding is managed in one place and applies to embeds, portal, PDFs, blueprint pages, and emails" is a good architectural call worth copying directly: one `org_branding` record (logo, primary color, from-name) referenced by every client-facing surface — the borrower portal (already exists), dispute letter PDFs, email templates, and any future embed form. Right now these are presumably each hardcoded to CreditCoachIQ's own brand; if EquityNest ever white-labels this for other coaching orgs, doing this now is much cheaper than retrofitting later.

---

## 7. Partner Network — upgrade the existing referral system

CreditCoachIQ already has `referral_partners` and a referral code on lead intake. Trulli's version adds two things worth borrowing: **automatic routing** (a partner's link leads land pre-attributed and pre-assigned, no manual matching) and **a partner-facing view** of their referred leads' status — both flagged as gaps in tonight's earlier session and now validated as a real pattern worth prioritizing, not a nice-to-have.

---

## 8. Commissions — lower priority, note for later

Trulli has a full earnings/payout module (paid-this-month, pending payout, YTD, disputes, tax & banking). This only matters if CreditCoachIQ pays coaches or referral partners on a per-deal commission basis rather than salary — worth confirming the actual compensation model before building any of this out.

---

## 9. Suggested build order

1. **Document Vault** (Section 2) — foundational, used by everything else, no dependencies.
2. **Credit Stacking deal intake + saved reports** (Section 3) — the actual product ask.
3. **Deal Manager KPI header + saved views** (Section 4) — builds directly on tonight's unified Clients page.
4. **Kanban board view** (Section 4) — bigger lift, do after the above proves out.
5. **Embed / public lead capture** (Section 5) — net-new channel, sequence based on how much EquityNest wants inbound volume vs. referral/manual.
6. **Branding unification** (Section 6) — do before any white-label conversation becomes real, not urgent otherwise.
7. **Partner Network upgrades** (Section 7) — pairs naturally with Embed since both are inbound-channel work.
8. **Commissions module** (Section 8) — only if the compensation model needs it.
