import { COPY } from '@/copy';
import { Card } from '@/components/ui/card';

/*
 * The honest degraded state for a failed backend read (the SSR outage
 * guard — see `live()` in src/data/api.ts). Deliberately distinct from any
 * empty state: "no tournament is open" is a claim about the world; this
 * card only claims we cannot know right now.
 */
export function LiveDataUnavailable() {
  return (
    <Card className="flex flex-col gap-2 p-6">
      <p className="text-[17px] font-medium text-ink">{COPY.shell.liveDataUnavailable}</p>
      <p className="max-w-prose text-[13px] leading-5 text-ink-muted">
        {COPY.shell.liveDataUnavailableDetail}
      </p>
    </Card>
  );
}
