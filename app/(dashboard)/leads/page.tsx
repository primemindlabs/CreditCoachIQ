'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Leads and Caseload merged into one segmented view at /caseload (see that
// page) — this route stays only so old bookmarks/links don't 404.
export default function LeadsRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/caseload'); }, [router]);
  return <p className="text-sm text-muted">Redirecting…</p>;
}
