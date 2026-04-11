/**
 * Authenticated app layout.
 * Wraps all protected pages with the Sidebar and auth guard.
 * Redirects to /login if unauthenticated, /pending if not yet approved.
 * Loads chat sessions and CV analyses to pass down to the sidebar.
 */

"use client";

import { useSession } from "next-auth/react";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Sidebar } from "@/components/sidebar";
import {
  CHAT_SESSIONS_CHANGED_EVENT,
  CV_ANALYSES_CHANGED_EVENT,
} from "@/lib/app-events";
import {
  listChatSessions,
  listCvAnalyses,
  createChatSession,
  deleteChatSession,
  deleteCvAnalysis,
  type ChatSession,
  type CvAnalysis,
} from "@/lib/api";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const SIDEBAR_WIDTH_KEY = "jobhound_sidebar_width";
  const MIN_SIDEBAR_WIDTH = 240;
  const MAX_SIDEBAR_WIDTH = 420;
  const { data: session, status, update } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const hasRefreshedSession = useRef(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(288);

  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [analyses, setAnalyses] = useState<CvAnalysis[]>([]);
  const isChatRoute = pathname === "/chat";

  const upsertSession = useCallback((session: ChatSession) => {
    setSessions((prev) => {
      const others = prev.filter((s) => s.id !== session.id);
      return [session, ...others];
    });
  }, []);

  const refreshSessions = useCallback(() => {
    listChatSessions().then(setSessions).catch(() => {});
  }, []);

  const refreshAnalyses = useCallback(() => {
    listCvAnalyses().then(setAnalyses).catch(() => {});
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem(SIDEBAR_WIDTH_KEY);
    if (!raw) return;
    const parsed = Number(raw);
    if (!Number.isNaN(parsed)) {
      setSidebarWidth(Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, parsed)));
    }
  }, []);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/login");
    } else if (status === "authenticated" && session?.userStatus !== "approved") {
      router.replace("/pending");
    }
  }, [status, session, router]);

  useEffect(() => {
    if (status !== "authenticated" || hasRefreshedSession.current) return;

    hasRefreshedSession.current = true;
    void update();
  }, [status, update]);

  // Load sidebar data once authenticated
  useEffect(() => {
    if (status !== "authenticated" || session?.userStatus !== "approved") return;
    refreshSessions();
    refreshAnalyses();
  }, [status, session, refreshSessions, refreshAnalyses]);

  useEffect(() => {
    const handleSessionsChanged = () => refreshSessions();
    const handleAnalysesChanged = () => refreshAnalyses();
    window.addEventListener(CHAT_SESSIONS_CHANGED_EVENT, handleSessionsChanged);
    window.addEventListener(CV_ANALYSES_CHANGED_EVENT, handleAnalysesChanged);
    return () => {
      window.removeEventListener(CHAT_SESSIONS_CHANGED_EVENT, handleSessionsChanged);
      window.removeEventListener(CV_ANALYSES_CHANGED_EVENT, handleAnalysesChanged);
    };
  }, [refreshAnalyses, refreshSessions]);

  const handleDeleteSession = useCallback(async (id: string) => {
    try {
      await deleteChatSession(id);
      setSessions((prev) => prev.filter((s) => s.id !== id));
    } catch {
      // non-critical
    }
  }, []);

  const handleDeleteAnalysis = useCallback(async (id: string) => {
    try {
      await deleteCvAnalysis(id);
      setAnalyses((prev) => prev.filter((a) => a.id !== id));
    } catch {
      // non-critical
    }
  }, []);

  const handleNewChat = useCallback(async () => {
    try {
      const newSession = await createChatSession();
      upsertSession(newSession);
      router.push(`/chat?s=${newSession.id}`);
    } catch {
      // non-critical
    }
  }, [router, upsertSession]);

  const handleSidebarResizeStart = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth;

    const onMove = (moveEvent: MouseEvent) => {
      const nextWidth = Math.min(
        MAX_SIDEBAR_WIDTH,
        Math.max(MIN_SIDEBAR_WIDTH, startWidth + moveEvent.clientX - startX)
      );
      setSidebarWidth(nextWidth);
      window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(nextWidth));
    };

    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [sidebarWidth]);

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!session || session.userStatus !== "approved") return null;

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        sessions={sessions}
        analyses={analyses}
        onDeleteSession={handleDeleteSession}
        onDeleteAnalysis={handleDeleteAnalysis}
        onNewChat={handleNewChat}
        profileHref="/profile"
        width={sidebarWidth}
        onResizeStart={handleSidebarResizeStart}
      />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Mobile top bar — hidden on lg+ where sidebar is always visible */}
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-card px-4 lg:hidden">
          <button
            onClick={() => setSidebarOpen(true)}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            aria-label="Open menu"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <Image src="/logo.svg" alt="JobHound" width={24} height={24} />
          <span className="text-base font-bold tracking-tight">JobHound</span>
        </header>

        <main className={isChatRoute ? "flex-1 min-h-0 overflow-hidden" : "flex-1 overflow-y-auto"}>
          <div className={isChatRoute ? "h-full min-h-0" : "p-4 md:p-6"}>{children}</div>
        </main>
      </div>
    </div>
  );
}
