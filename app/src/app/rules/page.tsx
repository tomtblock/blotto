/*
 * Rules page skeleton (roadmap 3.9): R4's eight statements as headed
 * sections. The bodies are TODO_COPY, filled by the founder in Phase 6 with
 * counsel red-lines — the SECTION SET is fixed here; the words are not ours
 * to write (brand voice and PID §8 language are founder-and-counsel-owned).
 */
import { COPY } from '@/copy';
import { AppHeader } from '@/components/shell/app-header';
import { TabBar } from '@/components/shell/tab-bar';

export default function RulesPage() {
  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <h1 className="mb-6 text-2xl">Rules</h1>
        {COPY.rules.sections.map((s) => (
          <section key={s.id} id={s.id} className="mb-6">
            <h2 className="mb-2 text-lg">{s.heading}</h2>
            <p className="text-sm opacity-70">{s.body}</p>
          </section>
        ))}
      </main>
      <TabBar />
    </>
  );
}
