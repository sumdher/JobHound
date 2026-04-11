/**
 * Sidebar navigation component.
 * On lg+ screens: always visible, static.
 * On smaller screens: slide-in drawer with overlay backdrop.
 *
 * AI Chat and My Profile are collapsible groups that show session/analysis lists.
 */

"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { signOut, useSession } from "next-auth/react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import type { ChatSession, CvAnalysis } from "@/lib/api";

const STATIC_NAV = [
  { href: "/dashboard", label: "Dashboard", icon: "📊" },
  { href: "/applications", label: "Applications", icon: "📋" },
  { href: "/applications/new", label: "New Application", icon: "✚" },
  { href: "/settings", label: "Settings", icon: "⚙️" },
];

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-90")}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
    </svg>
  );
}

interface DeleteState {
  id: string | null;
  timer: ReturnType<typeof setTimeout> | null;
}

export function Sidebar({
  open,
  onClose,
  sessions,
  analyses,
  onDeleteSession,
  onDeleteAnalysis,
  onNewChat,
  profileHref,
  width,
  onResizeStart,
}: {
  open: boolean;
  onClose: () => void;
  sessions: ChatSession[];
  analyses: CvAnalysis[];
  onDeleteSession: (id: string) => void;
  onDeleteAnalysis: (id: string) => void;
  onNewChat: () => void;
  profileHref: string;
  width: number;
  onResizeStart: (event: React.MouseEvent<HTMLDivElement>) => void;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data: session } = useSession();

  const activeSessionId = searchParams.get("s");
  const activeAnalysisId = pathname.startsWith("/profile/analyses/")
    ? pathname.split("/").pop()
    : searchParams.get("a");

  // Persist open/closed state in localStorage
  const [chatOpen, setChatOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const v = localStorage.getItem("jobhound_sidebar_chat_open");
    return v === null ? true : v === "true";
  });
  const [profileOpen, setProfileOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const v = localStorage.getItem("jobhound_sidebar_profile_open");
    return v === null ? true : v === "true";
  });

  // Delete confirmation state
  const [confirmSession, setConfirmSession] = useState<DeleteState>({ id: null, timer: null });
  const [confirmAnalysis, setConfirmAnalysis] = useState<DeleteState>({ id: null, timer: null });

  const confirmSessionRef = useRef(confirmSession);
  confirmSessionRef.current = confirmSession;
  const confirmAnalysisRef = useRef(confirmAnalysis);
  confirmAnalysisRef.current = confirmAnalysis;

  useEffect(() => {
    return () => {
      if (confirmSessionRef.current.timer) clearTimeout(confirmSessionRef.current.timer);
      if (confirmAnalysisRef.current.timer) clearTimeout(confirmAnalysisRef.current.timer);
    };
  }, []);

  // Close drawer when navigating
  useEffect(() => {
    onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchParams]);

  const toggleChat = () => {
    const next = !chatOpen;
    setChatOpen(next);
    localStorage.setItem("jobhound_sidebar_chat_open", String(next));
  };

  const toggleProfile = () => {
    const next = !profileOpen;
    setProfileOpen(next);
    localStorage.setItem("jobhound_sidebar_profile_open", String(next));
  };

  const startDeleteSession = (id: string) => {
    if (confirmSession.timer) clearTimeout(confirmSession.timer);
    const timer = setTimeout(() => {
      setConfirmSession({ id: null, timer: null });
    }, 3000);
    setConfirmSession({ id, timer });
  };

  const cancelDeleteSession = () => {
    if (confirmSession.timer) clearTimeout(confirmSession.timer);
    setConfirmSession({ id: null, timer: null });
  };

  const confirmDeleteSession = (id: string) => {
    if (confirmSession.timer) clearTimeout(confirmSession.timer);
    setConfirmSession({ id: null, timer: null });
    onDeleteSession(id);
  };

  const startDeleteAnalysis = (id: string) => {
    if (confirmAnalysis.timer) clearTimeout(confirmAnalysis.timer);
    const timer = setTimeout(() => {
      setConfirmAnalysis({ id: null, timer: null });
    }, 3000);
    setConfirmAnalysis({ id, timer });
  };

  const cancelDeleteAnalysis = () => {
    if (confirmAnalysis.timer) clearTimeout(confirmAnalysis.timer);
    setConfirmAnalysis({ id: null, timer: null });
  };

  const confirmDeleteAnalysis = (id: string) => {
    if (confirmAnalysis.timer) clearTimeout(confirmAnalysis.timer);
    setConfirmAnalysis({ id: null, timer: null });
    onDeleteAnalysis(id);
  };

  const isChatActive = pathname === "/chat";
  const isProfileActive = pathname.startsWith("/profile");
  const hasEmptyChat = sessions.some((s) => s.message_count === 0);

  return (
    <>
      {/* Mobile overlay backdrop */}
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/50 transition-opacity duration-300 lg:hidden",
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        )}
        onClick={onClose}
        aria-hidden
      />

      {/* Sidebar panel */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex h-full flex-col border-r border-border bg-card",
          "transition-transform duration-300 ease-in-out",
          "lg:static lg:translate-x-0 lg:transition-none",
          open ? "translate-x-0" : "-translate-x-full"
        )}
        style={{ width }}
      >
        {/* Logo */}
        <div className="flex h-16 items-center gap-2 border-b border-border px-4">
          <Link href="/dashboard" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <Image src="/icon.svg" alt="JobHound" width={38} height={38} priority unoptimized />
            <span className="text-xl font-bold tracking-tight">JobHound</span>
          </Link>
          <button
            onClick={onClose}
            className="ml-auto rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground lg:hidden"
            aria-label="Close menu"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {/* Static nav items */}
          {STATIC_NAV.map((item) => {
            const isActive =
              item.href === "/dashboard"
                ? pathname === "/dashboard"
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary/20 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                )}
              >
                <span className="text-base">{item.icon}</span>
                {item.label}
              </Link>
            );
          })}

          {/* AI Chat collapsible group */}
          <div>
            <div
              className={cn(
                "flex items-center rounded-lg text-sm font-medium transition-colors",
                isChatActive
                  ? "bg-primary/20 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
            >
              <button
                onClick={onNewChat}
                className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left"
              >
                <span className="text-base">💬</span>
                <span className="truncate">AI Chat</span>
              </button>
              <button
                onClick={toggleChat}
                className="shrink-0 rounded-r-lg px-3 py-2"
                aria-label={chatOpen ? "Collapse AI Chat" : "Expand AI Chat"}
              >
                <ChevronIcon open={chatOpen} />
              </button>
            </div>

            {chatOpen && (
              <div className="ml-4 mt-0.5 space-y-0.5 border-l border-border pl-2">
                {sessions.map((s) => {
                  const isItemActive = isChatActive && activeSessionId === s.id;
                  const isConfirming = confirmSession.id === s.id;
                  return (
                    <div
                      key={s.id}
                      className={cn(
                        "group flex items-center gap-1 rounded-md px-2 py-1.5 text-xs transition-colors",
                        isItemActive
                          ? "bg-primary/15 text-primary"
                          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                      )}
                    >
                      <Link
                        href={`/chat?s=${s.id}`}
                        className="flex-1 min-w-0 truncate"
                        title={s.title}
                      >
                        {s.title}
                      </Link>
                      {isConfirming ? (
                        <span className="flex items-center gap-0.5 shrink-0">
                          <button
                            onClick={() => cancelDeleteSession()}
                            title="Cancel"
                            className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                          >
                            ✕
                          </button>
                          <button
                            onClick={() => confirmDeleteSession(s.id)}
                            title="Confirm delete"
                            className="rounded p-0.5 text-destructive hover:text-destructive/80"
                          >
                            ✓
                          </button>
                        </span>
                      ) : (
                        <button
                          onClick={(e) => { e.preventDefault(); startDeleteSession(s.id); }}
                          title="Delete session"
                          className="shrink-0 rounded p-0.5 text-transparent group-hover:text-muted-foreground hover:!text-destructive transition-colors"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  );
                })}
                {!hasEmptyChat && (
                  <button
                    onClick={onNewChat}
                    className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
                  >
                    <span className="font-medium">+ New Chat</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* My Profile collapsible group */}
          <div>
            <div
              className={cn(
                "flex items-center rounded-lg text-sm font-medium transition-colors",
                isProfileActive
                  ? "bg-primary/20 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
            >
              <Link
                href={profileHref}
                className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2"
              >
                <span className="text-base">👤</span>
                <span className="truncate">My Profile</span>
              </Link>
              <button
                onClick={toggleProfile}
                className="shrink-0 rounded-r-lg px-3 py-2"
                aria-label={profileOpen ? "Collapse My Profile" : "Expand My Profile"}
              >
                <ChevronIcon open={profileOpen} />
              </button>
            </div>

            {profileOpen && (
              <div className="ml-4 mt-0.5 space-y-0.5 border-l border-border pl-2">
                {analyses.map((a) => {
                  const isItemActive = isProfileActive && activeAnalysisId === a.id;
                  const isConfirming = confirmAnalysis.id === a.id;
                  return (
                    <div
                      key={a.id}
                      className={cn(
                        "group flex items-center gap-1 rounded-md px-2 py-1.5 text-xs transition-colors",
                        isItemActive
                          ? "bg-primary/15 text-primary"
                          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                      )}
                    >
                      <Link
                        href={`/profile/analyses/${a.id}`}
                        className="flex-1 min-w-0 truncate"
                        title={a.title}
                      >
                        {a.title}
                      </Link>
                      {isConfirming ? (
                        <span className="flex items-center gap-0.5 shrink-0">
                          <button
                            onClick={() => cancelDeleteAnalysis()}
                            title="Cancel"
                            className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                          >
                            ✕
                          </button>
                          <button
                            onClick={() => confirmDeleteAnalysis(a.id)}
                            title="Confirm delete"
                            className="rounded p-0.5 text-destructive hover:text-destructive/80"
                          >
                            ✓
                          </button>
                        </span>
                      ) : (
                        <button
                          onClick={(e) => { e.preventDefault(); startDeleteAnalysis(a.id); }}
                          title="Delete analysis"
                          className="shrink-0 rounded p-0.5 text-transparent group-hover:text-muted-foreground hover:!text-destructive transition-colors"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  );
                })}
                {analyses.length === 0 && (
                  <p className="px-2 py-1.5 text-xs text-muted-foreground/60 italic">No saved analyses</p>
                )}
              </div>
            )}
          </div>

          {/* Admin link */}
          {session?.isAdmin && (
            <Link
              href="/admin"
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                pathname.startsWith("/admin")
                  ? "bg-primary/20 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
            >
              <span className="text-base">🛡️</span>
              Admin Panel
            </Link>
          )}
        </nav>

        {/* User profile */}
        {session?.user && (
          <div className="border-t border-border p-3">
            <div className="flex items-center gap-3 rounded-lg px-2 py-2">
              {session.user.image ? (
                <Image
                  src={session.user.image}
                  alt={session.user.name ?? "User"}
                  width={32}
                  height={32}
                  className="rounded-full shrink-0"
                />
              ) : (
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/20 text-sm font-bold text-primary">
                  {(session.user.name ?? "U")[0]}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{session.user.name}</p>
                <p className="text-xs text-muted-foreground truncate">{session.user.email}</p>
              </div>
              <button
                onClick={() => {
                  if (window.confirm("Sign out of JobHound?")) {
                    signOut({ callbackUrl: "/login" });
                  }
                }}
                className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                title="Sign out"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                  />
                </svg>
              </button>
            </div>
          </div>
        )}

        <div
          onMouseDown={onResizeStart}
          className="absolute right-0 top-0 hidden h-full w-2 cursor-col-resize lg:block"
          aria-hidden
        >
          <div className="mx-auto h-full w-px bg-border/60 transition-colors hover:bg-primary" />
        </div>
      </aside>
    </>
  );
}
