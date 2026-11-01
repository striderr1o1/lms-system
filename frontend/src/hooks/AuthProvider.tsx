import { useQueryClient } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, ApiError } from "../api/client";
import { sessionAcceptance, usableAccessToken } from "../api/session";
import { supabase, TEACHER_APPLY_EMAIL } from "../api/supabase";

interface AuthValue {
  session: Session | null;
  ready: boolean;
}

const AuthContext = createContext<AuthValue>({ session: null, ready: false });

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;

    function apply(next: Session | null) {
      if (!active) return;
      if (!next) {
        setSession(null);
        setReady(true);
        queryClient.removeQueries({ queryKey: ["me"] });
        return;
      }
      if (sessionAcceptance(next) === "use") {
        setSession(next);
        setReady(true);
        return;
      }
      if (sessionAcceptance(next) === "wait") return;
      setSession(null);
      setReady(true);
      queryClient.removeQueries({ queryKey: ["me"] });
      window.setTimeout(() => {
        void supabase.auth.signOut().catch(() => undefined);
      }, 0);
    }

    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (error) {
          apply(null);
          return;
        }
        apply(data.session);
      })
      .catch(() => {
        apply(null);
      });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      apply(next);
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [queryClient]);

  useEffect(() => {
    const token = usableAccessToken(session);
    if (!session?.user.email || !token) return;
    const expected = localStorage.getItem(TEACHER_APPLY_EMAIL);
    if (!expected || expected !== session.user.email.toLowerCase()) return;
    let cancelled = false;
    api("/api/v1/me/teacher-application", { method: "POST" }, token)
      .then(() => {
        localStorage.removeItem(TEACHER_APPLY_EMAIL);
        if (!cancelled) queryClient.invalidateQueries({ queryKey: ["me"] });
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && (err.status === 409 || err.status === 403)) {
          localStorage.removeItem(TEACHER_APPLY_EMAIL);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [queryClient, session]);

  const value = useMemo(() => ({ session, ready }), [session, ready]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
