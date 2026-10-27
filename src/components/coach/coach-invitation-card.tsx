"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, Copy, Link2, Loader2, Mail, RefreshCw } from "lucide-react";
import { clientFetch } from "@/lib/client-fetch";
import { copyText } from "@/lib/browser-helpers";
import {
  invitationEmailClipboardText, invitationEmailMailto,
  type CoachInvitationEmail,
} from "@/lib/booking/invitation-email";
import type { Locale } from "@/i18n/routing";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FieldError, Hint, Input, Label, Textarea } from "@/components/ui/field";

export type CoachInvitationDraft = { signingUrl: string; invitation: CoachInvitationEmail };

const COPY = {
  zh: {
    title: "发送给学员的邀请邮件", manual: "邮件由教练手动发送。复制下面的固定中英双语邮件，或打开自己的邮件客户端发送。",
    studentRecipient: "收件人（学员本人）", guardianRecipient: "收件人（监护人）",
    subject: "邮件主题", body: "邮件正文（中文 + English）", link: "签字链接",
    full: "复制完整邮件", copySubject: "复制主题", copyBody: "复制正文", copyLink: "复制链接",
    mailClient: "打开邮件客户端", copied: "已复制", copyFailed: "自动复制失败，请手动复制下面已选中的内容。",
    manualCopy: "手动复制内容", generate: "生成邮件与签字链接", regenerate: "重新生成签字链接",
    regenerateHelp: "生成新链接会使之前的签字链接失效，请只发送最新链接。请在邮件注明的截止时间前签署，链接仅可使用一次。",
    signInHelp: "收件人必须使用上面的邮箱登录。签署免责协议后，按订单页面完成付款并提交付款信息，等待教练确认。",
    failed: "未能确认新链接是否生成，请重试；不要发送旧链接。",
    unavailable: "当前订单已不能生成邀请，请刷新订单状态。",
  },
  en: {
    title: "Student invitation email", manual: "The coach sends this email manually. Copy the fixed Chinese and English draft below, or open your own email app to send it.",
    studentRecipient: "Recipient (adult student)", guardianRecipient: "Recipient (parent or guardian)",
    subject: "Email subject", body: "Email body (Chinese + English)", link: "Signing link",
    full: "Copy full email", copySubject: "Copy subject", copyBody: "Copy body", copyLink: "Copy link",
    mailClient: "Open email app", copied: "Copied", copyFailed: "Automatic copying failed. Copy the selected text below manually.",
    manualCopy: "Text to copy manually", generate: "Generate email and signing link", regenerate: "Generate a new signing link",
    regenerateHelp: "Generating a new link invalidates the previous signing link. Send only the newest link. Sign before the deadline stated in the email. The link can be used once.",
    signInHelp: "The recipient must sign in with the address above. After signing the waiver, follow the order page to pay and submit payment information for the coach to confirm.",
    failed: "The new link could not be confirmed. Please retry and do not send an old link.",
    unavailable: "This order can no longer issue an invitation. Refresh its status.",
  },
} as const;

