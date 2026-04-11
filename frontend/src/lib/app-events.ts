"use client";

export const CHAT_SESSIONS_CHANGED_EVENT = "jobhound:chat-sessions-changed";
export const CV_ANALYSES_CHANGED_EVENT = "jobhound:cv-analyses-changed";
export const CHAT_DRAFT_UPDATED_EVENT = "jobhound:chat-draft-updated";
export const PROFILE_ANALYSIS_UPDATED_EVENT = "jobhound:profile-analysis-updated";

export function emitAppEvent<T>(name: string, detail?: T): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(name, { detail }));
}
