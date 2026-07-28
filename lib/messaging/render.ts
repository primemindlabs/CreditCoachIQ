/**
 * Token-personalization renderer. Every campaign send goes through this —
 * it's what keeps a system-triggered sequence from reading like a mass
 * blast. Unknown tokens render as an empty string rather than leaking
 * `{{like_this}}` into a client's inbox.
 */
export type MessageContext = Record<string, string | number | null | undefined>;

export function renderTemplate(body: string, ctx: MessageContext): string {
  return body.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) => {
    const value = ctx[key];
    return value === null || value === undefined ? '' : String(value);
  });
}

const STAGE_LABELS: Record<string, string> = {
  credit_coaching: 'Credit Coaching',
  credit_stacking: 'Credit Stacking',
  loan_ready: 'Loan Ready',
  handed_off: 'Funding in Progress',
  paused: 'Paused',
  exited: 'Exited',
};

export function stageLabel(stage: string): string {
  return STAGE_LABELS[stage] ?? stage;
}
