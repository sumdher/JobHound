/**
 * Authenticated app layout.
 * Wraps all protected pages with the Sidebar and auth guard.
 * Redirects to /login if unauthenticated, /pending if not yet approved.
 * Loads chat sessions and CV analyses to pass down to the sidebar.
 */

"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { Sidebar } from "@/components/sidebar";
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
  const { data: session, status } = useSession();
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [analyses, setAnalyses] = useState<CvAnalysis[]>([]);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/login");
    } else if (status === "authenticated" && session?.userStatus !== "approved") {
      router.replace("/pending");
    }
  }, [status, session, router]);

  // Load sidebar data once authenticated
  useEffect(() => {
    if (status !== "authenticated" || session?.userStatus !== "approved") return;
    listChatSessions().then(setSessions).catch(() => {});
    listCvAnalyses().then(setAnalyses).catch(() => {});
  }, [status, session]);

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
      setSessions((prev) => [newSession, ...prev]);
      router.push(`/chat?s=${newSession.id}`);
    } catch {
      // non-critical
    }
  }, [router]);

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!session || session.userStatus !== "approved") return null;

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        sessions={sessions}
        analyses={analyses}
        onDeleteSession={handleDeleteSession}
        onDeleteAnalysis={handleDeleteAnalysis}
        onNewChat={handleNewChat}
      />

      <div className="flex flex-1 flex-col overflow-hidden min-w-0">
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

        <main className="flex-1 overflow-y-auto">
          <div className="p-4 md:p-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
