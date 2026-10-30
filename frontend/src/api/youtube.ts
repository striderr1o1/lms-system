const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export function youtubeEmbedUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  let id: string | null = null;
  if (host === "youtu.be") {
    id = url.pathname.split("/").filter(Boolean)[0] ?? null;
  } else if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
    const parts = url.pathname.split("/").filter(Boolean);
    if (url.pathname === "/watch" || parts[0] === "watch") {
      id = url.searchParams.get("v");
    } else if (parts[0] === "shorts" || parts[0] === "embed" || parts[0] === "live" || parts[0] === "v" || parts[0] === "share") {
      id = parts[1] ?? null;
    }
  }
  if (!id || !VIDEO_ID.test(id)) return null;
  return `https://www.youtube-nocookie.com/embed/${id}`;
}
