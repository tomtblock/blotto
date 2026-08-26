"use client";

import { createContext, useContext } from "react";
import type { Auth } from "./types";

/*
 * The context the provider adapter (auth-provider.tsx) fills in. Kept in its
 * own file so screens importing useAuth never transitively import the
 * provider SDK.
 */

const noProvider = () => {
  throw new Error("useAuth called outside <AuthProvider>");
};

export const AuthContext = createContext<Auth>({
  status: "initializing",
  walletAddress: null,
  signers: [],
  signInWithSocial: noProvider,
  connectWallet: noProvider,
  signOut: noProvider,
});

export function useAuth(): Auth {
  return useContext(AuthContext);
}
