import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { KeyboardSensor } from "@dnd-kit/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import { api, errorMessage } from "../api/client";
import type { Course, CourseContent, LessonContent, LessonRecord, SectionContent, SectionRecord } from "../api/types";
import {
  buttonClass,
  buttonSecondaryClass,
  Empty,
  ErrorNote,
  Loading,
  fieldClass,
  labelClass,
} from "../components/ui";
import { TeacherGate } from "../routes/guards";

export function BuilderPage() {
  return (
    <TeacherGate>
      <Builder />
    </TeacherGate>
  );
}

function Builder() {
  const { id = "" } = useParams();
  const queryClient = useQueryClient();
  const course = useQuery({
    queryKey: ["course", id],
    queryFn: () => api<Course>(`/api/v1/courses/${id}`),
  });
  const content = useQuery({
    queryKey: ["content", id],
    queryFn: () => api<CourseContent>(`/api/v1/courses/${id}/content`),
  });
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["content", id] });
    await queryClient.invalidateQueries({ queryKey: ["course", id] });
    await queryClient.invalidateQueries({ queryKey: ["teacher-courses"] });
  }

  const saveCourse = useMutation({
    mutationFn: (body: { title: string; description: string | null; category: string | null; thumbnail_url: string | null }) =>
      api<Course>(`/api/v1/teacher/courses/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: refresh,
  });
  const removeCourse = useMutation({
    mutationFn: () => api(`/api/v1/teacher/courses/${id}`, { method: "DELETE" }),
  });
  const addSection = useMutation({
    mutationFn: (title: string) =>
      api<SectionRecord>(`/api/v1/teacher/courses/${id}/sections`, {
        method: "POST",
        body: JSON.stringify({ title }),
      }),
    onSuccess: refresh,
  });
  const reorderSections = useMutation({
    mutationFn: (ordered_ids: string[]) =>
      api(`/api/v1/teacher/courses/${id}/sections/reorder`, {
        method: "POST",
        body: JSON.stringify({ ordered_ids }),
      }),
    onSuccess: refresh,
  });

  if (course.isLoading || content.isLoading) return <Loading label="Loading builder" />;
  if (course.isError) return <ErrorNote message={errorMessage(course.error)} />;
  if (content.isError) return <ErrorNote message={errorMessage(content.error)} />;
  if (!course.data || !content.data) return null;

  const sections = content.data.sections;

  function onSectionDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = sections.map((section) => section.id);
    const next = arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
    reorderSections.mutate(next);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-zinc-500">
            <Link to="/teach" className="text-blue-800">Teach</Link>
            {" · "}
            Status: {course.data.status}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">{course.data.title}</h1>
        </div>
        <Link to={`/teach/courses/${id}/students`} className={buttonSecondaryClass}>
          Students
        </Link>
      </div>
      <p className="text-sm text-zinc-600">An admin publishes this course from Admin → Courses. Students only see published courses.</p>
      <CourseForm
        course={course.data}
        pending={saveCourse.isPending}
        error={saveCourse.isError ? errorMessage(saveCourse.error) : null}
        onSave={(body) => saveCourse.mutate(body)}
        onDelete={() => {
          if (window.confirm("Delete this course?")) {
            removeCourse.mutate(undefined, { onSuccess: () => window.location.assign("/teach") });
          }
        }}
      />
      {removeCourse.isError ? <ErrorNote message={errorMessage(removeCourse.error)} /> : null}
      <SectionCreator pending={addSection.isPending} onCreate={(title) => addSection.mutate(title)} />
      {addSection.isError ? <ErrorNote message={errorMessage(addSection.error)} /> : null}
      {sections.length === 0 ? <Empty>No sections yet.</Empty> : null}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onSectionDragEnd}>
        <SortableContext items={sections.map((section) => section.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-4">
            {sections.map((section) => (
              <SectionCard key={section.id} section={section} sensors={sensors} onChange={refresh} />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      {reorderSections.isError ? <ErrorNote message={errorMessage(reorderSections.error)} /> : null}
    </div>
  );
}

function CourseForm({
  course,
  pending,
  error,
  onSave,
  onDelete,
}: {
  course: Course;
  pending: boolean;
  error: string | null;
  onSave: (body: { title: string; description: string | null; category: string | null; thumbnail_url: string | null }) => void;
  onDelete: () => void;
}) {
  const [title, setTitle] = useState(course.title);
  const [description, setDescription] = useState(course.description ?? "");
  const [category, setCategory] = useState(course.category ?? "");
  const [thumbnail, setThumbnail] = useState(course.thumbnail_url ?? "");

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    onSave({
      title,
      description: description.trim() || null,
      category: category.trim() || null,
      thumbnail_url: thumbnail.trim() || null,
    });
  }

  return (
    <form className="grid gap-3 rounded-lg border border-zinc-200 bg-white p-4" onSubmit={onSubmit}>
      <label className={labelClass}>
        Title
        <input className={fieldClass} required value={title} onChange={(event) => setTitle(event.target.value)} />
      </label>
      <label className={labelClass}>
        Description
        <textarea className={fieldClass} rows={3} value={description} onChange={(event) => setDescription(event.target.value)} />
      </label>
      <label className={labelClass}>
        Category
        <input className={fieldClass} value={category} onChange={(event) => setCategory(event.target.value)} />
      </label>
      <label className={labelClass}>
        Thumbnail URL
        <input className={fieldClass} placeholder="https://" value={thumbnail} onChange={(event) => setThumbnail(event.target.value)} />
      </label>
      {error ? <ErrorNote message={error} /> : null}
      <div className="flex gap-2">
        <button type="submit" className={buttonClass} disabled={pending}>
          Save course
        </button>
        <button type="button" className={buttonSecondaryClass} onClick={onDelete}>
          Delete course
        </button>
      </div>
    </form>
  );
}

function SectionCreator({ pending, onCreate }: { pending: boolean; onCreate: (title: string) => void }) {
  const [title, setTitle] = useState("");
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onCreate(title);
        setTitle("");
      }}
    >
      <label className={labelClass}>
        New section
        <input className={fieldClass} required value={title} onChange={(event) => setTitle(event.target.value)} />
      </label>
      <button type="submit" className={buttonSecondaryClass} disabled={pending}>
        Add section
      </button>
    </form>
  );
}

function SortableRow({ id, children }: { id: string; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <div ref={setNodeRef} style={style} className="flex gap-2">
      <button type="button" className="cursor-grab px-1 text-zinc-400" aria-label="Drag to reorder" {...attributes} {...listeners}>
        ::
      </button>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function SectionCard({
  section,
  sensors,
  onChange,
}: {
  section: SectionContent;
  sensors: ReturnType<typeof useSensors>;
  onChange: () => Promise<void>;
}) {
  const [title, setTitle] = useState(section.title);
  const [editor, setEditor] = useState<LessonContent | "new" | null>(null);
  const rename = useMutation({
    mutationFn: () =>
      api(`/api/v1/teacher/sections/${section.id}`, { method: "PATCH", body: JSON.stringify({ title }) }),
    onSuccess: onChange,
  });
  const remove = useMutation({
    mutationFn: () => api(`/api/v1/teacher/sections/${section.id}`, { method: "DELETE" }),
    onSuccess: onChange,
  });
  const reorder = useMutation({
    mutationFn: (ordered_ids: string[]) =>
      api(`/api/v1/teacher/sections/${section.id}/lessons/reorder`, {
        method: "POST",
        body: JSON.stringify({ ordered_ids }),
      }),
    onSuccess: onChange,
  });

  function onLessonDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = section.lessons.map((lesson) => lesson.id);
    reorder.mutate(arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id))));
  }

  return (
    <SortableRow id={section.id}>
      <section className="rounded-lg border border-zinc-200 bg-white p-4">
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            rename.mutate();
          }}
        >
          <label className={labelClass}>
            Section title
            <input className={fieldClass} value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <button type="submit" className={buttonSecondaryClass}>
            Save
          </button>
          <button
            type="button"
            className={buttonSecondaryClass}
            onClick={() => {
              if (window.confirm("Delete this section and its lessons?")) remove.mutate();
            }}
          >
            Delete
          </button>
        </form>
        {rename.isError ? <ErrorNote message={errorMessage(rename.error)} /> : null}
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onLessonDragEnd}>
          <SortableContext items={section.lessons.map((lesson) => lesson.id)} strategy={verticalListSortingStrategy}>
            <ul className="mt-4 space-y-2">
              {section.lessons.map((lesson) => (
                <li key={lesson.id}>
                  <SortableRow id={lesson.id}>
                    <div className="flex items-center justify-between gap-2 rounded-md border border-zinc-200 px-3 py-2">
                      <div>
                        <p className="text-sm font-medium">{lesson.title}</p>
                        <p className="text-xs text-zinc-500">{lesson.type}</p>
                      </div>
                      <button type="button" className="text-sm text-blue-800" onClick={() => setEditor(lesson)}>
                        Edit
                      </button>
                    </div>
                  </SortableRow>
                </li>
              ))}
            </ul>
          </SortableContext>
        </DndContext>
        {section.lessons.length === 0 ? <p className="mt-3 text-sm text-zinc-600">No lessons in this section.</p> : null}
        {reorder.isError ? <ErrorNote message={errorMessage(reorder.error)} /> : null}
        <div className="mt-3">
          <button type="button" className={buttonSecondaryClass} onClick={() => setEditor("new")}>
            Add lesson
          </button>
        </div>
        {editor ? (
          <LessonEditor
            sectionId={section.id}
            lesson={editor === "new" ? null : editor}
            onClose={() => setEditor(null)}
            onSaved={async () => {
              setEditor(null);
              await onChange();
            }}
          />
        ) : null}
      </section>
    </SortableRow>
  );
}

function LessonEditor({
  sectionId,
  lesson,
  onClose,
  onSaved,
}: {
  sectionId: string;
  lesson: LessonContent | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [title, setTitle] = useState(lesson?.title ?? "");
  const [type, setType] = useState<LessonContent["type"]>(lesson?.type ?? "text");
  const [body, setBody] = useState(lesson?.body_markdown ?? "");
  const [externalUrl, setExternalUrl] = useState(lesson?.external_url ?? "");
  const [fileUrl, setFileUrl] = useState(lesson?.file_url ?? "");
  const [duration, setDuration] = useState(lesson?.duration_sec?.toString() ?? "");
  const save = useMutation({
    mutationFn: () => {
      const payload = {
        title,
        type,
        body_markdown: type === "text" ? body : body.trim() || null,
        external_url: type === "link" ? externalUrl : externalUrl.trim() || null,
        file_url: type === "file" ? fileUrl : fileUrl.trim() || null,
        duration_sec: duration.trim() ? Number(duration) : null,
      };
      if (lesson) {
        return api<LessonRecord>(`/api/v1/teacher/lessons/${lesson.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      }
      return api<LessonRecord>(`/api/v1/teacher/sections/${sectionId}/lessons`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    onSuccess: onSaved,
  });
  const remove = useMutation({
    mutationFn: () => api(`/api/v1/teacher/lessons/${lesson?.id}`, { method: "DELETE" }),
    onSuccess: onSaved,
  });

  return (
    <form
      className="mt-4 space-y-3 border-t border-zinc-200 pt-4"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <h3 className="text-sm font-semibold">{lesson ? "Edit lesson" : "New lesson"}</h3>
      <label className={labelClass}>
        Title
        <input className={fieldClass} required value={title} onChange={(event) => setTitle(event.target.value)} />
      </label>
      <label className={labelClass}>
        Type
        <select className={fieldClass} value={type} onChange={(event) => setType(event.target.value as LessonContent["type"])}>
          <option value="text">Text</option>
          <option value="video">Video</option>
          <option value="link">Link</option>
          <option value="file">File</option>
        </select>
      </label>
      {type === "text" ? (
        <label className={labelClass}>
          Body
          <textarea className={fieldClass} rows={6} required value={body} onChange={(event) => setBody(event.target.value)} />
        </label>
      ) : null}
      {type === "video" ? (
        <div>
          <label className={labelClass}>
            Video file
            <input type="file" accept="video/*" disabled className="mt-1 block w-full text-sm disabled:cursor-not-allowed disabled:opacity-60" />
          </label>
          <p className="mt-1 text-sm text-zinc-600">Mux is connected later. You can save this lesson now. The file is not uploaded.</p>
        </div>
      ) : null}
      {type === "link" ? (
        <label className={labelClass}>
          URL
          <input className={fieldClass} required type="url" value={externalUrl} onChange={(event) => setExternalUrl(event.target.value)} />
        </label>
      ) : null}
      {type === "file" ? (
        <label className={labelClass}>
          File URL
          <input className={fieldClass} required type="url" value={fileUrl} onChange={(event) => setFileUrl(event.target.value)} />
        </label>
      ) : null}
      <label className={labelClass}>
        Duration (seconds, optional)
        <input className={fieldClass} inputMode="numeric" value={duration} onChange={(event) => setDuration(event.target.value)} />
      </label>
      {save.isError ? <ErrorNote message={errorMessage(save.error)} /> : null}
      {remove.isError ? <ErrorNote message={errorMessage(remove.error)} /> : null}
      <div className="flex gap-2">
        <button type="submit" className={buttonClass} disabled={save.isPending}>
          Save lesson
        </button>
        <button type="button" className={buttonSecondaryClass} onClick={onClose}>
          Close
        </button>
        {lesson ? (
          <button
            type="button"
            className={buttonSecondaryClass}
            onClick={() => {
              if (window.confirm("Delete this lesson?")) remove.mutate();
            }}
          >
            Delete lesson
          </button>
        ) : null}
      </div>
    </form>
  );
}
