'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';

interface Result { id: string; name: string; detail: string; status: string }

/**
 * Cmd+K (Mac) / Ctrl+K (Windows) global client search. Also reachable by
 * clicking the search icon in the nav, since not every user discovers
 * keyboard shortcuts on their own. Debounced query against
 * /api/coach/search, arrow keys to move, Enter to jump to the client page.
 */
export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const runSearch = useCallback((q: string) => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    setLoading(true);
    fetch(`/api/coach/search?q=${encodeURIComponent(q.trim())}`)
      .then((r) => (r.ok ? r.json() : { results: [] }))
      .then((d) => {
        setResults(d.results ?? []);
        setActiveIndex(0);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const t = setTimeout(() => runSearch(query), 200);
    return () => clearTimeout(t);
  }, [query, runSearch]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery('');
      setResults([]);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  function goTo(id: string) {
    setOpen(false);
    router.push(`/caseload/${id}`);
  }

  function onInputKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && results[activeIndex]) {
      goTo(results[activeIndex].id);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-control px-2.5 py-1.5 text-muted hover:bg-line/60 hover:text-ink"
        aria-label="Search clients"
        title="Search (Cmd+K)"
      >
        <Search size={15} strokeWidth={1.75} />
      </button>

      {open && (
        <div className="fixed inset-0 z-30 flex items-start justify-center bg-ink/20 pt-[15vh]" onClick={() => setOpen(false)}>
          <div className="w-full max-w-lg rounded-card border border-line bg-white shadow-card" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 border-b border-line px-4 py-3">
              <Search size={15} strokeWidth={1.75} className="shrink-0 text-muted" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onInputKeyDown}
                placeholder="Search clients by name, email, or phone…"
                className="w-full text-sm text-ink placeholder:text-muted focus:outline-none"
              />
              <span className="shrink-0 rounded-control border border-line px-1.5 py-0.5 text-[10px] text-muted">Esc</span>
            </div>
            <div className="max-h-80 overflow-y-auto py-1">
              {loading && <p className="px-4 py-4 text-sm text-muted">Searching…</p>}
              {!loading && query.trim().length >= 2 && results.length === 0 && (
                <p className="px-4 py-4 text-sm text-muted">No clients match &ldquo;{query}&rdquo;.</p>
              )}
              {!loading && query.trim().length < 2 && (
                <p className="px-4 py-4 text-sm text-muted">Type at least 2 characters to search.</p>
              )}
              {results.map((r, i) => (
                <button
                  key={r.id}
                  onClick={() => goTo(r.id)}
                  onMouseEnter={() => setActiveIndex(i)}
                  className={`flex w-full items-center justify-between px-4 py-2.5 text-left text-sm ${i === activeIndex ? 'bg-paper' : ''}`}
                >
                  <span className="text-ink">{r.name}</span>
                  <span className="text-xs text-muted">{r.status}{r.detail ? `, ${r.detail}` : ''}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
