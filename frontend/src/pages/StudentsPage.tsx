import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { api, errorMessage } from "../api/client";
import type { CourseStudent } from "../api/types";
import { Empty, ErrorNote, Loading, PageHeader } from "../components/ui";
import { TeacherGate } from "../routes/guards";

export function StudentsPage() {
  return (
    <TeacherGate>
      <Students />
    </TeacherGate>
  );
}

function Students() {
  const { id = "" } = useParams();
  const students = useQuery({
    queryKey: ["students", id],
    queryFn: () => api<CourseStudent[]>(`/api/v1/teacher/courses/${id}/students`),
  });
  return (
    <div>
      <PageHeader title="Enrolled students" lede="Name, email, when they enrolled, and how many lessons they finished." />
      <p className="mb-4 text-sm">
        <Link to={`/teach/courses/${id}`} className="text-blue-800">
          Back to builder
        </Link>
      </p>
      {students.isLoading ? <Loading label="Loading students" /> : null}
      {students.isError ? <ErrorNote message={errorMessage(students.error)} /> : null}
      {students.data && students.data.length === 0 ? <Empty>No one has enrolled.</Empty> : null}
      {students.data && students.data.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-zinc-200 text-zinc-500">
              <tr>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Email</th>
                <th className="px-3 py-2 font-medium">Enrolled</th>
                <th className="px-3 py-2 font-medium">Completed</th>
                <th className="px-3 py-2 font-medium">Lessons done</th>
              </tr>
            </thead>
            <tbody>
              {students.data.map((student) => (
                <tr key={student.student_id} className="border-b border-zinc-100">
                  <td className="px-3 py-2">{student.name || "—"}</td>
                  <td className="px-3 py-2">{student.email || "—"}</td>
                  <td className="px-3 py-2">{new Date(student.enrolled_at).toLocaleString()}</td>
                  <td className="px-3 py-2">{student.completed_at ? new Date(student.completed_at).toLocaleString() : "—"}</td>
                  <td className="px-3 py-2">{student.completed_lesson_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
