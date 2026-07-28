/**
 * Normalize each credit vendor's webhook payload to our schema.
 * Vendor formats differ; a generic field-map handles the common shapes plus a
 * per-vendor override. No SSN/DOB is ever read — only the vendor's borrower ID.
 * (Ported unchanged from conduit-next.)
 */
export type CreditAlertType = 'inquiry' | 'score_increase' | 'score_decrease' | 'derogatory' | 'new_account';

export interface NormalizedCreditAlert {
  vendor_borrower_id: string;
  alert_type: CreditAlertType;
  previous_score?: number;
  new_score?: number;
  inquiring_lender?: string;
  inquiry_date?: string;
}

const pick = (o: Record<string, unknown>, keys: string[]): unknown => {
  for (const k of keys) if (o[k] != null) return o[k];
  return undefined;
};

function deriveType(raw: string | undefined, prev?: number, next?: number): CreditAlertType {
  const t = (raw ?? '').toLowerCase();
  if (t.includes('inquiry') || t.includes('hard_pull') || t.includes('pull')) return 'inquiry';
  if (t.includes('derog') || t.includes('collection') || t.includes('late')) return 'derogatory';
  if (t.includes('new_account') || t.includes('tradeline')) return 'new_account';
  if (prev != null && next != null) return next >= prev ? 'score_increase' : 'score_decrease';
  return 'inquiry';
}

function generic(payload: unknown): NormalizedCreditAlert | null {
  if (!payload || typeof payload !== 'object') return null;
  const o = payload as Record<string, unknown>;
  const id = pick(o, ['vendor_borrower_id', 'borrower_id', 'borrowerId', 'subjectId', 'reference_id', 'consumer_id']);
  if (!id) return null;
  const prev = Number(pick(o, ['previous_score', 'previousScore', 'prior_score', 'old_score'])) || undefined;
  const next = Number(pick(o, ['new_score', 'newScore', 'current_score', 'score'])) || undefined;
  return {
    vendor_borrower_id: String(id),
    alert_type: deriveType(pick(o, ['alert_type', 'alertType', 'event', 'eventType', 'type']) as string | undefined, prev, next),
    previous_score: prev, new_score: next,
    inquiring_lender: (pick(o, ['inquiring_lender', 'inquiringLender', 'lender_name', 'inquirer', 'subscriber_name']) as string) ?? undefined,
    inquiry_date: (pick(o, ['inquiry_date', 'inquiryDate', 'event_date']) as string) ?? undefined,
  };
}

export function normalizeCreditAlert(vendor: string, payload: unknown): NormalizedCreditAlert | null {
  switch (vendor) {
    case 'creditxpert':
    case 'factual_data':
    case 'xactus':
    case 'meridianlink':
    case 'softpull':
    case 'scoremaster':
    case 'credco':
    case 'other':
      return generic(payload);
    default:
      return generic(payload);
  }
}
