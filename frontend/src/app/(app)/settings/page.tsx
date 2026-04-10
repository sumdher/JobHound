/**
 * Settings page.
 * LLM provider + model are stored per-user in the backend DB (follow you across devices).
 * API key is stored in browser localStorage only — never sent to the server.
 * Ollama model list is fetched live from the server.
 */

"use client";

import { useEffect, useState, useCallback } from "react";
import { apiFetch } from "@/lib/api";

interface LLMSettings {
  provider: string;
  model: string;
  base_url?: string;
}

interface Config extends LLMSettings {
  apiKey: string; // localStorage only — never persisted server-side
}

const DEFAULT_MODELS: Record<string, string> = {
  ollama: "llama3.1:8b",
  openai: "gpt-4o-mini",
  anthropic: "claude-sonnet-4-20250514",
  nebius: "",
};

const DEFAULT_BASE_URLS: Record<string, string> = {
  nebius: "https://api.studio.nebius.ai/v1",
};

const PROVIDERS = [
  { value: "ollama", label: "Ollama (local)" },
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "nebius", label: "Nebius" },
];

function loadApiKey(): string {
  if (typeof window === "undefined") return "";
  try {
    const raw = localStorage.getItem("jobhound_llm_config");
    return raw ? (JSON.parse(raw) as { apiKey?: string }).apiKey ?? "" : "";
  } catch {
    return "";
  }
}

function saveApiKey(key: string) {
  const raw = localStorage.getItem("jobhound_llm_config");
  const existing = raw ? JSON.parse(raw) : {};
  localStorage.setItem("jobhound_llm_config", JSON.stringify({ ...existing, apiKey: key }));
}

// Sync non-sensitive settings to localStorage so other pages (chat, parse) can read them
function syncToLocalStorage(cfg: Config) {
  const raw = localStorage.getItem("jobhound_llm_config");
  const existing = raw ? JSON.parse(raw) : {};
  localStorage.setItem(
    "jobhound_llm_config",
    JSON.stringify({
      ...existing,
      provider: cfg.provider,
      model: cfg.model,
      baseUrl: cfg.base_url ?? "",
      apiKey: cfg.apiKey,
    })
  );
}

