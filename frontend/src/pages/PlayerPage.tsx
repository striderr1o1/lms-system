import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { api, errorMessage } from "../api/client";
import type { CourseContent } from "../api/types";
import { LessonBody } from "../components/LessonBody";
import { ErrorNote, Loading } from "../components/ui";

export function PlayerPage() {
  const { courseId = "", lessonId = "" } = useParams();
  const content = useQuery({
    queryKey: ["content", courseId],
    queryFn: () => api<CourseContent>(`/api/v1/courses/${courseId}/content`),
    enabled: !!courseId,
  });

  if (content.isLoading) return <Loading label="Loading lesson" />;
  if (content.isError) return <ErrorNote message={errorMessage(content.error)} />;
  if (!content.data) return null;

  const sections = content.data.sections;
  const lesson = sections.flatMap((section) => section.lessons).find((item) => item.id === lessonId);
  return (
    <div className="grid gap-6 md:grid-cols-[16rem_1fr]">
      <aside className="space-y-4">
        <Link to="/learn" className="text-sm text-blue-800">
          Back to learning
        </Link>
        <p className="font-semibold text-zinc-950">{content.data.title}</p>
        {sections.map((section) => (
          <div key={section.id}>
            <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500">{section.title}</h2>
            <ul className="mt-1 space-y-1">
              {section.lessons.map((item) => {
                const active = item.id === lessonId;
                return (
                  <li key={item.id}>
                    <Link
                      to={`/learn/${courseId}/${item.id}`}
                      className={`block rounded-md px-2 py-1.5 text-sm ${active ? "bg-blue-50 text-blue-900" : "hover:bg-white"}`}
                    >
                      <span className="block">{item.title}</span>
                      <span className="text-xs text-zinc-500">{item.progress?.is_completed ? "Complete" : "Not complete"}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </aside>
      <section className="rounded-lg border border-zinc-200 bg-white p-5">
        {lesson ? (
          <LessonBody courseId={courseId} lesson={lesson} />
        ) : (
          <ErrorNote message="That lesson is not in this course." />
        )}
      </section>
    </div>
  );
}
