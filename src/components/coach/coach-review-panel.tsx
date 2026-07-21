"use client";

import { useRef, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { Card, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/field";
import type { BookingStatus, PaymentMethod, UploadedBy } from "@prisma/client";
import type { Locale } from "@/i18n/routing";
import { Check, Loader2, Upload, X } from "lucide-react";

const COPY = {
  zh: {
    title: "付款审核",
    method: "付款方式",
    reference: "转账备注",
    uploadedBy: "截图来源",
    byCustomer: "学员上传",
    byCoach: "教练代传",
    noProof: "尚未收到付款截图。",
    confirm: "确认收款",
    reject: "驳回付款",
    reason: "驳回原因(会发给学员)",
    needReason: "请填写驳回原因。",
    uploadForStudent: "代学员上传截图",
    uploaded: "已上传,请提交",
    submit: "提交",
    failed: "操作失败,请重试。",
    confirmed: "已确认收款。",
  },
  en: {
    title: "Payment review",
    method: "Method",
    reference: "Reference",
    uploadedBy: "Screenshot from",
    byCustomer: "the student",
    byCoach: "you, on their behalf",
    noProof: "No payment screenshot yet.",
    confirm: "Confirm payment",
    reject: "Reject payment",
    reason: "Reason (sent to the student)",
    needReason: "Please give a reason.",
    uploadForStudent: "Upload screenshot for the student",
    uploaded: "Uploaded — now submit it",
    submit: "Submit",
    failed: "That did not work. Please try again.",
    confirmed: "Payment confirmed.",
  },
} as const;

export function CoachReviewPanel({
  locale,
  bookingCode,
  status,
  hasProof,
  proofUploadedBy,
  paymentMethod,
  paymentReference,
  canReview,
  canUploadProof,
}: {
  locale: Locale;
  bookingCode: string;
  status: BookingStatus;
  hasProof: boolean;
  proofUploadedBy: UploadedBy | null;
  paymentMethod: PaymentMethod | null;
  paymentReference: string | null;
  canReview: boolean;
  canUploadProof: boolean;
}) {
  const router = useRouter();
  const c = COPY[locale];
  const fileRef = useRef<HTMLInputElement>(null);

  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [proofKey, setProofKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function review(action: "confirm" | "reject") {
    if (action === "reject" && !reason.trim()) {
      setError(c.needReason);
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/bookings/${bookingCode}/review`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-locale": locale },
      body: JSON.stringify({ action, note: reason.trim() || null }),
    });
    setBusy(false);
    if (!res.ok) {
      setError(c.failed);
      return;
    }
    router.refresh();
  }

  async function uploadForStudent(file: File) {
    setUploading(true);
    setError(null);
    const body = new FormData();
    body.set("file", file);
    body.set("purpose", "payment-proof");
    body.set("bookingCode", bookingCode);
    const res = await fetch("/api/upload", { method: "POST", body });
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
    setBusy(true);
    const res = await fetch(`/api/bookings/${bookingCode}/payment`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ method: "EMT", proofKey, reference: null }),
    });
    setBusy(false);
    if (!res.ok) {
      setError(c.failed);
      return;
    }
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
            src={`/api/bookings/${bookingCode}/proof`}
            alt=""
            className="max-h-96 rounded-lg border border-border"
          />
        </>
      ) : (
        <p className="text-sm text-muted-foreground">{c.noProof}</p>
      )}

      {status === "CONFIRMED" && (
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
            {proofKey && (
              <Button onClick={submitProof} disabled={busy}>
                {c.submit}
              </Button>
            )}
          </div>
          {proofKey && (
            <p className="text-xs text-muted-foreground">{c.uploaded}</p>
          )}
        </div>
      )}

      <FieldError>{error}</FieldError>
    </Card>
  );
}
