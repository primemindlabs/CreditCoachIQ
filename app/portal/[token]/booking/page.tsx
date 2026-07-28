'use client';

import { useEffect, useState, useCallback } from 'react';

interface BookingInfo {
  canBook: boolean;
  reason?: string;
  schedulingUrl?: string;
  allowance: { used: number; total: number; remaining: number };
  upcoming: { id: string; scheduled_at: string; status: string } | null;
}

export default function PortalBookingPage({ params }: { params: { token: string } }) {
  const { token } = params;
  const [data, setData] = useState<BookingInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const res = await fetch(`/api/portal/${token}/booking`);
    setData(await res.json());
    setLoading(false);
  }, [token]);

  useEffect(() => { load(); }, [load]);

  if (loading || !data) return <p className="text-sm text-muted">Loading…</p>;

  return (
    <div>
      <h1 className="mb-2 text-[26px] font-medium text-ink">Book a call</h1>
      <p className="mb-8 text-sm text-muted">
        {data.allowance.remaining} of {data.allowance.total} calls remaining this period.
      </p>

      {data.upcoming && (
        <div className="mb-6 rounded-card border border-line bg-money-tint p-6">
          <p className="text-sm font-medium text-ink">Upcoming call</p>
          <p className="mt-1 text-sm text-muted">{new Date(data.upcoming.scheduled_at).toLocaleString()}</p>
        </div>
      )}

      {data.canBook && data.schedulingUrl ? (
        <div className="overflow-hidden rounded-card border border-line bg-white">
          <iframe src={data.schedulingUrl} className="h-[700px] w-full" title="Book a call" />
        </div>
      ) : (
        <div className="rounded-card border border-line bg-white p-8 text-center">
          <p className="text-[15px] text-ink">{data.reason ?? 'Booking isn’t available right now.'}</p>
        </div>
      )}
    </div>
  );
}
