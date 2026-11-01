import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { NavLink, Outlet, useNavigate } from "react-router";
import { ApiError, errorMessage } from "../api/client";
import { supabase } from "../api/supabase";
import { ErrorNote, Loading, buttonSecondaryClass } from "./ui";
import { useAuth } from "../hooks/AuthProvider";
import { useMe } from "../hooks/useMe";

function itemClass(active: boolean) {
  return active ? "text-blue-800" : "text-zinc-700 hover:text-zinc-950";
}

export function Layout() {
  const { session, ready } = useAuth();
  const me = useMe();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const authRejected =
    Boolean(session) &&
    me.isError &&
    !me.isFetching &&
    me.error instanceof ApiError &&
    me.error.status === 401;
  const profileFailed =
    Boolean(session) && me.isError && !me.data && !me.isFetching && !authRejected;

  async function logout() {
    await supabase.auth.signOut();
    queryClient.clear();
    navigate("/");
  }

  useEffect(() => {
    if (!authRejected) return;
    void supabase.auth
      .signOut()
      .then(() => {
        queryClient.clear();
        navigate("/");
      })
      .catch(() => undefined);
  }, [authRejected, navigate, queryClient]);

  if (!ready || authRejected || (session && !me.data && !profileFailed)) {
    return (
      <div className="min-h-screen bg-stone-100 text-zinc-900">
        <header className="border-b border-zinc-200 bg-white">
          <div className="mx-auto max-w-5xl px-4 py-3">
            <span className="font-semibold tracking-tight text-zinc-950">LMS</span>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-8">
          <Loading label="Checking your session" />
        </main>
      </div>
    );
  }

  if (profileFailed) {
    return (
      <div className="min-h-screen bg-stone-100 text-zinc-900">
        <header className="border-b border-zinc-200 bg-white">
          <div className="mx-auto flex max-w-5xl items-center px-4 py-3">
            <span className="font-semibold tracking-tight text-zinc-950">LMS</span>
            <button type="button" className="ml-auto text-sm text-zinc-700 hover:text-zinc-950" onClick={() => void logout()}>
              Log out
            </button>
          </div>
        </header>
        <main className="mx-auto max-w-5xl space-y-3 px-4 py-8">
          <ErrorNote message={errorMessage(me.error)} />
          <button type="button" className={buttonSecondaryClass} onClick={() => void me.refetch()}>
            Try again
          </button>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-100 text-zinc-900">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3">
          <NavLink to="/" className="font-semibold tracking-tight text-zinc-950">
            LMS
          </NavLink>
          <nav className="flex flex-wrap items-center gap-4 text-sm">
            <NavLink to="/courses" className={({ isActive }) => itemClass(isActive)}>
              Courses
            </NavLink>
            {session ? (
              <NavLink to="/learn" className={({ isActive }) => itemClass(isActive)}>
                Learn
              </NavLink>
            ) : null}
            {me.data?.role === "teacher" ? (
              <NavLink to="/teach" className={({ isActive }) => itemClass(isActive)}>
                Teach
              </NavLink>
            ) : null}
            {me.data?.role === "admin" ? (
              <NavLink to="/admin" className={({ isActive }) => itemClass(isActive)}>
                Admin
              </NavLink>
            ) : null}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            {session ? (
              <>
                <span className="text-zinc-600">{me.data?.full_name || me.data?.email || "Account"}</span>
                <button type="button" className="text-zinc-700 hover:text-zinc-950" onClick={() => void logout()}>
                  Log out
                </button>
              </>
            ) : (
              <>
                <NavLink to="/login" className={({ isActive }) => itemClass(isActive)}>
                  Log in
                </NavLink>
                <NavLink to="/register" className={({ isActive }) => itemClass(isActive)}>
                  Register
                </NavLink>
              </>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
