"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Gift, Loader2, RefreshCw } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { clientFetch } from "@/lib/client-fetch";
import { clientRandomUUID } from "@/lib/browser-helpers";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { FieldError, Hint, Input, Label, Textarea } from "@/components/ui/field";

type GrantRecord = {
  id: string;
  quantity: number;
  note: string | null;
  createdAt: string;
  recipient: { name: string | null; email: string };
  coach: { name: string | null };
};

type Props = { locale: Locale; coachId: string };

function grantRecords(body: unknown): GrantRecord[] | null {
  if (!body || typeof body !== "object" || !("ok" in body) || body.ok !== true || !("grants" in body) || !Array.isArray(body.grants)) return null;
  if (!body.grants.every((grant: unknown) => {
    if (!grant || typeof grant !== "object") return false;
    const value = grant as Partial<GrantRecord>;
    return typeof value.id === "string" && Number.isInteger(value.quantity) && (value.quantity ?? 0) >= 1 && (value.quantity ?? 0) <= 100
      && (value.note === null || typeof value.note === "string") && typeof value.createdAt === "string" && Number.isFinite(Date.parse(value.createdAt))
      && typeof value.recipient?.email === "string" && (value.recipient.name === null || typeof value.recipient.name === "string")
      && !!value.coach && (value.coach.name === null || typeof value.coach.name === "string");
  })) return null;
  return body.grants as GrantRecord[];
}

/** A changed SSR identity creates a fresh form and discards the previous coach's drafts. */
export function VideoAnalysisGrants(props: Props) {
  return <CreditGrantWorkspace key={props.coachId} {...props} />;
}

