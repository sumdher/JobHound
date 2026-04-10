/**
 * New Application page for JobHound.
 * Provides two input modes: a Quick Input (AI-powered text parsing) tab and a
 * Manual Form tab. On Quick Input, raw text is sent to the backend LLM which
 * returns pre-filled fields; uncertain fields are highlighted in amber.
 * On save, the application is created via the API and the user is redirected
 * to the new application's detail page.
 */

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { parseApplication, createApplication } from "@/lib/api";
import { cn, STATUS_LABELS } from "@/lib/utils";

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

// ── Types ─────────────────────────────────────────────────────────────────────

interface FormData {
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
  raw_input: string;
}

const EMPTY_FORM: FormData = {
  company: "",
  job_title: "",
  date_applied: new Date().toISOString().slice(0, 10),
  source: "",
  status: "applied",
  location: "",
  work_mode: "",
  whats_in_it_for_me: "",
  salary_min: "",
  salary_max: "",
  salary_currency: "EUR",
  job_url: "",
  cv_link: "",
  cl_link: "",
  notes: "",
  raw_input: "",
};

// ── Sub-components ────────────────────────────────────────────────────────────

function Label({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="block text-sm font-medium text-foreground mb-1">
      {children}
      {required && <span className="ml-1 text-destructive">*</span>}
    </label>
  );
}

function Input({
  value,
  onChange,
  type = "text",
  placeholder,
  uncertain,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  uncertain?: boolean;
  className?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={cn(
        "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring",
        uncertain && "border-yellow-500/60 bg-yellow-500/10",
        className
      )}
    />
  );
}

function Textarea({
  value,
  onChange,
  placeholder,
  rows = 3,
  uncertain,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  uncertain?: boolean;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      className={cn(
        "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-y",
        uncertain && "border-yellow-500/60 bg-yellow-500/10"
      )}
    />
  );
}

function SelectInput({
  value,
  onChange,
  options,
  placeholder,
  uncertain,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder: string;
  uncertain?: boolean;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring",
        uncertain && "border-yellow-500/60 bg-yellow-500/10"
      )}
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

// ── Skills Section ────────────────────────────────────────────────────────────

function SkillsEditor({
  skills,
  onChange,
}: {
  skills: string[];
  onChange: (skills: string[]) => void;
}) {
  const [input, setInput] = useState("");

  function addSkill() {
    const trimmed = input.trim();
    if (trimmed && !skills.includes(trimmed)) {
      onChange([...skills, trimmed]);
    }
    setInput("");
  }

  function removeSkill(skill: string) {
    onChange(skills.filter((s) => s !== skill));
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2 min-h-[2rem]">
        {skills.map((skill) => (
          <span
            key={skill}
            className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground"
          >
            {skill}
            <button
              type="button"
              onClick={() => removeSkill(skill)}
              className="ml-0.5 text-muted-foreground hover:text-foreground transition-colors"
              aria-label={`Remove ${skill}`}
            >
              ×
            </button>
          </span>
        ))}
        {skills.length === 0 && (
          <span className="text-xs text-muted-foreground self-center">No skills added yet</span>
        )}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              addSkill();
            }
          }}
          placeholder="Add a skill (press Enter or comma)"
          className="flex-1 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <button
          type="button"
          onClick={addSkill}
          className="rounded-lg bg-secondary px-3 py-2 text-sm font-medium text-secondary-foreground hover:opacity-80 transition-opacity"
        >
          Add
        </button>
      </div>
    </div>
  );
}

// ── Application Form ──────────────────────────────────────────────────────────

