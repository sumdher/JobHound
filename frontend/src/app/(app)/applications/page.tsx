/**
 * Applications list page for JobHound.
 * Displays a searchable, filterable, paginated table of all job applications.
 * Supports filtering by status and source, sorting, and inline deletion.
 */

"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  listApplications,
  deleteApplication,
  updateApplication,
  type Application,
  type ApplicationFilters,
} from "@/lib/api";
import { cn, formatDate, STATUS_COLORS, STATUS_LABELS } from "@/lib/utils";

const PAGE_SIZE = 20;

const SORT_OPTIONS = [
  { value: "date_applied_desc", label: "Date Applied (Newest)" },
  { value: "date_applied_asc", label: "Date Applied (Oldest)" },
  { value: "company_asc", label: "Company (A–Z)" },
  { value: "company_desc", label: "Company (Z–A)" },
];

const ALL_STATUSES = [
  "applied",
  "screening",
  "interview_scheduled",
  "interviewing",
  "offer",
  "rejected",
  "ghosted",
  "withdrawn",
];

const COMMON_SOURCES = [
  "LinkedIn",
  "Indeed",
  "Glassdoor",
  "Company Website",
  "Referral",
  "Other",
];

// ── Skill Pills ───────────────────────────────────────────────────────────────

function SkillPills({ skills }: { skills: string[] }) {
  const visible = skills.slice(0, 3);
  const extra = skills.length - 3;
  return (
    <div className="flex flex-wrap gap-1">
      {visible.map((s) => (
        <span
          key={s}
          className="rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground"
        >
          {s}
        </span>
      ))}
      {extra > 0 && (
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          +{extra}
        </span>
      )}
    </div>
  );
}

// ── Inline Status Select ──────────────────────────────────────────────────────

// Inline styles needed — browsers ignore Tailwind bg-* on native <select>
const STATUS_STYLES: Record<string, { bg: string; color: string; border: string }> = {
  applied:             { bg: "rgba(59,130,246,0.2)",  color: "#60a5fa", border: "rgba(59,130,246,0.35)" },
  screening:           { bg: "rgba(168,85,247,0.2)",  color: "#c084fc", border: "rgba(168,85,247,0.35)" },
  interview_scheduled: { bg: "rgba(234,179,8,0.2)",   color: "#facc15", border: "rgba(234,179,8,0.35)" },
  interviewing:        { bg: "rgba(249,115,22,0.2)",  color: "#fb923c", border: "rgba(249,115,22,0.35)" },
  offer:               { bg: "rgba(34,197,94,0.2)",   color: "#4ade80", border: "rgba(34,197,94,0.35)" },
  rejected:            { bg: "rgba(239,68,68,0.2)",   color: "#f87171", border: "rgba(239,68,68,0.35)" },
  ghosted:             { bg: "rgba(107,114,128,0.2)", color: "#9ca3af", border: "rgba(107,114,128,0.35)" },
  withdrawn:           { bg: "rgba(107,114,128,0.2)", color: "#9ca3af", border: "rgba(107,114,128,0.35)" },
};

function StatusSelect({
  status,
  updating,
  onChange,
}: {
  status: string;
  updating: boolean;
  onChange: (v: string) => void;
}) {
  const s = STATUS_STYLES[status] ?? { bg: "rgba(107,114,128,0.2)", color: "#9ca3af", border: "rgba(107,114,128,0.35)" };
  return (
    <select
      value={status}
      disabled={updating}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-full border px-2.5 py-0.5 pr-6 text-xs font-medium cursor-pointer appearance-none focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60 disabled:cursor-wait"
      style={{
        backgroundColor: s.bg,
        color: s.color,
        borderColor: s.border,
        backgroundImage: updating
          ? "none"
          : `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='${encodeURIComponent(s.color)}'/%3E%3C/svg%3E")`,
        backgroundRepeat: "no-repeat",
        backgroundPosition: "right 6px center",
        backgroundSize: "8px",
      }}
    >
      {ALL_STATUSES.map((opt) => (
        <option key={opt} value={opt} style={{ backgroundColor: "#1e293b", color: "#e2e8f0" }}>
          {STATUS_LABELS[opt] ?? opt}
        </option>
      ))}
    </select>
  );
}

// ── Select ────────────────────────────────────────────────────────────────────

