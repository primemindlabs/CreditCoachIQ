'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, Phone } from 'lucide-react';

interface CallItem { id: string; scheduled_at: string; status: string; borrower_id: string; borrowers: { first_name: string; last_name: string } | null }
interface ExternalEvent { id: string; summary: string; startISO: string | null }

function startOfWeek(d: Date): Date {
  const day = d.getDay();
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((day + 6) % 7));
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function addDays(d: Date, n: number): Date {
  const next = new Date(d);
  next.setDate(d.getDate() + n);
  return next;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.toDateString() === b.toDateString();
}

// Dedicated week-view calendar, separate from the Today page's "today only"
// slice. Same two data sources (call_bookings + Google Calendar sync via
// /api/coach/calendar), just over a full paged week instead of hardcoded to
// today. Read-only, booking/rescheduling still happens through the client
// portal or Settings' Google Calendar connect flow.
export default function CalendarPage() {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [calls, setCalls] = useState<CallItem[]>([]);
  const [externalEvents, setExternalEvents] = useState<ExternalEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (start: Date) => {
    setLoading(true);
    const end = addDays(start, 7);
    const res = await fetch(`/api/coach/calendar?start=${start.toISOString()}&end=${end.toISOString()}`);
    if (res.ok) {
      const d = await res.json();
      setCalls(d.calls ?? []);
      setExternalEvents(d.externalEvents ?? []);
      setConnected(!!d.connected);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(weekStart); }, [weekStart, load]);

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const today = new Date();

  function eventsFor(day: Date) {
    const dayCalls = calls.filter((c) => isSameDay(new Date(c.scheduled_at), day));
    const dayExternal = externalEvents.filter((e) => e.startISO && isSameDay(new Date(e.startISO), day));
    return { dayCalls, dayExternal };
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-[26px] font-medium text-ink">Calendar</h1>
          <p className="mt-1 text-sm text-muted">
            {weekStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, {addDays(weekStart, 6).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setWeekStart(addDays(weekStart, -7))} className="rounded-control border border-line p-2 text-ink hover:border-ink/30" aria-label="Previous week">
            <ChevronLeft size={15} strokeWidth={1.75} />
          </button>
          <button onClick={() => setWeekStart(startOfWeek(new Date()))} className="rounded-control border border-line px-3 py-2 text-sm text-ink hover:border-ink/30">This week</button>
          <button onClick={() => setWeekStart(addDays(weekStart, 7))} className="rounded-control border border-line p-2 text-ink hover:border-ink/30" aria-label="Next week">
            <ChevronRight size={15} strokeWidth={1.75} />
          </button>
        </div>
      </div>

      {!connected && (
        <div className="mb-6 rounded-control border border-line bg-gold-tint p-4 text-sm text-ink">
          Google Calendar isn&apos;t connected, so only booked calls show here. <Link href="/settings" className="underline">Connect it in Settings</Link> to also see events from your own calendar.
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-7">
          {days.map((day) => {
            const { dayCalls, dayExternal } = eventsFor(day);
            const isToday = isSameDay(day, today);
            return (
              <div key={day.toISOString()} className={`rounded-card border bg-white p-3 ${isToday ? 'border-money' : 'border-line'}`}>
                <p className={`mb-2 text-xs font-medium uppercase tracking-wide ${isToday ? 'text-money' : 'text-muted'}`}>
                  {day.toLocaleDateString(undefined, { weekday: 'short' })} <span className="figure">{day.getDate()}</span>
                </p>
                <div className="space-y-2">
                  {dayCalls.map((c) => (
                    <Link key={c.id} href={`/caseload/${c.borrower_id}`} className="block rounded-control bg-money-tint px-2 py-1.5 text-xs text-money-hover hover:opacity-80">
                      <span className="flex items-center gap-1 font-medium"><Phone size={10} strokeWidth={2} /> {new Date(c.scheduled_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
                      <span className="block truncate">{c.borrowers ? `${c.borrowers.first_name} ${c.borrowers.last_name}` : 'Client'}</span>
                    </Link>
                  ))}
                  {dayExternal.map((e) => (
                    <div key={e.id} className="rounded-control bg-iris-tint px-2 py-1.5 text-xs text-iris">
                      <span className="block font-medium">{e.startISO ? new Date(e.startISO).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'All day'}</span>
                      <span className="block truncate">{e.summary}</span>
                    </div>
                  ))}
                  {dayCalls.length === 0 && dayExternal.length === 0 && <p className="text-xs text-muted">Nothing</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
