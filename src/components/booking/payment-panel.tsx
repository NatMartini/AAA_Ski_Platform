"use client";

import { useRef, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { Card, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FieldError, Hint, Input, Label } from "@/components/ui/field";
import { PriceBreakdown } from "./price-breakdown";
import { formatMoneyShort, type Quote } from "@/lib/pricing";
import type { Locale } from "@/i18n/routing";
import { cn } from "@/lib/utils";
import { Loader2, TriangleAlert, Upload } from "lucide-react";

type Methods = {
  emt: { email: string; name: string | null } | null;
  wechat: boolean;
  alipay: boolean;
};

const COPY = {
  zh: {
    amount: "请转账金额",
    emt: "Interac e-Transfer",
    emtTo: "收款邮箱",
    emtName: "收款人",
    wechat: "微信支付",
    alipay: "支付宝",
    scan: "请扫码支付",
    memo: "转账备注请填写订单号",
    upload: "上传付款截图",
    redact: "上传前请遮挡账号、余额等无关信息。该截图仅你和教练可见。",
    reference: "转账备注 / 参考号(选填)",
    choose: "选择图片",
    replace: "重新选择",
    submit: "提交付款凭证",
    submitting: "提交中…",
    rejected: "教练未通过本次付款,原因:",
    reupload: "请重新上传付款截图。",
    needProof: "请先上传付款截图。",
    needMethod: "请选择付款方式。",
    uploadFailed: "上传失败,请换一张图片重试。",
    failed: "提交失败,请重试。",
    coachUploading: "你正在代学员上传付款截图。",
  },
  en: {
    amount: "Amount to send",
    emt: "Interac e-Transfer",
    emtTo: "Send to",
    emtName: "Recipient",
    wechat: "WeChat Pay",
    alipay: "Alipay",
    scan: "Scan to pay",
    memo: "Put the booking reference in the transfer memo",
    upload: "Upload payment screenshot",
    redact:
      "Cover your account number, balance and anything else you would rather not share. Only you and your coach can see this.",
    reference: "Transfer reference (optional)",
    choose: "Choose image",
    replace: "Choose another",
    submit: "Submit payment proof",
    submitting: "Submitting…",
    rejected: "Your coach did not accept this payment. Reason:",
    reupload: "Please upload the screenshot again.",
    needProof: "Please upload the screenshot first.",
    needMethod: "Please choose how you paid.",
    uploadFailed: "Upload failed. Please try a different image.",
    failed: "Could not submit. Please try again.",
    coachUploading: "You are uploading this screenshot on the student's behalf.",
  },
} as const;

export function PaymentPanel({
  locale,
  bookingCode,
  coachId,
  isCoach,
  quote,
  methods,
  rejectedNote,
}: {
  locale: Locale;
  bookingCode: string;
  coachId: string;
  isCoach: boolean;
  quote: Quote;
  methods: Methods;
  rejectedNote: string | null;
}) {
  const router = useRouter();
  const c = COPY[locale];
  const fileRef = useRef<HTMLInputElement>(null);

  const available = [
    methods.emt ? ("EMT" as const) : null,
    methods.wechat ? ("WECHAT" as const) : null,
    methods.alipay ? ("ALIPAY" as const) : null,
  ].filter(Boolean) as ("EMT" | "WECHAT" | "ALIPAY")[];

  const [method, setMethod] = useState(available[0] ?? null);
  const [proofKey, setProofKey] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [reference, setReference] = useState("");
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setUploading(true);
    setError(null);
    const body = new FormData();
    body.set("file", file);
    body.set("purpose", "payment-proof");
    body.set("bookingCode", bookingCode);

    const res = await fetch("/api/upload", { method: "POST", body });
    setUploading(false);

    if (!res.ok) {
      setError(c.uploadFailed);
      return;
    }
    const j = (await res.json()) as { key: string };
    setProofKey(j.key);
    setPreview(URL.createObjectURL(file));
  }

  async function submit() {
    if (!method) {
      setError(c.needMethod);
      return;
    }
    if (!proofKey) {
      setError(c.needProof);
      return;
    }
    setBusy(true);
    setError(null);

    const res = await fetch(`/api/bookings/${bookingCode}/payment`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ method, proofKey, reference: reference || null }),
    });
    setBusy(false);

    if (!res.ok) {
      setError(c.failed);
      return;
    }
    router.push(`/booking/${bookingCode}`);
    router.refresh();
  }

  return (
    <div className="space-y-5">
      {rejectedNote !== null && (
        <p className="flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-800 dark:text-red-200">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            <strong>
              {c.rejected} {rejectedNote || "—"}
            </strong>
            <br />
            {c.reupload}
          </span>
        </p>
      )}

      {isCoach && (
        <p className="rounded-lg border border-ice-500/40 bg-ice-500/10 p-3 text-sm">
          {c.coachUploading}
        </p>
      )}

      <Card className="space-y-4">
        <CardTitle>{c.amount}</CardTitle>
        <p className="text-3xl font-semibold tabular-nums">
          {formatMoneyShort(quote.totalCents)}{" "}
          <span className="text-base font-normal text-muted-foreground">
            {quote.currency}
          </span>
        </p>
        <PriceBreakdown quote={quote} locale={locale} />
      </Card>

      <Card className="space-y-4">
        <div
          role="group"
          aria-label={c.upload}
          className="flex flex-wrap gap-2"
        >
          {available.map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={method === m}
              onClick={() => setMethod(m)}
              className={cn(
                "min-h-11 rounded-lg border px-4 text-sm",
                method === m
                  ? "border-accent bg-accent text-accent-foreground"
                  : "border-border bg-surface hover:border-ice-400",
              )}
            >
              {m === "EMT" ? c.emt : m === "WECHAT" ? c.wechat : c.alipay}
            </button>
          ))}
        </div>

        {method === "EMT" && methods.emt && (
          <dl className="rounded-lg bg-surface-muted p-4 text-sm">
            <div className="flex justify-between gap-4 py-1">
              <dt className="text-muted-foreground">{c.emtTo}</dt>
              <dd className="font-mono">{methods.emt.email}</dd>
            </div>
            {methods.emt.name && (
              <div className="flex justify-between gap-4 py-1">
                <dt className="text-muted-foreground">{c.emtName}</dt>
                <dd>{methods.emt.name}</dd>
              </div>
            )}
            <div className="flex justify-between gap-4 py-1">
              <dt className="text-muted-foreground">{c.memo}</dt>
              <dd className="font-mono">{bookingCode}</dd>
            </div>
          </dl>
        )}

        {(method === "WECHAT" || method === "ALIPAY") && (
          <div className="space-y-2">
            <p className="text-sm">{c.scan}</p>
            {/* eslint-disable-next-line @next/next/no-img-element -- served
                from an authenticated route, not a static asset */}
            <img
              src={`/api/files/qr/${coachId}?kind=${method === "ALIPAY" ? "alipay" : "wechat"}`}
              alt={method === "ALIPAY" ? c.alipay : c.wechat}
              className="size-52 rounded-lg border border-border bg-white object-contain p-2"
            />
          </div>
        )}
      </Card>

      <Card className="space-y-4">
        <CardTitle>{c.upload}</CardTitle>
        <Hint>{c.redact}</Hint>

        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
            e.target.value = "";
          }}
        />

        <div className="flex flex-wrap items-start gap-4">
          {preview && (
            // eslint-disable-next-line @next/next/no-img-element -- local blob preview
            <img
              src={preview}
              alt=""
              className="max-h-48 rounded-lg border border-border"
            />
          )}
          <Button
            type="button"
            variant="secondary"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
          >
            {uploading ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <Upload aria-hidden />
            )}
            {proofKey ? c.replace : c.choose}
          </Button>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="reference">{c.reference}</Label>
          <Input
            id="reference"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            maxLength={200}
          />
        </div>

        <FieldError>{error}</FieldError>

        <Button
          onClick={submit}
          disabled={busy || uploading || !proofKey}
          className="self-start"
        >
          {busy && <Loader2 className="animate-spin" aria-hidden />}
          {busy ? c.submitting : c.submit}
        </Button>
      </Card>
    </div>
  );
}