export default function SettingsPage() {
  const [config, setConfig] = useState<Config>({
    provider: "ollama",
    model: "llama3.1:8b",
    base_url: "",
    apiKey: "",
  });
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [ollamaError, setOllamaError] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchOllamaModels = useCallback(async () => {
    setLoadingModels(true);
    setOllamaError(false);
    try {
      const data = await apiFetch<{ models: string[]; error?: string }>("/api/user/ollama-models");
      setOllamaModels(data.models);
      if (data.error) setOllamaError(true);
    } catch {
      setOllamaError(true);
      setOllamaModels([]);
    } finally {
      setLoadingModels(false);
    }
  }, []);

  // Load settings from backend on mount
  useEffect(() => {
    const load = async () => {
      try {
        const stored = await apiFetch<LLMSettings>("/api/user/settings");
        const apiKey = loadApiKey();
        setConfig({ ...stored, base_url: stored.base_url ?? "", apiKey });
        syncToLocalStorage({ ...stored, base_url: stored.base_url ?? "", apiKey });
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "Failed to load settings");
      }
    };
    load();
  }, []);

  // Fetch Ollama models when provider is ollama
  useEffect(() => {
    if (config.provider === "ollama") {
      fetchOllamaModels();
    }
  }, [config.provider, fetchOllamaModels]);

  const handleProviderChange = (provider: string) => {
    setConfig((prev) => ({
      ...prev,
      provider,
      model: DEFAULT_MODELS[provider] ?? "",
      base_url: DEFAULT_BASE_URLS[provider] ?? "",
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload: LLMSettings = {
        provider: config.provider,
        model: config.model,
        ...(config.base_url ? { base_url: config.base_url } : {}),
      };
      await apiFetch("/api/user/settings", {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      saveApiKey(config.apiKey);
      syncToLocalStorage(config);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  const showApiKey = config.provider !== "ollama";
  const showBaseUrl = config.provider === "nebius";

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-muted-foreground">
          LLM provider preferences — saved to your account, follow you across devices.
        </p>
      </div>

      {loadError && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {loadError}
        </div>
      )}

      <div className="rounded-lg border border-border bg-card p-6 space-y-5">
        <h2 className="text-lg font-semibold">LLM Provider</h2>

        {/* Provider */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Provider</label>
          <select
            value={config.provider}
            onChange={(e) => handleProviderChange(e.target.value)}
            className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {PROVIDERS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </div>

        {/* Model — dropdown for Ollama, text input for others */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Model</label>
          {config.provider === "ollama" ? (
            <div className="space-y-2">
              {loadingModels ? (
                <div className="flex items-center gap-2 rounded-lg border border-border bg-input px-3 py-2 text-sm text-muted-foreground">
                  <div className="h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                  Loading available models…
                </div>
              ) : ollamaError || ollamaModels.length === 0 ? (
                <>
                  <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-400">
                    {ollamaError
                      ? "Could not reach Ollama — enter model name manually."
                      : "No models found — run `ollama pull <model>` first."}
                  </div>
                  <input
                    type="text"
                    value={config.model}
                    onChange={(e) => setConfig({ ...config, model: e.target.value })}
                    placeholder="e.g. llama3.1:8b"
                    className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </>
              ) : (
                <select
                  value={config.model}
                  onChange={(e) => setConfig({ ...config, model: e.target.value })}
                  className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {ollamaModels.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              )}
              {!loadingModels && ollamaModels.length > 0 && (
                <button
                  onClick={fetchOllamaModels}
                  className="text-xs text-muted-foreground hover:text-foreground underline"
                >
                  Refresh model list
                </button>
              )}
            </div>
          ) : (
            <input
              type="text"
              value={config.model}
              onChange={(e) => setConfig({ ...config, model: e.target.value })}
              placeholder={DEFAULT_MODELS[config.provider] ?? "model name"}
              className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          )}
        </div>

        {/* API Key (cloud providers only) */}
        {showApiKey && (
          <div className="space-y-1.5">
            <label className="text-sm font-medium">API Key</label>
            <input
              type="password"
              value={config.apiKey}
              onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
              placeholder="sk-..."
              className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <p className="text-xs text-muted-foreground">
              Stored in your browser only — never sent to our servers.
            </p>
          </div>
        )}

        {/* Base URL (nebius only — ollama URL is a server-side admin config) */}
        {showBaseUrl && (
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Base URL</label>
            <input
              type="url"
              value={config.base_url}
              onChange={(e) => setConfig({ ...config, base_url: e.target.value })}
              placeholder={DEFAULT_BASE_URLS[config.provider] ?? "https://..."}
              className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 pt-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-60"
          >
            {saved ? "Saved!" : saving ? "Saving…" : "Save Settings"}
          </button>
        </div>
      </div>

      {/* Current config summary */}
      <div className="rounded-lg border border-border bg-card p-6">
        <h3 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Active Configuration
        </h3>
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Provider</dt>
            <dd className="font-medium">{config.provider}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Model</dt>
            <dd className="font-medium">{config.model || "—"}</dd>
          </div>
          {showApiKey && (
            <div className="flex justify-between">
              <dt className="text-muted-foreground">API Key</dt>
              <dd className="font-medium">{config.apiKey ? "••••••••" : "not set"}</dd>
            </div>
          )}
          {showBaseUrl && config.base_url && (
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Base URL</dt>
              <dd className="text-xs font-medium">{config.base_url}</dd>
            </div>
          )}
        </dl>
      </div>

      <div className="rounded-lg border border-border bg-muted/30 p-4">
        <p className="text-xs text-muted-foreground">
          <strong>Provider &amp; model</strong> are saved to your account and apply on all your devices.
          {" "}<strong>API keys</strong> are browser-only and never leave your device.
          Each user has their own independent settings.
        </p>
      </div>
    </div>
  );
}
