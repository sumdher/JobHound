/**
 * Dashboard page for JobHound.
 * Displays analytics overview with stat cards and charts covering application
 * volume, status funnel, skills frequency, source effectiveness, salary
 * distribution, response time, and status trends over time.
 */

"use client";

import { useEffect, useState } from "react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  getAnalyticsOverview,
  getApplicationsOverTime,
  getStatusFunnel,
  getSkillsFrequency,
  getSourceEffectiveness,
  getSalaryDistribution,
  getResponseTime,
  getStatusByMonth,
} from "@/lib/api";
import { cn, STATUS_LABELS } from "@/lib/utils";

const CHART_COLORS = [
  "#3b82f6",
  "#8b5cf6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#6366f1",
  "#ec4899",
  "#14b8a6",
];

// ── Types ────────────────────────────────────────────────────────────────────

interface OverviewData {
  total_applications?: number;
  response_rate?: number;
  active_applications?: number;
  most_common_skill?: string;
  applications_this_month?: number;
  avg_salary?: number;
  avg_salary_currency?: string;
}

interface OverTime {
  period: string;
  count: number;
}

interface StatusFunnelItem {
  status: string;
  count: number;
}

interface SkillItem {
  name: string;
  category: string;
  count: number;
}

interface SourceItem {
  source: string;
  applied_count: number;
  response_count: number;
  response_rate: number;
}

interface SalaryDistribution {
  buckets: { bucket_min: number; bucket_max: number; count: number }[];
  p25: number;
  median: number;
  p75: number;
}

interface ResponseTimeItem {
  source: string;
  avg_days: number;
}

interface StatusByMonthItem {
  month: string;
  status: string;
  count: number;
}

// ── Skeleton ─────────────────────────────────────────────────────────────────

function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn("animate-pulse rounded-md bg-muted/50", className)} />
  );
}

// ── Stat Card ─────────────────────────────────────────────────────────────────

interface StatCardProps {
  label: string;
  value: string | number;
  loading?: boolean;
}

function StatCard({ label, value, loading }: StatCardProps) {
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      {loading ? (
        <>
          <Skeleton className="mb-3 h-4 w-24" />
          <Skeleton className="h-8 w-20" />
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-bold text-foreground">{value}</p>
        </>
      )}
    </div>
  );
}

// ── Chart Card ────────────────────────────────────────────────────────────────

