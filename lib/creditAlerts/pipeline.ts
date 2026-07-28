/**
 * Alert pipeline. After a credit alert is logged: build the borrower-specific
 * context and notify the assigned agent across channels. SMS/email are GATED
 * (record-only — we timestamp lo_notified_at; actual Twilio/Resend send fires
 * only when CREDIT_ALERTS_LIVE + creds are present).
 *
 * Adapted from conduit-next: looks up `borrowers` (local, denormalized) instead
 * of conduit-next's `leads`/`profiles` tables directly.
 */
import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';

export interface AlertContext {
  action_rail_title: string;
  action_rail_body: string;
  lo_sms: string;
  lo_email_subject: string;
}

export function buildAlertContext(a: { alert_type: string; previous_score?: number | null; new_score?: number | null; inquiring_lender?: string | null }, borrower: { first_name?: string | null; last_name?: string | null }, agentFirst: string): AlertContext {
  const name = `${borrower.first_name ?? ''} ${borrower.last_name ?? ''}`.trim() || 'your borrower';
  const first = borrower.first_name ?? 'your borrower';
  const delta = (a.previous_score != null && a.new_score != null) ? a.new_score - a.previous_score : 0;

  switch (a.alert_type) {
    case 'inquiry':
      return {
        action_rail_title: `🚨 ${name} credit pulled`,
        action_rail_body: a.inquiring_lender ? `${a.inquiring_lender} just pulled ${first}'s credit. Respond within 15 minutes.` : `A competitor just pulled ${first}'s credit. Respond now.`,
        lo_sms: `🚨 CREDIT ALERT: ${name}'s credit was just pulled${a.inquiring_lender ? ` by ${a.inquiring_lender}` : ' by a competitor'}. Reach out NOW before you lose this deal — open your dashboard to send a rate update.`,
        lo_email_subject: `⚠️ ${name} — credit inquiry detected`,
      };
    case 'score_increase':
      return {
        action_rail_title: `📈 ${first}'s score improved +${delta}`,
        action_rail_body: `New score: ${a.new_score}. They may qualify for a better rate — send an update.`,
        lo_sms: `Good news! ${name}'s credit score went up ${delta} points (now ${a.new_score}). They may qualify for a better rate — reach out now.`,
        lo_email_subject: `${name} credit score improved — better rate may be available`,
      };
    case 'score_decrease':
      return {
        action_rail_title: `📉 ${first}'s score dropped ${Math.abs(delta)}`,
        action_rail_body: `New score: ${a.new_score}. May affect qualification — review the file.`,
        lo_sms: `Heads up: ${name}'s credit score dropped ${Math.abs(delta)} points (now ${a.new_score}). Review their file to assess qualification impact.`,
        lo_email_subject: `${name} credit score change — file review suggested`,
      };
    default:
      return {
        action_rail_title: `📊 Credit update for ${first}`,
        action_rail_body: `New activity on ${first}'s credit. Review the file.`,
        lo_sms: `Credit update on ${name} — there's new activity on their report. Take a look when you can.`,
        lo_email_subject: `${name} — credit activity`,
      };
  }
}

export async function triggerCreditAlertPipeline(alertId: string, orgId: string): Promise<void> {
  const sb = createAdminClient();
  const { data: alert } = await sb.from('credit_alerts').select('id, alert_type, previous_score, new_score, inquiring_lender, borrower_id').eq('id', alertId).eq('org_id', orgId).maybeSingle();
  if (!alert) return;
  const { data: borrower } = await sb.from('borrowers').select('first_name, last_name, assigned_agent_id').eq('id', alert.borrower_id).maybeSingle();
  if (!borrower) return;
  const { data: agent } = borrower.assigned_agent_id ? await sb.from('profiles').select('first_name, phone, email').eq('id', borrower.assigned_agent_id).maybeSingle() : { data: null };

  const ctx = buildAlertContext(alert, borrower, (agent as { first_name?: string } | null)?.first_name ?? 'there');

  const live = process.env.CREDIT_ALERTS_LIVE === 'true';
  // TODO(delivery): when live, send ctx.lo_sms via Twilio + ctx.lo_email_subject via Resend here.
  void ctx; void live;

  await sb.from('credit_alerts').update({ lo_notified_at: new Date().toISOString() }).eq('id', alertId);
}
