'use client';

import { useEffect, useState, useCallback } from 'react';
import { Phone, RefreshCw, ShieldOff, Sparkles, MessageSquare, UserCheck } from 'lucide-react';
import RadialScore from '@/components/ui/RadialScore';
import Sparkline from '@/components/ui/Sparkline';
import StatCard from '@/components/ui/StatCard';
import JourneyRoadmap from '@/components/ui/JourneyRoadmap';
import ActivityTimeline from '@/components/ui/ActivityTimeline';

interface ClientDetail {
  borrower: {
    id: string; first_name: string; last_name: string; email: string | null; phone: string | null;
    plan_tier: string; journey_stage: string; state: string | null; funding_status: string | null;
    lead_status: string; interest_level: string | null; coach_notes: string | null; assigned_agent_id: string | null;
  };
  canReassign: boolean;
  enrollment: {
    id: string; status: string; target_score: number; current_score_exp: number | null; current_score_eqx: number | null; current_score_tu: number | null;
    croa_disclosure_signed_at: string | null; mortgage_ready_at: string | null;
  } | null;
  goals: { id: string; title: string; target_amount: number | null; current_amount: number | null; status: string }[];
  openTasks: { id: string; type: string; title: string; due_date: string | null }[];
  recentCalls: { id: string; status: string; duration_seconds: number | null; started_at: string; notes: string | null }[];
  referralPartnerName: string | null;
  scoreHistory: { date: string; score: number }[];
  churnRisk: { score: number; level: 'low' | 'medium' | 'high'; reasons: string[] } | null;
}

interface StackSummary { capitalAvailable: number; activeApplicationCount: number; expiringWithin30Days: { lender_name: string }[]; }
interface Dispute { id: string; bureau: string; letter_body: string; sent_at: string | null; response_status: string; credit_tradelines: { creditor_name: string } | null; }
interface SmsMessage { id: string; direction: 'inbound' | 'outbound'; body: string; status: string; created_at: string; }
interface PortalMessage { id: string; sender: 'coach' | 'borrower'; body: string; created_at: string; read_at: string | null }
interface Agent { id: string; first_name: string; last_name: string; role: string }
interface ClientDocument {
  id: string; doc_type: string; file_name: string; mime_type: string | null;
  size_bytes: number | null; enrollment_id: string | null; created_at: string; url: string | null;
}
interface ActivityItem {
  id: string;
  type: 'stage_change' | 'note' | 'call' | 'sms' | 'email' | 'portal_message' | 'status_change';
  label: string;
  detail: string | null;
  actor: string | null;
  createdAt: string;
}
interface BillingInfo {
  configured: boolean;
  subscriptionStatus: string | null;
  lastPaymentFailedAt: string | null;
  lastPaymentFailureReason: string | null;
  paymentRetryCount: number;
  invoices: { id: string; number: string | null; status: string | null; amountDue: number; amountPaid: number; created: string; hostedInvoiceUrl: string | null }[];
}

