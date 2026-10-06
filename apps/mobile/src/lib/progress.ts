import { useEffect, useState } from 'react';

// Steps shown on the import waiting screen (ImportProgress). Imports are
// single server calls, so the app can't know the real phase — each step's
// `at` (ms since the start) follows measured timings instead (2026-09-29).
export type ProgressStep = { at: number; text: string };

// Milliseconds since `active` became true (ticks a few times a second), 0
// when inactive. Restarts on every new run.
export function useElapsed(active: boolean, tickMs = 200): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!active) {
      setElapsed(0);
      return;
    }
    const start = Date.now();
    const timer = setInterval(() => setElapsed(Date.now() - start), tickMs);
    return () => clearInterval(timer);
  }, [active, tickMs]);
  return elapsed;
}
