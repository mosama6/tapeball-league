import { apiPath } from "./config";

export async function api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (init.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  const token = localStorage.getItem("wolfpack_admin_token");
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(apiPath(path), { ...init, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || data.error || "Request failed");
  return data as T;
}
