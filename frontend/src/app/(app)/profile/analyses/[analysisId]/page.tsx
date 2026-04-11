"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { getCvAnalysis, type CvAnalysis } from "@/lib/api";

function inlineMarkdown(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={i} className="rounded bg-black/20 px-1 py-0.5 text-xs font-mono">{part.slice(1, -1)}</code>;
    if (part.startsWith("*") && part.endsWith("*")) return <em key={i}>{part.slice(1, -1)}</em>;
    return part;
  });
}

function parseTableRow(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
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
    listItems = [];
    listType = null;
  };

  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("```")) {
      flushList();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
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
                  <th key={`th-${index}`} className="border-b border-border px-3 py-2 font-semibold" style={{ textAlign: alignments[index] ?? "left" }}>
                    {inlineMarkdown(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((row, rowIndex) => (
                <tr key={`tr-${rowIndex}`} className="odd:bg-background even:bg-muted/10">
                  {row.map((cell, cellIndex) => (
                    <td key={`td-${rowIndex}-${cellIndex}`} className="border-t border-border px-3 py-2 align-top" style={{ textAlign: alignments[cellIndex] ?? "left" }}>
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

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return iso;
  }
}

export default function SavedAnalysisPage() {
  const params = useParams<{ analysisId: string }>();
  const analysisId = typeof params.analysisId === "string" ? params.analysisId : "";
  const [analysis, setAnalysis] = useState<CvAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!analysisId) return;
    setLoading(true);
    getCvAnalysis(analysisId)
      .then((data) => {
        setAnalysis(data);
        setError("");
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Failed to load analysis");
      })
      .finally(() => setLoading(false));
  }, [analysisId]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!analysis) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <Link href="/profile" className="text-sm text-muted-foreground hover:text-foreground">← Back to My Profile</Link>
        <p className="text-sm text-destructive">{error || "Analysis not found"}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="space-y-2">
        <Link href="/profile" className="text-sm text-muted-foreground hover:text-foreground">← Back to My Profile</Link>
        <div>
          <h1 className="text-2xl font-bold">{analysis.title}</h1>
          <p className="text-sm text-muted-foreground">Saved {formatDate(analysis.created_at)}</p>
        </div>
      </div>

      <section className="rounded-xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-base font-semibold">Job Description</h2>
        <div className="rounded-lg border border-border bg-secondary/30 p-4 whitespace-pre-wrap text-sm leading-relaxed">
          {analysis.job_description?.trim() || "This saved analysis was created before job descriptions were stored."}
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-base font-semibold">Analysis</h2>
        <div className="rounded-lg border border-border bg-secondary/30 p-4">
          <Markdown content={analysis.content} />
        </div>
      </section>

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
