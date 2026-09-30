import { useEffect, useState } from 'react';

// Progress messages shown while waiting on an import (2026-09-29): a bare
// spinner felt stuck. Imports are single server calls, so the app can't know
// the real phase — each message's `at` (ms since the start) follows measured
// timings instead. Shared by ImportScreen and PhotoImportScreen.
export type ProgressStep = { at: number; text: string };

// Returns the message for the time elapsed since `active` became true, or
// null when inactive. Restarts from the first step on every new run.
export function useProgressMessage(active: boolean, steps: ProgressStep[]): string | null {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    // Reset when the wait ends (not when the next one starts), so a new run
    // never flashes the previous run's last message for one render.
    if (!active) {
      setIndex(0);
      return;
    }
    const timers = steps.slice(1).map((step, i) => setTimeout(() => setIndex(i + 1), step.at));
    return () => timers.forEach(clearTimeout);
  }, [active, steps]);
  return active ? steps[index].text : null;
}
