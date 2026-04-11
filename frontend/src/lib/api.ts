/**
 * API client for JobHound backend.
 * All requests include the JWT from session and support per-request LLM config
 * (stored in localStorage) via request headers.
 */

import { getSession } from "next-auth/react";

// Use relative URL so requests go through the Next.js proxy rewrite
// (next.config.ts: /backend/* → http://backend:8000/*).
// This works on any IP/network — no hardcoded host needed.
// Override via NEXT_PUBLIC_API_URL for non-Docker deployments.
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "/backend";

/** LLM provider config stored in localStorage by the Settings page. */
export interface LLMConfig {
  provider?: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
}

export function estimateTokens(text: string): number {
  const normalized = text.trim();
  if (!normalized) return 0;
  return Math.max(1, Math.ceil(normalized.length / 4));
}

function getLLMConfig(): LLMConfig {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem("jobhound_llm_config");
    return raw ? (JSON.parse(raw) as LLMConfig) : {};
  } catch {
    return {};
  }
}

// Cache the session for a short window so concurrent requests share one fetch.
let _sessionPromise: ReturnType<typeof getSession> | null = null;
let _sessionTimestamp = 0;
const SESSION_CACHE_MS = 5_000;

async function getAuthHeaders(): Promise<Record<string, string>> {
  const now = Date.now();
  if (!_sessionPromise || now - _sessionTimestamp > SESSION_CACHE_MS) {
    _sessionPromise = getSession();
    _sessionTimestamp = now;
  }
  const session = await _sessionPromise;
  const token = (session as { accessToken?: string } | null)?.accessToken;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const authHeaders = await getAuthHeaders();
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders,
      ...(options.headers as Record<string, string>),
    },
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(
      (error as { detail?: string }).detail ?? `HTTP ${res.status}`
    );
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ── Applications ─────────────────────────────────────────────────────────────

export interface Application {
  id: string;
  user_id: string;
  company: string;
  job_title: string;
  date_applied: string;
  source?: string;
  status: string;
  location?: string;
  work_mode?: string;
  whats_in_it_for_me?: string;
  salary_min?: number;
  salary_max?: number;
  salary_currency: string;
  salary_period: string;
  cv_link?: string;
  cl_link?: string;
  job_url?: string;
  notes?: string;
  rejection_reason?: string;
  raw_input?: string;
  skills: string[];
  status_history: StatusHistory[];
  created_at: string;
  updated_at: string;
}

export interface StatusHistory {
  id: number;
  from_status?: string;
  to_status: string;
  changed_at: string;
  notes?: string;
}

export interface ApplicationListResponse {
  items: Application[];
  total: number;
  page: number;
  page_size: number;
}

export interface ApplicationFilters {
  page?: number;
  page_size?: number;
  status?: string;
  source?: string;
  date_from?: string;
  date_to?: string;
  skills?: string[];
  location?: string;
  search?: string;
  sort_by?: string;
  sort_order?: "asc" | "desc";
}

export async function listApplications(
  filters: ApplicationFilters = {}
): Promise<ApplicationListResponse> {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") {
      if (Array.isArray(v)) {
        v.forEach((item) => params.append(k, item));
      } else {
        params.set(k, String(v));
      }
    }
  });
  return apiFetch<ApplicationListResponse>(
    `/api/applications?${params.toString()}`
  );
}

export async function getApplication(id: string): Promise<Application> {
  return apiFetch<Application>(`/api/applications/${id}`);
}

