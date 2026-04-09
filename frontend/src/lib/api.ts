/**
 * API client for JobHound backend.
 * All requests include the JWT from session and support per-request LLM config
 * (stored in localStorage) via request headers.
 */

import { getSession } from "next-auth/react";

// const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "/backend";

/** LLM provider config stored in localStorage by the Settings page. */
export interface LLMConfig {
  provider?: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
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

async function apiFetch<T>(
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

export interface ParseResponse {
  parsed: Record<string, unknown>;
  uncertain_fields: string[];
  skills: string[];
}

export async function parseApplication(text: string): Promise<ParseResponse> {
  const llmConfig = getLLMConfig();
  return apiFetch<ParseResponse>("/api/applications/parse", {
    method: "POST",
    body: JSON.stringify({ text, ...llmConfig }),
  });
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

// ── Chat ────────────────────────────────────────────────────────────────────

export async function getChatHistory(): Promise<
  { id: number; role: string; content: string; created_at: string }[]
> {
  return apiFetch("/api/chat/history");
}

export async function clearChatHistory(): Promise<void> {
  return apiFetch<void>("/api/chat/history", { method: "DELETE" });
}

/** Stream chat response as SSE. Returns an EventSource-like async iterator. */
export async function streamChat(
  message: string,
  onToken: (token: string) => void,
  onDone: () => void,
  onError: (error: string) => void
): Promise<void> {
  const authHeaders = await getAuthHeaders();
  const llmConfig = getLLMConfig();

  const res = await fetch(`${API_URL}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders,
    },
    body: JSON.stringify({ message, ...llmConfig }),
  });

  if (!res.ok || !res.body) {
    onError(`HTTP ${res.status}`);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

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
          const parsed = JSON.parse(data) as { token?: string; error?: string };
          if (parsed.error) {
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

  onDone();
}
