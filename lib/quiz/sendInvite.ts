import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { issuePortalToken, portalUrl } from '@/lib/portal/token';
import { getResend, FROM } from '@/lib/resend';
import { getTwilio, TWILIO_FROM } from '@/lib/sms';

/**
 * Send (or resend) the pre-call intake quiz to a borrower. Creates/reuses a
 * portal token and an 'sent' intake_quiz_responses row, then emails (and
 * texts, if consented) a link to the quiz. This is a discrete transactional
 * send — not run through the campaign engine, since it's coach-triggered
 * (or fired once at enrollment) rather than a drip sequence.
 */
export async function sendQuizInvite(orgId: string, borrowerId: string): Promise<{ ok: boolean; portalUrl?: string; error?: string }> {
  const sb = createAdminClient();
  const { data: borrower } = await sb
    .from('borrowers')
    .select('id, first_name, email, phone, sms_consent, sms_opt_out, email_opt_out')
    .eq('id', borrowerId).eq('org_id', orgId).maybeSingle();
  if (!borrower) return { ok: false, error: 'Borrower not found' };
  if (!borrower.email && !borrower.phone) return { ok: false, error: 'Borrower has no email or phone on file' };

  // Reuse an existing non-completed response rather than spamming a new one each time this is called.
  const { data: existingResponse } = await sb
    .from('intake_quiz_responses')
    .select('id, status')
    .eq('org_id', orgId).eq('borrower_id', borrowerId)
    .in('status', ['sent', 'started'])
    .maybeSingle();

  if (!existingResponse) {
    await sb.from('intake_quiz_responses').insert({ org_id: orgId, borrower_id: borrowerId, status: 'sent' });
  }

  const token = await issuePortalToken(orgId, borrowerId);
  const base = process.env.NEXT_PUBLIC_APP_URL ?? '';
  const url = portalUrl(base, token, '/quiz');
  const smartCreditUrl = process.env.SMARTCREDIT_REFERRAL_URL;

  const firstName = (borrower.first_name as string) ?? 'there';
  const smartCreditLine = smartCreditUrl
    ? `\n\nIf you'd like to pull your credit report first (optional, not required), you can do that here: ${smartCreditUrl}`
    : '';

  let emailSent = false;
  let smsSent = false;

  if (borrower.email && !borrower.email_opt_out) {
    try {
      await getResend().emails.send({
        from: FROM,
        to: borrower.email as string,
        subject: `Quick prep before your call, ${firstName}`,
        html: `<p>Hi ${firstName},</p><p>Before your consultation, take 2 minutes to complete a short intake quiz so your coach can prep for your specific goals: <a href="${url}">${url}</a></p>${smartCreditUrl ? `<p>If you'd like to pull your credit report first (optional, not required): <a href="${smartCreditUrl}">${smartCreditUrl}</a></p>` : ''}<p>See you soon,<br/>Your CreditCoachIQ team</p>`,
      });
      emailSent = true;
    } catch (err) {
      console.error('[quiz] email send failed:', err instanceof Error ? err.message : err);
    }
  }

  if (borrower.phone && borrower.sms_consent && !borrower.sms_opt_out) {
    try {
      await getTwilio().messages.create({ to: borrower.phone as string, from: TWILIO_FROM, body: `Hi ${firstName}, quick prep before your call: ${url}${smartCreditLine}` });
      smsSent = true;
    } catch (err) {
      console.error('[quiz] SMS send failed:', err instanceof Error ? err.message : err);
    }
  }

  if (!emailSent && !smsSent) return { ok: false, error: 'No channel could be sent (opted out or send failed)' };
  return { ok: true, portalUrl: url };
}
