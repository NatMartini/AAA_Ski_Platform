"use client";

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { Bell, Check, CheckCheck, ChevronRight, Loader2, RefreshCw, X } from "lucide-react";
import { Link, usePathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { notificationLabel, type InboxNotification } from "@/lib/notifications";
import {
  markNotificationsRead, readNotificationKeys, serverNotificationReadKeys,
  subscribeNotificationReads,
} from "@/lib/notification-read-state";

const COPY = {
  zh: {
    title: "消息提醒", unread: "条未读消息", empty: "暂时没有消息提醒。",
    recent: "显示待处理事项和最近 30 天的更新。", action: "待处理",
    readAll: "全部标为已读", read: "标为已读", refresh: "刷新消息", close: "关闭消息提醒",
    loading: "正在加载消息…", error: "消息暂时无法更新，请重试。", retry: "重试",
    signedOut: "登录状态已变化，请重新登录。",
    local: "已读状态保存在此浏览器。",
  },
  en: {
    title: "Notifications", unread: "unread notifications", empty: "No notifications yet.",
    recent: "Pending actions and updates from the last 30 days.", action: "Action needed",
    readAll: "Mark all read", read: "Mark read", refresh: "Refresh notifications", close: "Close notifications",
    loading: "Loading notifications…", error: "Notifications could not update. Please retry.", retry: "Retry",
    signedOut: "Your sign-in changed. Please sign in again.",
    local: "Read status is saved in this browser.",
  },
} as const;

export function NotificationBell({ userId, locale }: { userId: string; locale: Locale }) {
  const c = COPY[locale];
  const pathname = usePathname();
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<InboxNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<"connection" | "session" | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const subscribe = useCallback((onChange: () => void) => subscribeNotificationReads(userId, onChange), [userId]);
  const snapshot = useCallback(() => readNotificationKeys(userId), [userId]);
  const readKeys = useSyncExternalStore(subscribe, snapshot, serverNotificationReadKeys);
  const read = new Set(readKeys);
  const unread = items.filter((item) => !read.has(item.key)).length;

  useEffect(() => {
    const controller = new AbortController();
    let fetching = false;
    async function refresh() {
      if (fetching) return;
      fetching = true;
      try {
        const response = await fetch("/api/notifications", {
          cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
        });
        if (controller.signal.aborted) return;
        if (response.status === 401 || response.status === 403) {
          setItems([]);
          setError("session");
          return;
        }
        if (!response.ok) throw new Error("Notifications unavailable");
        const data = await response.json();
        if (controller.signal.aborted) return;
        if (data.userId !== userId) {
          setItems([]);
          setError("session");
          return;
        }
        if (!Array.isArray(data.items)) throw new Error("Invalid notification response");
        setItems(data.items);
        setError(null);
      } catch {
        if (!controller.signal.aborted) setError("connection");
      } finally {
        fetching = false;
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void refresh();
    const visibleRefresh = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const interval = window.setInterval(visibleRefresh, 60_000);
    window.addEventListener("focus", visibleRefresh);
    document.addEventListener("visibilitychange", visibleRefresh);
    return () => {
      controller.abort();
      window.clearInterval(interval);
      window.removeEventListener("focus", visibleRefresh);
      document.removeEventListener("visibilitychange", visibleRefresh);
    };
  }, [userId, pathname, refreshVersion]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!trigger.current?.contains(target) && !panel.current?.contains(target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  function refresh() {
    setLoading(true);
    setRefreshVersion((version) => version + 1);
  }

  return (
    <div className="contents">
      <button
        ref={trigger}
        type="button"
        aria-label={`${c.title}${unread ? ` — ${unread} ${c.unread}` : ""}`}
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        onClick={() => {
          setOpen(!open);
          if (!open) refresh();
        }}
        className="press relative flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-ink-2 hover:border-border-strong hover:text-ink"
      >
        <Bell className="size-4" aria-hidden />
        {unread > 0 && (
          <span aria-hidden className="absolute -right-1 -top-1 flex min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold leading-4 text-white">
            {unread}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={panel}
          id={`${id}-panel`}
          role="region"
          aria-labelledby={`${id}-title`}
          className="absolute left-3 right-3 top-full z-50 mt-2 overflow-hidden rounded-2xl border border-border-strong bg-surface shadow-[var(--shadow-lg)] sm:left-auto sm:right-6 sm:w-96"
        >
          <div className="flex items-center gap-2 border-b border-border p-3">
            <h2 id={`${id}-title`} className="min-w-0 flex-1 text-sm font-bold">{c.title}</h2>
            <button type="button" disabled={loading} onClick={refresh} aria-label={c.refresh} className="flex size-9 items-center justify-center rounded-lg text-ink-2 hover:bg-surface-2 disabled:opacity-40">
              <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} aria-hidden />
            </button>
            <button type="button" onClick={() => { setOpen(false); trigger.current?.focus(); }} aria-label={c.close} className="flex size-9 items-center justify-center rounded-lg text-ink-2 hover:bg-surface-2">
              <X className="size-4" aria-hidden />
            </button>
          </div>
          <div className="max-h-[min(65vh,32rem)] overflow-y-auto overscroll-contain p-3">
            {error && (
              <div role="status" className="mb-3 rounded-lg border border-border bg-surface-2 p-3 text-xs text-ink-2">
                <p>{error === "session" ? c.signedOut : c.error}</p>
                {error === "connection" && <button type="button" onClick={refresh} className="mt-2 font-bold text-accent underline">{c.retry}</button>}
              </div>
            )}
            {loading && items.length === 0 ? (
              <p role="status" className="flex items-center justify-center gap-2 py-7 text-sm text-ink-3"><Loader2 className="size-4 animate-spin" aria-hidden />{c.loading}</p>
            ) : items.length === 0 ? (
              <p className="py-7 text-center text-sm text-ink-3">{c.empty}</p>
            ) : (
              <ul className="space-y-2">
                {items.map((item) => {
                  const isRead = read.has(item.key);
                  const label = notificationLabel(item.kind, locale);
                  return (
                    <li key={item.key} className={`flex items-start rounded-xl border ${isRead ? "border-border bg-surface text-ink-2" : "border-border-strong bg-surface-2 text-ink"}`}>
                      <Link href={item.href} onClick={() => { markNotificationsRead(userId, [item.key]); setOpen(false); }} className="min-w-0 flex-1 rounded-xl p-3 hover:bg-surface-3">
                        <span className="flex items-start gap-2 text-sm font-semibold"><span className="flex-1">{label}</span><ChevronRight className="mt-0.5 size-4 shrink-0" aria-hidden /></span>
                        <span className="mt-1 block font-mono text-[11px] text-ink-3">{item.code}</span>
                        {item.actionable && <span className="mt-1 block text-[11px] font-bold text-accent">{c.action}</span>}
                      </Link>
                      {!isRead && <button type="button" onClick={() => markNotificationsRead(userId, [item.key])} aria-label={`${c.read}: ${label} ${item.code}`} className="mr-1 mt-1 flex size-9 shrink-0 items-center justify-center rounded-lg text-ink-3 hover:bg-surface-3 hover:text-ink"><Check className="size-4" aria-hidden /></button>}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div className="space-y-2 border-t border-border p-3">
            <button type="button" disabled={unread === 0} onClick={() => markNotificationsRead(userId, items.map((item) => item.key))} className="flex min-h-9 items-center gap-2 text-xs font-bold text-accent disabled:opacity-40"><CheckCheck className="size-4" aria-hidden />{c.readAll}</button>
            <p className="text-[11px] leading-relaxed text-ink-3">{c.recent} {c.local}</p>
          </div>
        </div>
      )}
    </div>
  );
}
