import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { api, errorMessage } from "../api/client";
import type { Course, CourseContent, Enrollment } from "../api/types";
import { buttonClass, buttonSecondaryClass, ErrorNote, Loading, PageHeader } from "../components/ui";
import { useAuth } from "../hooks/AuthProvider";

export function CourseDetailPage() {
  const { id = "" } = useParams();
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const course = useQuery({
    queryKey: ["course", id],
    queryFn: () => api<Course>(`/api/v1/courses/${id}`),
    enabled: !!id,
  });
  const enrollments = useQuery({
    queryKey: ["enrollments"],
    queryFn: () => api<Enrollment[]>("/api/v1/me/enrollments"),
    enabled: !!session,
  });
  const enrollment = enrollments.data?.find((item) => item.course_id === id);
  const content = useQuery({
    queryKey: ["content", id],
    queryFn: () => api<CourseContent>(`/api/v1/courses/${id}/content`),
    enabled: !!session && !!enrollment,
  });
  const enroll = useMutation({
    mutationFn: () => api<Enrollment>(`/api/v1/courses/${id}/enroll`, { method: "POST" }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["enrollments"] });
      await queryClient.invalidateQueries({ queryKey: ["content", id] });
    },
  });

  if (course.isLoading) return <Loading label="Loading course" />;
  if (course.isError) return <ErrorNote message={errorMessage(course.error)} />;
  if (!course.data) return null;
  const data = course.data;
  const resume = enrollment?.resume_lesson_id ?? content.data?.sections.flatMap((section) => section.lessons)[0]?.id;

  return (
    <div className="max-w-2xl space-y-4">
      <PageHeader title={data.title} lede={data.teacher_name ? `Teacher: ${data.teacher_name}` : undefined} />
      {data.category ? <p className="text-sm font-medium text-zinc-500">{data.category}</p> : null}
      {data.status !== "published" ? (
        <p className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700">
          This course is {data.status}. Students cannot see it until an admin publishes it.
        </p>
      ) : null}
      <p className="whitespace-pre-wrap text-zinc-800">{data.description || "No description."}</p>
      {!session ? (
        <Link to={`/login?next=${encodeURIComponent(`/courses/${id}`)}`} className={buttonClass}>
          Log in to enroll
        </Link>
      ) : enrollment && resume ? (
        <Link to={`/learn/${id}/${resume}`} className={buttonClass}>
          {enrollment.completed_at ? "Review lessons" : "Continue"}
        </Link>
      ) : data.status === "published" ? (
        <button type="button" className={buttonClass} disabled={enroll.isPending} onClick={() => enroll.mutate()}>
          {enroll.isPending ? "Enrolling…" : "Enroll"}
        </button>
      ) : null}
      {enroll.isError ? <ErrorNote message={errorMessage(enroll.error)} /> : null}
      {enrollment ? (
        <p className="text-sm text-zinc-600">
          {enrollment.completed_lesson_count} of {enrollment.lesson_count} lessons complete
        </p>
      ) : null}
      <Link to="/courses" className={buttonSecondaryClass}>
        Back to courses
      </Link>
    </div>
  );
}
