"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import Image from "next/image";
import {
  AdminUser,
  listAllUsers,
  updateUserStatus,
  deleteUser,
} from "@/lib/api";

type StatusFilter = "all" | "pending" | "approved" | "rejected";

const STATUS_COLORS: Record<string, string> = {
  approved: "bg-green-500/20 text-green-400 border border-green-500/30",
  pending: "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30",
  rejected: "bg-red-500/20 text-red-400 border border-red-500/30",
};

export default function AdminPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [actionLoading, setActionLoading] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  // Redirect non-admins
  useEffect(() => {
    if (status === "loading") return;
    if (!session?.isAdmin) router.replace("/dashboard");
  }, [session, status, router]);

  const fetchUsers = useCallback(async () => {
    try {
      setError(null);
      const data = await listAllUsers();
      setUsers(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (session?.isAdmin) fetchUsers();
  }, [session, fetchUsers]);

  async function handleStatusChange(userId: string, newStatus: string) {
    setActionLoading((s) => new Set(s).add(userId));
    try {
      await updateUserStatus(userId, newStatus);
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, status: newStatus } : u))
      );
    } catch (e) {
      alert(e instanceof Error ? e.message : "Action failed");
    } finally {
      setActionLoading((s) => {
        const next = new Set(s);
        next.delete(userId);
        return next;
      });
    }
  }

  async function handleDelete(user: AdminUser) {
    if (
      !window.confirm(
        `Delete ${user.email} and ALL their data?\n\nThis cannot be undone.`
      )
    )
      return;
    setActionLoading((s) => new Set(s).add(user.id));
    try {
      await deleteUser(user.id);
      setUsers((prev) => prev.filter((u) => u.id !== user.id));
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setActionLoading((s) => {
        const next = new Set(s);
        next.delete(user.id);
        return next;
      });
    }
  }

  if (status === "loading" || !session?.isAdmin) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  const filtered =
    filter === "all" ? users : users.filter((u) => u.status === filter);

  const counts = {
    all: users.length,
    pending: users.filter((u) => u.status === "pending").length,
    approved: users.filter((u) => u.status === "approved").length,
    rejected: users.filter((u) => u.status === "rejected").length,
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Admin Panel</h1>
          <p className="text-sm text-muted-foreground">Manage user access</p>
        </div>
        <span className="rounded-full bg-primary/20 px-3 py-1 text-xs font-semibold text-primary">
          Admin
        </span>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {(["all", "pending", "approved", "rejected"] as StatusFilter[]).map(
          (s) => (
            <div
              key={s}
              className="rounded-xl border border-border bg-card p-4 text-center"
            >
              <div className="text-2xl font-bold">{counts[s]}</div>
              <div className="mt-1 text-xs capitalize text-muted-foreground">
                {s}
              </div>
            </div>
          )
        )}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 rounded-lg border border-border bg-card p-1 w-fit">
        {(["all", "pending", "approved", "rejected"] as StatusFilter[]).map(
          (s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`rounded-md px-4 py-1.5 text-sm font-medium capitalize transition-colors ${
                filter === s
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {s}
              {counts[s] > 0 && s !== "all" && (
                <span className="ml-1.5 rounded-full bg-background/30 px-1.5 py-0.5 text-xs">
                  {counts[s]}
                </span>
              )}
            </button>
          )
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
          <button
            onClick={fetchUsers}
            className="ml-3 underline hover:no-underline"
          >
            Retry
          </button>
        </div>
      )}

      {/* User list */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-muted-foreground">
            No {filter === "all" ? "" : filter} users found.
          </div>
        ) : (
          <table className="w-full hidden md:table">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 text-left">User</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Apps</th>
                <th className="px-4 py-3 text-left">Joined</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((user) => {
                const busy = actionLoading.has(user.id);
                const isAdminSelf = user.email === session.user?.email;
                return (
                  <tr
                    key={user.id}
                    className={`transition-colors ${isAdminSelf ? "opacity-50" : "hover:bg-accent/30"}`}
                  >
                    {/* User */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {user.avatar_url ? (
                          <Image
                            src={user.avatar_url}
                            alt={user.name ?? user.email}
                            width={32}
                            height={32}
                            className="rounded-full"
                          />
                        ) : (
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/20 text-sm font-bold text-primary">
                            {(user.name ?? user.email)[0].toUpperCase()}
                          </div>
                        )}
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium">
                              {user.name ?? "—"}
                            </p>
                            {isAdminSelf && (
                              <span className="rounded-full bg-primary/20 px-1.5 py-0.5 text-xs font-semibold text-primary">
                                You
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {user.email}
                          </p>
                        </div>
                      </div>
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          STATUS_COLORS[user.status] ?? ""
                        }`}
                      >
                        {user.status}
                      </span>
                    </td>

                    {/* Apps */}
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {user.application_count}
                    </td>

                    {/* Joined */}
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {new Date(user.created_at).toLocaleDateString("en-GB", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3">
                      {isAdminSelf ? (
                        <p className="text-right text-xs text-muted-foreground italic">
                          admin account
                        </p>
                      ) : (
                        <div className="flex items-center justify-end gap-2">
                          {user.status !== "approved" && (
                            <button
                              disabled={busy}
                              onClick={() =>
                                handleStatusChange(user.id, "approved")
                              }
                              className="rounded-md bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-500 disabled:opacity-50"
                            >
                              Approve
                            </button>
                          )}
                          {user.status !== "rejected" && (
                            <button
                              disabled={busy}
                              onClick={() =>
                                handleStatusChange(user.id, "rejected")
                              }
                              className="rounded-md bg-yellow-600 px-3 py-1 text-xs font-medium text-white hover:bg-yellow-500 disabled:opacity-50"
                            >
                              Reject
                            </button>
                          )}
                          {user.status !== "pending" && (
                            <button
                              disabled={busy}
                              onClick={() =>
                                handleStatusChange(user.id, "pending")
                              }
                              className="rounded-md border border-border px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
                            >
                              Revoke
                            </button>
                          )}
                          <button
                            disabled={busy}
                            onClick={() => handleDelete(user)}
                            className="rounded-md bg-red-600/80 px-3 py-1 text-xs font-medium text-white hover:bg-red-600 disabled:opacity-50"
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {/* Mobile card list */}
        {!loading && filtered.length > 0 && (
          <div className="md:hidden divide-y divide-border">
            {filtered.map((user) => {
              const busy = actionLoading.has(user.id);
              const isAdminSelf = user.email === session.user?.email;
              return (
                <div
                  key={user.id}
                  className={`p-4 space-y-3 ${isAdminSelf ? "opacity-50" : ""}`}
                >
                  {/* User info */}
                  <div className="flex items-center gap-3">
                    {user.avatar_url ? (
                      <Image src={user.avatar_url} alt={user.name ?? user.email} width={36} height={36} className="rounded-full shrink-0" />
                    ) : (
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/20 text-sm font-bold text-primary">
                        {(user.name ?? user.email)[0].toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium truncate">{user.name ?? "—"}</p>
                        {isAdminSelf && (
                          <span className="rounded-full bg-primary/20 px-1.5 py-0.5 text-xs font-semibold text-primary shrink-0">You</span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                    </div>
                    <span className={`ml-auto shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[user.status] ?? ""}`}>
                      {user.status}
                    </span>
                  </div>

                  {/* Meta */}
                  <p className="text-xs text-muted-foreground">
                    {user.application_count} app{user.application_count !== 1 ? "s" : ""} · Joined {new Date(user.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                  </p>

                  {/* Actions */}
                  {!isAdminSelf && (
                    <div className="flex flex-wrap gap-2">
                      {user.status !== "approved" && (
                        <button disabled={busy} onClick={() => handleStatusChange(user.id, "approved")} className="rounded-md bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-500 disabled:opacity-50">Approve</button>
                      )}
                      {user.status !== "rejected" && (
                        <button disabled={busy} onClick={() => handleStatusChange(user.id, "rejected")} className="rounded-md bg-yellow-600 px-3 py-1 text-xs font-medium text-white hover:bg-yellow-500 disabled:opacity-50">Reject</button>
                      )}
                      {user.status !== "pending" && (
                        <button disabled={busy} onClick={() => handleStatusChange(user.id, "pending")} className="rounded-md border border-border px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-50">Revoke</button>
                      )}
                      <button disabled={busy} onClick={() => handleDelete(user)} className="rounded-md bg-red-600/80 px-3 py-1 text-xs font-medium text-white hover:bg-red-600 disabled:opacity-50">Delete</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
