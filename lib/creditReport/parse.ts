/**
 * Credit report import — AI-parsed PDF upload, replacing manual tradeline
 * entry. Uses Claude's native PDF document support (the Messages API reads
 * the PDF directly; no separate OCR step) to extract bureau scores and
 * tradelines into the same shape app/api/disputes/generate already expects
 * (credit_tradelines: is_disputable, dispute_reason, dispute_priority, etc.),
 * so imported tradelines flow straight into the existing dispute pipeline.
 *
 * Disputability is an AI-assisted first pass, not a final determination — a
 * coach should review is_disputable/dispute_reason before generating letters
 * against a real client's report, same as any other AI-drafted output in
 * this codebase.
 */
import 'server-only';
import Anthropic from '@anthropic-ai/sdk';

export interface ParsedTradeline {
  creditor_name: string;
  account_number: string | null; // last 4 only, never the full number
  account_type: string | null;
  bureau: 'experian' | 'equifax' | 'transunion' | 'all_three';
  balance: number | null;
  credit_limit: number | null;
  open_date: string | null; // YYYY-MM-DD
  close_date: string | null;
  status: string | null;
  payment_status: string | null;
  negative_remarks: string[];
  is_disputable: boolean;
  dispute_reason: string | null;
  dispute_priority: number; // 1 (highest) - 10 (lowest)
  estimated_score_gain: number | null;
}

export interface ParsedCreditReport {
  source_bureau: 'experian' | 'equifax' | 'transunion' | 'tri_merge' | 'unknown';
  report_date: string | null;
  score_exp: number | null;
  score_eqx: number | null;
  score_tu: number | null;
  tradelines: ParsedTradeline[];
  summary: string;
}

const EXTRACTION_SCHEMA_INSTRUCTIONS = `Extract structured data from this credit report PDF and return ONLY valid JSON matching this exact shape (no markdown fences, no commentary):

{
  "source_bureau": "experian" | "equifax" | "transunion" | "tri_merge" | "unknown",
  "report_date": "YYYY-MM-DD" | null,
  "score_exp": number | null,
  "score_eqx": number | null,
  "score_tu": number | null,
  "tradelines": [
    {
      "creditor_name": string,
      "account_number": string | null,  // LAST 4 DIGITS ONLY — never transcribe a full account number
      "account_type": string | null,     // e.g. "credit_card", "auto_loan", "collection", "mortgage"
      "bureau": "experian" | "equifax" | "transunion" | "all_three",
      "balance": number | null,
      "credit_limit": number | null,
      "open_date": "YYYY-MM-DD" | null,
      "close_date": "YYYY-MM-DD" | null,
      "status": string | null,           // e.g. "open", "closed", "charge_off", "collection"
      "payment_status": string | null,   // e.g. "current", "30_days_late", "90_days_late"
      "negative_remarks": string[],      // e.g. ["late_payment_60", "charge_off"]
      "is_disputable": boolean,          // true if there's a plausible FCRA dispute basis (inaccuracy, staleness, missing verification, re-aging, duplicate reporting, etc.) — flag conservatively, a human reviews every one
      "dispute_reason": string | null,   // one sentence, only if is_disputable is true
      "dispute_priority": number,        // 1 (highest impact/most disputable) to 10 (lowest), only meaningful if is_disputable
      "estimated_score_gain": number | null  // rough estimate only if is_disputable, otherwise null
    }
  ],
  "summary": string  // 2-3 sentence plain-English summary of overall credit health and the most impactful dispute opportunities
}

Be conservative flagging is_disputable — only flag genuine FCRA dispute bases (inaccurate balances/dates, accounts that don't belong to the consumer, stale negative items past the 7-year reporting window, duplicate tradelines, missing required verification), not simply "this account looks bad." A human coach reviews every flagged item before any letter is sent.`;

export async function parseCreditReportPdf(pdfBase64: string): Promise<ParsedCreditReport> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 8000,
    messages: [
      {
        role: 'user',
        // The 'document' content block is supported by the Claude API but not
        // yet reflected in this version of @anthropic-ai/sdk's TypeScript
        // types — cast to bypass the stale type check without affecting the
        // actual request payload sent over the wire.
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
          { type: 'text', text: EXTRACTION_SCHEMA_INSTRUCTIONS },
        ] as any,
      },
    ],
  });

  const block = response.content[0];
  const text = block.type === 'text' ? block.text : '';

  let parsed: ParsedCreditReport;
  try {
    // Strip markdown fences if the model wraps the JSON despite instructions.
    const cleaned = text.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    parsed = JSON.parse(cleaned) as ParsedCreditReport;
  } catch {
    throw new Error('Could not parse the AI extraction as JSON. The PDF may not be a readable credit report, or the model output was malformed.');
  }

  if (!Array.isArray(parsed.tradelines)) parsed.tradelines = [];
  return parsed;
}