export async function createApplication(
  data: Record<string, unknown>
): Promise<Application> {
  return apiFetch<Application>("/api/applications", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateApplication(
  id: string,
  data: Record<string, unknown>
): Promise<Application> {
  return apiFetch<Application>(`/api/applications/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function deleteApplication(id: string): Promise<void> {
  return apiFetch<void>(`/api/applications/${id}`, { method: "DELETE" });
}

export interface ExportFilters {
  status?: string[];
  source?: string[];
  work_mode?: string[];
  date_from?: string;
  date_to?: string;
  search?: string;
}

function buildExportQuery(filters: ExportFilters, countOnly = false): string {
  const p = new URLSearchParams();
  filters.status?.forEach((s) => p.append("status", s));
  filters.source?.forEach((s) => p.append("source", s));
  filters.work_mode?.forEach((m) => p.append("work_mode", m));
  if (filters.date_from) p.set("date_from", filters.date_from);
  if (filters.date_to) p.set("date_to", filters.date_to);
  if (filters.search) p.set("search", filters.search);
  if (countOnly) p.set("count_only", "true");
  return p.toString();
}

export async function countExportApplications(filters: ExportFilters): Promise<number> {
  const qs = buildExportQuery(filters, true);
  const res = await apiFetch<{ total: number }>(`/api/applications/export?${qs}`);
  return res.total;
}

export async function exportApplications(
  filters: ExportFilters
): Promise<{ exported_at: string; total: number; applications: Application[] }> {
  const qs = buildExportQuery(filters, false);
  return apiFetch(`/api/applications/export?${qs}`);
}

export interface ParseResponse {
  parsed: Record<string, unknown>;
  uncertain_fields: string[];
  skills: string[];
}

export async function parseApplication(text: string, signal?: AbortSignal): Promise<ParseResponse> {
  const llmConfig = getLLMConfig();
  const authHeaders = await getAuthHeaders();

  // Use the Next.js route handler (/api/parse) instead of the rewrite proxy
  // (/backend/api/applications/parse) — same reason as /api/chat: rewrites
  // buffer the full response before forwarding, causing Cloudflare 524 timeouts.
  const res = await fetch("/api/parse", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders,
    },
    body: JSON.stringify({ text, ...llmConfig }),
    signal,
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error((error as { detail?: string }).detail ?? `HTTP ${res.status}`);
  }

  return res.json() as Promise<ParseResponse>;
}

// ── Analytics ─────────────────────────────────────────────────────────────────

export async function getAnalyticsOverview(): Promise<Record<string, unknown>> {
  return apiFetch("/api/analytics/overview");
}

export async function getApplicationsOverTime(
  period: "weekly" | "monthly" = "monthly"
): Promise<{ period: string; count: number }[]> {
  return apiFetch(`/api/analytics/applications-over-time?period=${period}`);
}

export async function getStatusFunnel(): Promise<
  { status: string; count: number }[]
> {
  return apiFetch("/api/analytics/status-funnel");
}

export async function getSkillsFrequency(): Promise<
  { name: string; category: string; count: number }[]
> {
  return apiFetch("/api/analytics/skills-frequency");
}

export async function getSourceEffectiveness(): Promise<
  {
    source: string;
    applied_count: number;
    response_count: number;
    response_rate: number;
  }[]
> {
  return apiFetch("/api/analytics/source-effectiveness");
}

export async function getSalaryDistribution(): Promise<{
  buckets: { bucket_min: number; bucket_max: number; count: number }[];
  p25: number;
  median: number;
  p75: number;
}> {
  return apiFetch("/api/analytics/salary-distribution");
}

export async function getResponseTime(): Promise<
  { source: string; avg_days: number }[]
> {
  return apiFetch("/api/analytics/response-time");
}

export async function getStatusByMonth(): Promise<
  { month: string; status: string; count: number }[]
> {
  return apiFetch("/api/analytics/status-by-month");
}

// ── Admin ────────────────────────────────────────────────────────────────────

export interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  status: string;
  application_count: number;
  created_at: string;
}

export async function listAllUsers(): Promise<AdminUser[]> {
  return apiFetch<AdminUser[]>("/api/admin/panel/users");
}

export async function updateUserStatus(
  userId: string,
  newStatus: string
): Promise<{ id: string; status: string }> {
  return apiFetch(`/api/admin/panel/users/${userId}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status: newStatus }),
  });
}

export async function deleteUser(userId: string): Promise<void> {
  return apiFetch<void>(`/api/admin/panel/users/${userId}`, { method: "DELETE" });
}

// ── Chat Sessions ────────────────────────────────────────────────────────────

export interface ChatSession {
  id: string;
  title: string;
  token_count: number;
  max_tokens: number;
  created_at: string;
  updated_at: string;
  message_count: number;
}

export async function listChatSessions(): Promise<ChatSession[]> {
  return apiFetch<ChatSession[]>("/api/chat/sessions");
}

export async function createChatSession(): Promise<ChatSession> {
  return apiFetch<ChatSession>("/api/chat/sessions", { method: "POST" });
}