function ChartCard({
  title,
  loading,
  empty,
  children,
  className,
  actions,
}: {
  title: string;
  loading?: boolean;
  empty?: boolean;
  children: React.ReactNode;
  className?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className={cn("rounded-lg border border-border bg-card p-5", className)}>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {actions}
      </div>
      {loading ? (
        <Skeleton className="h-48 w-full" />
      ) : empty ? (
        <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
          No data yet
        </div>
      ) : (
        children
      )}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtSalaryRaw(cents?: number, currency = "EUR"): string {
  if (!cents) return "—";
  return new Intl.NumberFormat("en-EU", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function pivotStatusByMonth(
  raw: StatusByMonthItem[]
): Record<string, Record<string, number>> {
  const map: Record<string, Record<string, number>> = {};
  for (const row of raw) {
    if (!map[row.month]) map[row.month] = {};
    map[row.month][row.status] = row.count;
  }
  return map;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [overTime, setOverTime] = useState<OverTime[]>([]);
  const [overtimePeriod, setOvertimePeriod] = useState<"weekly" | "monthly">(
    "monthly"
  );
  const [funnel, setFunnel] = useState<StatusFunnelItem[]>([]);
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [sources, setSources] = useState<SourceItem[]>([]);
  const [salary, setSalary] = useState<SalaryDistribution | null>(null);
  const [responseTime, setResponseTime] = useState<ResponseTimeItem[]>([]);
  const [statusByMonth, setStatusByMonth] = useState<StatusByMonthItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load all analytics on mount
  useEffect(() => {
    async function load() {
      try {
        const [ov, ot, fn, sk, src, sal, rt, sbm] = await Promise.all([
          getAnalyticsOverview(),
          getApplicationsOverTime(overtimePeriod),
          getStatusFunnel(),
          getSkillsFrequency(),
          getSourceEffectiveness(),
          getSalaryDistribution(),
          getResponseTime(),
          getStatusByMonth(),
        ]);
        setOverview(ov as OverviewData);
        setOverTime(ot);
        setFunnel(fn);
        setSkills(sk.slice(0, 10));
        setSources(src);
        setSalary(sal);
        setResponseTime(rt);
        setStatusByMonth(sbm);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load data");
      } finally {
        setLoading(false);
      }
    }
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reload over-time chart when period changes
  useEffect(() => {
    if (!loading) {
      getApplicationsOverTime(overtimePeriod)
        .then(setOverTime)
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overtimePeriod]);

  // Build status-by-month stacked chart data
  const allStatuses = Array.from(new Set(statusByMonth.map((r) => r.status)));
  const pivoted = pivotStatusByMonth(statusByMonth);
  const statusByMonthData = Object.entries(pivoted).map(([month, counts]) => ({
    month,
    ...counts,
  }));

  // Salary buckets
  const salaryData =
    salary?.buckets.map((b) => ({
      label: `${Math.round(b.bucket_min / 100)}k–${Math.round(b.bucket_max / 100)}k`,
      count: b.count,
    })) ?? [];

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
        Error loading dashboard: {error}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Overview of your job search activity
        </p>
      </div>

      {/* Top stat row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Total Applications"
          value={overview?.total_applications ?? "—"}
          loading={loading}
        />
        <StatCard
          label="Response Rate"
          value={
            overview?.response_rate != null
              ? `${Math.round(overview.response_rate * 100)}%`
              : "—"
          }
          loading={loading}
        />
        <StatCard
          label="Active Applications"
          value={overview?.active_applications ?? "—"}
          loading={loading}
        />
        <StatCard
          label="Most Common Skill"
          value={overview?.most_common_skill ?? "—"}
          loading={loading}
        />
      </div>

      {/* Second stat row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Applications This Month"
          value={overview?.applications_this_month ?? "—"}
          loading={loading}
        />
        <StatCard
          label="Avg Salary"
          value={fmtSalaryRaw(
            overview?.avg_salary,
            overview?.avg_salary_currency ?? "EUR"
          )}
          loading={loading}
        />
      </div>

      {/* Charts grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Applications Over Time */}
        <ChartCard
          title="Applications Over Time"
          loading={loading}
          empty={!loading && overTime.length === 0}
          actions={
            <div className="flex gap-1">
              {(["weekly", "monthly"] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setOvertimePeriod(p)}
                  className={cn(
                    "rounded px-2 py-1 text-xs font-medium transition-colors",
                    overtimePeriod === p
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </button>
              ))}
            </div>
          }
        >
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={overTime}>
              <defs>
                <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={CHART_COLORS[0]} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={CHART_COLORS[0]} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                dataKey="period"
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "6px",
                  fontSize: 12,
                }}
              />
              <Area
                type="monotone"
                dataKey="count"
                stroke={CHART_COLORS[0]}
                fill="url(#colorCount)"
                name="Applications"
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Status Funnel */}
        <ChartCard
          title="Status Funnel"
          loading={loading}
          empty={!loading && funnel.length === 0}
        >
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={funnel} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                type="number"
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              />
              <YAxis
                type="category"
                dataKey="status"
                width={120}
                tickFormatter={(v: string) => STATUS_LABELS[v] ?? v}
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "6px",
                  fontSize: 12,
                }}
              />
              <Bar dataKey="count" fill={CHART_COLORS[1]} name="Count" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Skills Frequency */}
        <ChartCard
          title="Top Skills"
          loading={loading}
          empty={!loading && skills.length === 0}
        >
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={skills} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                type="number"
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              />
              <YAxis
                type="category"
                dataKey="name"
                width={100}
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "6px",
                  fontSize: 12,
                }}
              />
              <Bar dataKey="count" fill={CHART_COLORS[2]} name="Appearances" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Source Effectiveness */}
        <ChartCard
          title="Source Effectiveness"
          loading={loading}
          empty={!loading && sources.length === 0}
        >
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={sources}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                dataKey="source"
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "6px",
                  fontSize: 12,
                }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="applied_count" fill={CHART_COLORS[0]} name="Applied" radius={[4, 4, 0, 0]} />
              <Bar dataKey="response_count" fill={CHART_COLORS[2]} name="Responses" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Salary Distribution */}
        <ChartCard
          title="Salary Distribution"
          loading={loading}
          empty={!loading && salaryData.length === 0}
        >
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={salaryData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "6px",
                  fontSize: 12,
                }}
              />
              <Bar dataKey="count" fill={CHART_COLORS[3]} name="Applications" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Response Time */}
        <ChartCard
          title="Avg Response Time by Source"
          loading={loading}
          empty={!loading && responseTime.length === 0}
        >
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={responseTime} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                type="number"
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                label={{
                  value: "days",
                  position: "insideRight",
                  fontSize: 11,
                  fill: "hsl(var(--muted-foreground))",
                }}
              />
              <YAxis
                type="category"
                dataKey="source"
                width={100}
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "6px",
                  fontSize: 12,
                }}
              />
              <Bar dataKey="avg_days" fill={CHART_COLORS[4]} name="Avg Days" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Status by Month */}
        <ChartCard
          title="Status by Month"
          loading={loading}
          empty={!loading && statusByMonthData.length === 0}
          className="lg:col-span-2"
        >
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={statusByMonthData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                dataKey="month"
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "6px",
                  fontSize: 12,
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {allStatuses.map((status, i) => (
                <Bar
                  key={status}
                  dataKey={status}
                  stackId="a"
                  fill={CHART_COLORS[i % CHART_COLORS.length]}
                  name={STATUS_LABELS[status] ?? status}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </div>
  );
}
