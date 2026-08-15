import { apiPath } from "./config";

const TOKEN_KEY = "wolfpack_umpire_token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(t: string) {
  localStorage.setItem(TOKEN_KEY, t);
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

async function req(path: string, init: RequestInit = {}) {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (init.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(apiPath(path), { ...init, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || data.error || data.message || "Request failed");
  return data;
}

export const api = {
  login: (email: string, password: string) => req("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  me: () => req("/api/auth/me"),
  matches: () => req("/api/umpire/matches"),
  match: (id: string) => req(`/api/umpire/matches/${id}`),
  toss: (id: string, body: object) => req(`/api/umpire/matches/${id}/toss`, { method: "POST", body: JSON.stringify(body) }),
  xi: (id: string, body: object) => req(`/api/umpire/matches/${id}/playing-xi`, { method: "POST", body: JSON.stringify(body) }),
  overs: (id: string, body: object) => req(`/api/umpire/matches/${id}/overs`, { method: "POST", body: JSON.stringify(body) }),
  startInnings: (id: string, body: object) => req(`/api/umpire/matches/${id}/start-innings`, { method: "POST", body: JSON.stringify(body) }),
  superOver: (id: string, body: object) => req(`/api/umpire/matches/${id}/super-over`, { method: "POST", body: JSON.stringify(body) }),
  delivery: (id: string, body: object) => req(`/api/umpire/matches/${id}/deliveries`, { method: "POST", body: JSON.stringify(body) }),
  undo: (id: string) => req(`/api/umpire/matches/${id}/undo`, { method: "POST", body: "{}" }),
  selectBatter: (id: string, playerId: string) =>
    req(`/api/umpire/matches/${id}/select-batter`, { method: "POST", body: JSON.stringify({ playerId }) }),
  selectBowler: (id: string, bowlerId: string, override = false) =>
    req(`/api/umpire/matches/${id}/select-bowler`, { method: "POST", body: JSON.stringify({ bowlerId, override }) }),
  walkover: (id: string, body: object) => req(`/api/umpire/matches/${id}/walkover`, { method: "POST", body: JSON.stringify(body) }),
  stream: (id: string, url: string) => req(`/api/umpire/matches/${id}/stream`, { method: "PATCH", body: JSON.stringify({ url }) })
};
