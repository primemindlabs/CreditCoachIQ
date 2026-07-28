import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { renderTemplate } from './render';
import { buildMessageContext } from './context';
import { getResend, FROM } from '@/lib/resend';
import { getTwilio, TWILIO_FROM } from '@/lib/sms';

/**
 * Enroll a client in a campaign. Idempotent — re-enrolling a client already
 * active in the same campaign is a no-op (a client should never get the
 * same welcome sequence twice because two triggers fired close together).
 */
export async function enrollBorrowerInCampaign(orgId: string, campaignId: string, borrowerId: string): Promise<void> {
  const sb = createAdminClient();

  const { data: existing } = await sb
    .from('campaign_enrollments')
    .select('id, status')
    .eq('org_id', orgId).eq('campaign_id', campaignId).eq('borrower_id', borrowerId)
    .maybeSingle();
  if (existing && existing.status === 'active') return; // already in progress

  await sb.from('campaign_enrollments').upsert({
    org_id: orgId,
    campaign_id: campaignId,
    borrower_id: borrowerId,
    current_step_order: 0,
    status: 'active',
    next_send_at: new Date().toISOString(), // step 1's own delay_hours is applied when it's actually sent
    enrolled_at: new Date().toISOString(),
    completed_at: null,
  }, { onConflict: 'campaign_id,borrower_id' });
}

/**
 * Cron entry point — send whatever's due right now, across every active
 * enrollment in the org (or all orgs, if orgId is omitted, for a
 * single-tenant deployment where there's realistically only one).
 * Call this from a scheduled job (e.g. every 5-15 minutes).
 */
export async function processDueEnrollments(orgId?: string): Promise<{ processed: number; sent: number; failed: number }> {
  const sb = createAdminClient();
  let query = sb.from('campaign_enrollments').select('*').eq('status', 'active').lte('next_send_at', new Date().toISOString());
  if (orgId) query = query.eq('org_id', orgId);
  const { data: due } = await query.limit(200);

  let sent = 0, failed = 0;
  for (const enrollment of due ?? []) {
    const result = await sendNextStep(enrollment);
    if (result === 'sent') sent += 1;
    if (result === 'failed') failed += 1;
  }
  return { processed: (due ?? []).length, sent, failed };
}

async function sendNextStep(enrollment: {
  id: string; org_id: string; campaign_id: string; borrower_id: string; current_step_order: number;
}): Promise<'sent' | 'skipped' | 'completed' | 'failed'> {
  const sb = createAdminClient();
  const nextOrder = enrollment.current_step_order + 1;

  const { data: step } = await sb
    .from('campaign_steps')
    .select('*')
    .eq('campaign_id', enrollment.campaign_id)
    .eq('step_order', nextOrder)
    .maybeSingle();

  if (!step) {
    await sb.from('campaign_enrollments').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', enrollment.id);
    return 'completed';
  }

  const { data: borrower } = await sb
    .from('borrowers')
    .select('email, phone, email_opt_out, sms_opt_out, sms_consent, journey_stage')
    .eq('id', enrollment.borrower_id)
    .maybeSingle();

  // Skip-condition check (e.g. client already moved past the stage that triggered this campaign).
  if (step.condition && typeof step.condition === 'object') {
    const cond = step.condition as { skip_if_stage_not?: string };
    if (cond.skip_if_stage_not && borrower?.journey_stage !== cond.skip_if_stage_not) {
      await advanceEnrollment(enrollment.id, nextOrder);
      return 'skipped';
    }
  }

  // Consent gates — never send SMS without consent, never send email to an opted-out client.
  if (step.channel === 'sms' && (!borrower?.sms_consent || borrower?.sms_opt_out || !borrower?.phone)) {
    await advanceEnrollment(enrollment.id, nextOrder);
    return 'skipped';
  }
  if (step.channel === 'email' && (borrower?.email_opt_out || !borrower?.email)) {
    await advanceEnrollment(enrollment.id, nextOrder);
    return 'skipped';
  }

  const { data: template } = await sb.from('message_templates').select('*').eq('id', step.template_id).maybeSingle();
  if (!template) return 'failed';

  const ctx = await buildMessageContext(enrollment.org_id, enrollment.borrower_id);
  const bodyRendered = renderTemplate(template.body, ctx);
  const subjectRendered = template.subject ? renderTemplate(template.subject, ctx) : null;

  const sendRecord = {
    org_id: enrollment.org_id,
    enrollment_id: enrollment.id,
    step_id: step.id,
    borrower_id: enrollment.borrower_id,
    channel: step.channel,
    to_address: step.channel === 'email' ? (borrower?.email ?? '') : (borrower?.phone ?? ''),
    subject_rendered: subjectRendered,
    body_rendered: bodyRendered,
    status: 'queued' as const,
  };

  try {
    let providerMessageId: string | null = null;
    if (step.channel === 'email') {
      const res = await getResend().emails.send({ from: FROM, to: sendRecord.to_address, subject: subjectRendered ?? '', html: bodyRendered });
      providerMessageId = res.data?.id ?? null;
    } else {
      const msg = await getTwilio().messages.create({ to: sendRecord.to_address, from: TWILIO_FROM, body: bodyRendered });
      providerMessageId = msg.sid;
    }
    await sb.from('campaign_sends').insert({ ...sendRecord, status: 'sent', provider_message_id: providerMessageId, sent_at: new Date().toISOString() });
    await advanceEnrollment(enrollment.id, nextOrder);
    return 'sent';
  } catch (err) {
    await sb.from('campaign_sends').insert({ ...sendRecord, status: 'failed', error_message: err instanceof Error ? err.message : 'Unknown error' });
    // Don't advance on failure — retry next cron pass rather than silently skipping a step.
    return 'failed';
  }
}

async function advanceEnrollment(enrollmentId: string, justSentStepOrder: number): Promise<void> {
  const sb = createAdminClient();
  const { data: enrollment } = await sb.from('campaign_enrollments').select('campaign_id').eq('id', enrollmentId).maybeSingle();
  if (!enrollment) return;

  const { data: next } = await sb
    .from('campaign_steps')
    .select('delay_hours')
    .eq('campaign_id', enrollment.campaign_id)
    .eq('step_order', justSentStepOrder + 1)
    .maybeSingle();

  if (!next) {
    await sb.from('campaign_enrollments').update({ current_step_order: justSentStepOrder, status: 'completed', completed_at: new Date().toISOString() }).eq('id', enrollmentId);
    return;
  }

  const nextSendAt = new Date(Date.now() + next.delay_hours * 60 * 60 * 1000);
  await sb.from('campaign_enrollments').update({ current_step_order: justSentStepOrder, next_send_at: nextSendAt.toISOString() }).eq('id', enrollmentId);
}
