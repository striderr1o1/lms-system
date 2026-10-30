import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { api, errorMessage } from "../api/client";
import type { Course, Page } from "../api/types";
import { buttonSecondaryClass, Empty, ErrorNote, Loading, PageHeader, fieldClass, labelClass } from "../components/ui";

export function CatalogPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const category = params.get("category") ?? "";
  const page = Number(params.get("page") ?? "1") || 1;
  const [draft, setDraft] = useState(q);

  const categories = useQuery({
    queryKey: ["categories"],
    queryFn: () => api<{ categories: string[] }>("/api/v1/courses/categories"),
  });
  const courses = useQuery({
    queryKey: ["courses", q, category, page],
    queryFn: () => {
      const search = new URLSearchParams({ page: String(page), page_size: "12" });
      if (q) search.set("q", q);
      if (category) search.set("category", category);
      return api<Page<Course>>(`/api/v1/courses?${search.toString()}`);
    },
  });

  function update(next: { q?: string; category?: string; page?: number }) {
    const search = new URLSearchParams();
    const query = next.q ?? q;
    const cat = next.category ?? category;
    const nextPage = next.page ?? 1;
    if (query) search.set("q", query);
    if (cat) search.set("category", cat);
    if (nextPage > 1) search.set("page", String(nextPage));
    setParams(search);
  }

  return (
    <div>
      <PageHeader title="Courses" lede="Published courses only. Search matches the title and description." />
      <form
        className="mb-6 flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          update({ q: draft.trim(), page: 1 });
        }}
      >
        <label className={labelClass}>
          Search
          <input className={fieldClass} value={draft} onChange={(event) => setDraft(event.target.value)} />
        </label>
        <label className={labelClass}>
          Category
          <select
            className={fieldClass}
            value={category}
            onChange={(event) => update({ category: event.target.value, q, page: 1 })}
          >
            <option value="">All</option>
            {(categories.data?.categories ?? []).map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={buttonSecondaryClass}>
          Search
        </button>
      </form>
      {courses.isLoading ? <Loading label="Loading courses" /> : null}
      {courses.isError ? <ErrorNote message={errorMessage(courses.error)} /> : null}
      {courses.data && courses.data.items.length === 0 ? <Empty>No courses match.</Empty> : null}
      <ul className="grid gap-4 sm:grid-cols-2">
        {courses.data?.items.map((course) => (
          <li key={course.id}>
            <Link to={`/courses/${course.id}`} className="block h-full rounded-lg border border-zinc-200 bg-white p-4 hover:border-blue-700">
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{course.category || "Uncategorized"}</p>
              <h2 className="mt-1 text-lg font-semibold text-zinc-950">{course.title}</h2>
              <p className="mt-2 line-clamp-3 text-sm text-zinc-600">{course.description || "No description."}</p>
              <p className="mt-3 text-sm text-zinc-500">{course.teacher_name || "Teacher"}</p>
            </Link>
          </li>
        ))}
      </ul>
      {courses.data && courses.data.total > courses.data.page_size ? (
        <div className="mt-6 flex items-center gap-3 text-sm">
          <button
            type="button"
            className={buttonSecondaryClass}
            disabled={page <= 1}
            onClick={() => update({ page: page - 1, q })}
          >
            Previous
          </button>
          <span className="text-zinc-600">
            Page {page} of {Math.ceil(courses.data.total / courses.data.page_size)}
          </span>
          <button
            type="button"
            className={buttonSecondaryClass}
            disabled={page * courses.data.page_size >= courses.data.total}
            onClick={() => update({ page: page + 1, q })}
          >
            Next
          </button>
        </div>
      ) : null}
    </div>
  );
}
