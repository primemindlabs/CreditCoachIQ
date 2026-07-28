/**
 * Staff role permission matrix. Four roles now exist (migration 0012 widened
 * profiles.role from admin/coach to add processor and sales):
 * - admin: everything.
 * - coach: the primary caseworker role — disputes, complaints, caseload,
 *   intake, and read-only billing (they should see a client's payment
 *   status, not change subscription pricing).
 * - processor: back-office dispute/report processing — same operational
 *   surface as a coach minus billing, since processors don't own the
 *   client billing relationship.
 * - sales: intake/lead-facing, pre-enrollment — deliberately narrow.
 *
 * This governs the NEW routes built alongside this matrix (complaints,
 * billing invoices). Existing admin-only routes (analytics, audit-log,
 * state-compliance) already check `role !== 'admin'` directly and are
 * unaffected — processor/sales simply don't satisfy that check either.
 */
export type StaffRole = 'admin' | 'coach' | 'processor' | 'sales';

export type Permission =
  | 'manage_billing'
  | 'view_billing'
  | 'manage_disputes'
  | 'manage_complaints'
  | 'manage_caseload'
  | 'manage_intake';

const MATRIX: Record<StaffRole, Permission[]> = {
  admin: ['manage_billing', 'view_billing', 'manage_disputes', 'manage_complaints', 'manage_caseload', 'manage_intake'],
  coach: ['view_billing', 'manage_disputes', 'manage_complaints', 'manage_caseload', 'manage_intake'],
  processor: ['manage_disputes', 'manage_complaints', 'manage_caseload'],
  sales: ['manage_intake'],
};

export function hasPermission(role: string, permission: Permission): boolean {
  return MATRIX[role as StaffRole]?.includes(permission) ?? false;
}
