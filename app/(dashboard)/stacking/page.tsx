import { redirect } from 'next/navigation';

// Credit stacking moved onto each client's own profile page
// (components/stacking/ClientStackingPanel.tsx, embedded in
// app/(dashboard)/caseload/[borrowerId]/page.tsx) so it lives with the
// rest of that client's record instead of a separate top-level page.
export default function StackingRedirect() {
  redirect('/caseload');
}
