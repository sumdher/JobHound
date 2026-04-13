/**
 * Profile page — CV management and AI job fit analysis.
 * User can upload a PDF or paste their CV as text.
 * Shows PDF metadata (filename + upload date) when available.
 * CV text area is hidden by default and toggled visible.
 * The "Job Fit Analysis" section streams tailored suggestions.
 * Completed analyses can be saved and re-opened from a saved list.
 * URL param ?a=analysisId auto-expands that saved analysis.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  getCv,
  saveCvText,
  uploadCvPdf,
  streamCvAnalyze,
  listCvAnalyses,
  saveCvAnalysis,
  deleteCvAnalysis,
  type CvAnalysis,
} from "@/lib/api";
import {
  CV_ANALYSES_CHANGED_EVENT,
  emitAppEvent,
} from "@/lib/app-events";
import { cn } from "@/lib/utils";

// ── Loading phrases ───────────────────────────────────────────────────────────

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

// ── Markdown renderer ──────────────────────────────────────────────────────────

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

function parseTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isTableDivider(line: string): boolean {
  const cells = parseTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function tableAlign(cell: string): "left" | "center" | "right" {
  const trimmed = cell.trim();
  if (trimmed.startsWith(":") && trimmed.endsWith(":")) return "center";
  if (trimmed.endsWith(":")) return "right";
  return "left";
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
    } else if (line.includes("|") && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
      flushList();
      const header = parseTableRow(line);
      const alignments = parseTableRow(lines[i + 1]).map(tableAlign);
      const body: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
        body.push(parseTableRow(lines[i]));
        i++;
      }
      nodes.push(
        <div key={`table-${i}`} className="my-3 overflow-x-auto rounded-lg border border-border">
          <table className="min-w-full border-collapse text-sm">
            <thead className="bg-muted/40">
              <tr>
                {header.map((cell, index) => (
                  <th
                    key={`th-${index}`}
                    className="border-b border-border px-3 py-2 font-semibold"
                    style={{ textAlign: alignments[index] ?? "left" }}
                  >
                    {inlineMarkdown(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((row, rowIndex) => (
                <tr key={`tr-${rowIndex}`} className="odd:bg-background even:bg-muted/10">
                  {row.map((cell, cellIndex) => (
                    <td
                      key={`td-${rowIndex}-${cellIndex}`}
                      className="border-t border-border px-3 py-2 align-top"
                      style={{ textAlign: alignments[cellIndex] ?? "left" }}
                    >
                      {inlineMarkdown(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    } else if (line.startsWith("### ")) { flushList(); nodes.push(<p key={i} className="mt-3 mb-0.5 font-semibold">{inlineMarkdown(line.slice(4))}</p>); }
    else if (line.startsWith("#### ")) { flushList(); nodes.push(<p key={i} className="mt-3 mb-0.5 text-sm font-semibold">{inlineMarkdown(line.slice(5))}</p>); }
    else if (line.startsWith("##### ")) { flushList(); nodes.push(<p key={i} className="mt-3 mb-0.5 text-sm font-medium">{inlineMarkdown(line.slice(6))}</p>); }
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

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return iso;
  }
}

const PROFILE_ANALYSIS_STORAGE_KEY = "jobhound_profile_analysis_draft";

interface ProfileAnalysisDraft {
  jobDescription: string;
  analysis: string;
  streaming: boolean;
  error: string | null;
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function ProfilePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeAnalysisId = searchParams.get("a");

  // CV state
  const [cvText, setCvText] = useState("");
  const [cvFilename, setCvFilename] = useState<string | null>(null);
  const [cvUploadedAt, setCvUploadedAt] = useState<string | null>(null);
  const [cvSaving, setCvSaving] = useState(false);
  const [cvSaved, setCvSaved] = useState(false);
  const [cvLoading, setCvLoading] = useState(true);
  const [cvError, setCvError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [showCvText, setShowCvText] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Analysis state
  const [jobDescription, setJobDescription] = useState("");
  const [analysis, setAnalysis] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [loadingPhrase, setLoadingPhrase] = useState("");
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const jobDescriptionRef = useRef(jobDescription);
  const analysisRef = useRef(analysis);
  const streamingRef = useRef(streaming);
  const analysisErrorRef = useRef<string | null>(analysisError);

  // Save analysis state
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState(false);

  // Saved analyses state
  const [savedAnalyses, setSavedAnalyses] = useState<CvAnalysis[]>([]);

  // Delete confirm state
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persistDraft = useCallback((draft: ProfileAnalysisDraft) => {
    if (typeof window === "undefined") return;
    window.sessionStorage.setItem(PROFILE_ANALYSIS_STORAGE_KEY, JSON.stringify(draft));
  }, []);

  useEffect(() => {
    jobDescriptionRef.current = jobDescription;
  }, [jobDescription]);

  useEffect(() => {
    analysisRef.current = analysis;
  }, [analysis]);

  useEffect(() => {
    streamingRef.current = streaming;
  }, [streaming]);

  useEffect(() => {
    analysisErrorRef.current = analysisError;
  }, [analysisError]);

  // Load CV and saved analyses on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem(PROFILE_ANALYSIS_STORAGE_KEY);
    }

    getCv()
      .then((data) => {
        setCvText(data.cv_text);
        setCvFilename(data.cv_filename ?? null);
        setCvUploadedAt(data.cv_uploaded_at ?? null);
      })
      .catch(() => {/* non-critical */})
      .finally(() => setCvLoading(false));

    listCvAnalyses()
      .then(setSavedAnalyses)
      .catch(() => {/* non-critical */});
  }, []);

  useEffect(() => {
    if (activeAnalysisId) {
      router.replace(`/profile/analyses/${activeAnalysisId}`);
    }
  }, [activeAnalysisId, router]);

  // Cleanup confirm timer on unmount
  useEffect(() => {
    return () => {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    };
  }, []);

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
      setCvFilename(data.cv_filename);
      setCvUploadedAt(data.cv_uploaded_at);
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
    analysisErrorRef.current = null;
    const initialDraft: ProfileAnalysisDraft = {
      jobDescription,
      analysis: "",
      streaming: true,
      error: null,
    };
    jobDescriptionRef.current = jobDescription;
    analysisRef.current = "";
    streamingRef.current = true;
    analysisErrorRef.current = null;
    persistDraft(initialDraft);

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
      (token) => {
        const next = analysisRef.current + token;
        analysisRef.current = next;
        persistDraft({
          jobDescription: jobDescriptionRef.current,
          analysis: next,
          streaming: true,
          error: null,
        });
        setAnalysis(next);
      },
      () => {
        streamingRef.current = false;
        setStreaming(false);
        persistDraft({
          jobDescription: jobDescriptionRef.current,
          analysis: analysisRef.current,
          streaming: false,
          error: null,
        });
      },
      (err) => {
        analysisErrorRef.current = err;
        streamingRef.current = false;
        setAnalysisError(err);
        setStreaming(false);
        persistDraft({
          jobDescription: jobDescriptionRef.current,
          analysis: analysisRef.current,
          streaming: false,
          error: err,
        });
      },
      controller.signal,
    );
  };

  const handleStop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    streamingRef.current = false;
    setStreaming(false);
    persistDraft({
      jobDescription: jobDescriptionRef.current,
      analysis: analysisRef.current,
      streaming: false,
      error: analysisErrorRef.current,
    });
  };

  const handleSaveAnalysis = async () => {
    if (!analysis || saving) return;
    setSaving(true);
    try {
      const saved = await saveCvAnalysis(analysis, jobDescription);
      setSavedAnalyses((prev) => [saved, ...prev]);
      setSavedMsg(true);
      emitAppEvent(CV_ANALYSES_CHANGED_EVENT);
      setTimeout(() => setSavedMsg(false), 2000);
    } catch {
      // non-critical
    } finally {
      setSaving(false);
    }
  };

  const handleStartDeleteAnalysis = (id: string) => {
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    setConfirmingDeleteId(id);
    confirmTimerRef.current = setTimeout(() => {
      setConfirmingDeleteId(null);
    }, 3000);
  };

  const handleCancelDeleteAnalysis = () => {
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    setConfirmingDeleteId(null);
  };

  const handleConfirmDeleteAnalysis = async (id: string) => {
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    setConfirmingDeleteId(null);
    try {
      await deleteCvAnalysis(id);
      setSavedAnalyses((prev) => prev.filter((a) => a.id !== id));
      emitAppEvent(CV_ANALYSES_CHANGED_EVENT);
    } catch {
      // non-critical
    }
  };

  const jdAdjustHeight = useCallback((el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  const wordCount = cvText.trim() ? cvText.trim().split(/\s+/).length : 0;

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
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 transition-colors",
            dragOver ? "border-primary bg-primary/10" : "border-border hover:border-primary/50 hover:bg-muted/20"
          )}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          />
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

        {/* PDF metadata */}
        {(cvFilename || cvUploadedAt) && (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
            <svg className="h-4 w-4 shrink-0 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            {cvFilename && <span className="font-medium text-foreground">{cvFilename}</span>}
            {cvFilename && cvUploadedAt && <span className="text-border">|</span>}
            {cvUploadedAt && <span>Uploaded {formatDate(cvUploadedAt)}</span>}
          </div>
        )}

        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <div className="flex-1 border-t border-border" />
          <span>or paste / edit below</span>
          <div className="flex-1 border-t border-border" />
        </div>

        {/* Toggle show CV text */}
        <div className="flex items-center justify-between">
          <button
            onClick={() => setShowCvText((v) => !v)}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            {showCvText ? "Hide extracted text ▲" : "Show extracted text ▼"}
          </button>
          {wordCount > 0 && (
            <span className="text-xs text-muted-foreground">{wordCount} words</span>
          )}
        </div>

        {/* Text editor — shown when toggled or if no PDF uploaded */}
        {showCvText && (
          <>
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
          </>
        )}

        {/* Show minimal fallback if no PDF and text is hidden */}
        {!showCvText && !cvFilename && !cvLoading && (
            <div className="rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground/70 italic text-center">
              No CV saved yet — upload a PDF or click &ldquo;Show extracted text&rdquo; to paste manually.
            </div>
        )}

        {cvError && <p className="text-xs text-destructive">{cvError}</p>}

        {showCvText && (
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              {wordCount > 0 ? `${wordCount} words` : "No CV saved yet"}
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
                      setCvFilename(null);
                      setCvUploadedAt(null);
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
        )}
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
          onChange={(e) => {
            const next = e.target.value;
            setJobDescription(next);
            jobDescriptionRef.current = next;
            persistDraft({
              jobDescription: next,
              analysis: analysisRef.current,
              streaming: streamingRef.current,
              error: analysisErrorRef.current,
            });
            jdAdjustHeight(e.target);
          }}
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
          </div>
        )}

        {/* Save analysis button — shown once analysis is complete */}
        {analysis && !streaming && (
          <div className="flex items-center gap-3">
            {!savedMsg && (
              <button
                onClick={handleSaveAnalysis}
                disabled={saving}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              >
                {saving ? "Saving..." : "Save Analysis"}
              </button>
            )}
            {savedMsg && (
              <span className="text-sm font-medium text-green-500">Saved!</span>
            )}
          </div>
        )}
      </div>

      {/* Saved Analyses Section */}
      {savedAnalyses.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-5 space-y-3">
          <h2 className="text-base font-semibold">Saved Analyses</h2>
          <div className="space-y-2">
            {savedAnalyses.map((a) => {
              const isConfirming = confirmingDeleteId === a.id;
              return (
                <div key={a.id} className="rounded-lg border border-border overflow-hidden">
                  <div className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/20">
                    <Link href={`/profile/analyses/${a.id}`} className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{a.title}</p>
                      <p className="text-xs text-muted-foreground">{formatDate(a.created_at)}</p>
                    </Link>
                    <div className="flex items-center gap-1 shrink-0">
                      {isConfirming ? (
                        <>
                          <button
                            onClick={handleCancelDeleteAnalysis}
                            title="Cancel"
                            className="rounded p-1 text-muted-foreground hover:text-foreground transition-colors"
                          >
                            ✕
                          </button>
                          <button
                            onClick={() => handleConfirmDeleteAnalysis(a.id)}
                            title="Confirm delete"
                            className="rounded p-1 text-destructive hover:text-destructive/80 transition-colors"
                          >
                            ✓
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => handleStartDeleteAnalysis(a.id)}
                          title="Delete analysis"
                          className="rounded p-1 text-muted-foreground/40 hover:text-destructive transition-colors"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