function ApplicationForm({
  formData,
  skills,
  uncertainFields,
  onChange,
  onSkillsChange,
  onSubmit,
  saving,
  error,
}: {
  formData: FormData;
  skills: string[];
  uncertainFields: string[];
  onChange: (field: keyof FormData, value: string) => void;
  onSkillsChange: (skills: string[]) => void;
  onSubmit: () => void;
  saving: boolean;
  error: string | null;
}) {
  const isUncertain = (field: string) => uncertainFields.includes(field);

  return (
    <div className="space-y-6">
      {uncertainFields.length > 0 && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-400">
          Fields highlighted in amber were uncertain — please review them before saving.
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Core fields */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label required>Company</Label>
          <Input
            value={formData.company}
            onChange={(v) => onChange("company", v)}
            placeholder="Acme Corp"
            uncertain={isUncertain("company")}
          />
        </div>
        <div>
          <Label required>Job Title</Label>
          <Input
            value={formData.job_title}
            onChange={(v) => onChange("job_title", v)}
            placeholder="Senior Engineer"
            uncertain={isUncertain("job_title")}
          />
        </div>
        <div>
          <Label>Date Applied</Label>
          <Input
            type="date"
            value={formData.date_applied}
            onChange={(v) => onChange("date_applied", v)}
            uncertain={isUncertain("date_applied")}
          />
        </div>
        <div>
          <Label>Status</Label>
          <SelectInput
            value={formData.status}
            onChange={(v) => onChange("status", v)}
            placeholder="Select status"
            options={STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] ?? s }))}
            uncertain={isUncertain("status")}
          />
        </div>
        <div>
          <Label>Source</Label>
          <SelectInput
            value={formData.source}
            onChange={(v) => onChange("source", v)}
            placeholder="Where did you find this?"
            options={SOURCES.map((s) => ({ value: s, label: s }))}
            uncertain={isUncertain("source")}
          />
        </div>
        <div>
          <Label>Location</Label>
          <Input
            value={formData.location}
            onChange={(v) => onChange("location", v)}
            placeholder="Berlin, Germany"
            uncertain={isUncertain("location")}
          />
        </div>
        <div>
          <Label>Work Mode</Label>
          <SelectInput
            value={formData.work_mode}
            onChange={(v) => onChange("work_mode", v)}
            placeholder="Select work mode"
            options={WORK_MODES.map((m) => ({ value: m, label: m.charAt(0).toUpperCase() + m.slice(1) }))}
            uncertain={isUncertain("work_mode")}
          />
        </div>
        <div>
          <Label>Job URL</Label>
          <Input
            value={formData.job_url}
            onChange={(v) => onChange("job_url", v)}
            placeholder="https://..."
            uncertain={isUncertain("job_url")}
          />
        </div>
      </div>

      {/* Salary */}
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-3">Salary</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <Label>Min ({formData.salary_currency || "EUR"})</Label>
            <Input
              type="number"
              value={formData.salary_min}
              onChange={(v) => onChange("salary_min", v)}
              placeholder="e.g. 80000"
              uncertain={isUncertain("salary_min")}
            />
          </div>
          <div>
            <Label>Max ({formData.salary_currency || "EUR"})</Label>
            <Input
              type="number"
              value={formData.salary_max}
              onChange={(v) => onChange("salary_max", v)}
              placeholder="e.g. 100000"
              uncertain={isUncertain("salary_max")}
            />
          </div>
          <div>
            <Label>Currency</Label>
            <Input
              value={formData.salary_currency}
              onChange={(v) => onChange("salary_currency", v)}
              placeholder="EUR"
              uncertain={isUncertain("salary_currency")}
            />
          </div>
        </div>
      </div>

      {/* Links */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label>CV Link</Label>
          <Input
            value={formData.cv_link}
            onChange={(v) => onChange("cv_link", v)}
            placeholder="https://..."
            uncertain={isUncertain("cv_link")}
          />
        </div>
        <div>
          <Label>Cover Letter Link</Label>
          <Input
            value={formData.cl_link}
            onChange={(v) => onChange("cl_link", v)}
            placeholder="https://..."
            uncertain={isUncertain("cl_link")}
          />
        </div>
      </div>

      {/* What's in it for me */}
      <div>
        <Label>What&apos;s In It For Me</Label>
        <Textarea
          value={formData.whats_in_it_for_me}
          onChange={(v) => onChange("whats_in_it_for_me", v)}
          placeholder="Why are you excited about this role?"
          rows={3}
          uncertain={isUncertain("whats_in_it_for_me")}
        />
      </div>

      {/* Notes */}
      <div>
        <Label>Notes</Label>
        <Textarea
          value={formData.notes}
          onChange={(v) => onChange("notes", v)}
          placeholder="Any additional notes..."
          rows={3}
          uncertain={isUncertain("notes")}
        />
      </div>

      {/* Skills */}
      <div>
        <Label>Skills</Label>
        <SkillsEditor skills={skills} onChange={onSkillsChange} />
      </div>

      {/* Submit */}
      <div className="flex justify-end pt-2">
        <button
          type="button"
          onClick={onSubmit}
          disabled={saving}
          className="flex items-center gap-2 rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {saving && (
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
            </svg>
          )}
          Save Application
        </button>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function NewApplicationPage() {
  const router = useRouter();
  const [tab, setTab] = useState<"quick" | "manual">("quick");

  // Quick input state
  const [rawText, setRawText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [parsed, setParsed] = useState(false);

  // Form state
  const [formData, setFormData] = useState<FormData>(EMPTY_FORM);
  const [skills, setSkills] = useState<string[]>([]);
  const [uncertainFields, setUncertainFields] = useState<string[]>([]);

  // Save state
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function updateField(field: keyof FormData, value: string) {
    setFormData((prev) => ({ ...prev, [field]: value }));
  }

  async function handleParse() {
    if (!rawText.trim()) return;
    setParsing(true);
    setParseError(null);
    try {
      const result = await parseApplication(rawText);
      const p = result.parsed;

      // Map parsed fields onto form
      setFormData({
        company: String(p.company ?? ""),
        job_title: String(p.job_title ?? ""),
        date_applied: p.date_applied
          ? String(p.date_applied).slice(0, 10)
          : new Date().toISOString().slice(0, 10),
        source: String(p.source ?? ""),
        status: String(p.status ?? "applied"),
        location: String(p.location ?? ""),
        work_mode: String(p.work_mode ?? ""),
        whats_in_it_for_me: String(p.whats_in_it_for_me ?? ""),
        salary_min: p.salary_min != null ? String(Math.round(p.salary_min / 100)) : "",
        salary_max: p.salary_max != null ? String(Math.round(p.salary_max / 100)) : "",
        salary_currency: String(p.salary_currency ?? "EUR"),
        job_url: String(p.job_url ?? ""),
        cv_link: String(p.cv_link ?? ""),
        cl_link: String(p.cl_link ?? ""),
        notes: String(p.notes ?? ""),
        raw_input: rawText,
      });
      setSkills(result.skills ?? []);
      setUncertainFields(result.uncertain_fields ?? []);
      setParsed(true);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Parsing failed");
    } finally {
      setParsing(false);
    }
  }

  async function handleSave() {
    if (!formData.company.trim() || !formData.job_title.trim()) {
      setSaveError("Company and Job Title are required.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const payload: Record<string, unknown> = {
        ...formData,
        skills,
        salary_min: formData.salary_min ? Math.round(Number(formData.salary_min) * 100) : undefined,
        salary_max: formData.salary_max ? Math.round(Number(formData.salary_max) * 100) : undefined,
        raw_input: formData.raw_input || rawText || undefined,
      };

      // Remove empty strings
      Object.keys(payload).forEach((k) => {
        if (payload[k] === "") delete payload[k];
      });

      const created = await createApplication(payload);
      router.push(`/applications/${created.id}`);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">New Application</h1>
        <p className="text-sm text-muted-foreground">
          Use AI to parse a job posting or fill in the details manually.
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 rounded-lg border border-border bg-card p-1 w-fit">
        {(["quick", "manual"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
              tab === t
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t === "quick" ? "Quick Input" : "Manual Form"}
          </button>
        ))}
      </div>

      {/* Quick Input Tab */}
      {tab === "quick" && (
        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-card p-5 space-y-4">
            <div>
              <Label>Paste Job Information</Label>
              <Textarea
                value={rawText}
                onChange={setRawText}
                placeholder="Paste any text about the job — position title, company, salary, location, source, job description... The AI will extract the details."
                rows={8}
              />
            </div>

            {parseError && (
              <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {parseError}
              </div>
            )}

            <div className="flex items-center gap-3">
              <button
                onClick={handleParse}
                disabled={parsing || !rawText.trim()}
                className="flex items-center gap-2 rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {parsing ? (
                  <>
                    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                    </svg>
                    Parsing...
                  </>
                ) : (
                  "Parse with AI"
                )}
              </button>
              {parsed && (
                <span className="text-sm text-green-400">
                  Parsed successfully — review the form below
                </span>
              )}
            </div>
          </div>

          {/* Pre-filled form after parse */}
          {parsed && (
            <div className="rounded-lg border border-border bg-card p-5">
              <h2 className="text-sm font-semibold text-foreground mb-4">
                Review &amp; Save
              </h2>
              <ApplicationForm
                formData={formData}
                skills={skills}
                uncertainFields={uncertainFields}
                onChange={updateField}
                onSkillsChange={setSkills}
                onSubmit={handleSave}
                saving={saving}
                error={saveError}
              />
            </div>
          )}
        </div>
      )}

      {/* Manual Form Tab */}
      {tab === "manual" && (
        <div className="rounded-lg border border-border bg-card p-5">
          <ApplicationForm
            formData={formData}
            skills={skills}
            uncertainFields={[]}
            onChange={updateField}
            onSkillsChange={setSkills}
            onSubmit={handleSave}
            saving={saving}
            error={saveError}
          />
        </div>
      )}
    </div>
  );
}
