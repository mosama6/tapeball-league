export const API_BASE = String(import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

export function apiPath(path: string) {
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE}${p}`;
}
