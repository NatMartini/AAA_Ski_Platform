"use client";

import { useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FieldError, Hint, Input, Label, Textarea } from "@/components/ui/field";
import { QrUploadField } from "./qr-upload-field";
import { formatMoneyShort } from "@/lib/pricing";
import type { Locale } from "@/i18n/routing";
import { Check, Loader2, TriangleAlert } from "lucide-react";

export type CoachSettings = {
  displayName: string;
  hourlyRateCents: number;
  handoverDiscountCents: number;
  minHours: number;
  maxHours: number;
  leadTimeHours: number;
  emtEnabled: boolean;
  emtEmail: string;
  emtName: string;
  wechatPayEnabled: boolean;
  wechatPayQrKey: string | null;
  alipayEnabled: boolean;
  alipayQrKey: string | null;
  wechatId: string;
  contactEmail: string;
  contactPhone: string;
  cancellationPolicyZh: string;
  cancellationPolicyEn: string;
  isPublished: boolean;
  icsToken: string;
};

const COPY = {
  zh: {
    profile: "基本资料",
    displayName: "显示名称",
    pricing: "价格",
    hourlyRate: "每小时价格(加元)",
    handover: "每单交接扣减(加元)",
    handoverHelp:
      "每张订单固定扣一次,不随时长增加。首尾各留 5 分钟交接,共 10 分钟。",
    minHours: "最少小时数",
    maxHours: "最多小时数",
    leadTime: "最少提前预定小时数",
    payment: "收款方式",
    emt: "启用 Interac e-Transfer",
    emtEmail: "收款邮箱",
    emtName: "收款人姓名",
    wechatPay: "启用微信支付",
    alipay: "启用支付宝",
    qrHelp: "上传收款二维码。仅已登录并有订单的学员可见。",
    contact: "联系方式",
    wechatId: "微信号(用于约其他时间)",
    contactEmail: "联系邮箱",
    contactPhone: "联系电话",
    policy: "取消与退款政策",
    policyHelp:
      "下单前会完整展示给学员,并在下单时冻结到该订单上 —— 之后修改不影响已成立的订单。两种语言都必须填写才能接单。",
    policyZh: "中文版",
    policyEn: "英文版",
    publish: "开放预定",
    publishHelp: "关闭后学员看不到你,也无法预定。",
    save: "保存设置",
    saved: "已保存",
    example: "例:2 小时 = ",
    gaps: "以下项目完成后才能接单:",
  },
  en: {
    profile: "Profile",
    displayName: "Display name",
    pricing: "Pricing",
    hourlyRate: "Hourly rate (CAD)",
    handover: "Handover credit per booking (CAD)",
    handoverHelp:
      "Deducted once per booking, not per hour. Five minutes at each end, ten in total.",
    minHours: "Minimum hours",
    maxHours: "Maximum hours",
    leadTime: "Minimum notice (hours)",
    payment: "Payment methods",
    emt: "Accept Interac e-Transfer",
    emtEmail: "e-Transfer address",
    emtName: "Recipient name",
    wechatPay: "Accept WeChat Pay",
    alipay: "Accept Alipay",
    qrHelp: "Upload your payment QR code. Only signed-in students with a booking can see it.",
    contact: "Contact",
    wechatId: "WeChat ID (for off-grid times)",
    contactEmail: "Contact email",
    contactPhone: "Contact phone",
    policy: "Cancellation and refund policy",
    policyHelp:
      "Shown in full before a student books, and frozen onto the booking at that moment — later edits do not change existing bookings. Both languages are required before you can take bookings.",
    policyZh: "Chinese",
    policyEn: "English",
    publish: "Open for bookings",
    publishHelp: "While off, students cannot see or book you.",
    save: "Save settings",
    saved: "Saved",
    example: "e.g. 2 hours = ",
    gaps: "Complete these before you can take bookings:",
  },
} as const;

