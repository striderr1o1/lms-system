import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { api, errorMessage } from "../api/client";
import type { OverviewAnalytics } from "../api/types";
import { ErrorNote, Loading, PageHeader } from "../components/ui";

export function AdminHomePage() {
  const overview = useQuery({
    queryKey: ["analytics", "overview"],
    queryFn: () => api<OverviewAnalytics>("/api/v1/admin/analytics/overview"),
  });
  const totals = overview.data?.totals_by_role;
  return (
    <div className="space-y-6">
      <PageHeader title="Admin" lede="Approve teachers, publish courses, and read the last 30 days." />
      <div className="flex flex-wrap gap-4 text-sm">
        <Link to="/admin/users" className="font-medium text-blue-800">Users</Link>
        <Link to="/admin/courses" className="font-medium text-blue-800">Courses</Link>
        <Link to="/admin/analytics" className="font-medium text-blue-800">Analytics</Link>
      </div>
      {overview.isLoading ? <Loading label="Loading totals" /> : null}
      {overview.isError ? <ErrorNote message={errorMessage(overview.error)} /> : null}
      {totals ? (
        <dl className="grid gap-3 sm:grid-cols-3">
          {(["student", "teacher", "admin"] as const).map((role) => (
            <div key={role} className="rounded-lg border border-zinc-200 bg-white p-4">
              <dt className="text-sm capitalize text-zinc-500">{role}s</dt>
              <dd className="text-2xl font-semibold">{totals[role]}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}
