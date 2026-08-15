/** Turn a YouTube watch/share/live URL (or 11-char id) into an embeddable iframe src. */
export function youtubeEmbedUrl(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  let id = "";
  if (/^[\w-]{11}$/.test(raw)) {
    id = raw;
  } else {
    try {
      const u = new URL(raw);
      const host = u.hostname.replace(/^www\./, "");
      if (host === "youtu.be") id = u.pathname.split("/").filter(Boolean)[0] ?? "";
      else if (u.searchParams.get("v")) id = u.searchParams.get("v") ?? "";
      else {
        const parts = u.pathname.split("/").filter(Boolean);
        if (parts[0] === "embed" || parts[0] === "live" || parts[0] === "shorts") id = parts[1] ?? "";
      }
    } catch {
      return null;
    }
  }
  id = id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 11);
  if (id.length !== 11) return null;
  return `https://www.youtube.com/embed/${id}?rel=0`;
}
