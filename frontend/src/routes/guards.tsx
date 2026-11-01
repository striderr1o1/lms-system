import type { ReactNode } from "react";
import { Navigate, Outlet, useLocation } from "react-router";
import { ErrorNote, Loading } from "../components/ui";
import { useAuth } from "../hooks/AuthProvider";
import { useMe } from "../hooks/useMe";

export function RequireAuth() {
  const location = useLocation();
  const { session, ready } = useAuth();
  const me = useMe();
  if (!ready || (session && me.isLoading)) return <Loading label="Checking your session" />;
  if (!session) {
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }
  if (me.isError) return <ErrorNote message="Your profile could not be loaded. Confirm the email, then log in again." />;
  return <Outlet />;
}

export function RequireRole({ role }: { role: "teacher" | "admin" }) {
  const me = useMe();
  if (me.isLoading || !me.data) return <Loading />;
  if (me.data.role !== role) return <Navigate to="/" replace />;
  return <Outlet />;
}

export function TeacherGate({ children }: { children: ReactNode }) {
  const me = useMe();
  if (!me.data) return <Loading />;
  if (me.data.teacher_status !== "approved") {
    const rejected = me.data.teacher_status === "rejected";
    return (
      <div className="max-w-xl space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Teach</h1>
        <p className="text-sm text-zinc-700">
          {rejected
            ? "Your teacher application was rejected. You cannot create or edit courses."
            : "Your teacher application is pending. An admin needs to approve it before you can create courses."}
        </p>
      </div>
    );
  }
  return children;
}
