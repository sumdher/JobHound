/**
 * Dashboard page for JobHound.
 * Displays analytics overview with stat cards and charts covering application
 * volume, status funnel, skills frequency, source effectiveness, salary
 * distribution, response time, and status trends over time.
 */

"use client";

import { useEffect, useState, type ReactNode } from "react";
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
  PieChart,
  Pie,
  Cell,
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

const TOOLTIP_STYLE = {
  background: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "12px",
  fontSize: 12,
  boxShadow: "0 18px 45px rgba(0, 0, 0, 0.24)",
};

const AXIS_TICK = {
  fontSize: 11,
  fill: "hsl(var(--muted-foreground))",
};

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

interface StatusDistributionItem extends StatusFunnelItem {
  label: string;
  fill: string;
}

interface ResponseShareItem {
  name: string;
  value: number;
  fill: string;
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
    <div className="rounded-2xl border border-border/70 bg-card/80 p-5 shadow-[0_18px_40px_rgba(0,0,0,0.14)] backdrop-blur">
      {loading ? (
        <>
          <Skeleton className="mb-3 h-4 w-24" />
          <Skeleton className="h-8 w-20" />
        </>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-primary/80" />
            <p className="text-sm text-muted-foreground">{label}</p>
          </div>
          <p className="mt-3 text-2xl font-bold tracking-tight text-foreground">{value}</p>
        </>
      )}
    </div>
  );
}

// ── Chart Card ────────────────────────────────────────────────────────────────

