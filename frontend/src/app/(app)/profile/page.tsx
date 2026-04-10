/**
 * Profile page — CV management and AI job fit analysis.
 * User can upload a PDF or paste their CV as text.
 * The "Job Fit Analysis" section compares the stored CV against a
 * pasted job description and streams tailored suggestions.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getCv, saveCvText, uploadCvPdf, streamCvAnalyze } from "@/lib/api";

// ── Loading phrases (same pool as chat) ──────────────────────────────────────

const LOADING_PHRASES = [
  "Reading the runes...",
  "Charting a course through your data...",
  "Measuring twice, sailing once...",
  "Anchoring on first principles...",
  "Applying some Bayesian optimism...",
  "Gradient descending into clarity...",
  "Running a quick sanity check...",
  "Compiling thoughts, no warnings so far...",
  "Turning data into opinions...",
  "Finding signal in polite noise...",
  "Consulting the oracle fr fr...",
  "Respectfully asking the model...",
  "No cap, thinking hard...",
  "Convinced 1 neural net so far...",
  "Sounding the depths of your data...",
];

// ── Markdown renderer (reused from chat page) ─────────────────────────────────

function inlineMarkdown(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**"))
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`"))
      return <code key={i} className="rounded bg-black/20 px-1 py-0.5 text-xs font-mono">{part.slice(1, -1)}</code>;
    if (part.startsWith("*") && part.endsWith("*"))
      return <em key={i}>{part.slice(1, -1)}</em>;
    return part;
  });
}

function Markdown({ content }: { content: string }) {
  const lines = content.split("\n");
  const nodes: React.ReactNode[] = [];
  let i = 0;
  let listItems: React.ReactNode[] = [];
  let listType: "ul" | "ol" | null = null;
  const flushList = () => {
    if (!listItems.length) return;
    if (listType === "ul") nodes.push(<ul key={`ul-${i}`} className="my-1 ml-4 list-disc space-y-0.5">{listItems}</ul>);
    else nodes.push(<ol key={`ol-${i}`} className="my-1 ml-4 list-decimal space-y-0.5">{listItems}</ol>);
    listItems = []; listType = null;
  };
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("```")) {
      flushList();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) { codeLines.push(lines[i]); i++; }
      nodes.push(<pre key={i} className="my-2 overflow-x-auto rounded-lg bg-black/30 p-3 text-xs font-mono leading-relaxed"><code>{codeLines.join("\n")}</code></pre>);
    } else if (line.startsWith("### ")) { flushList(); nodes.push(<p key={i} className="mt-3 mb-0.5 font-semibold">{inlineMarkdown(line.slice(4))}</p>); }
    else if (line.startsWith("## ")) { flushList(); nodes.push(<p key={i} className="mt-3 mb-1 text-base font-bold">{inlineMarkdown(line.slice(3))}</p>); }
    else if (line.startsWith("# ")) { flushList(); nodes.push(<p key={i} className="mt-3 mb-1 text-lg font-bold">{inlineMarkdown(line.slice(2))}</p>); }
    else if (/^[-*] /.test(line)) { if (listType !== "ul") { flushList(); listType = "ul"; } listItems.push(<li key={i}>{inlineMarkdown(line.slice(2))}</li>); }
    else if (/^\d+\. /.test(line)) { if (listType !== "ol") { flushList(); listType = "ol"; } listItems.push(<li key={i}>{inlineMarkdown(line.replace(/^\d+\. /, ""))}</li>); }
    else if (/^---+$/.test(line.trim())) { flushList(); nodes.push(<hr key={i} className="my-2 border-current opacity-20" />); }
    else if (line.trim() === "") { flushList(); nodes.push(<div key={i} className="h-2" />); }
    else { flushList(); nodes.push(<p key={i} className="leading-relaxed">{inlineMarkdown(line)}</p>); }
    i++;
  }
  flushList();
  return <div className="space-y-0.5 text-sm">{nodes}</div>;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ProfilePage() {
  // CV state
  const [cvText, setCvText] = useState("");
  const [cvSaving, setCvSaving] = useState(false);
  const [cvSaved, setCvSaved] = useState(false);
  const [cvLoading, setCvLoading] = useState(true);
  const [cvError, setCvError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Analysis state
  const [jobDescription, setJobDescription] = useState("");
  const [analysis, setAnalysis] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [loadingPhrase, setLoadingPhrase] = useState("");
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const analysisBottomRef = useRef<HTMLDivElement>(null);

  // Load CV on mount
  useEffect(() => {
    getCv()
      .then((data) => setCvText(data.cv_text))
      .catch(() => {/* non-critical */})
      .finally(() => setCvLoading(false));
  }, []);

  // Scroll to bottom as analysis streams
  useEffect(() => {
    if (analysis) analysisBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [analysis]);

  // Rotating loading phrases while streaming
  useEffect(() => {
    if (!streaming) { setLoadingPhrase(""); return; }
    const pick = () => setLoadingPhrase(LOADING_PHRASES[Math.floor(Math.random() * LOADING_PHRASES.length)]);
    pick();
    const id = setInterval(pick, 2500);
    return () => clearInterval(id);
  }, [streaming]);

  const handleSaveCv = async () => {
    setCvSaving(true);
    setCvError(null);
    try {
      await saveCvText(cvText);
      setCvSaved(true);
      setTimeout(() => setCvSaved(false), 2000);
    } catch (e) {
      setCvError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setCvSaving(false);
    }
  };

  const handleFile = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setCvError("Only PDF files are supported.");
      return;
    }
    setUploading(true);
    setCvError(null);
    try {
      const data = await uploadCvPdf(file);
      setCvText(data.cv_text);
      setCvSaved(true);
      setTimeout(() => setCvSaved(false), 2000);
    } catch (e) {
      setCvError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleAnalyze = async () => {
    if (!jobDescription.trim() || streaming) return;
    setAnalysis("");
    setAnalysisError(null);
    setStreaming(true);

    // Read LLM config from localStorage
    let llmConfig = {};
    try {
      const raw = localStorage.getItem("jobhound_llm_config");
      if (raw) llmConfig = JSON.parse(raw);
    } catch { /* ignore */ }

    const controller = new AbortController();
    abortRef.current = controller;

    await streamCvAnalyze(
      jobDescription,
      llmConfig,
      (token) => setAnalysis((prev) => prev + token),
      () => setStreaming(false),
      (err) => { setAnalysisError(err); setStreaming(false); },
      controller.signal,
    );
  };

  const handleStop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
  };

  const jdAdjustHeight = useCallback((el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">My Profile</h1>
        <p className="text-sm text-muted-foreground">
          Store your CV so the AI can analyze job fit and suggest improvements.
        </p>
      </div>

      {/* CV Section */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <h2 className="text-base font-semibold">Your CV</h2>

        {/* Drop zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 transition-colors ${dragOver ? "border-primary bg-primary/10" : "border-border hover:border-primary/50 hover:bg-muted/20"}`}
        >
          <input ref={fileInputRef} type="file" accept=".pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
          {uploading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              Extracting text from PDF…
            </div>
          ) : (
            <>
              <svg className="h-8 w-8 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">Drop your PDF here</span> or click to upload
              </p>
              <p className="text-xs text-muted-foreground">PDF up to 10 MB — text is extracted and stored</p>
            </>
          )}
        </div>

        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <div className="flex-1 border-t border-border" />
          <span>or paste / edit below</span>
          <div className="flex-1 border-t border-border" />
        </div>

        {/* Text editor */}
        {cvLoading ? (
          <div className="h-48 animate-pulse rounded-lg bg-muted/30" />
        ) : (
          <textarea
            value={cvText}
            onChange={(e) => setCvText(e.target.value)}
            placeholder={"Paste your CV text here…\n\nInclude: work experience, skills, education, etc."}
            rows={12}
            className="w-full resize-y rounded-lg border border-border bg-input px-4 py-3 text-sm leading-relaxed placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring font-mono"
          />
        )}

        {cvError && <p className="text-xs text-destructive">{cvError}</p>}

        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {cvText.trim() ? `${cvText.trim().split(/\s+/).length} words` : "No CV saved yet"}
          </p>
          <div className="flex items-center gap-2">
            {cvText.trim() && (
              <button
                onClick={async () => {
                  if (!window.confirm("Clear your saved CV? This cannot be undone.")) return;
                  setCvSaving(true);
                  setCvError(null);
                  try {
                    await saveCvText("");
                    setCvText("");
                  } catch (e) {
                    setCvError(e instanceof Error ? e.message : "Clear failed");
                  } finally {
                    setCvSaving(false);
                  }
                }}
                disabled={cvSaving}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:border-destructive hover:text-destructive disabled:opacity-50 transition-colors"
              >
                Clear CV
              </button>
            )}
            <button
              onClick={handleSaveCv}
              disabled={cvSaving || !cvText.trim()}
              className="rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {cvSaved ? "Saved!" : cvSaving ? "Saving…" : "Save CV"}
            </button>
          </div>
        </div>
      </div>

      {/* Job Fit Analysis Section */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div>
          <h2 className="text-base font-semibold">Job Fit Analysis</h2>
          <p className="text-sm text-muted-foreground">
            Paste a job description — the AI will compare it to your CV and suggest specific improvements.
          </p>
        </div>

        {!cvText.trim() && (
          <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-400">
            Save your CV above first to enable job fit analysis.
          </div>
        )}

        <textarea
          value={jobDescription}
          onChange={(e) => { setJobDescription(e.target.value); jdAdjustHeight(e.target); }}
          placeholder="Paste the job description here…"
          rows={4}
          disabled={!cvText.trim()}
          style={{ maxHeight: "300px" }}
          className="w-full resize-none overflow-y-auto rounded-xl border border-border bg-input px-4 py-3 text-sm leading-relaxed placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-40 transition-[height]"
        />

        <div className="flex items-center gap-3">
          {streaming ? (
            <button
              onClick={handleStop}
              className="flex items-center gap-1.5 rounded-xl bg-secondary px-4 py-2.5 text-sm font-medium text-foreground hover:bg-accent transition-colors"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1" /></svg>
              Stop
            </button>
          ) : (
            <button
              onClick={handleAnalyze}
              disabled={!jobDescription.trim() || !cvText.trim()}
              className="rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              Analyze Fit
            </button>
          )}
          {streaming && loadingPhrase && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <span className="italic">{loadingPhrase}</span>
            </div>
          )}
        </div>

        {analysisError && <p className="text-xs text-destructive">{analysisError}</p>}

        {(analysis || streaming) && (
          <div className="rounded-xl border border-border bg-secondary/50 px-5 py-4">
            {analysis ? (
              <>
                <Markdown content={analysis} />
                {streaming && <span className="inline-block h-4 w-0.5 animate-pulse bg-current ml-0.5" />}
              </>
            ) : (
              <span className="flex gap-1 px-1 py-1">
                <span className="animate-bounce text-lg leading-none">·</span>
                <span className="animate-bounce text-lg leading-none [animation-delay:0.1s]">·</span>
                <span className="animate-bounce text-lg leading-none [animation-delay:0.2s]">·</span>
              </span>
            )}
            <div ref={analysisBottomRef} />
          </div>
        )}
      </div>
    </div>
  );
}
