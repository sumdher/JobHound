/**
 * Settings page.
 * Allows users to configure their LLM provider preferences (stored in localStorage).
 * Settings are sent with each API request as provider overrides.
 */

"use client";

import { useEffect, useState } from "react";

interface LLMConfig {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl: string;
}

const DEFAULT_MODELS: Record<string, string> = {
  ollama: "llama3.1:8b",
  openai: "gpt-4o-mini",
  anthropic: "claude-sonnet-4-20250514",
  nebius: "",
};

const DEFAULT_BASE_URLS: Record<string, string> = {
  ollama: "http://localhost:11434",
  nebius: "https://api.studio.nebius.ai/v1",
};

const PROVIDERS = [
  { value: "ollama", label: "Ollama (local)" },
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "nebius", label: "Nebius" },
];

export default function SettingsPage() {
  const [config, setConfig] = useState<LLMConfig>({
    provider: "ollama",
    model: "llama3.1:8b",
    apiKey: "",
    baseUrl: "http://localhost:11434",
  });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const raw = localStorage.getItem("jobhound_llm_config");
    if (raw) {
      try {
        const stored = JSON.parse(raw) as LLMConfig;
        setConfig(stored);
      } catch {
        // ignore
      }
    }
  }, []);

  const handleProviderChange = (provider: string) => {
    setConfig({
      provider,
      model: DEFAULT_MODELS[provider] ?? "",
      apiKey: "",
      baseUrl: DEFAULT_BASE_URLS[provider] ?? "",
    });
  };

  const handleSave = () => {
    localStorage.setItem("jobhound_llm_config", JSON.stringify(config));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleReset = () => {
    localStorage.removeItem("jobhound_llm_config");
    setConfig({
      provider: "ollama",
      model: "llama3.1:8b",
      apiKey: "",
      baseUrl: "http://localhost:11434",
    });
  };

  const showApiKey = config.provider !== "ollama";
  const showBaseUrl = config.provider === "ollama" || config.provider === "nebius";

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Configure your LLM provider for parsing and chat. Settings are stored
          in your browser.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card p-6 space-y-5">
        <h2 className="text-lg font-semibold">LLM Provider</h2>

        {/* Provider select */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Provider</label>
          <select
            value={config.provider}
            onChange={(e) => handleProviderChange(e.target.value)}
            className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {PROVIDERS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        {/* Model name */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Model Name</label>
          <input
            type="text"
            value={config.model}
            onChange={(e) => setConfig({ ...config, model: e.target.value })}
            placeholder={DEFAULT_MODELS[config.provider] ?? "model name"}
            className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
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
              Stored locally in your browser only, never sent to our servers.
            </p>
          </div>
        )}

        {/* Base URL (ollama + nebius) */}
        {showBaseUrl && (
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Base URL</label>
            <input
              type="url"
              value={config.baseUrl}
              onChange={(e) => setConfig({ ...config, baseUrl: e.target.value })}
              placeholder={DEFAULT_BASE_URLS[config.provider] ?? "https://..."}
              className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 pt-2">
          <button
            onClick={handleSave}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            {saved ? "Saved!" : "Save Settings"}
          </button>
          <button
            onClick={handleReset}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            Reset to Defaults
          </button>
        </div>
      </div>

      {/* Current config summary */}
      <div className="rounded-lg border border-border bg-card p-6">
        <h3 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Current Configuration
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
          <div className="flex justify-between">
            <dt className="text-muted-foreground">API Key</dt>
            <dd className="font-medium">
              {config.apiKey ? "••••••••" : "not set"}
            </dd>
          </div>
          {showBaseUrl && (
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Base URL</dt>
              <dd className="font-medium text-xs">{config.baseUrl || "—"}</dd>
            </div>
          )}
        </dl>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <p className="text-xs text-muted-foreground">
          <strong>Note:</strong> These settings are stored in your browser&apos;s
          localStorage and sent with each parse/chat request to override the
          server defaults. They are never stored on the server. Different users
          can use different providers simultaneously.
        </p>
      </div>
    </div>
  );
}
