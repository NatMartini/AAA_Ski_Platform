"use client";

import { useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  FieldError,
  Hint,
  Input,
  Label,
  Select,
  Textarea,
} from "@/components/ui/field";
import { QrUploadField } from "./qr-upload-field";
import { ImageUploadField } from "./image-upload-field";
import { SkillPicker } from "@/components/booking/skill-picker";
import { LEVELS } from "@/lib/skills";
import { cn } from "@/lib/utils";
import { formatMoneyShort } from "@/lib/pricing";
import type { Locale } from "@/i18n/routing";
import { Check, Languages, Loader2, TriangleAlert } from "lucide-react";

export type CoachSettings = {
  displayName: string;
  avatarKey: string | null;
  bioZh: string;
  bioEn: string;
  csiaLevel: number | null;
  csiaParkLevel: number | null;
  teachableSkills: string[];
  teachableLevels: string[];
  hourlyRateCents: number;
  handoverDiscountCents: number;
  extraPersonCents: number;
  maxGroupSize: number;
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
    photo: "头像",
    photoHelp: "显示在选择教练页和约课页。建议用正方形照片,上传后会自动压缩。",
    photoUpload: "上传头像",
    photoReplace: "更换头像",
    photoFailed: "上传失败,请重试。",
    photoTooLarge: "图片太大,请压缩后再传。",
    bio: "教练介绍",
    bioHelp: "显示在学员的约课页面最上方。空行分段。",
    bioZh: "中文",
    bioEn: "英文",
    teaching: "教学资质与范围",
    teachingHelp: "学员选择教练时会看到这些信息,系统自动分配教练时也会参考。",
    csia: "CSIA 等级",
    csiaPark: "CSIA Park 等级",
    csiaNone: "未认证 / 不显示",
    levelN: "{n} 级",
    teachLevels: "可教水平",
    teachSkills: "可教动作",
    teachSkillsHelp: "按 CSIA 等级排列。留空表示全部动作都可以教。",
    alpine: "双板技术",
    park: "公园",
    tier: "L{n}",
    pricing: "价格",
    hourlyRate: "每小时价格(加元)",
    handover: "每单交接扣减(加元)",
    handoverHelp:
      "每张订单固定扣一次,不随时长增加。首尾各留 5 分钟交接,共 10 分钟。",
    extraPerson: "每增加一人每小时加价(加元)",
    extraPersonHelp: "多人课时,每多一名学员每小时加收此金额。",
    maxGroupSize: "最多人数",
    maxGroupHelp: "设为 1 则不接受多人课。",
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
    wechatId: "微信号",
    contactEmail: "联系邮箱",
    contactPhone: "联系电话",
    policy: "取消与退款政策",
    policyHelp:
      "下单前会完整展示给学员,并在下单时冻结到该订单上 —— 之后修改不影响已成立的订单。两种语言都必须填写才能接单。",
    policyZh: "中文版",
    toEn: "翻译成英文",
    toZh: "翻译成中文",
    translateHint:
      "自动翻译只是初稿,会把这段文字发送给 DeepL 翻译服务。请自己核对后再保存 —— 这段文字下单时会冻结成学员同意的条款。",
    translateUnavailable: "尚未配置翻译服务(DEEPL_API_KEY)。",
    translateFailed: "翻译失败,请稍后重试。",
    translateEmpty: "请先填写要翻译的那一栏。",
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
    photo: "Profile photo",
    photoHelp:
      "Shown on the coach list and the booking page. A square photo works best; it is compressed on upload.",
    photoUpload: "Upload photo",
    photoReplace: "Replace photo",
    photoFailed: "Upload failed. Please try again.",
    photoTooLarge: "That image is too large.",
    bio: "Coach introduction",
    bioHelp:
      "Shown at the top of the booking page. Blank lines start a new paragraph.",
    bioZh: "Chinese",
    bioEn: "English",
    teaching: "Certification and teaching range",
    teachingHelp:
      "Students see this when choosing a coach, and it drives the automatic matching.",
    csia: "CSIA level",
    csiaPark: "CSIA Park level",
    csiaNone: "Not certified / hide",
    levelN: "Level {n}",
    teachLevels: "Abilities you teach",
    teachSkills: "Moves you teach",
    teachSkillsHelp:
      "Listed in CSIA syllabus order. Leaving this empty means you teach everything.",
    alpine: "Alpine",
    park: "Park",
    tier: "L{n}",
    pricing: "Pricing",
    hourlyRate: "Hourly rate (CAD)",
    handover: "Handover credit per booking (CAD)",
    handoverHelp:
      "Deducted once per booking, not per hour. Five minutes at each end, ten in total.",
    extraPerson: "Extra per additional student per hour (CAD)",
    extraPersonHelp: "For group lessons, each extra student adds this per hour.",
    maxGroupSize: "Maximum group size",
    maxGroupHelp: "Set to 1 to not accept group lessons.",
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
    wechatId: "WeChat ID",
    contactEmail: "Contact email",
    contactPhone: "Contact phone",
    policy: "Cancellation and refund policy",
    policyHelp:
      "Shown in full before a student books, and frozen onto the booking at that moment — later edits do not change existing bookings. Both languages are required before you can take bookings.",
    policyZh: "Chinese",
    toEn: "Translate to English",
    toZh: "Translate to Chinese",
    translateHint:
      "A first draft only — the text is sent to DeepL to translate. Read it before saving: this wording is frozen onto every booking as the terms the student agreed to.",
    translateUnavailable: "No translation service is configured (DEEPL_API_KEY).",
    translateFailed: "Translation failed. Please try again.",
    translateEmpty: "Fill in the language you are translating from first.",
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
  const [translating, setTranslating] = useState<"ZH" | "EN" | null>(null);
  const [translateError, setTranslateError] = useState<string | null>(null);

  function set<K extends keyof CoachSettings>(key: K, value: CoachSettings[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setStatus("idle");
  }

  /**
   * Drafts one language of the policy from the other. Never saves — it fills
   * the field and leaves the coach to read it and press Save.
   */
  async function translatePolicy(target: "ZH" | "EN") {
    const source =
      target === "EN" ? form.cancellationPolicyZh : form.cancellationPolicyEn;
    if (!source.trim()) {
      setTranslateError(c.translateEmpty);
      return;
    }
    setTranslating(target);
    setTranslateError(null);

    const res = await fetch("/api/coach/translate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: source, target }),
    });
    setTranslating(null);

    if (!res.ok) {
      setTranslateError(
        res.status === 501 ? c.translateUnavailable : c.translateFailed,
      );
      return;
    }
    const { text } = (await res.json()) as { text: string };
    set(
      target === "EN" ? "cancellationPolicyEn" : "cancellationPolicyZh",
      text,
    );
  }

  async function save() {
    setStatus("saving");
    setErrors({});
    const res = await fetch("/api/coach/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        displayName: form.displayName,
        bioZh: form.bioZh,
        bioEn: form.bioEn,
        csiaLevel: form.csiaLevel,
        csiaParkLevel: form.csiaParkLevel,
        teachableSkills: form.teachableSkills,
        teachableLevels: form.teachableLevels,
        hourlyRateCents: form.hourlyRateCents,
        handoverDiscountCents: form.handoverDiscountCents,
        extraPersonCents: form.extraPersonCents,
        maxGroupSize: form.maxGroupSize,
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
        <div className="space-y-1.5">
          <Label>{c.photo}</Label>
          <ImageUploadField
            purpose="coach-avatar"
            previewSrc={`/api/files/avatar/${coachId}`}
            previewAlt={form.displayName}
            hasImage={Boolean(form.avatarKey)}
            round
            hint={c.photoHelp}
            labels={{
              upload: c.photoUpload,
              replace: c.photoReplace,
              failed: c.photoFailed,
              tooLarge: c.photoTooLarge,
            }}
            onUploaded={(key) => set("avatarKey", key)}
          />
        </div>

        <CardDescription>{c.bioHelp}</CardDescription>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="bioZh">
              {c.bio} · {c.bioZh}
            </Label>
            <Textarea
              id="bioZh"
              value={form.bioZh}
              onChange={(e) => set("bioZh", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bioEn">
              {c.bio} · {c.bioEn}
            </Label>
            <Textarea
              id="bioEn"
              value={form.bioEn}
              onChange={(e) => set("bioEn", e.target.value)}
            />
          </div>
        </div>
      </Card>

      <Card className="space-y-4">
        <CardTitle>{c.teaching}</CardTitle>
        <CardDescription>{c.teachingHelp}</CardDescription>

        <div className="grid gap-4 sm:grid-cols-2">
          <CertField
            id="csiaLevel"
            label={c.csia}
            value={form.csiaLevel}
            max={4}
            noneLabel={c.csiaNone}
            levelLabel={c.levelN}
            onChange={(v) => set("csiaLevel", v)}
          />
          <CertField
            id="csiaParkLevel"
            label={c.csiaPark}
            value={form.csiaParkLevel}
            max={2}
            noneLabel={c.csiaNone}
            levelLabel={c.levelN}
            onChange={(v) => set("csiaParkLevel", v)}
          />
        </div>

        <fieldset>
          <legend className="mb-1.5 text-sm font-semibold">
            {c.teachLevels}
          </legend>
          <div className="flex flex-wrap gap-1.5">
            {LEVELS.map((l) => {
              const on = form.teachableLevels.includes(l.key);
              return (
                <button
                  key={l.key}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    set(
                      "teachableLevels",
                      on
                        ? form.teachableLevels.filter((k) => k !== l.key)
                        : [...form.teachableLevels, l.key],
                    )
                  }
                  className={cn(
                    "press inline-flex min-h-9 items-center rounded-full border px-3 text-xs font-semibold",
                    on
                      ? "border-accent bg-accent text-accent-foreground"
                      : "border-border bg-surface text-ink-2 hover:border-accent",
                  )}
                >
                  {locale === "zh" ? l.zh : l.en}
                </button>
              );
            })}
          </div>
        </fieldset>

        <div className="space-y-1.5">
          <Label>{c.teachSkills}</Label>
          <Hint>{c.teachSkillsHelp}</Hint>
          <SkillPicker
            locale={locale}
            selected={form.teachableSkills}
            onChange={(next) => set("teachableSkills", next)}
            labels={{ alpine: c.alpine, park: c.park, tier: c.tier }}
          />
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
        <div className="grid gap-4 sm:grid-cols-2">
          <MoneyField
            id="extraPersonCents"
            label={c.extraPerson}
            cents={form.extraPersonCents}
            onChange={(v) => set("extraPersonCents", v)}
            hint={c.extraPersonHelp}
            error={errors.extraPersonCents}
          />
          <NumberField
            id="maxGroupSize"
            label={c.maxGroupSize}
            value={form.maxGroupSize}
            onChange={(v) => set("maxGroupSize", v)}
            hint={c.maxGroupHelp}
            error={errors.maxGroupSize}
          />
        </div>
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
              locale={locale}
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
              locale={locale}
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
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label htmlFor="policyZh">{c.policyZh}</Label>
            <TranslateButton
              label={c.toEn}
              busy={translating === "EN"}
              disabled={translating !== null}
              onClick={() => translatePolicy("EN")}
            />
          </div>
          <Textarea
            id="policyZh"
            value={form.cancellationPolicyZh}
            onChange={(e) => set("cancellationPolicyZh", e.target.value)}
          />
          <FieldError>{errors.cancellationPolicyZh}</FieldError>
        </div>
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label htmlFor="policyEn">{c.policyEn}</Label>
            <TranslateButton
              label={c.toZh}
              busy={translating === "ZH"}
              disabled={translating !== null}
              onClick={() => translatePolicy("ZH")}
            />
          </div>
          <Textarea
            id="policyEn"
            value={form.cancellationPolicyEn}
            onChange={(e) => set("cancellationPolicyEn", e.target.value)}
          />
          <FieldError>{errors.cancellationPolicyEn}</FieldError>
        </div>
        <Hint>{c.translateHint}</Hint>
        <FieldError>{translateError}</FieldError>
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

/** Fills the other language of the policy. Small and quiet — it is an aid. */
function TranslateButton({
  label,
  busy,
  disabled,
  onClick,
}: {
  label: string;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="press inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-semibold text-ink-2 disabled:opacity-50 hover:enabled:border-accent hover:enabled:text-ink"
    >
      {busy ? (
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
      ) : (
        <Languages className="size-3.5" aria-hidden />
      )}
      {label}
    </button>
  );
}

/** A CSIA level, or none. Stored as a small integer so it can be compared. */
function CertField({
  id,
  label,
  value,
  max,
  noneLabel,
  levelLabel,
  onChange,
}: {
  id: string;
  label: string;
  value: number | null;
  max: number;
  noneLabel: string;
  levelLabel: string;
  onChange: (value: number | null) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select
        id={id}
        value={value ?? ""}
        onChange={(e) =>
          onChange(e.target.value === "" ? null : Number(e.target.value))
        }
      >
        <option value="">{noneLabel}</option>
        {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
          <option key={n} value={n}>
            {levelLabel.replace("{n}", String(n))}
          </option>
        ))}
      </Select>
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
  hint,
  error,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
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
        step={1}
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(Math.max(0, Math.round(Number(e.target.value || 0))))}
      />
      <Hint>{hint}</Hint>
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
