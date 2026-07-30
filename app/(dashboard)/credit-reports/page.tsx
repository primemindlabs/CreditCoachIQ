import { redirect } from 'next/navigation';

// Credit report import moved onto each client's own profile page
// (components/credit-reports/CreditReportPanel.tsx, embedded in
// app/(dashboard)/caseload/[borrowerId]/page.tsx) so it lives with the
// rest of that client's record instead of a separate top-level page.
export default function CreditReportsRedirect() {
  redirect('/caseload');
}
