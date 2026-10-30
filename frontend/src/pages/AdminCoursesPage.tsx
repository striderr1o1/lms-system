import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, errorMessage } from "../api/client";
import type { Course, Page } from "../api/types";
import { buttonSecondaryClass, ErrorNote, Loading, PageHeader } from "../components/ui";

export function AdminCoursesPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const courses = useQuery({
    queryKey: ["admin-courses", page],
    queryFn: () => api<Page<Course>>(`/api/v1/admin/courses?page=${page}&page_size=20`),
  });
  const update = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api(`/api/v1/admin/courses/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-courses"] });
      void queryClient.invalidateQueries({ queryKey: ["courses"] });
    },
  });

  return (
    <div className="space-y-4">
      <PageHeader title="Courses" lede="Draft courses stay out of the catalog until you publish them." />
      {courses.isLoading ? <Loading label="Loading courses" /> : null}
      {courses.isError ? <ErrorNote message={errorMessage(courses.error)} /> : null}
      {update.isError ? <ErrorNote message={errorMessage(update.error)} /> : null}
      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-zinc-200 text-zinc-500">
            <tr>
              <th className="px-3 py-2 font-medium">Title</th>
              <th className="px-3 py-2 font-medium">Teacher</th>
              <th className="px-3 py-2 font-medium">Enrolled</th>
              <th className="px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {courses.data?.items.map((course) => (
              <tr key={course.id} className="border-b border-zinc-100">
                <td className="px-3 py-2">{course.title}</td>
                <td className="px-3 py-2">{course.teacher_name || "—"}</td>
                <td className="px-3 py-2">{course.enrollment_count ?? 0}</td>
                <td className="px-3 py-2">
                  <label className="sr-only" htmlFor={`status-${course.id}`}>
                    Status for {course.title}
                  </label>
                  <select
                    id={`status-${course.id}`}
                    className="rounded-md border border-zinc-300 bg-white px-2 py-1"
                    value={course.status}
                    onChange={(event) => update.mutate({ id: course.id, status: event.target.value })}
                  >
                    <option value="draft">Draft</option>
                    <option value="published">Published</option>
                    <option value="archived">Archived</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {courses.data && courses.data.total > courses.data.page_size ? (
        <div className="flex gap-2">
          <button type="button" className={buttonSecondaryClass} disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
            Previous
          </button>
          <button
            type="button"
            className={buttonSecondaryClass}
            disabled={page * courses.data.page_size >= courses.data.total}
            onClick={() => setPage((value) => value + 1)}
          >
            Next
          </button>
        </div>
      ) : null}
    </div>
  );
}
