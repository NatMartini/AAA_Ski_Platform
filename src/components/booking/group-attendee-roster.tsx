"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { Check, Download, FileSignature, Loader2, RefreshCw, Users } from "lucide-react";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { CoachInvitationCard, type CoachInvitationDraft } from "@/components/coach/coach-invitation-card";
import type { Locale } from "@/i18n/routing";

export type GroupInvitationLink = CoachInvitationDraft & {
  attendeeId: string; ordinal: number; fullName: string; email: string; isMinor: boolean;
};
export type GroupRosterAttendee = {
  id: string; ordinal: number; fullName: string; email: string; isMinor: boolean;
  signed: boolean; signedAt?: string | null; canReadPdf?: boolean; canInvite?: boolean;
};

export function GroupAttendeeRoster({
  locale, code, attendees: initialAttendees, allSigned: initialAllSigned,
  canManage, senderRole = "organizer", invitations = [], poll = true,
}: {
  locale: Locale;
  code: string;
  attendees: GroupRosterAttendee[];
  allSigned: boolean;
  canManage: boolean;
  senderRole?: "coach" | "organizer";
  invitations?: GroupInvitationLink[];
  poll?: boolean;
}) {
  const zh = locale === "zh";
  const router = useRouter();
  const [rows, setRows] = useState(initialAttendees);
  const [allSigned, setAllSigned] = useState(initialAllSigned);
  const [manage, setManage] = useState(canManage);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const ready = useRef(initialAllSigned);

  useEffect(() => {
    if (!poll) return;
    const controller = new AbortController();
    let loading = false;
    async function refresh() {
      if (loading) return;
      loading = true;
      try {
        const response = await fetch(`/api/bookings/${encodeURIComponent(code)}/attendees`, {
          cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
        });
        if (controller.signal.aborted) return;
        if (response.status === 401 || response.status === 403) {
          setRows([]);
          setAllSigned(false);
          setManage(false);
          setError(true);
          router.refresh();
          return;
        }
        if (!response.ok) throw new Error("Cannot read roster");
        const data = await response.json();
        if (controller.signal.aborted) return;
        if (!Array.isArray(data.attendees) || typeof data.allSigned !== "boolean") throw new Error("Invalid roster");
        setRows(data.attendees);
        setAllSigned(data.allSigned);
        if (typeof data.canManage === "boolean") setManage(data.canManage);
        setError(false);
        if (data.allSigned !== ready.current) {
          ready.current = data.allSigned;
          router.refresh();
        }
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        loading = false;
        if (!controller.signal.aborted) setBusy(false);
      }
    }
    void refresh();
    const visible = () => { if (document.visibilityState === "visible") void refresh(); };
    const interval = window.setInterval(visible, 30_000);
    window.addEventListener("focus", visible);
    return () => { controller.abort(); window.clearInterval(interval); window.removeEventListener("focus", visible); };
  }, [code, poll, refreshVersion, router]);

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2"><Users className="size-5 text-accent" aria-hidden />{zh ? "每位学员的签署状态" : "Each student's waiver"}</CardTitle>
        {poll && <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => { setBusy(true); setRefreshVersion((value) => value + 1); }}>{busy ? <Loader2 className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />}{zh ? "刷新状态" : "Refresh status"}</Button>}
      </div>
      <CardDescription>{allSigned ? zh ? "所有学员已完成免责协议签署。" : "Everyone has signed their waiver." : zh ? "每位成年学员本人或未成年学员的监护人必须独立签署。全部签署完成后才开放付款。" : "Every adult student or minor's guardian must sign independently. Payment opens after all signatures are complete."}</CardDescription>
      <FieldError>{error ? zh ? "暂时无法更新签署状态，请刷新重试。" : "Could not update signing status. Please retry." : null}</FieldError>
      <ul className="space-y-4">
        {rows.map((attendee) => {
          const initial = invitations.find((invitation) => invitation.attendeeId === attendee.id);
          return (
            <li key={attendee.id} className="space-y-3 rounded-xl border border-border p-3 sm:p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="break-words text-sm font-bold">{attendee.fullName}</p>
                  <p className="mt-1 break-all text-xs text-ink-3">{attendee.isMinor ? zh ? "监护人邮箱：" : "Guardian email: " : zh ? "本人邮箱：" : "Student email: "}{attendee.email}</p>
                </div>
                <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${attendee.signed ? "bg-success-bg text-success" : "bg-amber-bg text-amber"}`}>{attendee.signed ? <Check className="size-3" aria-hidden /> : <FileSignature className="size-3" aria-hidden />}{attendee.signed ? zh ? "已签署" : "Signed" : zh ? "待签署" : "Signature needed"}</span>
              </div>
              {attendee.signed && attendee.canReadPdf && <Button asChild variant="secondary" size="sm"><a href={`/api/bookings/${encodeURIComponent(code)}/waiver-pdf?attendee=${encodeURIComponent(attendee.id)}`}><Download aria-hidden />{zh ? "下载本人已签协议" : "Download signed waiver"}</a></Button>}
              {!attendee.signed && manage && attendee.canInvite !== false && <CoachInvitationCard
                locale={locale} code={code} recipientEmail={attendee.email} isMinor={attendee.isMinor}
                initial={initial} senderRole={senderRole} groupSigningOnly
                generateEndpoint={`/api/bookings/${encodeURIComponent(code)}/attendees/${encodeURIComponent(attendee.id)}/invite`}
              />}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
