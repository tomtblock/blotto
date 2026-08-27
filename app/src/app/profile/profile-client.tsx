'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/wallet/auth-context';
import { indexerApi } from '@/data/api';
import { lamportsToSol } from '@/data/format';
import type { ProfileRow } from '@/data/types';

const CLASS_NAMES = ['Goblin', 'Knight', 'Wizard', 'Dragon', 'Titan'];

export function ProfileClient() {
  const auth = useAuth();
  const wallet = auth.status === 'signed-in' ? auth.walletAddress : null;
  const [profile, setProfile] = useState<ProfileRow | null>(null);

  useEffect(() => {
    if (!wallet) return;
    indexerApi().getProfile(wallet).then(setProfile).catch(() => setProfile(null));
  }, [wallet]);

  if (!wallet) return <p className="opacity-70">Sign in to see your record.</p>;
  if (!profile) return <p className="opacity-70">No entries yet.</p>;

  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="rounded border p-4">
        <div className="text-sm opacity-60">Pools entered</div>
        <div className="font-mono text-2xl">{profile.pools_entered}</div>
      </div>
      <div className="rounded border p-4">
        <div className="text-sm opacity-60">Paid finishes</div>
        <div className="font-mono text-2xl">{profile.seats_paid}</div>
      </div>
      <div className="rounded border p-4">
        <div className="text-sm opacity-60">Total prizes</div>
        <div className="font-mono text-2xl">{lamportsToSol(profile.total_won_lamports)} SOL</div>
      </div>
      <div className="col-span-2 rounded border p-4">
        <div className="mb-2 text-sm opacity-60">Character collection</div>
        <dl className="grid grid-cols-5 gap-2 text-center">
          {profile.class_counts.map((n, i) => (
            <div key={i}>
              <dt className="text-xs opacity-60">{CLASS_NAMES[i]}</dt>
              <dd className="font-mono text-xl">{n}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
