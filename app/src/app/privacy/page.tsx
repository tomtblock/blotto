import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal/legal-page';
import { LEGAL_COPY, PRIVACY_SECTIONS } from '@/copy/legal';

export const metadata: Metadata = { title: LEGAL_COPY.privacyTitle };

/* The privacy page (founder direction 2026-08-28). Content and status flag
 * live in src/copy/legal.ts — DRAFT until counsel signs it off. */
export default function PrivacyPage() {
  return (
    <LegalPage
      title={LEGAL_COPY.privacyTitle}
      intro={LEGAL_COPY.privacyIntro}
      sections={PRIVACY_SECTIONS}
    />
  );
}
