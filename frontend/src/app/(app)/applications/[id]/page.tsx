/**
 * Application detail page for JobHound.
 * Displays all information for a single job application, including a vertical
 * status timeline derived from status_history. Supports inline editing of all
 * fields via the updateApplication API, skills management, and deletion with a
 * confirmation step.
 */

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useParams } from "next/navigation";
import {
  getApplication,
  updateApplication,
  deleteApplication,
  type Application,
  type StatusHistory,
} from "@/lib/api";
import {
  cn,
  formatDate,
  formatSalary,
  STATUS_LABELS,
  STATUS_COLORS,
} from "@/lib/utils";

// ── Constants ─────────────────────────────────────────────────────────────────

const SOURCES = [
  "LinkedIn",
  "Indeed",
  "Glassdoor",
  "Company Website",
  "Referral",
  "Recruiter",
  "Other",
];

const WORK_MODES = ["remote", "hybrid", "onsite"];

const STATUSES = [
  "applied",
  "screening",
  "interview_scheduled",
  "interviewing",
  "offer",
  "rejected",
  "ghosted",
  "withdrawn",
];

// ── Edit State type ───────────────────────────────────────────────────────────

interface EditState {
  company: string;
  job_title: string;
  date_applied: string;
  source: string;
  status: string;
  location: string;
  work_mode: string;
  whats_in_it_for_me: string;
  salary_min: string;
  salary_max: string;
  salary_currency: string;
  job_url: string;
  cv_link: string;
  cl_link: string;
  notes: string;
  rejection_reason: string;
  skills: string[];
}

function toEditState(app: Application): EditState {
  return {
    company: app.company,
    job_title: app.job_title,
    date_applied: app.date_applied?.slice(0, 10) ?? "",
    source: app.source ?? "",
    status: app.status,
    location: app.location ?? "",
    work_mode: app.work_mode ?? "",
    whats_in_it_for_me: app.whats_in_it_for_me ?? "",
    salary_min: app.salary_min != null ? String(Math.round(app.salary_min / 100)) : "",
    salary_max: app.salary_max != null ? String(Math.round(app.salary_max / 100)) : "",
    salary_currency: app.salary_currency ?? "EUR",
    job_url: app.job_url ?? "",
    cv_link: app.cv_link ?? "",
    cl_link: app.cl_link ?? "",
    notes: app.notes ?? "",
    rejection_reason: app.rejection_reason ?? "",
    skills: [...app.skills],
  };
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const color =
    STATUS_COLORS[status] ?? "bg-muted text-muted-foreground border-border";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
        color
      )}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

function SectionCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <h2 className="mb-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-4">
      <span className="w-32 shrink-0 text-sm text-muted-foreground">{label}</span>
      <span className="text-sm text-foreground">{children}</span>
    </div>
  );
}

function ExternalLink({ href, label }: { href?: string; label: string }) {
  if (!href) return <span className="text-muted-foreground">—</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary underline-offset-2 hover:underline break-all"
    >
      {label} ↗
    </a>
  );
}

function EditInput({
  value,
  onChange,
  type = "text",
  placeholder,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  className?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={cn(
        "rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring",
        className
      )}
    />
  );
}

function EditSelect({
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
      className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
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

// ── Skills Editor ─────────────────────────────────────────────────────────────

function SkillsEditor({
  skills,
  onChange,
}: {
  skills: string[];
  onChange: (s: string[]) => void;
}) {
  const [input, setInput] = useState("");

  function addSkill() {
    const t = input.trim();
    if (t && !skills.includes(t)) onChange([...skills, t]);
    setInput("");
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {skills.map((s) => (
          <span
            key={s}
            className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground"
          >
            {s}
            <button
              type="button"
              onClick={() => onChange(skills.filter((x) => x !== s))}
              className="text-muted-foreground hover:text-foreground ml-0.5"
              aria-label={`Remove ${s}`}
            >
              ×
            </button>
          </span>
        ))}
        {skills.length === 0 && (
          <span className="text-xs text-muted-foreground">No skills added yet</span>
        )}
      </div>
      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              addSkill();
            }
          }}
          placeholder="Add skill (Enter or comma to confirm)"
          className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <button
          type="button"
          onClick={addSkill}
          className="rounded-lg bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground hover:opacity-80 transition-opacity"
        >
          Add
        </button>
      </div>
    </div>
  );
}

