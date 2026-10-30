import { useQueryClient } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, ApiError } from "../api/client";
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
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setReady(true);
      if (!next) queryClient.removeQueries({ queryKey: ["me"] });
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [queryClient]);

  useEffect(() => {
    if (!session?.user.email) return;
    const expected = localStorage.getItem(TEACHER_APPLY_EMAIL);
    if (!expected || expected !== session.user.email.toLowerCase()) return;
    let cancelled = false;
    api("/api/v1/me/teacher-application", { method: "POST" })
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
