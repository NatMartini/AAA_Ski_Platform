"use client";

import { clientFetch } from "@/lib/client-fetch";

import { useRef, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { Card, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label, Select } from "@/components/ui/field";
import type { PaymentMethod, UploadedBy } from "@prisma/client";
import type { Locale } from "@/i18n/routing";
import { paymentPaths, type PaymentTarget } from "@/lib/payment-target";
import { Check, Loader2, Upload, X } from "lucide-react";

const COPY = {
  zh: {
    title: "付款审核",
    method: "付款方式",
    reference: "参考号",
    uploadedBy: "截图来源",
    byCustomer: "学员上传",
    byCoach: "教练代传",
    noProof: "尚未收到付款截图。",
    wechatPending: "学员说已用微信付款。请在微信里核对收到这笔钱后再确认。",
    wechatPendingOther: "学员说已用微信付款,等收款的教练在微信里核对。",
    wechatDone: "学员用微信付款,没有截图。",
    confirm: "确认收款",
    reject: "驳回付款",
    reason: "驳回原因(会发给学员)",
    needReason: "请填写驳回原因。",
    uploadForStudent: "代学员上传截图",
    uploaded: "已上传。填上参考号后提交。",
    studentReference: "转账参考号 Reference(必填)",
    submit: "提交",
    wechatReceived: "已收到学员的微信付款",
    needReference: "请填写转账参考号。",
    failed: "操作失败,请重试。",
    confirmed: "已确认收款。",
    manualReceipt: "直接登记收款",
    manualHelp: "学员签字后，可直接登记你已实际收到的付款，无需学员上传截图。",
    receiptMethod: "实际收款方式",
    receiptReference: "收款参考号(选填)",
    receivedConfirm: "已核对到账，确认收款",
    manuallyRecorded: "教练已直接登记并确认收款。",
    receiptFailed: "收款未能确认，请刷新订单检查状态后重试。",
  },
  en: {
    title: "Payment review",
    method: "Method",
    reference: "Reference",
    uploadedBy: "Screenshot from",
    byCustomer: "the student",
    byCoach: "you, on their behalf",
    noProof: "No payment screenshot yet.",
    wechatPending:
      "The student says they have paid by WeChat. Check it arrived in WeChat before confirming.",
    wechatPendingOther:
      "The student says they have paid by WeChat. The coach being paid checks it in WeChat.",
    wechatDone: "Paid by WeChat, so there is no screenshot.",
    confirm: "Confirm payment",
    reject: "Reject payment",
    reason: "Reason (sent to the student)",
    needReason: "Please give a reason.",
    uploadForStudent: "Upload screenshot for the student",
    uploaded: "Uploaded. Add the reference, then submit.",
    studentReference: "Transfer reference (required)",
    submit: "Submit",
    wechatReceived: "Received the student's WeChat payment",
    needReference: "Please enter the transfer reference.",
    failed: "That did not work. Please try again.",
    confirmed: "Payment confirmed.",
    manualReceipt: "Record a payment received",
    manualHelp: "After the student signs, record money you have actually received. A student screenshot is not required.",
    receiptMethod: "Payment method received",
    receiptReference: "Receipt reference (optional)",
    receivedConfirm: "Payment received — confirm",
    manuallyRecorded: "The coach recorded and confirmed this payment directly.",
    receiptFailed: "Payment could not be confirmed. Refresh the booking and check its status before retrying.",
  },
} as const;

export function CoachReviewPanel({
  locale,
  target,
  confirmed,
  submitted,
  hasProof,
  proofUploadedBy,
  paymentMethod,
  paymentReference,
  canReview,
  canUploadProof,
  canConfirmReceipt = false,
  expectedUpdatedAt,
}: {
  locale: Locale;
  /** The booking or lesson package whose payment is being reviewed. */
  target: PaymentTarget;
  /** Payment has already been accepted. */
  confirmed: boolean;
  /** A payment is in and waiting for the coach's check. */
  submitted: boolean;
  hasProof: boolean;
  proofUploadedBy: UploadedBy | null;
  paymentMethod: PaymentMethod | null;
  paymentReference: string | null;
  canReview: boolean;
  canUploadProof: boolean;
  /** Only the booking's coach, after a waiver, before a payment is submitted. */
  canConfirmReceipt?: boolean;
  /** Version of the exact payment shown on this page, required for every review. */
  expectedUpdatedAt: string;
}) {
  const router = useRouter();
  const c = COPY[locale];
  const fileRef = useRef<HTMLInputElement>(null);
  const paths = paymentPaths(target);

  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [proofKey, setProofKey] = useState<string | null>(null);
  const [studentReference, setStudentReference] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [receiptMethod, setReceiptMethod] = useState<PaymentMethod>("EMT");
  const [receiptReference, setReceiptReference] = useState("");

  async function confirmReceipt() {
    if (!canConfirmReceipt || target.kind !== "booking") return;
    setBusy(true);
    setError(null);
    const response = await clientFetch(paths.review, {
      method: "POST",
      headers: { "content-type": "application/json", "x-locale": locale },
      body: JSON.stringify({
        action: "confirm",
        expectedUpdatedAt,
        manualReceipt: { method: receiptMethod, reference: receiptReference.trim() || undefined },
      }),
    });
    setBusy(false);
    if (!response.ok) setError(c.receiptFailed);
    router.refresh();
  }

  async function review(action: "confirm" | "reject") {
    if (action === "reject" && !reason.trim()) {
      setError(c.needReason);
      return;
    }
    setBusy(true);
    setError(null);
    const res = await clientFetch(paths.review, {
      method: "POST",
      headers: { "content-type": "application/json", "x-locale": locale },
      body: JSON.stringify({ action, note: reason.trim() || null, expectedUpdatedAt }),
    });
    setBusy(false);
    if (!res.ok) {
      setError(c.failed);
      if (res.status === 409) router.refresh();
      return;
    }
    router.refresh();
  }

  async function uploadForStudent(file: File) {
    setUploading(true);
    setError(null);
    const body = new FormData();
    body.set("file", file);
    body.set("purpose", paths.upload.purpose);
    body.set(paths.upload.field, target.code);
    const res = await clientFetch("/api/upload", { method: "POST", body });
    setUploading(false);
    if (!res.ok) {
      setError(c.failed);
      return;
    }
    const j = (await res.json()) as { key: string };
    setProofKey(j.key);
  }

  async function submitProof() {
    if (!proofKey) return;
    if (!studentReference.trim()) {
      setError(c.needReference);
      return;
    }
    setBusy(true);
    setError(null);
    const res = await clientFetch(paths.submit, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        method: "EMT",
        proofKey,
        reference: studentReference.trim(),
      }),
    });
    setBusy(false);
    if (!res.ok) {
      setError(c.failed);
      return;
    }
    router.refresh();
  }

  /**
   * WeChat has nothing to upload: the coach sees the money arrive and that is
   * the confirmation. Recorded as a WeChat payment, then confirmed in one go.
   */
  async function wechatReceived() {
    setBusy(true);
    setError(null);
    const submitted = await clientFetch(paths.submit, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ method: "WECHAT" }),
    });
    const submission = await submitted.json().catch(() => null) as { updatedAt?: string } | null;
    const submittedVersion = submission?.updatedAt;
    const confirmed = submitted.ok && typeof submittedVersion === "string" && !Number.isNaN(Date.parse(submittedVersion))
      && (await clientFetch(paths.review, {
        method: "POST",
        headers: { "content-type": "application/json", "x-locale": locale },
        body: JSON.stringify({ action: "confirm", note: null, expectedUpdatedAt: submittedVersion }),
      })).ok;
    setBusy(false);
    if (!confirmed) setError(c.failed);
    router.refresh();
  }

  return (
    <Card className="space-y-4 border-ice-500/40">
      <CardTitle>{c.title}</CardTitle>

      {hasProof ? (
        <>
          <dl className="space-y-1 text-sm">
            {paymentMethod && (
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{c.method}</dt>
                <dd>{paymentMethod}</dd>
              </div>
            )}
            {paymentReference && (
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{c.reference}</dt>
                <dd className="font-mono">{paymentReference}</dd>
              </div>
            )}
            {proofUploadedBy && (
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{c.uploadedBy}</dt>
                <dd>
                  {proofUploadedBy === "COACH" ? c.byCoach : c.byCustomer}
                </dd>
              </div>
            )}
          </dl>

          {/* eslint-disable-next-line @next/next/no-img-element -- streamed from
              an authenticated route, never a static asset */}
          <img
            src={`${paths.proof}?v=${encodeURIComponent(expectedUpdatedAt)}`}
            alt=""
            className="max-h-96 rounded-lg border border-border"
          />
        </>
      ) : confirmed && proofUploadedBy === "COACH" ? (
        <div className="space-y-2 text-sm text-ink-2">
          <p>{c.manuallyRecorded}</p>
          {paymentMethod && <p>{c.method}: {paymentMethod}</p>}
          {paymentReference && <p>{c.reference}: <span className="font-mono">{paymentReference}</span></p>}
        </div>
      ) : paymentMethod === "WECHAT" && (submitted || confirmed) ? (
        <p className="text-sm text-ink-2">
          {confirmed
            ? c.wechatDone
            : canReview
              ? c.wechatPending
              : c.wechatPendingOther}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">{c.noProof}</p>
      )}

      {confirmed && (
        <p className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
          <Check className="size-4" aria-hidden />
          {c.confirmed}
        </p>
      )}

      {canReview && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="reject-reason">{c.reason}</Label>
            <Input
              id="reject-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => review("confirm")} disabled={busy}>
              {busy ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <Check aria-hidden />
              )}
              {c.confirm}
            </Button>
            <Button
              variant="danger"
              onClick={() => review("reject")}
              disabled={busy}
            >
              <X aria-hidden />
              {c.reject}
            </Button>
          </div>
        </div>
      )}

      {canConfirmReceipt && target.kind === "booking" && (
        <div className="space-y-3 rounded-xl border border-border bg-surface-2 p-4">
          <h3 className="text-sm font-bold">{c.manualReceipt}</h3>
          <p className="text-xs leading-relaxed text-ink-2">{c.manualHelp}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="receipt-method">{c.receiptMethod}</Label>
              <Select id="receipt-method" value={receiptMethod} disabled={busy || uploading} onChange={(event) => setReceiptMethod(event.target.value as PaymentMethod)}>
                <option value="EMT">Interac e-Transfer</option>
                <option value="WECHAT">{locale === "zh" ? "微信" : "WeChat"}</option>
                <option value="ALIPAY">{locale === "zh" ? "支付宝" : "Alipay"}</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="receipt-reference">{c.receiptReference}</Label>
              <Input id="receipt-reference" value={receiptReference} disabled={busy || uploading} maxLength={200} onChange={(event) => setReceiptReference(event.target.value)} />
            </div>
          </div>
          <Button onClick={confirmReceipt} disabled={busy || uploading}>
            {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />}
            {c.receivedConfirm}
          </Button>
        </div>
      )}

      {canUploadProof && !canReview && (
        <div className="space-y-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void uploadForStudent(file);
              e.target.value = "";
            }}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
            >
              {uploading ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <Upload aria-hidden />
              )}
              {c.uploadForStudent}
            </Button>
            {target.kind === "package" && <Button
              variant="secondary"
              disabled={busy || uploading}
              onClick={wechatReceived}
            >
              {busy && !proofKey ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <Check aria-hidden />
              )}
              {c.wechatReceived}
            </Button>}
          </div>
          {proofKey && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">{c.uploaded}</p>
              <div className="space-y-1.5">
                <Label htmlFor="student-reference">{c.studentReference}</Label>
                <Input
                  id="student-reference"
                  value={studentReference}
                  required
                  onChange={(e) => setStudentReference(e.target.value)}
                  maxLength={200}
                />
              </div>
              <Button
                onClick={submitProof}
                disabled={busy || !studentReference.trim()}
              >
                {busy && <Loader2 className="animate-spin" aria-hidden />}
                {c.submit}
              </Button>
            </div>
          )}
        </div>
      )}

      <FieldError>{error}</FieldError>
    </Card>
  );
}