function CreditGrantWorkspace({ locale, coachId }: Props) {
  const zh = locale === "zh";
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [quantity, setQuantity] = useState("3");
  const [note, setNote] = useState("");
  const [grants, setGrants] = useState<GrantRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [identityChanged, setIdentityChanged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const requestKeys = useRef(new Map<string, string>());
  const submittingRef = useRef(false);
  const identityBlocked = useRef(false);
  const loadVersion = useRef(0);
  const mounted = useRef(true);
  const failedLoad = zh ? "发放记录读取失败，请重新读取。" : "Could not load issued credits. Please retry.";
  const changedMessage = zh ? "登录账号或权限已变化，请刷新页面后重新填写。" : "Your signed-in account or permissions changed. Refresh the page before completing this form again.";

  const handleIdentityChange = useCallback(() => {
    identityBlocked.current = true;
    setIdentityChanged(true);
    setGrants([]);
    setSuccess(null);
    setError(changedMessage);
    router.refresh();
  }, [changedMessage, router]);

  const load = useCallback(async (signal?: AbortSignal) => {
    const version = ++loadVersion.current;
    setLoading(true);
    const response = await clientFetch(`/api/coach/video-analysis/grants?expectedCoachId=${encodeURIComponent(coachId)}`, { cache: "no-store", signal });
    const body = await response.json().catch(() => null);
    if (signal?.aborted || !mounted.current || version !== loadVersion.current) return;
    setLoading(false);
    if (response.status === 401 || response.status === 403 || ["session-changed", "state-changed"].includes(body?.error)) {
      handleIdentityChange();
      return;
    }
    if (response.ok && body?.coachId !== coachId) {
      handleIdentityChange();
      return;
    }
    const records = response.ok ? grantRecords(body) : null;
    if (!records) {
      setLoadError(failedLoad);
      return;
    }
    setGrants(records);
    setLoadError(null);
  }, [coachId, failedLoad, handleIdentityChange]);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    const timer = window.setTimeout(() => void load(controller.signal), 0);
    return () => { mounted.current = false; controller.abort(); window.clearTimeout(timer); };
  }, [load]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current || identityBlocked.current || identityChanged) return;
    const recipientEmail = email.trim().toLowerCase();
    const amount = /^\d+$/.test(quantity.trim()) ? Number(quantity.trim()) : NaN;
    const trimmedNote = note.trim();
    setError(null);
    setSuccess(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail) || recipientEmail.length > 254 || !Number.isInteger(amount) || amount < 1 || amount > 100 || trimmedNote.length > 500) {
      setError(zh ? "请填写学员注册邮箱、1–100 的整数次数，备注最多 500 字。" : "Enter the student's registered email, a whole number from 1 to 100, and a note of at most 500 characters.");
      return;
    }
    const payload = { recipientEmail, quantity: amount, note: trimmedNote || null, expectedCoachId: coachId };
    const fingerprint = JSON.stringify(payload);
    let requestKey = requestKeys.current.get(fingerprint);
    if (!requestKey) {
      requestKey = clientRandomUUID();
      requestKeys.current.set(fingerprint, requestKey);
    }
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const response = await clientFetch("/api/coach/video-analysis/grants", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...payload, requestKey }),
      });
      const body = await response.json().catch(() => null);
      if (!mounted.current) return;
      if (response.status === 401 || response.status === 403 || ["session-changed", "state-changed"].includes(body?.error)) {
        handleIdentityChange();
        return;
      }
      if (!response.ok || body?.ok !== true) {
        const unavailableRecipient = ["recipient-not-found", "recipient-not-eligible", "student-not-found", "recipient-disabled", "recipient-not-customer", "invalid-recipient"].includes(body?.error);
        setError(unavailableRecipient
          ? zh ? "未找到可用的学员账号。请让学员先注册，再核对其注册邮箱。" : "No eligible student account was found. Ask the student to register and check their registered email."
          : zh ? "发放未能确认，请重试。重试同一份信息不会重复发放。" : "Credit issuance could not be confirmed. Retry the same details to avoid issuing duplicate credits.");
        return;
      }
      requestKeys.current.delete(fingerprint);
      setSuccess(zh ? `已向 ${recipientEmail} 发放 ${amount} 次 FreeSki 分析。` : `Issued ${amount} FreeSki analyses to ${recipientEmail}.`);
      setEmail("");
      setQuantity("3");
      setNote("");
      await load();
    } finally {
      submittingRef.current = false;
      if (mounted.current) setSubmitting(false);
    }
  }

  return <div className="space-y-6">
    <Card className="space-y-5">
      <div className="space-y-2">
        <CardTitle className="flex items-center gap-2"><Gift className="size-5 text-accent" aria-hidden />{zh ? "给学员发放分析次数" : "Issue analysis credits to a student"}</CardTitle>
        <CardDescription>{zh ? "发到学员的平台账号，立即可用。学员可在 FreeSki 页面直接上传滑雪视频分析，不需要课程订单。发放记录会保留；学员的视频和结果只由本人查看。" : "Credits are available immediately in the student's platform account. They can upload skiing videos on the FreeSki page without a lesson order. Issuance is recorded; personal videos and results remain private to the student."}</CardDescription>
      </div>
      <form onSubmit={(event) => void submit(event)} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_9rem]">
          <div className="space-y-2">
            <Label htmlFor="analysis-grant-email">{zh ? "学员注册邮箱" : "Student's registered email"}</Label>
            <Input id="analysis-grant-email" type="email" required maxLength={254} autoComplete="off" value={email} disabled={submitting || identityChanged} onChange={(event) => setEmail(event.target.value)} aria-describedby="analysis-grant-email-help" />
            <p id="analysis-grant-email-help" className="text-xs leading-relaxed text-ink-3">{zh ? "学员需先用此邮箱登录平台，创建学员账号。" : "The student must first sign in to the platform with this email to create a student account."}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="analysis-grant-quantity">{zh ? "发放次数" : "Number of credits"}</Label>
            <Input id="analysis-grant-quantity" type="number" inputMode="numeric" min={1} max={100} step={1} required value={quantity} disabled={submitting || identityChanged} onChange={(event) => setQuantity(event.target.value)} />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="analysis-grant-note">{zh ? "备注（选填）" : "Note (optional)"}</Label>
          <Textarea id="analysis-grant-note" maxLength={500} value={note} disabled={submitting || identityChanged} onChange={(event) => setNote(event.target.value)} placeholder={zh ? "例如：课后练习、体验分析" : "For example: practice after a lesson or a trial analysis"} />
          <Hint>{zh ? "学员可以看到这条备注。发放为赠送次数，记录不可修改。" : "The student can see this note. These are complimentary credits; the issuance record cannot be edited."}</Hint>
        </div>
        <FieldError>{error}</FieldError>
        {success && <p role="status" className="break-words text-sm font-semibold text-success">{success}</p>}
        <Button type="submit" disabled={submitting || identityChanged}>{submitting ? <Loader2 className="animate-spin" aria-hidden /> : <Gift aria-hidden />}{zh ? "发放 FreeSki 次数" : "Issue FreeSki credits"}</Button>
      </form>
    </Card>
    <section className="space-y-3" aria-labelledby="analysis-grant-history-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="analysis-grant-history-heading" className="text-lg font-extrabold">{zh ? "我的发放记录" : "My issued credits"}</h2>
        <Button variant="secondary" size="sm" disabled={loading || submitting || identityChanged} onClick={() => void load()}><RefreshCw className={loading ? "animate-spin" : undefined} aria-hidden />{zh ? "刷新记录" : "Refresh records"}</Button>
      </div>
      <FieldError>{loadError}</FieldError>
      {loading && grants.length === 0 ? <p role="status" className="text-sm text-ink-3">{zh ? "正在读取记录…" : "Loading records…"}</p> : !loadError && !identityChanged && grants.length === 0 ? <Card><CardDescription>{zh ? "还没有发放记录。" : "No credits issued yet."}</CardDescription></Card> : null}
      <div className="space-y-3">{grants.map((grant) => <Card key={grant.id} className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1"><p className="break-words font-bold">{grant.recipient.name || grant.recipient.email}</p><p className="break-all text-sm text-ink-2">{grant.recipient.email}</p></div>
          <p className="shrink-0 rounded-full bg-accent-soft px-3 py-1 text-sm font-bold text-accent">+{grant.quantity} {zh ? "次" : "credits"}</p>
        </div>
        <p className="text-xs text-ink-3">{new Intl.DateTimeFormat(zh ? "zh-CN" : "en-CA", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Toronto" }).format(new Date(grant.createdAt))}</p>
        {grant.note && <p className="whitespace-pre-wrap break-words text-sm text-ink-2">{grant.note}</p>}
      </Card>)}</div>
    </section>
  </div>;
}
