import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal/legal-page';
import { LEGAL_COPY, TERMS_SECTIONS } from '@/copy/legal';

export const metadata: Metadata = { title: LEGAL_COPY.termsTitle };

/* The terms page (founder direction 2026-08-28). The clickwrap at entry
 * links here, so a player can read what they are signing. Content and
 * status flag live in src/copy/legal.ts — DRAFT until counsel signs off. */
export default function TermsPage() {
  return (
    <LegalPage
      title={LEGAL_COPY.termsTitle}
      intro={LEGAL_COPY.termsIntro}
      sections={TERMS_SECTIONS}
    />
  );
}
