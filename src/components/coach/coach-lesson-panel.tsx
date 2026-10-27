"use client";

import { clientFetch } from "@/lib/client-fetch";

import { useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FieldError, Hint, Input, Label, Textarea } from "@/components/ui/field";
import { formatMoneyShort } from "@/lib/pricing";
import type { Locale } from "@/i18n/routing";
import {
  BadgeDollarSign,
  Check,
  Loader2,
  NotebookPen,
  XCircle,
} from "lucide-react";

const COPY = {
  zh: {
    balanceTitle: "尾款",
    balanceOwing: "待收尾款",
    balanceUnpaid: "学员尚未支付定金。定金 {deposit},尾款 {rest} 课后收。",
    balancePaid: "已收全款",
    balanceHint: "学员先付了一小时定金。课后收到尾款后点这里记录。",
    balanceNote: "备注(仅自己可见,如“现场现金”)",
    markPaid: "标记尾款已收",
    summaryTitle: "课后总结",
    summaryHint: "学员会在自己的订单页看到这段总结,第一次保存时会收到邮件提醒。",
    summaryPlaceholder: "今天练了什么、下次的重点、需要注意的地方……",
    saveSummary: "保存总结",
    completeTitle: "确认课程已完成",
    completeHint: "课程结束后确认完成，解锁本节课的共享视频分析额度：2 小时 3 次、3 小时 5 次，1v2、1v3 不按人数增加。尾款仍可继续登记。",
    completeFuture: "授课时间结束后才能确认完成。",
    completeAction: "确认课程已完成，解锁视频分析",
    completeFailed: "暂时无法确认完成。请检查课程状态和结束时间后重试。",
    videoTitle: "课程视频",
    videoHint: "上传课上拍的片段。只有这名学员和平台教练能看到,单个文件最大 200MB。",
    addVideo: "上传视频",
    caption: "说明(可选)",
    deleteVideo: "删除",
    confirmDelete: "确定删除这个视频?",
    cancelTitle: "取消这节课",
    cancelHint: "取消后时段立即释放,学员会收到带有原因的邮件。退款请自行与学员结算。",
    cancelReason: "取消原因(会发给学员)",
    cancelAction: "取消这节课",
    confirmCancel: "确定取消这节课?此操作无法撤销。",
    saved: "已保存",
    needReason: "请填写取消原因。",
    tooLarge: "文件太大,请压缩后再传(最大 200MB)。",
    badType: "只支持 MP4、MOV 或 WebM 格式的视频。",
    failed: "操作失败,请重试。",
  },
  en: {
    balanceTitle: "Balance",
    balanceOwing: "Still owing",
    balanceUnpaid:
      "The deposit has not cleared yet: {deposit} up front, {rest} after the lesson.",
    balancePaid: "Paid in full",
    balanceHint:
      "The student paid one hour up front. Record the rest here once you have it.",
    balanceNote: "Note (only you see this, e.g. “cash on the hill”)",
    markPaid: "Mark balance received",
    summaryTitle: "Lesson notes",
    summaryHint:
      "The student sees this on their booking page, and is emailed the first time you save it.",
    summaryPlaceholder:
      "What you worked on, what to focus on next time, anything to watch…",
    saveSummary: "Save notes",
    completeTitle: "Complete this lesson",
    completeHint: "After the lesson ends, confirm completion to unlock shared analyses: 3 for a two-hour lesson, 5 for a three-hour lesson, regardless of group size. You can still record an outstanding balance.",
    completeFuture: "Completion is available after the teaching time ends.",
    completeAction: "Complete lesson and unlock video analysis",
    completeFailed: "The lesson could not be completed. Check its status and end time, then try again.",
    videoTitle: "Lesson video",
    videoHint:
      "Upload clips from the lesson. Only this student and the platform coaches can see them; 200MB per file.",
    addVideo: "Upload video",
    caption: "Caption (optional)",
    deleteVideo: "Delete",
    confirmDelete: "Delete this video?",
    cancelTitle: "Cancel this lesson",
    cancelHint:
      "The slot is freed immediately and the student is emailed your reason. Settle any refund with them directly.",
    cancelReason: "Reason (sent to the student)",
    cancelAction: "Cancel this lesson",
    confirmCancel: "Cancel this lesson? This cannot be undone.",
    saved: "Saved",
    needReason: "Please give a reason.",
    tooLarge: "That file is too large — 200MB maximum.",
    badType: "Videos must be MP4, MOV or WebM.",
    failed: "That did not work. Please try again.",
  },
} as const;

/**
 * Everything the coach does with a lesson that is not payment review: record
 * the outstanding balance, write the notes, mark it completed, call it off.
 *
 * Separate from CoachReviewPanel because these actions belong to a different
 * moment — that panel is about getting the booking confirmed, this one is
 * mostly about what happens on and after the day.
 */
