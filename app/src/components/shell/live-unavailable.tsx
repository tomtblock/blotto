import { COPY } from '@/copy';
import { NeonSection } from '@/components/ui/neon-section';

/*
 * The honest degraded state (audit 2026-09-11, C-15 / D-16): the data
 * service could not be reached, which is NOT the same statement as "no
 * tournament is open" or "no entries yet". Round four A2 (founder
 * 2026-09-17): a titled neon box like every other block on the pink field.
 */
export function LiveDataUnavailable() {
  return (
    <NeonSection heading={COPY.shell.liveDataUnavailable} role="status">
      <p className="max-w-prose text-[15px] leading-6 text-ink-muted">
        {COPY.shell.liveDataUnavailableDetail}
      </p>
    </NeonSection>
  );
}