function currency(n: number): string {
  return (n ?? 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function fileSize(bytes: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const DOC_TYPES = [
  { value: 'government_id', label: 'Government ID' },
  { value: 'proof_of_income', label: 'Proof of income' },
  { value: 'bank_statement', label: 'Bank statement' },
  { value: 'croa_disclosure', label: 'CROA disclosure' },
  { value: 'dispute_correspondence', label: 'Dispute correspondence' },
  { value: 'credit_report', label: 'Credit report' },
  { value: 'business_formation', label: 'Business formation' },
  { value: 'ein_letter', label: 'EIN letter' },
  { value: 'voided_check', label: 'Voided check' },
  { value: 'other', label: 'Other' },
] as const;
const DOC_TYPE_LABEL: Record<string, string> = Object.fromEntries(DOC_TYPES.map((d) => [d.value, d.label]));

const FUNDING_STATUSES = [
  { value: 'pre_qual', label: 'Pre-qual' },
  { value: 'processing', label: 'Processing' },
  { value: 'underwriting', label: 'Underwriting' },
  { value: 'clear_to_close', label: 'Clear to close' },
  { value: 'funded', label: 'Funded' },
  { value: 'declined', label: 'Declined' },
  { value: 'withdrawn', label: 'Withdrawn' },
] as const;

export default function ClientDetailPage({ params }: { params: { borrowerId: string } }) {
  const { borrowerId } = params;
  const [data, setData] = useState<ClientDetail | null>(null);
  const [stack, setStack] = useState<StackSummary | null>(null);
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [billing, setBilling] = useState<BillingInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [callStatus, setCallStatus] = useState<string | null>(null);
  const [stageBusy, setStageBusy] = useState(false);
  const [fundingBusy, setFundingBusy] = useState(false);
  const [portalMsg, setPortalMsg] = useState<string | null>(null);
  const [callBrief, setCallBrief] = useState<string | null>(null);
  const [callBriefLoading, setCallBriefLoading] = useState(false);
  const [selectedDisputeIds, setSelectedDisputeIds] = useState<Set<string>>(new Set());
  const [bulkSending, setBulkSending] = useState(false);
  const [smsMessages, setSmsMessages] = useState<SmsMessage[]>([]);
  const [smsDraft, setSmsDraft] = useState('');
  const [smsSending, setSmsSending] = useState(false);
  const [converting, setConverting] = useState(false);
  const [callNoteDrafts, setCallNoteDrafts] = useState<Record<string, string>>({});
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [activityLoading, setActivityLoading] = useState(true);
  const [notesDraft, setNotesDraft] = useState('');
  const [notesSaving, setNotesSaving] = useState(false);
  const [notesSavedAt, setNotesSavedAt] = useState<number | null>(null);
  const [notesError, setNotesError] = useState<string | null>(null);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDueDate, setTaskDueDate] = useState('');
  const [taskSaving, setTaskSaving] = useState(false);
  const [completingTaskIds, setCompletingTaskIds] = useState<Set<string>>(new Set());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [roster, setRoster] = useState<Agent[]>([]);
  const [rosterLoaded, setRosterLoaded] = useState(false);
  const [assignBusy, setAssignBusy] = useState(false);
  const [portalMessages, setPortalMessages] = useState<PortalMessage[]>([]);
  const [portalDraft, setPortalDraft] = useState('');
  const [portalSending, setPortalSending] = useState(false);
  const [smsSuggestLoading, setSmsSuggestLoading] = useState(false);
  const [portalSuggestLoading, setPortalSuggestLoading] = useState(false);
  const [churnNarrative, setChurnNarrative] = useState<string | null>(null);
  const [churnNarrativeLoading, setChurnNarrativeLoading] = useState(false);
  const [documents, setDocuments] = useState<ClientDocument[]>([]);
  const [docFile, setDocFile] = useState<File | null>(null);
  const [docType, setDocType] = useState('other');
  const [docAttachToEnrollment, setDocAttachToEnrollment] = useState(false);
  const [docUploading, setDocUploading] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);
  const [deletingDocIds, setDeletingDocIds] = useState<Set<string>>(new Set());
  const [sigVerifying, setSigVerifying] = useState(false);
  const [sigVerifyResult, setSigVerifyResult] = useState<{ valid: boolean; reason?: string; signedAt?: string; method?: string } | null>(null);
  const [sigDownloading, setSigDownloading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setActivityLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/coach/client/${borrowerId}`);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setLoadError(d.error ?? `Could not load this client (${res.status}).`);
        setLoading(false);
        setActivityLoading(false);
        return;
      }
      const detail = await res.json();
      setData(detail);
      setNotesDraft(detail.borrower?.coach_notes ?? '');
      const [disputesRes, stackData, billingData, smsData, activityData, portalData, documentsData] = await Promise.all([
        detail.enrollment ? fetch(`/api/disputes?enrollment_id=${detail.enrollment.id}`).then((r) => r.json()) : Promise.resolve({ disputes: [] }),
        fetch(`/api/stacking/summary?borrower_id=${borrowerId}`).then((r) => r.json()),
        fetch(`/api/billing/invoices?borrowerId=${borrowerId}`).then((r) => (r.ok ? r.json() : null)),
        fetch(`/api/coach/sms?borrowerId=${borrowerId}`).then((r) => (r.ok ? r.json() : { messages: [] })),
        fetch(`/api/coach/client/${borrowerId}/activity`).then((r) => (r.ok ? r.json() : { items: [] })),
        fetch(`/api/coach/messages/${borrowerId}`).then((r) => (r.ok ? r.json() : { messages: [] })),
        fetch(`/api/coach/client/${borrowerId}/documents`).then((r) => (r.ok ? r.json() : { documents: [] })),
      ]);
      setDisputes(disputesRes.disputes ?? []);
      setStack(stackData);
      setPortalMessages(portalData.messages ?? []);
      setBilling(billingData);
      setSmsMessages(smsData.messages ?? []);
      setActivity(activityData.items ?? []);
      setDocuments(documentsData.documents ?? []);
    } finally {
      setLoading(false);
      setActivityLoading(false);
    }
  }, [borrowerId]);

  useEffect(() => { load(); }, [load]);

  async function saveNotes() {
    setNotesSaving(true);
    setNotesError(null);
    try {
      const res = await fetch(`/api/coach/client/${borrowerId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coachNotes: notesDraft }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setNotesError(d.error ?? `Could not save notes (${res.status}).`);
        return;
      }
      setNotesSavedAt(Date.now());
      setData((prev) => (prev ? { ...prev, borrower: { ...prev.borrower, coach_notes: notesDraft } } : prev));
    } catch {
      setNotesError('Could not reach the server. Check your connection and try again.');
    } finally {
      setNotesSaving(false);
    }
  }

  async function loadCallBrief() {
    setCallBriefLoading(true);
    const res = await fetch(`/api/coach/client/${borrowerId}/call-brief`);
    const d = await res.json();
    setCallBrief(res.ok ? d.brief : (d.error ?? 'Could not generate a brief.'));
    setCallBriefLoading(false);
  }

  async function placeCall() {
    setCallStatus('Calling…');
    const res = await fetch('/api/coach/dialer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ borrowerId }),
    });
    const d = await res.json();
    setCallStatus(res.ok ? 'Call placed — your phone should ring now.' : d.error);
  }

  async function changeStage(toStage: string) {
    setStageBusy(true);
    try {
      const res = await fetch('/api/journey/transition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ borrower_id: borrowerId, to_stage: toStage }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setPortalMsg(d.error ?? `Could not update stage (${res.status}).`);
        return;
      }
      load();
    } catch {
      setPortalMsg('Could not reach the server. Check your connection and try again.');
    } finally {
      setStageBusy(false);
    }
  }

  async function changeFundingStatus(toStatus: string) {
    setFundingBusy(true);
    try {
      const res = await fetch(`/api/coach/client/${borrowerId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fundingStatus: toStatus }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setPortalMsg(d.error ?? `Could not update funding status (${res.status}).`);
        return;
      }
      load();
    } catch {
      setPortalMsg('Could not reach the server. Check your connection and try again.');
    } finally {
      setFundingBusy(false);
    }
  }

  async function addTask() {
    if (!taskTitle.trim()) return;
    setTaskSaving(true);
    try {
      const res = await fetch('/api/coach/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ borrower_id: borrowerId, title: taskTitle.trim(), due_date: taskDueDate || undefined }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setPortalMsg(d.error ?? `Could not add that task (${res.status}).`);
        return;
      }
      setTaskTitle('');
      setTaskDueDate('');
      load();
    } catch {
      setPortalMsg('Could not reach the server. Check your connection and try again.');
    } finally {
      setTaskSaving(false);
    }
  }

  async function completeTask(id: string) {
    setCompletingTaskIds((prev) => new Set(prev).add(id));
    try {
      const res = await fetch('/api/coach/tasks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, completed: true }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setPortalMsg(d.error ?? `Could not complete that task (${res.status}).`);
        return;
      }
      load();
    } catch {
      setPortalMsg('Could not reach the server. Check your connection and try again.');
    } finally {
      setCompletingTaskIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  async function loadRoster() {
    if (rosterLoaded) return;
    try {
      const res = await fetch('/api/coach/roster');
      if (res.ok) {
        const d = await res.json();
        setRoster(d.agents ?? []);
      }
    } catch {
      // Non-critical — dropdown just stays limited to whoever's already assigned.
    } finally {
      setRosterLoaded(true);
    }
  }

  async function changeAssignedAgent(agentId: string) {
    setAssignBusy(true);
    try {
      const res = await fetch(`/api/coach/client/${borrowerId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignedAgentId: agentId || null }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setPortalMsg(d.error ?? `Could not reassign this client (${res.status}).`);
        return;
      }
      load();
    } catch {
      setPortalMsg('Could not reach the server. Check your connection and try again.');
    } finally {
      setAssignBusy(false);
    }
  }

  async function portalAction(action: 'revoke' | 'reissue') {
    try {
      const res = await fetch('/api/coach/portal-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ borrowerId, action }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPortalMsg(d.error ?? `Could not ${action === 'revoke' ? 'revoke' : 'reissue'} portal access (${res.status}).`);
        return;
      }
      setPortalMsg(action === 'reissue' && d.portalUrl ? `New link: ${d.portalUrl}` : 'Portal access revoked.');
    } catch {
      setPortalMsg('Could not reach the server.');
    }
  }

  async function approveDispute(id: string) {
    try {
      const res = await fetch('/api/disputes/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ disputeIds: [id] }),
      });
      const d = await res.json().catch(() => ({}));
      const failed = !res.ok || (d.results ?? []).some((r: { status: string }) => r.status === 'failed');
      if (failed) {
        const reason = d.results?.find((r: { status: string; error?: string }) => r.status === 'failed')?.error;
        setPortalMsg(reason ?? d.error ?? 'Could not mail that letter.');
      }
      load();
    } catch {
      setPortalMsg('Could not reach the server.');
    }
  }

  function toggleDisputeSelect(id: string) {
    setSelectedDisputeIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function sendSelectedDisputes() {
    if (selectedDisputeIds.size === 0) return;
    setBulkSending(true);
    try {
      const res = await fetch('/api/disputes/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ disputeIds: Array.from(selectedDisputeIds) }),
      });
      const d = await res.json().catch(() => ({}));
      const results: { status: string; error?: string }[] = d.results ?? [];
      const failedCount = results.filter((r) => r.status === 'failed').length;
      if (!res.ok || failedCount > 0) {
        setPortalMsg(`${failedCount || results.length} of ${selectedDisputeIds.size} letter(s) failed to send${d.error ? `: ${d.error}` : ''}.`);
      }
      setSelectedDisputeIds(new Set());
      load();
    } catch {
      setPortalMsg('Could not reach the server.');
    } finally {
      setBulkSending(false);
    }
  }

  async function sendSmsMessage() {
    if (!smsDraft.trim()) return;
    setSmsSending(true);
    try {
      const res = await fetch('/api/coach/sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ borrowerId, body: smsDraft.trim() }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPortalMsg(d.error ?? `Could not send that text (${res.status}).`);
        setSmsSending(false);
        return;
      }
      setSmsDraft('');
      setSmsSending(false);
      const thread = await fetch(`/api/coach/sms?borrowerId=${borrowerId}`).then((r) => (r.ok ? r.json() : { messages: [] }));
      setSmsMessages(thread.messages ?? []);
    } catch {
      setPortalMsg('Could not reach the server.');
      setSmsSending(false);
    }
  }

  async function sendPortalMessage() {
    if (!portalDraft.trim()) return;
    setPortalSending(true);
    try {
      const res = await fetch(`/api/coach/messages/${borrowerId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: portalDraft.trim() }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPortalMsg(d.error ?? `Could not send that message (${res.status}).`);
        return;
      }
      setPortalDraft('');
      const thread = await fetch(`/api/coach/messages/${borrowerId}`).then((r) => (r.ok ? r.json() : { messages: [] }));
      setPortalMessages(thread.messages ?? []);
    } catch {
      setPortalMsg('Could not reach the server.');
    } finally {
      setPortalSending(false);
    }
  }

  async function uploadDocument() {
    if (!docFile) return;
    setDocUploading(true);
    setDocError(null);
    try {
      const form = new FormData();
      form.append('file', docFile);
      form.append('docType', docType);
      if (docAttachToEnrollment && enrollment) form.append('enrollmentId', enrollment.id);
      const res = await fetch(`/api/coach/client/${borrowerId}/documents`, { method: 'POST', body: form });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setDocError(d.error ?? `Could not upload that file (${res.status}).`);
        return;
      }
      setDocFile(null);
      setDocType('other');
      setDocAttachToEnrollment(false);
      const refreshed = await fetch(`/api/coach/client/${borrowerId}/documents`).then((r) => (r.ok ? r.json() : { documents: [] }));
      setDocuments(refreshed.documents ?? []);
    } catch {
      setDocError('Could not reach the server. Check your connection and try again.');
    } finally {
      setDocUploading(false);
    }
  }

  async function deleteDocument(id: string) {
    setDeletingDocIds((prev) => new Set(prev).add(id));
    try {
      const res = await fetch(`/api/coach/client/${borrowerId}/documents?id=${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setDocError(d.error ?? `Could not remove that document (${res.status}).`);
        return;
      }
      setDocuments((prev) => prev.filter((doc) => doc.id !== id));
    } catch {
      setDocError('Could not reach the server.');
    } finally {
      setDeletingDocIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  // Shared by both threads — asks the AI for a draft based on the existing
  // conversation, then drops it into the compose box for the coach to edit
  // or clear before sending. Never sends anything on its own.
  async function suggestReply(channel: 'sms' | 'portal') {
    const thread = channel === 'sms'
      ? smsMessages.map((m) => ({ from: (m.direction === 'outbound' ? 'coach' : 'client') as 'coach' | 'client', body: m.body }))
      : portalMessages.map((m) => ({ from: (m.sender === 'coach' ? 'coach' : 'client') as 'coach' | 'client', body: m.body }));
    if (thread.length === 0) return;

    const setLoading = channel === 'sms' ? setSmsSuggestLoading : setPortalSuggestLoading;
    const setDraft = channel === 'sms' ? setSmsDraft : setPortalDraft;
    setLoading(true);
    try {
      const res = await fetch('/api/coach/reply-suggestion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel, firstName: borrower?.first_name ?? 'there', thread }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPortalMsg(d.error ?? 'Could not generate a suggestion.');
        return;
      }
      setDraft(d.draft ?? '');
    } catch {
      setPortalMsg('Could not reach the server.');
    } finally {
      setLoading(false);
    }
  }

  async function explainChurnRisk() {
    if (!data?.churnRisk) return;
    setChurnNarrativeLoading(true);
    try {
      const res = await fetch(`/api/coach/client/${borrowerId}/churn-narrative`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName: data.borrower.first_name, risk: data.churnRisk, activity }),
      });
      const d = await res.json().catch(() => ({}));
      setChurnNarrative(res.ok ? d.narrative : (d.error ?? 'Could not generate an explanation.'));
    } catch {
      setChurnNarrative('Could not reach the server.');
    } finally {
      setChurnNarrativeLoading(false);
    }
  }

  async function saveCallNotes(logId: string) {
    if (!(logId in callNoteDrafts)) return; // untouched — don't overwrite on a stray blur
    const notes = callNoteDrafts[logId];
    try {
      const res = await fetch('/api/coach/dialer', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logId, notes }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setPortalMsg(d.error ?? `Could not save that note (${res.status}).`);
        return;
      }
      load();
    } catch {
      setPortalMsg('Could not reach the server.');
    }
  }

  async function verifySignature() {
    setSigVerifying(true);
    setSigVerifyResult(null);
    try {
      const res = await fetch(`/api/coach/client/${borrowerId}/signature-certificate?verifyOnly=true`);
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSigVerifyResult({ valid: false, reason: d.error ?? `Could not verify (${res.status}).` });
        return;
      }
      setSigVerifyResult(d);
    } catch {
      setSigVerifyResult({ valid: false, reason: 'Could not reach the server.' });
    } finally {
      setSigVerifying(false);
    }
  }

  async function downloadSignatureCertificate() {
    setSigDownloading(true);
    try {
      const res = await fetch(`/api/coach/client/${borrowerId}/signature-certificate`);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setPortalMsg(d.error ?? `Could not generate the certificate (${res.status}).`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `croa-signed-agreement-${borrowerId}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setPortalMsg('Could not reach the server.');
    } finally {
      setSigDownloading(false);
    }
  }

  async function convertLead(overrideStateWarning = false) {
    setConverting(true);
    try {
      const res = await fetch(`/api/leads/${borrowerId}/convert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overrideStateWarning }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        if (res.status === 409 && d.warning === 'state_not_registered' && window.confirm(`${d.error}\n\nConvert anyway?`)) {
          return convertLead(true);
        }
        setPortalMsg(d.error ?? `Could not convert (${res.status}).`);
        return;
      }
      setPortalMsg('Converted to enrolled client.');
      load();
    } catch {
      setPortalMsg('Could not reach the server. Check your connection and try again.');
    } finally {
      setConverting(false);
    }
  }

  if (loadError) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <p className="max-w-sm text-center text-sm text-muted">{loadError}</p>
      </div>
    );
  }

  if (loading || !data) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <p className="text-sm text-muted">Loading…</p>
      </div>
    );
  }

  const { borrower, enrollment } = data;
  const scoreValues = data.scoreHistory.map((h) => h.score);

  return (
    <div>
      {/* Hero */}
      <div className="mb-6 border-b border-line pb-8">
        <div className="flex flex-col items-start justify-between gap-8 sm:flex-row sm:items-center">
          <div>
            <h1 className="text-[26px] font-medium leading-tight text-ink">{borrower.first_name} {borrower.last_name}</h1>
            <p className="mt-2 text-sm text-muted">
              {borrower.email ?? 'No email'} · {borrower.phone ?? 'No phone'} · {borrower.plan_tier.replace('_', ' ')}
              {data.referralPartnerName ? ` · Referred by ${data.referralPartnerName}` : ''}
            </p>
            <div className="mt-3 flex items-center gap-1.5 text-sm">
              <span className="text-muted">Coach:</span>
              {data.canReassign ? (
                <select
                  value={borrower.assigned_agent_id ?? ''}
                  disabled={assignBusy}
                  onFocus={loadRoster}
                  onChange={(e) => changeAssignedAgent(e.target.value)}
                  className="rounded-control border border-line px-2 py-1 text-sm text-ink disabled:opacity-60"
                >
                  <option value="">Unassigned</option>
                  {roster.map((a) => <option key={a.id} value={a.id}>{a.first_name} {a.last_name}</option>)}
                </select>
              ) : (
                <span className="text-ink">{roster.find((a) => a.id === borrower.assigned_agent_id)?.first_name ?? (borrower.assigned_agent_id ? 'Assigned' : 'Unassigned')}</span>
              )}
            </div>
            {enrollment ? (
              <div className="mt-3">
                <p className={`text-xs ${enrollment?.croa_disclosure_signed_at ? 'text-money' : 'text-gold'}`}>
                  {enrollment?.croa_disclosure_signed_at ? 'CROA signed' : 'CROA not yet signed'}
                </p>
                {enrollment?.croa_disclosure_signed_at && (
                  <div className="mt-1.5 flex items-center gap-3 text-xs">
                    <button onClick={verifySignature} disabled={sigVerifying} className="text-money hover:underline disabled:opacity-60">
                      {sigVerifying ? 'Verifying…' : 'Verify signature'}
                    </button>
                    <button onClick={downloadSignatureCertificate} disabled={sigDownloading} className="text-money hover:underline disabled:opacity-60">
                      {sigDownloading ? 'Preparing…' : 'Download certificate'}
                    </button>
                  </div>
                )}
                {sigVerifyResult && (
                  <p className={`mt-1.5 text-xs ${sigVerifyResult.valid ? 'text-money' : 'text-terra'}`}>
                    {sigVerifyResult.valid
                      ? `Integrity check passed — signed ${sigVerifyResult.signedAt ? new Date(sigVerifyResult.signedAt).toLocaleString() : ''} (${sigVerifyResult.method})`
                      : `Integrity check failed — ${sigVerifyResult.reason}`}
                  </p>
                )}
              </div>
            ) : (
              <p className="mt-3 text-xs text-gold">Lead · {borrower.lead_status}{borrower.interest_level ? ` · ${borrower.interest_level}` : ''} — not yet enrolled</p>
            )}
            {scoreValues.length >= 2 && (
              <div className="mt-6">
                <p className="mb-2 text-[11px] uppercase tracking-wide text-muted">Score trend</p>
                <Sparkline values={scoreValues} color="#0F9D58" width={180} height={44} />
              </div>
            )}
            <div className="mt-6 flex flex-wrap gap-2">
              <button onClick={placeCall} className="flex items-center gap-1.5 rounded-control bg-ink px-3.5 py-2 text-sm font-medium text-white hover:bg-ink/90">
                <Phone size={14} strokeWidth={1.75} /> Call
              </button>
              <button onClick={() => portalAction('reissue')} className="flex items-center gap-1.5 rounded-control border border-line px-3.5 py-2 text-sm text-ink hover:border-ink/30">
                <RefreshCw size={14} strokeWidth={1.75} /> Reissue portal link
              </button>
              <button onClick={() => portalAction('revoke')} className="flex items-center gap-1.5 rounded-control border border-line px-3.5 py-2 text-sm text-ink hover:border-ink/30">
                <ShieldOff size={14} strokeWidth={1.75} /> Revoke portal
              </button>
              <button onClick={loadCallBrief} disabled={callBriefLoading} className="flex items-center gap-1.5 rounded-control border border-line px-3.5 py-2 text-sm text-ink hover:border-ink/30 disabled:opacity-60">
                <Sparkles size={14} strokeWidth={1.75} /> {callBriefLoading ? 'Writing…' : 'Call prep brief'}
              </button>
              {!enrollment && (
                <button onClick={convertLead} disabled={converting} className="flex items-center gap-1.5 rounded-control bg-money px-3.5 py-2 text-sm font-medium text-white hover:bg-money-hover disabled:opacity-60">
                  <UserCheck size={14} strokeWidth={1.75} /> {converting ? 'Converting…' : 'Convert to client'}
                </button>
              )}
            </div>
            {callBrief && (
              <div className="mt-4 max-w-xl rounded-control border border-line bg-paper p-4 text-sm text-ink">{callBrief}</div>
            )}
            {callStatus && <p className="mt-3 text-sm text-muted">{callStatus}</p>}
            {portalMsg && <p className="mt-3 break-all text-sm text-muted">{portalMsg}</p>}
          </div>
          <RadialScore score={enrollment?.current_score_exp ?? null} target={enrollment?.target_score ?? null} size={140} />
        </div>
      </div>

      {/* Coach notes — freeform scratchpad, distinct from per-call notes and the activity log below. */}
      <div className="mb-8 rounded-card border border-line bg-white p-6 shadow-card">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-medium text-ink">Notes</p>
          <div className="flex items-center gap-2">
            {notesSavedAt && !notesSaving && Date.now() - notesSavedAt < 4000 && <span className="text-xs text-money">Saved</span>}
            <button
              onClick={saveNotes}
              disabled={notesSaving || notesDraft === (borrower.coach_notes ?? '')}
              className="rounded-control border border-line px-3 py-1.5 text-xs text-ink hover:border-ink/30 disabled:opacity-50"
            >
              {notesSaving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
        <textarea
          value={notesDraft}
          onChange={(e) => setNotesDraft(e.target.value)}
          placeholder="What's actually going on with this person — context that doesn't belong to any one call."
          rows={3}
          className="w-full resize-y rounded-control border border-line px-3 py-2 text-sm text-ink placeholder:text-muted"
        />
        {notesError && <p className="mt-2 text-xs text-terra">{notesError}</p>}
      </div>

      {/* Document vault — client-level by default; can optionally be scoped to
          the active enrollment so it shows up as deal-specific later on. */}
      <div className="mb-8 rounded-card border border-line bg-white p-6 shadow-card">
        <p className="mb-5 text-sm font-medium text-ink">Documents</p>
        <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-line pb-4">
          <input
            type="file"
            onChange={(e) => setDocFile(e.target.files?.[0] ?? null)}
            className="max-w-[220px] flex-1 text-xs text-ink file:mr-2 file:rounded-control file:border file:border-line file:bg-white file:px-2 file:py-1 file:text-xs file:text-ink"
          />
          <select
            value={docType}
            onChange={(e) => setDocType(e.target.value)}
            className="rounded-control border border-line px-2 py-1.5 text-xs text-ink"
          >
            {DOC_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          {enrollment && (
            <label className="flex items-center gap-1.5 text-xs text-muted">
              <input type="checkbox" checked={docAttachToEnrollment} onChange={(e) => setDocAttachToEnrollment(e.target.checked)} />
              Attach to enrollment
            </label>
          )}
          <button
            onClick={uploadDocument}
            disabled={docUploading || !docFile}
            className="shrink-0 rounded-control bg-money px-3 py-1.5 text-xs font-medium text-white hover:bg-money-hover disabled:opacity-50"
          >
            {docUploading ? 'Uploading…' : 'Upload'}
          </button>
        </div>
        {docError && <p className="mb-3 text-xs text-terra">{docError}</p>}
        {documents.length === 0 ? (
          <p className="text-sm text-muted">No documents on file yet.</p>
        ) : (
          <div className="space-y-2">
            {documents.map((doc) => (
              <div key={doc.id} className="flex items-center justify-between gap-2 border-b border-line pb-2 text-sm last:border-0 last:pb-0">
                <div className="min-w-0">
                  <p className="truncate text-ink">{doc.file_name}</p>
                  <p className="text-xs text-muted">
                    {DOC_TYPE_LABEL[doc.doc_type] ?? doc.doc_type}
                    {doc.enrollment_id ? ' · deal' : ' · client'}
                    {fileSize(doc.size_bytes) ? ` · ${fileSize(doc.size_bytes)}` : ''} · {new Date(doc.created_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {doc.url && (
                    <a href={doc.url} target="_blank" rel="noreferrer" className="text-xs text-money hover:underline">View</a>
                  )}
                  <button
                    onClick={() => deleteDocument(doc.id)}
                    disabled={deletingDocIds.has(doc.id)}
                    className="text-xs text-muted hover:text-terra disabled:opacity-50"
                  >
                    {deletingDocIds.has(doc.id) ? 'Removing…' : 'Remove'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mb-8 rounded-card border border-line bg-white p-6 shadow-card">
        <p className="mb-5 text-sm font-medium text-ink">Journey stage</p>
        <JourneyRoadmap stage={borrower.journey_stage} busy={stageBusy} onChange={changeStage} />
      </div>

      {enrollment && (
        <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <StatCard label="Stacked capital" value={stack ? currency(stack.capitalAvailable) : '—'} sub={`${stack?.activeApplicationCount ?? 0} active lines`} accent="money" />
          <div className="rounded-card border border-line bg-white p-4 shadow-card">
            <p className="text-[11px] uppercase tracking-wide text-muted">Funding status</p>
            <select
              value={borrower.funding_status ?? ''}
              disabled={fundingBusy}
              onChange={(e) => changeFundingStatus(e.target.value)}
              className="figure mt-1.5 w-full rounded-control border border-line bg-white py-1 text-lg font-medium text-ink disabled:opacity-60"
            >
              <option value="" disabled>Not set</option>
              {FUNDING_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      <div className="mb-8 rounded-card border border-line bg-white p-6 shadow-card">
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-ink">Activity</p>
            {data.churnRisk && data.churnRisk.level !== 'low' && (
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${data.churnRisk.level === 'high' ? 'bg-terra-tint text-terra' : 'bg-gold-tint text-ink'}`}>
                {data.churnRisk.level} churn risk
              </span>
            )}
          </div>
          {data.churnRisk && (
            <button onClick={explainChurnRisk} disabled={churnNarrativeLoading} className="flex items-center gap-1.5 rounded-control border border-line px-3 py-1.5 text-xs text-ink hover:border-ink/30 disabled:opacity-60">
              <Sparkles size={13} strokeWidth={1.75} /> {churnNarrativeLoading ? 'Thinking…' : 'Explain risk'}
            </button>
          )}
        </div>
        {churnNarrative && <div className="mb-4 rounded-control border border-line bg-paper p-4 text-sm text-ink">{churnNarrative}</div>}
        <ActivityTimeline items={activity} loading={activityLoading} />
      </div>

      {enrollment && (
        <div className="mb-8 rounded-card border border-line bg-white p-6 shadow-card">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm font-medium text-ink">Dispute letters</p>
            {selectedDisputeIds.size > 0 && (
              <button onClick={sendSelectedDisputes} disabled={bulkSending} className="rounded-control bg-money px-3 py-1.5 text-xs font-medium text-white hover:bg-money-hover disabled:opacity-50">
                {bulkSending ? 'Sending…' : `Send ${selectedDisputeIds.size} selected`}
              </button>
            )}
          </div>
          {disputes.length === 0 ? (
            <p className="text-sm text-muted">No disputes drafted yet.</p>
          ) : (
            <div className="space-y-3">
              {disputes.map((d) => (
                <div key={d.id} className="flex items-center justify-between border-b border-line pb-3 text-sm last:border-0 last:pb-0">
                  <span className="flex items-center gap-2 text-ink">
                    {!d.sent_at && (
                      <input type="checkbox" checked={selectedDisputeIds.has(d.id)} onChange={() => toggleDisputeSelect(d.id)} />
                    )}
                    {d.credit_tradelines?.creditor_name ?? 'Account'} · {d.bureau}
                  </span>
                  {d.sent_at ? (
                    <span className="text-muted">{d.response_status}</span>
                  ) : (
                    <button onClick={() => approveDispute(d.id)} className="rounded-control bg-money px-3 py-1.5 text-xs font-medium text-white hover:bg-money-hover">Approve & mail</button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {billing?.configured && (
        <div className="mb-8 rounded-card border border-line bg-white p-6 shadow-card">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm font-medium text-ink">Billing</p>
            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${billing.subscriptionStatus === 'past_due' ? 'bg-terra-tint text-terra' : billing.subscriptionStatus === 'active' ? 'bg-money-tint text-money-hover' : 'bg-line text-muted'}`}>
              {billing.subscriptionStatus?.replace('_', ' ') ?? '—'}
            </span>
          </div>
          {billing.lastPaymentFailedAt && (
            <div className="mb-4 rounded-control bg-terra-tint p-4 text-sm text-terra">
              Payment failed {new Date(billing.lastPaymentFailedAt).toLocaleDateString()} ({billing.paymentRetryCount} attempt{billing.paymentRetryCount === 1 ? '' : 's'}). {billing.lastPaymentFailureReason}
            </div>
          )}
          {billing.invoices.length === 0 ? (
            <p className="text-sm text-muted">No invoices yet.</p>
          ) : (
            <div className="space-y-2">
              {billing.invoices.map((inv) => (
                <div key={inv.id} className="flex items-center justify-between border-b border-line pb-2 text-sm last:border-0 last:pb-0">
                  <span className="text-ink">{new Date(inv.created).toLocaleDateString()} {inv.number ? `· ${inv.number}` : ''}</span>
                  <span className="text-muted">{currency(inv.amountPaid || inv.amountDue)} · {inv.status}</span>
                  {inv.hostedInvoiceUrl && (
                    <a href={inv.hostedInvoiceUrl} target="_blank" rel="noreferrer" className="text-money hover:underline">View</a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-card border border-line bg-white p-6 shadow-card">
          <p className="mb-3 text-sm font-medium text-ink">Goals</p>
          {data.goals.length === 0 ? <p className="text-sm text-muted">No goals set.</p> : (
            <div className="space-y-2">
              {data.goals.map((g) => (
                <div key={g.id} className="flex justify-between text-sm">
                  <span className="text-ink">{g.title}</span>
                  <span className="text-muted">{currency(g.current_amount ?? 0)} / {g.target_amount ? currency(g.target_amount) : '—'}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="rounded-card border border-line bg-white p-6 shadow-card">
          <p className="mb-3 text-sm font-medium text-ink">Open tasks</p>
          {data.openTasks.length === 0 ? <p className="mb-3 text-sm text-muted">Nothing open.</p> : (
            <div className="mb-3 space-y-2">
              {data.openTasks.map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-2 text-sm">
                  <label className="flex items-center gap-2 text-ink">
                    <input
                      type="checkbox"
                      checked={completingTaskIds.has(t.id)}
                      disabled={completingTaskIds.has(t.id)}
                      onChange={() => completeTask(t.id)}
                      className="rounded border-line"
                    />
                    {t.title}
                  </label>
                  <span className="shrink-0 text-muted">{t.due_date}</span>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2 border-t border-line pt-3">
            <input
              value={taskTitle}
              onChange={(e) => setTaskTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addTask(); }}
              placeholder="Add a task…"
              className="min-w-0 flex-1 rounded-control border border-line px-2.5 py-1.5 text-sm text-ink placeholder:text-muted"
            />
            <input
              type="date"
              value={taskDueDate}
              onChange={(e) => setTaskDueDate(e.target.value)}
              className="figure w-[130px] shrink-0 rounded-control border border-line px-2 py-1.5 text-sm text-ink"
            />
            <button
              onClick={addTask}
              disabled={taskSaving || !taskTitle.trim()}
              className="shrink-0 rounded-control border border-line px-3 py-1.5 text-sm text-ink hover:border-ink/30 disabled:opacity-60"
            >
              Add
            </button>
          </div>
        </div>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {data.recentCalls.length > 0 && (
          <div className="rounded-card border border-line bg-white p-6 shadow-card">
            <p className="mb-3 text-sm font-medium text-ink">Recent calls</p>
            <div className="space-y-3">
              {data.recentCalls.map((c) => (
                <div key={c.id} className="border-b border-line pb-3 text-sm last:border-0 last:pb-0">
                  <div className="flex justify-between">
                    <span className="text-ink">{new Date(c.started_at).toLocaleString()}</span>
                    <span className="text-muted">{c.status}{c.duration_seconds ? ` · ${Math.round(c.duration_seconds / 60)}m` : ''}</span>
                  </div>
                  <textarea
                    placeholder="Add call notes…"
                    defaultValue={c.notes ?? ''}
                    onChange={(e) => setCallNoteDrafts((prev) => ({ ...prev, [c.id]: e.target.value }))}
                    onBlur={() => saveCallNotes(c.id)}
                    rows={2}
                    className="mt-2 w-full rounded-control border border-line px-2 py-1.5 text-xs text-ink placeholder:text-muted focus:border-ink/30 focus:outline-none"
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="rounded-card border border-line bg-white p-6 shadow-card">
          <p className="mb-3 flex items-center gap-1.5 text-sm font-medium text-ink"><MessageSquare size={14} strokeWidth={1.75} /> Text messages</p>
          {!borrower.phone ? (
            <p className="text-sm text-muted">No phone number on file.</p>
          ) : (
            <>
              <div className="max-h-64 space-y-2 overflow-y-auto">
                {smsMessages.length === 0 ? (
                  <p className="text-sm text-muted">No texts yet.</p>
                ) : (
                  smsMessages.map((m) => (
                    <div key={m.id} className={`max-w-[85%] rounded-control px-3 py-2 text-sm ${m.direction === 'outbound' ? 'ml-auto bg-money-tint text-ink' : 'bg-paper text-ink'}`}>
                      <p>{m.body}</p>
                      <p className="mt-1 text-[10px] text-muted">{new Date(m.created_at).toLocaleString()}</p>
                    </div>
                  ))
                )}
              </div>
              <div className="mt-3 flex gap-2">
                <input
                  value={smsDraft}
                  onChange={(e) => setSmsDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') sendSmsMessage(); }}
                  placeholder="Text this client…"
                  className="flex-1 rounded-control border border-line px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-ink/30 focus:outline-none"
                />
                {smsMessages.length > 0 && (
                  <button onClick={() => suggestReply('sms')} disabled={smsSuggestLoading} title="Suggest a reply" className="flex items-center gap-1 rounded-control border border-line px-2.5 py-2 text-xs text-ink hover:border-ink/30 disabled:opacity-60">
                    <Sparkles size={13} strokeWidth={1.75} /> {smsSuggestLoading ? '…' : ''}
                  </button>
                )}
                <button onClick={sendSmsMessage} disabled={smsSending || !smsDraft.trim()} className="rounded-control bg-money px-3 py-2 text-xs font-medium text-white hover:bg-money-hover disabled:opacity-50">
                  {smsSending ? 'Sending…' : 'Send'}
                </button>
              </div>
            </>
          )}
        </div>

        <div className="rounded-card border border-line bg-white p-6 shadow-card">
          <p className="mb-3 flex items-center gap-1.5 text-sm font-medium text-ink"><MessageSquare size={14} strokeWidth={1.75} /> Portal messages</p>
          <div className="max-h-64 space-y-2 overflow-y-auto">
            {portalMessages.length === 0 ? (
              <p className="text-sm text-muted">No portal messages yet.</p>
            ) : (
              portalMessages.map((m) => (
                <div key={m.id} className={`max-w-[85%] rounded-control px-3 py-2 text-sm ${m.sender === 'coach' ? 'ml-auto bg-money-tint text-ink' : 'bg-paper text-ink'}`}>
                  <p>{m.body}</p>
                  <p className="mt-1 text-[10px] text-muted">{new Date(m.created_at).toLocaleString()}</p>
                </div>
              ))
            )}
          </div>
          <div className="mt-3 flex gap-2">
            <input
              value={portalDraft}
              onChange={(e) => setPortalDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') sendPortalMessage(); }}
              placeholder="Message this client on the portal…"
              className="flex-1 rounded-control border border-line px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-ink/30 focus:outline-none"
            />
            {portalMessages.length > 0 && (
              <button onClick={() => suggestReply('portal')} disabled={portalSuggestLoading} title="Suggest a reply" className="flex items-center gap-1 rounded-control border border-line px-2.5 py-2 text-xs text-ink hover:border-ink/30 disabled:opacity-60">
                <Sparkles size={13} strokeWidth={1.75} /> {portalSuggestLoading ? '…' : ''}
              </button>
            )}
            <button onClick={sendPortalMessage} disabled={portalSending || !portalDraft.trim()} className="rounded-control bg-money px-3 py-2 text-xs font-medium text-white hover:bg-money-hover disabled:opacity-50">
              {portalSending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