export function CoachLessonPanel({
  locale,
  bookingCode,
  balanceCents,
  paidCents,
  depositCents,
  isDeposit,
  canSettleBalance,
  canCancel,
  summary,
  isConfirmed,
  canComplete,
}: {
  locale: Locale;
  bookingCode: string;
  balanceCents: number;
  /** Cleared so far. Zero means the deposit itself is still outstanding. */
  paidCents: number;
  depositCents: number;
  isDeposit: boolean;
  canSettleBalance: boolean;
  canCancel: boolean;
  summary: string | null;
  isConfirmed: boolean;
  canComplete: boolean;
}) {
  const router = useRouter();
  const c = COPY[locale];

  const [note, setNote] = useState("");
  const [text, setText] = useState(summary ?? "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function call(
    what: string,
    path: string,
    method: string,
    body?: unknown,
  ) {
    setBusy(what);
    setError(null);
    const res = await clientFetch(`/api/bookings/${bookingCode}${path}`, {
      method,
      headers: { "content-type": "application/json", "x-locale": locale },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    setBusy(null);
    if (!res.ok) {
      setError(what === "complete" ? c.completeFailed : c.failed);
      return false;
    }
    setSaved(what);
    router.refresh();
    return true;
  }

  return (
    <div className="space-y-5">
      {isDeposit && (
        <Card className="space-y-3">
          <CardTitle className="flex items-center gap-2">
            <BadgeDollarSign className="size-4 text-accent" aria-hidden />
            {c.balanceTitle}
          </CardTitle>
          {balanceCents > 0 ? (
            <>
              {/* Before the deposit clears there is no "balance" yet — saying
                  the whole total is outstanding reads as though the student
                  paid nothing when in fact they have not paid anything *yet*
                  and the plan is what matters. */}
              {paidCents === 0 ? (
                <p className="text-sm text-ink-2" data-numeric>
                  {c.balanceUnpaid
                    .replace("{deposit}", formatMoneyShort(depositCents))
                    .replace(
                      "{rest}",
                      formatMoneyShort(balanceCents - depositCents),
                    )}
                </p>
              ) : (
                <p className="text-sm" data-numeric>
                  {c.balanceOwing}{" "}
                  <strong className="font-display text-lg">
                    {formatMoneyShort(balanceCents)}
                  </strong>
                </p>
              )}
              <CardDescription>{c.balanceHint}</CardDescription>
              {canSettleBalance && (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="balance-note">{c.balanceNote}</Label>
                    <Input
                      id="balance-note"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      maxLength={200}
                    />
                  </div>
                  <Button
                    className="self-start"
                    disabled={busy === "balance"}
                    onClick={() =>
                      call("balance", "/balance", "POST", {
                        note: note.trim() || null,
                      })
                    }
                  >
                    {busy === "balance" ? (
                      <Loader2 className="animate-spin" aria-hidden />
                    ) : (
                      <Check aria-hidden />
                    )}
                    {c.markPaid}
                  </Button>
                </>
              )}
            </>
          ) : (
            <p
              className="flex items-center gap-2 text-sm font-semibold"
              style={{ color: "var(--success)" }}
            >
              <Check className="size-4" aria-hidden />
              {c.balancePaid}
            </p>
          )}
        </Card>
      )}

      <Card className="space-y-3">
        <CardTitle className="flex items-center gap-2">
          <NotebookPen className="size-4 text-accent" aria-hidden />
          {c.summaryTitle}
        </CardTitle>
        <CardDescription>{c.summaryHint}</CardDescription>
        <Textarea
          id="lesson-summary"
          aria-label={c.summaryTitle}
          rows={6}
          value={text}
          placeholder={c.summaryPlaceholder}
          onChange={(e) => setText(e.target.value)}
          maxLength={4000}
        />
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            disabled={busy === "summary"}
            onClick={() => call("summary", "/summary", "PUT", { summary: text })}
          >
            {busy === "summary" && <Loader2 className="animate-spin" aria-hidden />}
            {c.saveSummary}
          </Button>
          {saved === "summary" && (
            <span
              role="status"
              className="flex items-center gap-1.5 text-sm font-semibold"
              style={{ color: "var(--success)" }}
            >
              <Check className="size-4" aria-hidden />
              {c.saved}
            </span>
          )}
        </div>
      </Card>

      {isConfirmed && <Card className="space-y-3">
        <CardTitle>{c.completeTitle}</CardTitle>
        <CardDescription>{c.completeHint}</CardDescription>
        {!canComplete && <Hint>{c.completeFuture}</Hint>}
        <Button disabled={!canComplete || busy !== null} onClick={() => call("complete", "/complete", "POST")}>
          {busy === "complete" ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />}
          {c.completeAction}
        </Button>
      </Card>}

      {canCancel && (
        <Card
          className="space-y-3"
          style={{ borderColor: "var(--danger-border)" }}
        >
          <CardTitle className="flex items-center gap-2">
            <XCircle className="size-4" style={{ color: "var(--danger)" }} aria-hidden />
            {c.cancelTitle}
          </CardTitle>
          <CardDescription>{c.cancelHint}</CardDescription>
          <div className="space-y-1.5">
            <Label htmlFor="cancel-reason">{c.cancelReason}</Label>
            <Input
              id="cancel-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
            />
            <Hint>{c.needReason}</Hint>
          </div>
          <Button
            variant="danger"
            className="self-start"
            disabled={busy === "cancel" || !reason.trim()}
            onClick={() => {
              if (!window.confirm(c.confirmCancel)) return;
              void call("cancel", "/cancel", "POST", { reason: reason.trim() });
            }}
          >
            {busy === "cancel" && <Loader2 className="animate-spin" aria-hidden />}
            {c.cancelAction}
          </Button>
        </Card>
      )}

      <FieldError>{error}</FieldError>
    </div>
  );
}