export async function renameChatSession(id: string, title: string): Promise<ChatSession> {
  return apiFetch<ChatSession>(`/api/chat/sessions/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ title }),
  });
}

export async function deleteChatSession(id: string): Promise<void> {
  return apiFetch<void>(`/api/chat/sessions/${id}`, { method: "DELETE" });
}

export async function getChatSessionHistory(id: string): Promise<{ id: number; role: string; content: string; created_at: string }[]> {
  return apiFetch(`/api/chat/sessions/${id}/history`);
}

export async function clearChatSessionHistory(id: string): Promise<void> {
  return apiFetch<void>(`/api/chat/sessions/${id}/history`, { method: "DELETE" });
}

// ── CV Analyses ───────────────────────────────────────────────────────────────

export interface CvAnalysis {
  id: string;
  title: string;
  job_description?: string | null;
  content: string;
  created_at: string;
}

export async function listCvAnalyses(): Promise<CvAnalysis[]> {
  return apiFetch<CvAnalysis[]>("/api/user/cv/analyses");
}

export async function getCvAnalysis(id: string): Promise<CvAnalysis> {
  return apiFetch<CvAnalysis>(`/api/user/cv/analyses/${id}`);
}

export async function saveCvAnalysis(content: string, jobDescription?: string, title?: string): Promise<CvAnalysis> {
  return apiFetch<CvAnalysis>("/api/user/cv/analyses", {
    method: "POST",
    body: JSON.stringify({
      content,
      ...(jobDescription?.trim() ? { job_description: jobDescription } : {}),
      ...(title?.trim() ? { title } : {}),
    }),
  });
}

export async function deleteCvAnalysis(id: string): Promise<void> {
  return apiFetch<void>(`/api/user/cv/analyses/${id}`, { method: "DELETE" });
}

// ── Chat (legacy) ─────────────────────────────────────────────────────────────

export async function getChatHistory(): Promise<
  { id: number; role: string; content: string; created_at: string }[]
> {
  return apiFetch("/api/chat/history");
}

export async function clearChatHistory(): Promise<void> {
  return apiFetch<void>("/api/chat/history", { method: "DELETE" });
}

// ── CV / Profile ─────────────────────────────────────────────────────────────

export async function getCv(): Promise<{ cv_text: string; cv_filename: string | null; cv_uploaded_at: string | null }> {
  return apiFetch("/api/user/cv");
}

export async function saveCvText(cv_text: string): Promise<{ cv_text: string }> {
  return apiFetch("/api/user/cv", {
    method: "PUT",
    body: JSON.stringify({ cv_text }),
  });
}

export async function uploadCvPdf(file: File): Promise<{ cv_text: string; pages: number; cv_filename: string; cv_uploaded_at: string }> {
  const authHeaders = await getAuthHeaders();
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${API_URL}/api/user/cv/pdf`, {
    method: "POST",
    headers: { ...authHeaders },
    body: formData,
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error((error as { detail?: string }).detail ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export async function streamCvAnalyze(
  jobDescription: string,
  llmConfig: { provider?: string; model?: string; apiKey?: string; baseUrl?: string },
  onToken: (token: string) => void,
  onDone: () => void,
  onError: (error: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const authHeaders = await getAuthHeaders();

  let res: Response;
  try {
    res = await fetch("/api/cv-analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ job_description: jobDescription, ...llmConfig }),
      signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") { onDone(); return; }
    onError(e instanceof Error ? e.message : "Request failed");
    return;
  }

  if (!res.ok || !res.body) { onError(`HTTP ${res.status}`); return; }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6).trim();
          if (data === "[DONE]") { onDone(); return; }
          try {
            const parsed = JSON.parse(data) as { token?: string; error?: string };
            if (parsed.error) onError(parsed.error);
            else if (parsed.token) onToken(parsed.token);
          } catch { /* ignore */ }
        }
      }
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") { onDone(); return; }
    throw e;
  }
  onDone();
}

/** Stream chat response as SSE. Pass an AbortSignal to support mid-stream cancellation. */
export async function streamChat(
  message: string,
  onToken: (token: string) => void,
  onDone: () => void,
  onMeta: ((meta: { session_id: string; token_count: number }) => void) | undefined,
  onError: (error: string) => void,
  sessionId?: string,
  signal?: AbortSignal,
): Promise<void> {
  const authHeaders = await getAuthHeaders();
  const llmConfig = getLLMConfig();

  let res: Response;
  try {
    // Use the Next.js route handler (/api/chat) instead of the rewrite proxy
    // (/backend/api/chat) — the route handler pipes SSE in real-time, while
    // rewrites buffer the entire response before forwarding (Cloudflare 524).
    res = await fetch(`/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders,
      },
      body: JSON.stringify({ message, ...llmConfig, ...(sessionId ? { session_id: sessionId } : {}) }),
      signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") { onDone(); return; }
    onError(e instanceof Error ? e.message : "Request failed");
    return;
  }

  if (!res.ok || !res.body) {
    onError(`HTTP ${res.status}`);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6).trim();
          if (data === "[DONE]") {
            onDone();
            return;
          }
          try {
            const parsed = JSON.parse(data) as { token?: string; error?: string; meta?: { session_id: string; token_count: number } };
            if (parsed.meta) {
              onMeta?.(parsed.meta);
            } else if (parsed.error) {
              onError(parsed.error);
            } else if (parsed.token) {
              onToken(parsed.token);
            }
          } catch {
            // ignore parse errors
          }
        }
      }
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") { onDone(); return; }
    throw e;
  }

  onDone();
}

/** Stream a session summarization as SSE. */
export async function streamSummarize(
  sessionId: string,
  onToken: (token: string) => void,
  onDone: () => void,
  onError: (error: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const authHeaders = await getAuthHeaders();

  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/chat/sessions/${sessionId}/summarize`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders,
      },
      signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") { onDone(); return; }
    onError(e instanceof Error ? e.message : "Request failed");
    return;
  }

  if (!res.ok || !res.body) {
    onError(`HTTP ${res.status}`);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6).trim();
          if (data === "[DONE]") {
            onDone();
            return;
          }
          try {
            const parsed = JSON.parse(data) as { token?: string; error?: string; meta?: { session_id: string; token_count: number } };
            if (parsed.meta) {
              // meta event at end of summarize — ignore tokens, just signal done
            } else if (parsed.error) {
              onError(parsed.error);
            } else if (parsed.token) {
              onToken(parsed.token);
            }
          } catch {
            // ignore parse errors
          }
        }
      }
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") { onDone(); return; }
    throw e;
  }

  onDone();
}
