"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiClient } from "@/lib/apiClient";
import { useAppSelector } from "@/lib/redux/hooks";

interface NotificationItem {
  id: string;
  type?: string | null;
  message?: string | null;
  is_read: boolean;
  created_at: string;
  ticket_id?: string | null;
  actor?: { id: string; name: string; email: string } | null;
  tickets?: { id: string; title: string; ticket_number?: string; project_id?: string } | null;
}

const POLL_MS = 30_000;

function timeAgo(iso: string) {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function NotificationBell() {
  const router = useRouter();
  const isLoggedIn = useAppSelector((s) => s.auth.isLoggedIn);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get("/notifications");
      setItems(res.data?.notifications ?? []);
      setUnread(res.data?.unread_count ?? 0);
      setError("");
    } catch {
      setError("Could not load notifications.");
    }
  }, []);

  useEffect(() => {
    if (!isLoggedIn) return;
    setLoading(true);
    load().finally(() => setLoading(false));
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [isLoggedIn, load]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const markRead = async (n: NotificationItem) => {
    if (n.is_read) return;
    setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, is_read: true } : x)));
    setUnread((c) => Math.max(0, c - 1));
    try {
      await apiClient.patch(`/notifications/${n.id}/read`);
    } catch {
      void load();
    }
  };

  const markAllRead = async () => {
    setItems((prev) => prev.map((x) => ({ ...x, is_read: true })));
    setUnread(0);
    try {
      await apiClient.patch("/notifications/read-all");
    } catch {
      void load();
    }
  };

  const remove = async (n: NotificationItem) => {
    setItems((prev) => prev.filter((x) => x.id !== n.id));
    if (!n.is_read) setUnread((c) => Math.max(0, c - 1));
    try {
      await apiClient.delete(`/notifications/${n.id}`);
    } catch {
      void load();
    }
  };

  const openNotification = async (n: NotificationItem) => {
    await markRead(n);
    const ticketId = n.tickets?.id ?? n.ticket_id;
    const projectId = n.tickets?.project_id;
    if (ticketId && projectId) {
      setOpen(false);
      router.push(`/project/${projectId}/ticket/${ticketId}`);
    }
  };

  if (!isLoggedIn) return null;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => {
          setOpen((o) => !o);
          if (!open) void load();
        }}
        aria-label="Notifications"
        className="relative w-9 h-9 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-violet-700 transition-colors"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-4.5 h-4.5 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed sm:absolute right-2 sm:right-0 left-2 sm:left-auto top-14 sm:top-11 sm:w-96 bg-white border border-slate-200 rounded-xl shadow-xl shadow-slate-200 z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <h3 className="text-sm font-bold text-slate-900">
              Notifications {unread > 0 && <span className="text-violet-600">({unread})</span>}
            </h3>
            <button
              onClick={markAllRead}
              disabled={unread === 0}
              className="text-xs font-medium text-violet-600 hover:text-violet-800 disabled:text-slate-300 disabled:cursor-not-allowed"
            >
              Mark all read
            </button>
          </div>

          <div className="max-h-96 overflow-y-auto">
            {loading && items.length === 0 && (
              <p className="text-xs text-slate-400 text-center py-8">Loading…</p>
            )}
            {error && <p className="text-xs text-red-500 text-center py-3">{error}</p>}
            {!loading && !error && items.length === 0 && (
              <p className="text-xs text-slate-400 text-center py-8">You&apos;re all caught up 🎉</p>
            )}

            {items.map((n) => (
              <div
                key={n.id}
                className={`group flex items-start gap-3 px-4 py-3 border-b border-slate-50 last:border-0 cursor-pointer hover:bg-slate-50 transition-colors ${n.is_read ? "" : "bg-violet-50/60"}`}
                onClick={() => openNotification(n)}
              >
                <div className="w-8 h-8 shrink-0 rounded-full bg-violet-100 text-violet-700 text-xs font-bold flex items-center justify-center">
                  {(n.actor?.name?.[0] ?? "?").toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-slate-700 leading-snug">
                    <span className="font-semibold text-slate-900">{n.actor?.name ?? "Someone"}</span>{" "}
                    {n.message ?? n.type ?? "sent you a notification"}
                  </p>
                  {n.tickets && (
                    <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                      <span className="font-mono text-slate-400">{n.tickets.ticket_number}</span> {n.tickets.title}
                    </p>
                  )}
                  <p className="text-[10px] text-slate-400 mt-1">{timeAgo(n.created_at)}</p>
                </div>
                <div className="flex flex-col items-center gap-2 shrink-0">
                  {!n.is_read && <span className="w-2 h-2 rounded-full bg-violet-600" />}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      void remove(n);
                    }}
                    aria-label="Delete notification"
                    className="text-slate-300 hover:text-red-500 text-sm leading-none sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}