"use client";

import {
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

/*
 * TanStack Query provider (PRD §3: polling, no WebSockets in v1). One client
 * per app instance, created in state so a re-render never resets the cache.
 * Per-surface polling intervals live with their queries, not here.
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Poll-driven surfaces control their own refetch cadence;
            // background tabs must not keep hitting RPC (PRD §4 foreground rule).
            refetchIntervalInBackground: false,
            refetchOnWindowFocus: true,
          },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
