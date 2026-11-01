import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, errorMessage } from "../api/client";
import type { Page, Profile } from "../api/types";
import { buttonSecondaryClass, ErrorNote, Loading, PageHeader, fieldClass, labelClass } from "../components/ui";
import { useMe } from "../hooks/useMe";

export function AdminUsersPage() {
  const me = useMe();
  const queryClient = useQueryClient();
  const [role, setRole] = useState("");
  const [q, setQ] = useState("");
  const [submittedQ, setSubmittedQ] = useState("");
  const [page, setPage] = useState(1);
  const users = useQuery({
    queryKey: ["admin-users", role, submittedQ, page],
    queryFn: () => {
      const search = new URLSearchParams({ page: String(page), page_size: "20" });
      if (role) search.set("role", role);
      if (submittedQ) search.set("q", submittedQ);
      return api<Page<Profile>>(`/api/v1/admin/users?${search.toString()}`);
    },
  });
  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api<Profile>(`/api/v1/admin/users/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-users"] }),
  });

  return (
    <div className="space-y-4">
      <PageHeader title="Users" lede="Activate accounts, approve teachers, or promote someone to admin." />
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          setPage(1);
          setSubmittedQ(q.trim());
        }}
      >
        <label className={labelClass}>
          Search
          <input className={fieldClass} value={q} onChange={(event) => setQ(event.target.value)} />
        </label>
        <label className={labelClass}>
          Role
          <select
            className={fieldClass}
            value={role}
            onChange={(event) => {
              setRole(event.target.value);
              setPage(1);
            }}
          >
            <option value="">All</option>
            <option value="student">Student</option>
            <option value="teacher">Teacher</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <button type="submit" className={buttonSecondaryClass}>
          Search
        </button>
      </form>
      {users.isLoading ? <Loading label="Loading users" /> : null}
      {users.isError ? <ErrorNote message={errorMessage(users.error)} /> : null}
      {patch.isError ? <ErrorNote message={errorMessage(patch.error)} /> : null}
      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-zinc-200 text-zinc-500">
            <tr>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Email</th>
              <th className="px-3 py-2 font-medium">Role</th>
              <th className="px-3 py-2 font-medium">Teacher</th>
              <th className="px-3 py-2 font-medium">Active</th>
              <th className="px-3 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.data?.items.map((user) => {
              const self = user.id === me.data?.id;
              return (
                <tr key={user.id} className="border-b border-zinc-100 align-top">
                  <td className="px-3 py-2">{user.full_name || "—"}</td>
                  <td className="px-3 py-2">{user.email || "—"}</td>
                  <td className="px-3 py-2">{user.role}</td>
                  <td className="px-3 py-2">{user.teacher_status || "—"}</td>
                  <td className="px-3 py-2">{user.is_active ? "Yes" : "No"}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-2">
                      {user.role === "teacher" && user.teacher_status !== "approved" ? (
                        <button type="button" className={buttonSecondaryClass} onClick={() => patch.mutate({ id: user.id, body: { teacher_status: "approved" } })}>
                          Approve
                        </button>
                      ) : null}
                      {user.role === "teacher" && user.teacher_status !== "rejected" ? (
                        <button type="button" className={buttonSecondaryClass} onClick={() => patch.mutate({ id: user.id, body: { teacher_status: "rejected" } })}>
                          Reject
                        </button>
                      ) : null}
                      {!self && user.role !== "admin" ? (
                        <button type="button" className={buttonSecondaryClass} onClick={() => patch.mutate({ id: user.id, body: { role: "admin" } })}>
                          Make admin
                        </button>
                      ) : null}
                      {!self ? (
                        <button
                          type="button"
                          className={buttonSecondaryClass}
                          onClick={() => patch.mutate({ id: user.id, body: { is_active: !user.is_active } })}
                        >
                          {user.is_active ? "Deactivate" : "Activate"}
                        </button>
                      ) : (
                        <span className="text-zinc-500">This is you</span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {users.data && users.data.total > users.data.page_size ? (
        <div className="flex gap-2">
          <button type="button" className={buttonSecondaryClass} disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
            Previous
          </button>
          <button
            type="button"
            className={buttonSecondaryClass}
            disabled={page * users.data.page_size >= users.data.total}
            onClick={() => setPage((value) => value + 1)}
          >
            Next
          </button>
        </div>
      ) : null}
    </div>
  );
}