// ── Status Timeline ───────────────────────────────────────────────────────────

function StatusTimeline({ history }: { history: StatusHistory[] }) {
  if (history.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No status changes recorded yet.
      </p>
    );
  }

  return (
    <ol className="relative ml-3 border-l border-border space-y-6">
      {history.map((entry, i) => (
        <li key={entry.id} className="ml-6">
          <span className="absolute -left-[11px] flex h-5 w-5 items-center justify-center rounded-full border border-border bg-card">
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                i === history.length - 1 ? "bg-primary" : "bg-muted-foreground"
              )}
            />
          </span>
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              {entry.from_status && (
                <>
                  <StatusBadge status={entry.from_status} />
                  <svg
                    className="h-3 w-3 text-muted-foreground"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 5l7 7-7 7"
                    />
                  </svg>
                </>
              )}
              <StatusBadge status={entry.to_status} />
              {i === history.length - 1 && (
                <span className="rounded-full bg-primary/20 px-2 py-0.5 text-xs text-primary">
                  Current
                </span>
              )}
            </div>
            <time className="block text-xs text-muted-foreground">
              {formatDate(entry.changed_at)}
            </time>
            {entry.notes && (
              <p className="text-xs text-muted-foreground">{entry.notes}</p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ApplicationDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const [app, setApp] = useState<Application | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const data = await getApplication(params.id);
        setApp(data);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load application"
        );
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [params.id]);

  function startEdit() {
    if (!app) return;
    setEditState(toEditState(app));
    setSaveError(null);
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setEditState(null);
    setSaveError(null);
  }

  async function saveEdit() {
    if (!editState || !app) return;
    setSaving(true);
    setSaveError(null);
    try {
      const payload: Record<string, unknown> = {
        company: editState.company,
        job_title: editState.job_title,
        date_applied: editState.date_applied || null,
        source: editState.source || null,
        status: editState.status,
        location: editState.location || null,
        work_mode: editState.work_mode || null,
        whats_in_it_for_me: editState.whats_in_it_for_me || null,
        salary_min: editState.salary_min ? Math.round(Number(editState.salary_min) * 100) : null,
        salary_max: editState.salary_max ? Math.round(Number(editState.salary_max) * 100) : null,
        salary_currency: editState.salary_currency || "EUR",
        job_url: editState.job_url || null,
        cv_link: editState.cv_link || null,
        cl_link: editState.cl_link || null,
        notes: editState.notes || null,
        rejection_reason: editState.rejection_reason || null,
        skills: editState.skills,
      };
      const updated = await updateApplication(app.id, payload);
      setApp(updated);
      setEditing(false);
      setEditState(null);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!app) return;
    setDeleting(true);
    try {
      await deleteApplication(app.id);
      router.push("/applications");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  function setField<K extends keyof Omit<EditState, "skills">>(
    field: K,
    value: EditState[K]
  ) {
    setEditState((prev) => (prev ? { ...prev, [field]: value } : prev));
  }

  // ── Loading skeleton ───────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="h-5 w-40 animate-pulse rounded bg-muted/50" />
        <div className="h-8 w-72 animate-pulse rounded bg-muted/50" />
        <div className="h-5 w-48 animate-pulse rounded bg-muted/50" />
        <div className="rounded-lg border border-border bg-card p-5 space-y-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-5 animate-pulse rounded bg-muted/50"
              style={{ width: `${50 + (i % 4) * 12}%` }}
            />
          ))}
        </div>
      </div>
    );
  }

  if (error || !app) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <Link
          href="/applications"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          ← Back to Applications
        </Link>
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {error ?? "Application not found"}
        </div>
      </div>
    );
  }

  const es = editState;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Back */}
      <Link
        href="/applications"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <svg
          className="h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 19l-7-7 7-7"
          />
        </svg>
        Back to Applications
      </Link>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          {editing && es ? (
            <>
              <EditInput
                value={es.company}
                onChange={(v) => setField("company", v)}
                placeholder="Company"
                className="text-xl font-bold w-full sm:w-80"
              />
              <EditInput
                value={es.job_title}
                onChange={(v) => setField("job_title", v)}
                placeholder="Job Title"
                className="w-full sm:w-80"
              />
            </>
          ) : (
            <>
              <h1 className="text-2xl font-bold text-foreground">
                {app.company}
              </h1>
              <p className="text-base text-muted-foreground">{app.job_title}</p>
            </>
          )}
          <div className="pt-1">
            {editing && es ? (
              <EditSelect
                value={es.status}
                onChange={(v) => setField("status", v)}
                options={STATUSES.map((s) => ({
                  value: s,
                  label: STATUS_LABELS[s] ?? s,
                }))}
                placeholder="Status"
              />
            ) : (
              <StatusBadge status={app.status} />
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {editing ? (
            <>
              <button
                onClick={saveEdit}
                disabled={saving}
                className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {saving && (
                  <svg
                    className="h-4 w-4 animate-spin"
                    viewBox="0 0 24 24"
                    fill="none"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8v8z"
                    />
                  </svg>
                )}
                Save Changes
              </button>
              <button
                onClick={cancelEdit}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                onClick={startEdit}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted/30 transition-colors"
              >
                Edit
              </button>
              {confirmDelete ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">
                    Are you sure?
                  </span>
                  <button
                    onClick={handleDelete}
                    disabled={deleting}
                    className="rounded-lg bg-destructive px-3 py-2 text-xs font-medium text-destructive-foreground hover:opacity-80 disabled:opacity-50 transition-opacity"
                  >
                    {deleting ? "Deleting..." : "Yes, delete"}
                  </button>
                  <button
                    onClick={() => setConfirmDelete(false)}
                    className="text-sm text-muted-foreground hover:text-foreground"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="rounded-lg border border-destructive/40 px-4 py-2 text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors"
                >
                  Delete
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Save error */}
      {saveError && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {saveError}
        </div>
      )}

      {/* Details card */}
      <SectionCard title="Details">
        <DetailRow label="Date Applied">
          {editing && es ? (
            <EditInput
              type="date"
              value={es.date_applied}
              onChange={(v) => setField("date_applied", v)}
            />
          ) : (
            formatDate(app.date_applied)
          )}
        </DetailRow>
        <DetailRow label="Source">
          {editing && es ? (
            <EditSelect
              value={es.source}
              onChange={(v) => setField("source", v)}
              options={SOURCES.map((s) => ({ value: s, label: s }))}
              placeholder="Select source"
            />
          ) : (
            app.source ?? "—"
          )}
        </DetailRow>
        <DetailRow label="Location">
          {editing && es ? (
            <EditInput
              value={es.location}
              onChange={(v) => setField("location", v)}
              placeholder="City, Country"
            />
          ) : (
            app.location ?? "—"
          )}
        </DetailRow>
        <DetailRow label="Work Mode">
          {editing && es ? (
            <EditSelect
              value={es.work_mode}
              onChange={(v) => setField("work_mode", v)}
              options={WORK_MODES.map((m) => ({
                value: m,
                label: m.charAt(0).toUpperCase() + m.slice(1),
              }))}
              placeholder="Select work mode"
            />
          ) : app.work_mode ? (
            app.work_mode.charAt(0).toUpperCase() + app.work_mode.slice(1)
          ) : (
            "—"
          )}
        </DetailRow>
        <DetailRow label="Job URL">
          {editing && es ? (
            <EditInput
              value={es.job_url}
              onChange={(v) => setField("job_url", v)}
              placeholder="https://..."
              className="w-full sm:w-80"
            />
          ) : (
            <ExternalLink href={app.job_url} label="View posting" />
          )}
        </DetailRow>
        <DetailRow label="CV">
          {editing && es ? (
            <EditInput
              value={es.cv_link}
              onChange={(v) => setField("cv_link", v)}
              placeholder="https://..."
              className="w-full sm:w-80"
            />
          ) : (
            <ExternalLink href={app.cv_link} label="View CV" />
          )}
        </DetailRow>
        <DetailRow label="Cover Letter">
          {editing && es ? (
            <EditInput
              value={es.cl_link}
              onChange={(v) => setField("cl_link", v)}
              placeholder="https://..."
              className="w-full sm:w-80"
            />
          ) : (
            <ExternalLink href={app.cl_link} label="View cover letter" />
          )}
        </DetailRow>
      </SectionCard>

      {/* Salary */}
      {(app.salary_min != null || app.salary_max != null || editing) && (
        <SectionCard title="Salary">
          {editing && es ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className="block text-xs text-muted-foreground mb-1">
                  Min ({es.salary_currency || "EUR"})
                </label>
                <EditInput
                  type="number"
                  value={es.salary_min}
                  onChange={(v) => setField("salary_min", v)}
                  placeholder="e.g. 80000"
                  className="w-full"
                />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">
                  Max ({es.salary_currency || "EUR"})
                </label>
                <EditInput
                  type="number"
                  value={es.salary_max}
                  onChange={(v) => setField("salary_max", v)}
                  placeholder="e.g. 100000"
                  className="w-full"
                />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">
                  Currency
                </label>
                <EditInput
                  value={es.salary_currency}
                  onChange={(v) => setField("salary_currency", v)}
                  placeholder="EUR"
                  className="w-full"
                />
              </div>
            </div>
          ) : (
            <p className="text-sm text-foreground">
              {formatSalary(
                app.salary_min,
                app.salary_currency,
                app.salary_period
              )}
              {app.salary_max != null &&
                app.salary_max !== app.salary_min && (
                  <>
                    {" "}–{" "}
                    {formatSalary(
                      app.salary_max,
                      app.salary_currency,
                      app.salary_period
                    )}
                  </>
                )}
            </p>
          )}
        </SectionCard>
      )}

      {/* What's in it for me */}
      {(app.whats_in_it_for_me || editing) && (
        <SectionCard title="What's In It For Me">
          {editing && es ? (
            <textarea
              value={es.whats_in_it_for_me}
              onChange={(e) => setField("whats_in_it_for_me", e.target.value)}
              rows={4}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-y"
            />
          ) : (
            <p className="text-sm text-foreground whitespace-pre-wrap">
              {app.whats_in_it_for_me}
            </p>
          )}
        </SectionCard>
      )}

      {/* Notes */}
      {(app.notes || editing) && (
        <SectionCard title="Notes">
          {editing && es ? (
            <textarea
              value={es.notes}
              onChange={(e) => setField("notes", e.target.value)}
              rows={4}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-y"
            />
          ) : (
            <p className="text-sm text-foreground whitespace-pre-wrap">
              {app.notes}
            </p>
          )}
        </SectionCard>
      )}

      {/* Rejection Reason */}
      {(app.status === "rejected" || editing) && (
        <SectionCard title="Rejection Reason">
          {editing && es ? (
            <textarea
              value={es.rejection_reason}
              onChange={(e) => setField("rejection_reason", e.target.value)}
              rows={3}
              placeholder="Why was this application rejected? (no feedback, skills mismatch, etc.)"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-y"
            />
          ) : app.rejection_reason ? (
            <p className="text-sm text-foreground whitespace-pre-wrap">
              {app.rejection_reason}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">No rejection reason recorded.</p>
          )}
        </SectionCard>
      )}

      {/* Skills */}
      <SectionCard title="Skills">
        {editing && es ? (
          <SkillsEditor
            skills={es.skills}
            onChange={(s) =>
              setEditState((prev) => (prev ? { ...prev, skills: s } : prev))
            }
          />
        ) : app.skills.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {app.skills.map((skill) => (
              <span
                key={skill}
                className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground"
              >
                {skill}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No skills listed.</p>
        )}
      </SectionCard>

      {/* Status Timeline */}
      <SectionCard title="Status History">
        <StatusTimeline history={app.status_history} />
      </SectionCard>
    </div>
  );
}