function Select({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

// ── Delete Confirmation — shared between card + table view ───────────────────

function DeleteConfirmInline({
  app,
  onConfirm,
  onCancel,
}: {
  app: Application;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
      <p className="text-sm text-foreground mb-3">
        Delete <strong>{app.company}</strong> — {app.job_title}?
      </p>
      <div className="flex gap-2">
        <button
          onClick={onConfirm}
          className="rounded bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:opacity-90"
        >
          Delete
        </button>
        <button
          onClick={onCancel}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ApplicationsPage() {
  const router = useRouter();
  const [applications, setApplications] = useState<Application[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [sortOption, setSortOption] = useState("date_applied_desc");

  // Pending delete
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Inline status editing
  const [statusUpdating, setStatusUpdating] = useState<Set<string>>(new Set());

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [sortBy, sortOrder] = sortOption.includes("_desc")
        ? [sortOption.replace("_desc", ""), "desc" as const]
        : [sortOption.replace("_asc", ""), "asc" as const];

      const filters: ApplicationFilters = {
        page,
        page_size: PAGE_SIZE,
        search: search || undefined,
        status: statusFilter || undefined,
        source: sourceFilter || undefined,
        sort_by: sortBy,
        sort_order: sortOrder,
      };

      const res = await listApplications(filters);
      setApplications(res.items);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load applications");
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter, sourceFilter, sortOption]);

  useEffect(() => {
    void load();
  }, [load]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, sourceFilter, sortOption]);

  async function handleStatusChange(id: string, newStatus: string) {
    setStatusUpdating((s) => new Set(s).add(id));
    // Optimistic update
    setApplications((prev) =>
      prev.map((a) => (a.id === id ? { ...a, status: newStatus } : a))
    );
    try {
      await updateApplication(id, { status: newStatus });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Status update failed");
      // Revert on failure
      void load();
    } finally {
      setStatusUpdating((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
    }
  }

  async function handleDelete(id: string) {
    setDeleting(true);
    try {
      await deleteApplication(id);
      setPendingDelete(null);
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Applications</h1>
          <p className="text-sm text-muted-foreground">
            {total} application{total !== 1 ? "s" : ""} total
          </p>
        </div>
        <Link
          href="/applications/new"
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity"
        >
          + New Application
        </Link>
      </div>

      {/* Search + Filters */}
      <div className="flex flex-wrap gap-3">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px]">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            type="text"
            placeholder="Search company, role, skills..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-border bg-card pl-9 pr-4 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <Select
          value={statusFilter}
          onChange={setStatusFilter}
          placeholder="All Statuses"
          options={ALL_STATUSES.map((s) => ({
            value: s,
            label: STATUS_LABELS[s] ?? s,
          }))}
        />

        <Select
          value={sourceFilter}
          onChange={setSourceFilter}
          placeholder="All Sources"
          options={COMMON_SOURCES.map((s) => ({ value: s, label: s }))}
        />

        <Select
          value={sortOption}
          onChange={setSortOption}
          placeholder="Sort by"
          options={SORT_OPTIONS}
        />
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* ── Mobile card list (hidden on md+) ─────────────────────────────────── */}
      <div className="md:hidden space-y-3">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-border bg-card p-4 space-y-3">
              <div className="h-4 w-1/2 animate-pulse rounded bg-muted/50" />
              <div className="h-3 w-3/4 animate-pulse rounded bg-muted/50" />
              <div className="h-3 w-1/3 animate-pulse rounded bg-muted/50" />
            </div>
          ))
        ) : applications.length === 0 ? (
          <div className="py-16 text-center text-muted-foreground">
            <span className="text-3xl">📭</span>
            <p className="mt-2">No applications found</p>
            <Link href="/applications/new" className="text-primary hover:underline text-sm">
              Add your first application
            </Link>
          </div>
        ) : (
          applications.map((app) => (
            <div key={app.id}>
              {pendingDelete === app.id ? (
                <DeleteConfirmInline
                  app={app}
                  onConfirm={() => handleDelete(app.id)}
                  onCancel={() => setPendingDelete(null)}
                />
              ) : (
                <div
                  className="rounded-xl border border-border bg-card p-4 space-y-3 cursor-pointer hover:bg-muted/20 transition-colors active:scale-[0.99]"
                  onClick={() => router.push(`/applications/${app.id}`)}
                >
                  {/* Top row: company + status */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-foreground truncate">{app.company}</p>
                      <p className="text-sm text-muted-foreground truncate">{app.job_title}</p>
                    </div>
                    <div onClick={(e) => e.stopPropagation()}>
                      <StatusSelect
                        status={app.status}
                        updating={statusUpdating.has(app.id)}
                        onChange={(v) => handleStatusChange(app.id, v)}
                      />
                    </div>
                  </div>

                  {/* Meta row */}
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span>{formatDate(app.date_applied)}</span>
                    {app.source && <span className="capitalize">{app.source}</span>}
                    {app.location && <span>{app.location}</span>}
                  </div>

                  {/* Skills */}
                  {app.skills.length > 0 && <SkillPills skills={app.skills} />}

                  {/* Actions */}
                  <div
                    className="flex items-center gap-4 pt-1 text-sm"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Link href={`/applications/${app.id}`} className="text-primary hover:underline">
                      Edit
                    </Link>
                    <button
                      onClick={() => setPendingDelete(app.id)}
                      className="text-destructive hover:opacity-80"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* ── Desktop table (hidden on mobile) ─────────────────────────────────── */}
      <div className="hidden md:block rounded-lg border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Company</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Role</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Date Applied</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground hidden lg:table-cell">Source</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground hidden lg:table-cell">Location</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground hidden lg:table-cell">Skills</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="border-b border-border">
                    {Array.from({ length: 8 }).map((__, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 animate-pulse rounded bg-muted/50" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : applications.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-16 text-center text-muted-foreground">
                    <div className="flex flex-col items-center gap-2">
                      <span className="text-3xl">📭</span>
                      <p>No applications found</p>
                      <Link href="/applications/new" className="text-primary hover:underline text-sm">
                        Add your first application
                      </Link>
                    </div>
                  </td>
                </tr>
              ) : (
                applications.flatMap((app) => {
                  const rows = [
                    <tr
                      key={app.id}
                      className="border-b border-border hover:bg-muted/20 transition-colors cursor-pointer"
                      onClick={() => router.push(`/applications/${app.id}`)}
                    >
                      <td className="px-4 py-3 font-medium text-foreground">{app.company}</td>
                      <td className="px-4 py-3 text-muted-foreground">{app.job_title}</td>
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <StatusSelect
                          status={app.status}
                          updating={statusUpdating.has(app.id)}
                          onChange={(v) => handleStatusChange(app.id, v)}
                        />
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{formatDate(app.date_applied)}</td>
                      <td className="px-4 py-3 text-muted-foreground hidden lg:table-cell">{app.source ?? "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground hidden lg:table-cell">{app.location ?? "—"}</td>
                      <td className="px-4 py-3 hidden lg:table-cell"><SkillPills skills={app.skills} /></td>
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-2">
                          <Link href={`/applications/${app.id}`} className="text-primary hover:underline">Edit</Link>
                          <button onClick={() => setPendingDelete(app.id)} className="text-destructive hover:opacity-80">Delete</button>
                        </div>
                      </td>
                    </tr>,
                  ];

                  if (pendingDelete === app.id) {
                    rows.push(
                      <tr key={`${app.id}-confirm`} className="bg-destructive/10">
                        <td colSpan={8} className="px-4 py-3">
                          <div className="flex items-center gap-4 text-sm">
                            <span>Delete <strong>{app.company}</strong> — {app.job_title}?</span>
                            <button onClick={() => handleDelete(app.id)} className="rounded bg-destructive px-3 py-1 text-xs font-medium text-destructive-foreground hover:opacity-90">Delete</button>
                            <button onClick={() => setPendingDelete(null)} className="text-muted-foreground hover:text-foreground">Cancel</button>
                          </div>
                        </td>
                      </tr>
                    );
                  }

                  return rows;
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {!loading && total > PAGE_SIZE && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="rounded-lg border border-border px-3 py-1.5 text-sm disabled:opacity-40 hover:bg-muted/30 transition-colors"
            >
              Previous
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || deleting}
              className="rounded-lg border border-border px-3 py-1.5 text-sm disabled:opacity-40 hover:bg-muted/30 transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
