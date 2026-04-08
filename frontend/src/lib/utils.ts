/**
 * Shared utility functions for JobHound frontend.
 * Includes className merging (shadcn/ui pattern) and formatting helpers.
 */

import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge Tailwind CSS classes without conflicts. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Format salary from smallest unit (cents) to human-readable. */
export function formatSalary(
  amountCents: number | null | undefined,
  currency = "EUR",
  period = "yearly"
): string {
  if (!amountCents) return "—";
  const amount = amountCents / 100;
  const formatted = new Intl.NumberFormat("en-EU", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
  return period === "yearly" ? `${formatted}/yr` : `${formatted}/${period}`;
}

/** Format a date string to a readable format. */
export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Status to display label mapping. */
export const STATUS_LABELS: Record<string, string> = {
  applied: "Applied",
  screening: "Screening",
  interview_scheduled: "Interview Scheduled",
  interviewing: "Interviewing",
  offer: "Offer",
  rejected: "Rejected",
  ghosted: "Ghosted",
  withdrawn: "Withdrawn",
};

/** Status to color class mapping. */
export const STATUS_COLORS: Record<string, string> = {
  applied: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  screening: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  interview_scheduled: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  interviewing: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  offer: "bg-green-500/20 text-green-400 border-green-500/30",
  rejected: "bg-red-500/20 text-red-400 border-red-500/30",
  ghosted: "bg-gray-500/20 text-gray-400 border-gray-500/30",
  withdrawn: "bg-gray-500/20 text-gray-400 border-gray-500/30",
};
