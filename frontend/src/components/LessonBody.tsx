import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, errorMessage } from "../api/client";
import type { LessonContent } from "../api/types";
import { youtubeEmbedUrl } from "../api/youtube";
import { buttonClass, ErrorNote } from "./ui";

export function LessonBody({ courseId, lesson }: { courseId: string; lesson: LessonContent }) {
  const queryClient = useQueryClient();
  const [localError, setLocalError] = useState<string | null>(null);
  const complete = useMutation({
    mutationFn: () =>
      api(`/api/v1/lessons/${lesson.id}/progress`, {
        method: "POST",
        body: JSON.stringify({
          last_position_sec: lesson.progress?.last_position_sec ?? 0,
          is_completed: true,
        }),
      }),
    onSuccess: async () => {
      setLocalError(null);
      await queryClient.invalidateQueries({ queryKey: ["content", courseId] });
      await queryClient.invalidateQueries({ queryKey: ["enrollments"] });
    },
    onError: (err) => setLocalError(errorMessage(err)),
  });
  const done = lesson.progress?.is_completed === true;
  const savedPosition = lesson.progress?.last_position_sec ?? 0;

  return (
    <article className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">{lesson.title}</h1>
      {lesson.type === "video" ? <VideoPlaceholder position={savedPosition} /> : null}
      {lesson.type === "text" ? <TextLesson body={lesson.body_markdown} /> : null}
      {lesson.type === "link" && lesson.external_url ? <LinkLesson url={lesson.external_url} title={lesson.title} /> : null}
      {lesson.type === "file" && lesson.file_url ? <FileLesson url={lesson.file_url} /> : null}
      {savedPosition > 0 && lesson.type !== "video" ? (
        <p className="text-sm text-zinc-500">Saved position: {savedPosition}s</p>
      ) : null}
      {lesson.type !== "video" ? (
        done ? (
          <p className="text-sm font-medium text-blue-800">Completed</p>
        ) : (
          <button type="button" className={buttonClass} disabled={complete.isPending} onClick={() => complete.mutate()}>
            {complete.isPending ? "Saving…" : "Mark complete"}
          </button>
        )
      ) : null}
      {localError ? <ErrorNote message={localError} /> : null}
    </article>
  );
}

function VideoPlaceholder({ position }: { position: number }) {
  return (
    <div className="rounded-md border border-zinc-200 bg-zinc-50 px-4 py-10 text-sm text-zinc-700">
      <p>Playback is not connected yet.</p>
      {position > 0 ? <p className="mt-2 text-zinc-500">Saved position: {position}s</p> : null}
    </div>
  );
}

function TextLesson({ body }: { body: string | null }) {
  if (!body) return <p className="text-sm text-zinc-600">This lesson has no text.</p>;
  return (
    <div className="lesson-markdown text-zinc-800">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {body}
      </ReactMarkdown>
    </div>
  );
}

function LinkLesson({ url, title }: { url: string; title: string }) {
  const embed = youtubeEmbedUrl(url);
  if (embed) {
    return (
      <iframe
        src={embed}
        title={title}
        className="aspect-video w-full rounded-md border border-zinc-200"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
      />
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="block rounded-md border border-zinc-200 bg-white p-4 hover:border-blue-700"
    >
      <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">Link</span>
      <span className="mt-1 block font-medium text-zinc-950">{title}</span>
      <span className="mt-1 block break-all text-sm text-blue-800">{url}</span>
    </a>
  );
}

function FileLesson({ url }: { url: string }) {
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-blue-800 underline">
      Download file
    </a>
  );
}