export function CoachInvitationCard({
  locale, code, recipientEmail, isMinor, initial, generateEndpoint, senderRole = "coach", groupSigningOnly = false,
}: {
  locale: Locale;
  code: string;
  recipientEmail: string;
  isMinor: boolean;
  initial?: CoachInvitationDraft;
  generateEndpoint?: string;
  senderRole?: "coach" | "organizer";
  groupSigningOnly?: boolean;
}) {
  const c = COPY[locale];
  const id = useId();
  const [draft, setDraft] = useState<CoachInvitationDraft | null>(initial ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<{ label: string; failed: boolean } | null>(null);
  const [fallback, setFallback] = useState<string | null>(null);
  const fallbackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (fallback !== null) {
      const field = fallbackRef.current?.querySelector("textarea");
      field?.focus();
      field?.select();
    }
  }, [fallback, copyStatus]);

  async function copy(text: string, label: string) {
    try {
      await copyText(text);
      setFallback(null);
      setCopyStatus({ label, failed: false });
    } catch {
      setFallback(text);
      setCopyStatus({ label, failed: true });
    }
  }

  async function generate() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setDraft(null);
    setFallback(null);
    setCopyStatus(null);
    const response = await clientFetch(generateEndpoint ?? `/api/coach/bookings/${encodeURIComponent(code)}/invite`, {
      method: "POST", headers: { "x-locale": locale },
    });
    const data = await response.json().catch(() => null) as (CoachInvitationDraft & { error?: string }) | null;
    if (!response.ok || !data?.signingUrl || !data.invitation?.to || !data.invitation.subject || !data.invitation.text) {
      setError(response.status === 409 || response.status === 410 ? c.unavailable : c.failed);
    } else {
      setDraft({ signingUrl: data.signingUrl, invitation: data.invitation });
    }
    setBusy(false);
  }

  return (
    <Card className="space-y-4">
      <div>
        <CardTitle className="flex items-center gap-2"><Mail className="size-5 shrink-0 text-accent" aria-hidden />{c.title}</CardTitle>
        <CardDescription>{senderRole === "coach" ? c.manual : locale === "zh" ? "把这位学员的个人签字链接发给本人或监护人。每人独立签署，全部签署完成后再由预约人付款。" : "Share this personal signing link with this student or their guardian. Everyone signs independently; the booking organizer pays after all signatures are complete."}</CardDescription>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-recipient`}>{isMinor ? c.guardianRecipient : c.studentRecipient}</Label>
        <Input id={`${id}-recipient`} readOnly value={draft?.invitation.to ?? recipientEmail} onFocus={(event) => event.currentTarget.select()} />
      </div>

      {draft && (
        <>
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-subject`}>{c.subject}</Label>
            <div className="flex flex-wrap gap-2">
              <Input id={`${id}-subject`} readOnly value={draft.invitation.subject} onFocus={(event) => event.currentTarget.select()} className="min-w-0 flex-1 basis-56" />
              <Button type="button" size="sm" variant="secondary" onClick={() => void copy(draft.invitation.subject, c.copySubject)}><Copy aria-hidden />{c.copySubject}</Button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-body`}>{c.body}</Label>
            <Textarea id={`${id}-body`} readOnly rows={13} value={draft.invitation.text} onFocus={(event) => event.currentTarget.select()} className="text-sm" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => void copy(invitationEmailClipboardText(draft.invitation), c.full)}><Copy aria-hidden />{c.full}</Button>
            <Button type="button" variant="secondary" onClick={() => void copy(draft.invitation.text, c.copyBody)}><Copy aria-hidden />{c.copyBody}</Button>
            <Button asChild variant="secondary"><a href={invitationEmailMailto(draft.invitation)}><Mail aria-hidden />{c.mailClient}</a></Button>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-link`}>{c.link}</Label>
            <div className="flex flex-wrap gap-2">
              <Input id={`${id}-link`} readOnly value={draft.signingUrl} onFocus={(event) => event.currentTarget.select()} className="min-w-0 flex-1 basis-56 font-mono text-xs" />
              <Button type="button" size="sm" variant="secondary" onClick={() => void copy(draft.signingUrl, c.copyLink)}><Link2 aria-hidden />{c.copyLink}</Button>
            </div>
            <Hint>{groupSigningOnly ? locale === "zh" ? "收件人必须使用上面的邮箱登录并完成个人签署。所有学员签署后，由预约人完成付款，不需要每人重复付款。" : "The recipient must sign in with the address above and sign their own waiver. After everyone signs, the booking organizer pays for the order. Students do not each pay separately." : c.signInHelp}</Hint>
          </div>
        </>
      )}

      {copyStatus && (copyStatus.failed
        ? <FieldError>{c.copyFailed}</FieldError>
        : <p role="status" className="flex items-center gap-2 text-sm font-semibold text-success"><Check className="size-4" aria-hidden />{c.copied} · {copyStatus.label}</p>)}
      {fallback !== null && <div ref={fallbackRef} className="space-y-1.5"><Label htmlFor={`${id}-fallback`}>{c.manualCopy}</Label><Textarea id={`${id}-fallback`} readOnly rows={8} value={fallback} onFocus={(event) => event.currentTarget.select()} className="font-mono text-xs" /></div>}

      <div className="space-y-2 border-t border-border pt-4">
        <Hint>{c.regenerateHelp}</Hint>
        <FieldError>{error}</FieldError>
        <Button type="button" variant="secondary" disabled={busy} onClick={generate}>{busy ? <Loader2 className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />}{draft ? c.regenerate : c.generate}</Button>
      </div>
    </Card>
  );
}
