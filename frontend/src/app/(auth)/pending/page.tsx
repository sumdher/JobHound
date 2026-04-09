/**
 * Pending approval page.
 * Shown to users who have signed in but are awaiting admin approval.
 * Polls the backend every 10 seconds to detect when access is granted.
 */

"use client";

import { signOut, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function PendingPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [statusMsg, setStatusMsg] = useState<"pending" | "approved" | "rejected">("pending");
  const [checking, setChecking] = useState(false);

  // Redirect already-approved users straight to dashboard
  useEffect(() => {
    if (status === "authenticated" && session?.userStatus === "approved") {
      router.replace("/dashboard");
    }
    if (status === "unauthenticated") {
      router.replace("/login");
    }
  }, [status, session, router]);

  // Poll the backend for status changes
  useEffect(() => {
    if (status !== "authenticated" || !session?.accessToken) return;

    const poll = async () => {
      try {
        const res = await fetch("/backend/api/auth/status", {
          headers: { Authorization: `Bearer ${session.accessToken}` },
        });
        if (!res.ok) return;
        const data = (await res.json()) as { status: string };
        if (data.status === "approved") {
          setStatusMsg("approved");
          // Sign out so next sign-in gets a fresh session with approved status
          setTimeout(() => signOut({ callbackUrl: "/login?approved=1" }), 2000);
        } else if (data.status === "rejected") {
          setStatusMsg("rejected");
        }
      } catch {
        // Network error — silently ignore, will retry
      }
    };

    poll();
    const interval = setInterval(poll, 10_000);
    return () => clearInterval(interval);
  }, [status, session]);

  const handleManualCheck = async () => {
    if (!session?.accessToken) return;
    setChecking(true);
    try {
      const res = await fetch("/backend/api/auth/status", {
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      if (res.ok) {
        const data = (await res.json()) as { status: string };
        if (data.status === "approved") {
          setStatusMsg("approved");
          setTimeout(() => signOut({ callbackUrl: "/login?approved=1" }), 1500);
        } else if (data.status === "rejected") {
          setStatusMsg("rejected");
        }
      }
    } finally {
      setChecking(false);
    }
  };

  if (statusMsg === "approved") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="w-full max-w-md space-y-6 rounded-xl border border-border bg-card p-8 shadow-2xl text-center">
          <div className="flex justify-center text-5xl">✓</div>
          <h1 className="text-2xl font-bold text-green-400">Access Granted!</h1>
          <p className="text-muted-foreground">
            Your account has been approved. Signing you in...
          </p>
          <div className="flex justify-center">
            <div className="h-6 w-6 animate-spin rounded-full border-4 border-green-400 border-t-transparent" />
          </div>
        </div>
      </div>
    );
  }

  if (statusMsg === "rejected") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="w-full max-w-md space-y-6 rounded-xl border border-border bg-card p-8 shadow-2xl text-center">
          <div className="flex justify-center text-5xl">✗</div>
          <h1 className="text-2xl font-bold text-red-400">Access Denied</h1>
          <p className="text-muted-foreground">
            Your access request has been declined. Contact the admin if you think
            this is a mistake.
          </p>
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="rounded-lg border border-border bg-secondary px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Back to login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="w-full max-w-md space-y-8 rounded-xl border border-border bg-card p-8 shadow-2xl">
        {/* Logo */}
        <div className="text-center">
          <div className="mb-4 flex justify-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/20 text-4xl">
              🐾
            </div>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Awaiting Approval
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your request to access JobHound is pending admin review.
          </p>
        </div>

        {/* Status */}
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-4 text-center">
          <div className="mb-2 flex items-center justify-center gap-2">
            <div className="h-2 w-2 animate-pulse rounded-full bg-yellow-400" />
            <span className="text-sm font-medium text-yellow-400">Pending</span>
          </div>
          <p className="text-xs text-muted-foreground">
            The admin has been notified. This page checks automatically every 10 seconds.
          </p>
        </div>

        {/* Account info */}
        {session?.user?.email && (
          <p className="text-center text-xs text-muted-foreground">
            Signed in as{" "}
            <span className="font-medium text-foreground">{session.user.email}</span>
          </p>
        )}

        {/* Actions */}
        <div className="space-y-3">
          <button
            onClick={handleManualCheck}
            disabled={checking}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-secondary px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50"
          >
            {checking ? (
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            ) : (
              "Check status now"
            )}
          </button>
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="w-full rounded-lg px-4 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