function ChartCard({
  title,
  description,
  loading,
  empty,
  children,
  className,
  actions,
}: {
  title: string;
  description?: string;
  loading?: boolean;
  empty?: boolean;
  children: ReactNode;
  className?: string;
  actions?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border/70 bg-card/80 p-5 shadow-[0_20px_50px_rgba(0,0,0,0.16)] backdrop-blur",
        className
      )}
    >
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold tracking-wide text-foreground">{title}</h2>
          {description ? (
            <p className="mt-1 text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
      {loading ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : empty ? (
        <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-border/60 bg-background/30 text-sm text-muted-foreground">
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

function getCompactBarHeight(
  items: number,
  rowHeight = 34,
  minHeight = 220,
  maxHeight = 360
) {
  return Math.max(minHeight, Math.min(maxHeight, items * rowHeight));
}

function fmtPercent(value: number, total: number) {
  if (!total) return "0%";
  return `${Math.round((value / total) * 100)}%`;
}

function truncateLabel(value: string, max = 14) {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
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
  const allStatuses = Array.from(
    new Set(statusByMonth.map((r: StatusByMonthItem) => r.status))
  );
  const pivoted = pivotStatusByMonth(statusByMonth);
  const statusByMonthData = Object.entries(pivoted).map(([month, counts]) => ({
    month,
    ...counts,
  }));

  const statusDistribution: StatusDistributionItem[] = funnel.map(
    (item: StatusFunnelItem, index: number) => ({
      ...item,
      label: STATUS_LABELS[item.status] ?? item.status,
      fill: CHART_COLORS[index % CHART_COLORS.length],
    })
  );
  const totalTrackedStatuses = statusDistribution.reduce(
    (sum: number, item: StatusDistributionItem) => sum + item.count,
    0
  );

  const sourceResponseShare: ResponseShareItem[] = sources
    .filter((item: SourceItem) => item.response_count > 0)
    .map((item: SourceItem, index: number) => ({
      name: item.source,
      value: item.response_count,
      fill: CHART_COLORS[index % CHART_COLORS.length],
    }));
  const totalResponses = sourceResponseShare.reduce(
    (sum: number, item: ResponseShareItem) => sum + item.value,
    0
  );

  const topSkillsHeight = getCompactBarHeight(skills.length, 34, 240, 360);
  const responseTimeHeight = getCompactBarHeight(
    responseTime.length,
    34,
    220,
    320
  );

  // Salary buckets
  const salaryData =
    salary?.buckets.map((b: { bucket_min: number; bucket_max: number; count: number }) => ({
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
      <div className="flex flex-col gap-2">
        <div className="inline-flex w-fit items-center rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
          Analytics overview
        </div>
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Overview of your job search activity
        </p>
      </div>

      {/* Top stat row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
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
          description="Track submission volume with a cleaner trend view and compact period switching."
          loading={loading}
          empty={!loading && overTime.length === 0}
          className="lg:col-span-2"
          actions={
            <div className="inline-flex rounded-full border border-border/60 bg-background/50 p-1">
              {(["weekly", "monthly"] as const).map((p) => (
                <button
                  type="button"
                  key={p}
                  onClick={() => setOvertimePeriod(p)}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                    overtimePeriod === p
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </button>
              ))}
            </div>
          }
        >
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={overTime} margin={{ top: 8, right: 8, left: -24, bottom: 0 }}>
              <defs>
                <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={CHART_COLORS[0]} stopOpacity={0.35} />
                  <stop offset="95%" stopColor={CHART_COLORS[0]} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid
                vertical={false}
                strokeDasharray="3 3"
                stroke="hsl(var(--border))"
              />
              <XAxis
                dataKey="period"
                axisLine={false}
                tickLine={false}
                tickMargin={10}
                tick={AXIS_TICK}
              />
              <YAxis
                allowDecimals={false}
                axisLine={false}
                tickLine={false}
                tick={AXIS_TICK}
              />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                formatter={(value: number) => [`${value} applications`, "Count"]}
              />
              <Area
                type="monotone"
                dataKey="count"
                stroke={CHART_COLORS[0]}
                strokeWidth={2.5}
                fill="url(#colorCount)"
                name="Applications"
                activeDot={{ r: 4 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Status Funnel */}
        <ChartCard
          title="Pipeline Distribution"
          description="Replace heavy bars with a donut breakdown and compact status summary."
          loading={loading}
          empty={!loading && funnel.length === 0}
        >
          <div className="grid gap-6 xl:grid-cols-[220px_minmax(0,1fr)] xl:items-center">
            <div className="relative h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    formatter={(value: number) => [`${value} applications`, "Count"]}
                  />
                  <Pie
                    data={statusDistribution}
                    dataKey="count"
                    nameKey="label"
                    innerRadius={66}
                    outerRadius={92}
                    paddingAngle={3}
                    stroke="rgba(255,255,255,0.08)"
                    strokeWidth={2}
                  >
                    {statusDistribution.map((entry: StatusDistributionItem) => (
                      <Cell key={entry.status} fill={entry.fill} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                <span className="text-3xl font-semibold text-foreground">
                  {totalTrackedStatuses}
                </span>
                <span className="text-xs text-muted-foreground">status updates</span>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              {statusDistribution.map((item: StatusDistributionItem) => (
                <div
                  key={item.status}
                  className="flex items-center justify-between rounded-xl border border-border/60 bg-background/30 px-3 py-2.5"
                >
                  <div className="flex items-center gap-3">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: item.fill }}
                    />
                    <div>
                      <p className="text-sm font-medium text-foreground">{item.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {fmtPercent(item.count, totalTrackedStatuses)} of tracked statuses
                      </p>
                    </div>
                  </div>
                  <span className="text-sm font-semibold text-foreground">
                    {item.count}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </ChartCard>

        {/* Skills Frequency */}
        <ChartCard
          title="Top Skills"
          description="Compact horizontal bars keep ranking readable without oversized rows."
          loading={loading}
          empty={!loading && skills.length === 0}
        >
          <ResponsiveContainer width="100%" height={topSkillsHeight}>
            <BarChart
              data={skills}
              layout="vertical"
              margin={{ top: 6, right: 8, left: 8, bottom: 0 }}
              barCategoryGap="34%"
            >
              <CartesianGrid
                vertical={false}
                strokeDasharray="3 3"
                stroke="hsl(var(--border))"
              />
              <XAxis
                type="number"
                allowDecimals={false}
                axisLine={false}
                tickLine={false}
                tick={AXIS_TICK}
              />
              <YAxis
                type="category"
                dataKey="name"
                width={108}
                axisLine={false}
                tickLine={false}
                tick={AXIS_TICK}
              />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                formatter={(value: number) => [`${value} appearances`, "Count"]}
                labelFormatter={(
                  value: string | number,
                  payload?: Array<{ payload?: SkillItem }>
                ) => {
                  const category = payload?.[0]?.payload?.category;
                  return category ? `${value} · ${category}` : String(value);
                }}
              />
              <Bar
                dataKey="count"
                fill={CHART_COLORS[2]}
                name="Appearances"
                radius={[0, 999, 999, 0]}
                barSize={12}
              />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Source Effectiveness */}
        <ChartCard
          title="Source Effectiveness"
          description="Compare volume vs responses while using a donut to show where replies are coming from."
          loading={loading}
          empty={!loading && sources.length === 0}
          className="lg:col-span-2"
        >
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.8fr)_240px]">
            <div className="rounded-xl border border-border/60 bg-background/30 p-3">
              <div className="mb-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                <span className="rounded-full border border-border/60 bg-background/50 px-2 py-1">
                  Applied
                </span>
                <span className="rounded-full border border-border/60 bg-background/50 px-2 py-1">
                  Responses
                </span>
              </div>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart
                  data={sources}
                  margin={{ top: 8, right: 8, left: -8, bottom: 12 }}
                  barGap={6}
                  barCategoryGap="28%"
                >
                  <CartesianGrid
                    vertical={false}
                    strokeDasharray="3 3"
                    stroke="hsl(var(--border))"
                  />
                  <XAxis
                    dataKey="source"
                    axisLine={false}
                    tickLine={false}
                    tickMargin={10}
                    tick={AXIS_TICK}
                    tickFormatter={(value: string) => truncateLabel(value)}
                  />
                  <YAxis
                    allowDecimals={false}
                    axisLine={false}
                    tickLine={false}
                    tick={AXIS_TICK}
                  />
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    formatter={(value: number, name: string) => [
                      value,
                      name === "applied_count" ? "Applied" : "Responses",
                    ]}
                  />
                  <Bar
                    dataKey="applied_count"
                    fill={CHART_COLORS[0]}
                    name="Applied"
                    radius={[8, 8, 0, 0]}
                    barSize={16}
                    maxBarSize={20}
                  />
                  <Bar
                    dataKey="response_count"
                    fill={CHART_COLORS[2]}
                    name="Responses"
                    radius={[8, 8, 0, 0]}
                    barSize={16}
                    maxBarSize={20}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="rounded-xl border border-border/60 bg-background/30 p-3">
              <div className="mb-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Response share
                </p>
                <p className="text-xs text-muted-foreground">
                  Distribution of received responses by source
                </p>
              </div>

              {sourceResponseShare.length > 0 ? (
                <>
                  <div className="relative h-[200px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Tooltip
                          contentStyle={TOOLTIP_STYLE}
                          formatter={(value: number) => [`${value} responses`, "Count"]}
                        />
                        <Pie
                          data={sourceResponseShare}
                          dataKey="value"
                          nameKey="name"
                          innerRadius={52}
                          outerRadius={78}
                          paddingAngle={3}
                          stroke="rgba(255,255,255,0.08)"
                          strokeWidth={2}
                        >
                          {sourceResponseShare.map((entry: ResponseShareItem) => (
                            <Cell key={entry.name} fill={entry.fill} />
                          ))}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                      <span className="text-2xl font-semibold text-foreground">
                        {totalResponses}
                      </span>
                      <span className="text-xs text-muted-foreground">responses</span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {sourceResponseShare.map((item: ResponseShareItem) => (
                      <div
                        key={item.name}
                        className="flex items-center justify-between rounded-lg border border-border/50 px-3 py-2"
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className="h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: item.fill }}
                          />
                          <span className="text-sm text-foreground">{item.name}</span>
                        </div>
                        <span className="text-xs font-medium text-muted-foreground">
                          {fmtPercent(item.value, totalResponses)}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="flex h-[280px] items-center justify-center text-sm text-muted-foreground">
                  No response-share data yet
                </div>
              )}
            </div>
          </div>
        </ChartCard>

        {/* Salary Distribution */}
        <ChartCard
          title="Salary Distribution"
          description="Narrower columns and quick percentile chips make compensation ranges easier to scan."
          loading={loading}
          empty={!loading && salaryData.length === 0}
        >
          <div className="space-y-4">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart
                data={salaryData}
                margin={{ top: 8, right: 8, left: -16, bottom: 0 }}
                barCategoryGap="28%"
              >
                <CartesianGrid
                  vertical={false}
                  strokeDasharray="3 3"
                  stroke="hsl(var(--border))"
                />
                <XAxis
                  dataKey="label"
                  axisLine={false}
                  tickLine={false}
                  tickMargin={10}
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                />
                <YAxis
                  allowDecimals={false}
                  axisLine={false}
                  tickLine={false}
                  tick={AXIS_TICK}
                />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(value: number) => [`${value} applications`, "Count"]}
                />
                <Bar
                  dataKey="count"
                  fill={CHART_COLORS[3]}
                  name="Applications"
                  radius={[8, 8, 0, 0]}
                  barSize={22}
                  maxBarSize={28}
                />
              </BarChart>
            </ResponsiveContainer>

            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl border border-border/60 bg-background/30 px-3 py-3">
                <p className="text-xs text-muted-foreground">P25</p>
                <p className="mt-1 text-sm font-semibold text-foreground">
                  {fmtSalaryRaw(salary?.p25, overview?.avg_salary_currency ?? "EUR")}
                </p>
              </div>
              <div className="rounded-xl border border-border/60 bg-background/30 px-3 py-3">
                <p className="text-xs text-muted-foreground">Median</p>
                <p className="mt-1 text-sm font-semibold text-foreground">
                  {fmtSalaryRaw(salary?.median, overview?.avg_salary_currency ?? "EUR")}
                </p>
              </div>
              <div className="rounded-xl border border-border/60 bg-background/30 px-3 py-3">
                <p className="text-xs text-muted-foreground">P75</p>
                <p className="mt-1 text-sm font-semibold text-foreground">
                  {fmtSalaryRaw(salary?.p75, overview?.avg_salary_currency ?? "EUR")}
                </p>
              </div>
            </div>
          </div>
        </ChartCard>

        {/* Response Time */}
        <ChartCard
          title="Avg Response Time by Source"
          description="Slim bars reduce visual weight while keeping turnaround comparisons readable."
          loading={loading}
          empty={!loading && responseTime.length === 0}
        >
          <ResponsiveContainer width="100%" height={responseTimeHeight}>
            <BarChart
              data={responseTime}
              layout="vertical"
              margin={{ top: 6, right: 12, left: 8, bottom: 0 }}
              barCategoryGap="34%"
            >
              <CartesianGrid
                vertical={false}
                strokeDasharray="3 3"
                stroke="hsl(var(--border))"
              />
              <XAxis
                type="number"
                allowDecimals={false}
                axisLine={false}
                tickLine={false}
                tick={AXIS_TICK}
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
                axisLine={false}
                tickLine={false}
                tick={AXIS_TICK}
              />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                formatter={(value: number) => [`${value} days`, "Average"]}
              />
              <Bar
                dataKey="avg_days"
                fill={CHART_COLORS[4]}
                name="Avg Days"
                radius={[0, 999, 999, 0]}
                barSize={12}
              />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Status by Month */}
        <ChartCard
          title="Status by Month"
          description="Stacked monthly bars keep long-term trend context without the oversized block effect."
          loading={loading}
          empty={!loading && statusByMonthData.length === 0}
          className="lg:col-span-2"
        >
          <ResponsiveContainer width="100%" height={280}>
            <BarChart
              data={statusByMonthData}
              margin={{ top: 8, right: 8, left: -20, bottom: 0 }}
              barCategoryGap="26%"
            >
              <CartesianGrid
                vertical={false}
                strokeDasharray="3 3"
                stroke="hsl(var(--border))"
              />
              <XAxis
                dataKey="month"
                axisLine={false}
                tickLine={false}
                tickMargin={10}
                tick={AXIS_TICK}
              />
              <YAxis
                allowDecimals={false}
                axisLine={false}
                tickLine={false}
                tick={AXIS_TICK}
              />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                formatter={(value: number, name: string) => [
                  value,
                  STATUS_LABELS[name] ?? name,
                ]}
              />
              <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
              {allStatuses.map((status, i) => (
                <Bar
                  key={status}
                  dataKey={status}
                  stackId="a"
                  fill={CHART_COLORS[i % CHART_COLORS.length]}
                  name={STATUS_LABELS[status] ?? status}
                  radius={i === allStatuses.length - 1 ? [6, 6, 0, 0] : undefined}
                  barSize={20}
                  maxBarSize={24}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </div>
  );
}
