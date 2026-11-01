import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { api, errorMessage } from "../api/client";
import type { Enrollment } from "../api/types";
import { Empty, ErrorNote, Loading, PageHeader } from "../components/ui";

export function LearnPage() {
  const enrollments = useQuery({
    queryKey: ["enrollments"],
    queryFn: () => api<Enrollment[]>("/api/v1/me/enrollments"),
  });
  return (
    <div>
      <PageHeader title="Your learning" lede="Enrolled courses and how many lessons you have finished." />
      {enrollments.isLoading ? <Loading label="Loading enrollments" /> : null}
      {enrollments.isError ? <ErrorNote message={errorMessage(enrollments.error)} /> : null}
      {enrollments.data && enrollments.data.length === 0 ? (
        <Empty>
          You are not enrolled yet. <Link to="/courses" className="text-blue-800 underline">Browse courses</Link>
        </Empty>
      ) : null}
      <ul className="space-y-3">
        {enrollments.data?.map((item) => {
          const width = item.lesson_count ? Math.round((item.completed_lesson_count / item.lesson_count) * 100) : 0;
          return (
            <li key={item.id} className="rounded-lg border border-zinc-200 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-zinc-950">{item.course_title}</h2>
                  <p className="text-sm text-zinc-500">{item.course_category || "Uncategorized"}</p>
                </div>
                {item.resume_lesson_id ? (
                  <Link to={`/learn/${item.course_id}/${item.resume_lesson_id}`} className="text-sm font-medium text-blue-800">
                    {item.completed_at ? "Review" : "Resume"}
                  </Link>
                ) : (
                  <Link to={`/courses/${item.course_id}`} className="text-sm font-medium text-blue-800">
                    Open course
                  </Link>
                )}
              </div>
              <p className="mt-3 text-sm text-zinc-600">
                {item.completed_lesson_count} of {item.lesson_count} lessons
                {item.completed_at ? " · Course complete" : ""}
              </p>
              <div className="mt-2 h-2 rounded bg-zinc-100">
                <div className="h-2 rounded bg-blue-700" style={{ width: `${width}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
