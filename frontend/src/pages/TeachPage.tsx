import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { api, errorMessage } from "../api/client";
import type { Course } from "../api/types";
import { buttonClass, Empty, ErrorNote, Loading, PageHeader, fieldClass, labelClass } from "../components/ui";
import { TeacherGate } from "../routes/guards";

export function TeachPage() {
  return (
    <TeacherGate>
      <TeacherHome />
    </TeacherGate>
  );
}

function TeacherHome() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const courses = useQuery({
    queryKey: ["teacher-courses"],
    queryFn: () => api<Course[]>("/api/v1/teacher/courses"),
  });
  const create = useMutation({
    mutationFn: () =>
      api<Course>("/api/v1/teacher/courses", {
        method: "POST",
        body: JSON.stringify({
          title,
          description: description.trim() || null,
          category: category.trim() || null,
        }),
      }),
    onSuccess: async (course) => {
      await queryClient.invalidateQueries({ queryKey: ["teacher-courses"] });
      navigate(`/teach/courses/${course.id}`);
    },
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    create.mutate();
  }

  return (
    <div className="space-y-8">
      <PageHeader title="Your courses" lede="New courses stay in draft until an admin publishes them." />
      <form className="grid gap-3 rounded-lg border border-zinc-200 bg-white p-4 sm:grid-cols-2" onSubmit={onSubmit}>
        <label className={labelClass}>
          Title
          <input className={fieldClass} required value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label className={labelClass}>
          Category
          <input className={fieldClass} value={category} onChange={(event) => setCategory(event.target.value)} />
        </label>
        <label className={`${labelClass} sm:col-span-2`}>
          Description
          <textarea className={fieldClass} rows={3} value={description} onChange={(event) => setDescription(event.target.value)} />
        </label>
        {create.isError ? (
          <div className="sm:col-span-2">
            <ErrorNote message={errorMessage(create.error)} />
          </div>
        ) : null}
        <div>
          <button type="submit" className={buttonClass} disabled={create.isPending}>
            {create.isPending ? "Creating…" : "Create course"}
          </button>
        </div>
      </form>
      {courses.isLoading ? <Loading label="Loading courses" /> : null}
      {courses.isError ? <ErrorNote message={errorMessage(courses.error)} /> : null}
      {courses.data && courses.data.length === 0 ? <Empty>You have no courses yet.</Empty> : null}
      <ul className="space-y-3">
        {courses.data?.map((course) => (
          <li key={course.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-white p-4">
            <div>
              <h2 className="font-semibold">{course.title}</h2>
              <p className="text-sm text-zinc-500">{course.status}</p>
            </div>
            <div className="flex gap-4 text-sm">
              <Link to={`/teach/courses/${course.id}`} className="font-medium text-blue-800">
                Edit
              </Link>
              <Link to={`/teach/courses/${course.id}/students`} className="font-medium text-blue-800">
                Students
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