export function CoachSettingsForm({
  initial,
  locale,
  coachId,
}: {
  initial: CoachSettings;
  locale: Locale;
  coachId: string;
}) {
  const router = useRouter();
  const c = COPY[locale];
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");

  function set<K extends keyof CoachSettings>(key: K, value: CoachSettings[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setStatus("idle");
  }

  async function save() {
    setStatus("saving");
    setErrors({});
    const res = await fetch("/api/coach/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        displayName: form.displayName,
        hourlyRateCents: form.hourlyRateCents,
        handoverDiscountCents: form.handoverDiscountCents,
        minHours: form.minHours,
        maxHours: form.maxHours,
        leadTimeHours: form.leadTimeHours,
        emtEnabled: form.emtEnabled,
        emtEmail: form.emtEmail,
        emtName: form.emtName,
        wechatPayEnabled: form.wechatPayEnabled,
        alipayEnabled: form.alipayEnabled,
        wechatId: form.wechatId,
        contactEmail: form.contactEmail,
        contactPhone: form.contactPhone,
        cancellationPolicyZh: form.cancellationPolicyZh,
        cancellationPolicyEn: form.cancellationPolicyEn,
        isPublished: form.isPublished,
      }),
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as {
        fields?: Record<string, string>;
      };
      setErrors(body.fields ?? { _: "Save failed" });
      setStatus("idle");
      return;
    }
    setStatus("saved");
    router.refresh();
  }

  const exampleTotal =
    form.hourlyRateCents * 2 - Math.min(form.handoverDiscountCents, form.hourlyRateCents * 2);

  return (
    <div className="space-y-5">
      <Card className="space-y-4">
        <CardTitle>{c.profile}</CardTitle>
        <div className="space-y-1.5">
          <Label htmlFor="displayName">{c.displayName}</Label>
          <Input
            id="displayName"
            value={form.displayName}
            onChange={(e) => set("displayName", e.target.value)}
          />
          <FieldError>{errors.displayName}</FieldError>
        </div>
      </Card>

      <Card className="space-y-4">
        <CardTitle>{c.pricing}</CardTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <MoneyField
            id="hourlyRateCents"
            label={c.hourlyRate}
            cents={form.hourlyRateCents}
            onChange={(v) => set("hourlyRateCents", v)}
            error={errors.hourlyRateCents}
          />
          <MoneyField
            id="handoverDiscountCents"
            label={c.handover}
            cents={form.handoverDiscountCents}
            onChange={(v) => set("handoverDiscountCents", v)}
            hint={c.handoverHelp}
            error={errors.handoverDiscountCents}
          />
        </div>
        <p className="rounded-lg bg-surface-muted p-3 text-sm">
          {c.example}
          <strong>
            {formatMoneyShort(form.hourlyRateCents)} × 2 −{" "}
            {formatMoneyShort(form.handoverDiscountCents)} ={" "}
            {formatMoneyShort(exampleTotal)}
          </strong>
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          <NumberField
            id="minHours"
            label={c.minHours}
            value={form.minHours}
            onChange={(v) => set("minHours", v)}
            error={errors.minHours}
          />
          <NumberField
            id="maxHours"
            label={c.maxHours}
            value={form.maxHours}
            onChange={(v) => set("maxHours", v)}
            error={errors.maxHours}
          />
          <NumberField
            id="leadTimeHours"
            label={c.leadTime}
            value={form.leadTimeHours}
            onChange={(v) => set("leadTimeHours", v)}
            error={errors.leadTimeHours}
          />
        </div>
      </Card>

      <Card className="space-y-4">
        <CardTitle>{c.payment}</CardTitle>
        <Toggle
          id="emtEnabled"
          label={c.emt}
          checked={form.emtEnabled}
          onChange={(v) => set("emtEnabled", v)}
        />
        {form.emtEnabled && (
          <div className="grid gap-4 pl-6 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="emtEmail">{c.emtEmail}</Label>
              <Input
                id="emtEmail"
                type="email"
                value={form.emtEmail}
                onChange={(e) => set("emtEmail", e.target.value)}
              />
              <FieldError>{errors.emtEmail}</FieldError>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="emtName">{c.emtName}</Label>
              <Input
                id="emtName"
                value={form.emtName}
                onChange={(e) => set("emtName", e.target.value)}
              />
            </div>
          </div>
        )}

        <Toggle
          id="wechatPayEnabled"
          label={c.wechatPay}
          checked={form.wechatPayEnabled}
          onChange={(v) => set("wechatPayEnabled", v)}
        />
        {form.wechatPayEnabled && (
          <div className="pl-6">
            <QrUploadField
              kind="wechat"
              coachId={coachId}
              currentKey={form.wechatPayQrKey}
              hint={c.qrHelp}
              onUploaded={(key) => set("wechatPayQrKey", key)}
            />
          </div>
        )}

        <Toggle
          id="alipayEnabled"
          label={c.alipay}
          checked={form.alipayEnabled}
          onChange={(v) => set("alipayEnabled", v)}
        />
        {form.alipayEnabled && (
          <div className="pl-6">
            <QrUploadField
              kind="alipay"
              coachId={coachId}
              currentKey={form.alipayQrKey}
              hint={c.qrHelp}
              onUploaded={(key) => set("alipayQrKey", key)}
            />
          </div>
        )}
      </Card>

      <Card className="space-y-4">
        <CardTitle>{c.contact}</CardTitle>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="wechatId">{c.wechatId}</Label>
            <Input
              id="wechatId"
              value={form.wechatId}
              onChange={(e) => set("wechatId", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="contactEmail">{c.contactEmail}</Label>
            <Input
              id="contactEmail"
              type="email"
              value={form.contactEmail}
              onChange={(e) => set("contactEmail", e.target.value)}
            />
            <FieldError>{errors.contactEmail}</FieldError>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="contactPhone">{c.contactPhone}</Label>
            <Input
              id="contactPhone"
              value={form.contactPhone}
              onChange={(e) => set("contactPhone", e.target.value)}
            />
          </div>
        </div>
      </Card>

      <Card className="space-y-4">
        <CardTitle>{c.policy}</CardTitle>
        <CardDescription>{c.policyHelp}</CardDescription>
        <div className="space-y-1.5">
          <Label htmlFor="policyZh">{c.policyZh}</Label>
          <Textarea
            id="policyZh"
            value={form.cancellationPolicyZh}
            onChange={(e) => set("cancellationPolicyZh", e.target.value)}
          />
          <FieldError>{errors.cancellationPolicyZh}</FieldError>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="policyEn">{c.policyEn}</Label>
          <Textarea
            id="policyEn"
            value={form.cancellationPolicyEn}
            onChange={(e) => set("cancellationPolicyEn", e.target.value)}
          />
          <FieldError>{errors.cancellationPolicyEn}</FieldError>
        </div>
      </Card>

      <Card className="space-y-3">
        <Toggle
          id="isPublished"
          label={c.publish}
          checked={form.isPublished}
          onChange={(v) => set("isPublished", v)}
        />
        <Hint>{c.publishHelp}</Hint>
      </Card>

      {errors._ && (
        <p className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
          <TriangleAlert className="size-4" aria-hidden />
          {errors._}
        </p>
      )}

      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={status === "saving"}>
          {status === "saving" && <Loader2 className="animate-spin" aria-hidden />}
          {c.save}
        </Button>
        {status === "saved" && (
          <span
            role="status"
            className="flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400"
          >
            <Check className="size-4" aria-hidden />
            {c.saved}
          </span>
        )}
      </div>
    </div>
  );
}

/** Money is edited in dollars but stored and sent as integer cents. */
function MoneyField({
  id,
  label,
  cents,
  onChange,
  hint,
  error,
}: {
  id: string;
  label: string;
  cents: number;
  onChange: (cents: number) => void;
  hint?: string;
  error?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        min={0}
        step="0.01"
        inputMode="decimal"
        value={(cents / 100).toFixed(2)}
        onChange={(e) => onChange(Math.round(Number(e.target.value || 0) * 100))}
      />
      <Hint>{hint}</Hint>
      <FieldError>{error}</FieldError>
    </div>
  );
}

function NumberField({
  id,
  label,
  value,
  onChange,
  error,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
  error?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        min={0}
        step={1}
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(Math.max(0, Math.round(Number(e.target.value || 0))))}
      />
      <FieldError>{error}</FieldError>
    </div>
  );
}

function Toggle({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label htmlFor={id} className="flex items-center gap-3 text-sm">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4 accent-[var(--accent)]"
      />
      <span>{label}</span>
    </label>
  );
}
