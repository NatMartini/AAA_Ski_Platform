"use client";

import { useRef, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { Card, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/field";
import { SignaturePad } from "./signature-pad";
import type { Locale } from "@/i18n/routing";
import { Loader2, ShieldAlert } from "lucide-react";

export type ClauseView = {
  id: string;
  heading: string;
  body: string;
  bodyAlt: string;
  acknowledge: boolean;
};

const COPY = {
  zh: {
    scrollGate: "请滚动阅读到底部后再签署",
    scrolled: "已阅读全文",
    acknowledgeHint: "以下条款需逐条确认",
    readConfirm: "我已完整阅读本协议,并理解签署本协议意味着放弃部分法律权利。",
    consent: "我同意以电子方式签署本协议,并理解电子签名与手写签名具有同等效力。",
    typedName: "请输入你的全名(作为打印签名)",
    guardian: "监护人信息",
    guardianName: "监护人姓名",
    guardianRelationship: "与学员关系",
    guardianPhone: "监护人电话",
    draw: "请在下方手写签名",
    clear: "重写",
    submit: "确认签署",
    needAll: "请确认所有必须勾选的条款。",
    needName: "请输入你的全名。",
    needSignature: "请手写签名。",
    needGuardian: "请填写监护人姓名。",
    failed: "签署失败,请重试。",
    alreadySigned: "本雪季已签署过,无需重复签署。",
  },
  en: {
    scrollGate: "Please read to the end before signing",
    scrolled: "You have read the whole agreement",
    acknowledgeHint: "These clauses need to be acknowledged individually",
    readConfirm:
      "I have read this entire agreement. I understand that I am giving up legal rights by signing it.",
    consent:
      "I agree to sign this agreement electronically, and I understand that my electronic signature has the same effect as a handwritten one.",
    typedName: "Type your full name (as your printed signature)",
    guardian: "Guardian details",
    guardianName: "Guardian's name",
    guardianRelationship: "Relationship to participant",
    guardianPhone: "Guardian's phone",
    draw: "Sign below",
    clear: "Clear",
    submit: "Sign and continue",
    needAll: "Please acknowledge every clause that requires it.",
    needName: "Please type your full name.",
    needSignature: "Please draw your signature.",
    needGuardian: "Please enter the guardian's name.",
    failed: "Could not record the signature. Please try again.",
    alreadySigned: "Already signed for this season — no need to sign again.",
  },
} as const;

export function WaiverForm({
  locale,
  bookingCode,
  clauses,
  isGuardian,
  minorNotice,
  postTo,
  redirectTo,
}: {
  locale: Locale;
  bookingCode: string;
  clauses: ClauseView[];
  isGuardian: boolean;
  minorNotice: string | null;
  /** Differs between the normal flow and a coach-issued signing link. */
  postTo: string;
  redirectTo: string;
}) {
  const router = useRouter();
  const c = COPY[locale];
  const scrollRef = useRef<HTMLDivElement>(null);

  const [scrolledToEnd, setScrolledToEnd] = useState(false);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [readConfirmed, setReadConfirmed] = useState(false);
  const [consent, setConsent] = useState(false);
  const [typedName, setTypedName] = useState("");
  const [guardianName, setGuardianName] = useState("");
  const [guardianRelationship, setGuardianRelationship] = useState("");
  const [guardianPhone, setGuardianPhone] = useState("");
  const [signature, setSignature] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const required = clauses.filter((cl) => cl.acknowledge);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    // 24px of slack so a trackpad that stops just short still counts.
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 24) {
      setScrolledToEnd(true);
    }
  }

  const canSubmit =
    scrolledToEnd &&
    readConfirmed &&
    consent &&
    required.every((cl) => checked[cl.id]) &&
    typedName.trim().length > 0 &&
    signature !== null &&
    (!isGuardian || guardianName.trim().length > 0);

  async function submit() {
    if (!signature) {
      setError(c.needSignature);
      return;
    }
    if (!typedName.trim()) {
      setError(c.needName);
      return;
    }
    if (isGuardian && !guardianName.trim()) {
      setError(c.needGuardian);
      return;
    }
    if (!required.every((cl) => checked[cl.id])) {
      setError(c.needAll);
      return;
    }

    setBusy(true);
    setError(null);

    const agreed: Record<string, true> = {};
    for (const cl of required) agreed[cl.id] = true;

    const res = await fetch(postTo, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        typedName: typedName.trim(),
        signatureImage: signature,
        consentToElectronic: true,
        agreedCheckboxes: agreed,
        guardianName: isGuardian ? guardianName.trim() : null,
        guardianRelationship: isGuardian ? guardianRelationship.trim() : null,
        guardianPhone: isGuardian ? guardianPhone.trim() : null,
      }),
    });
    setBusy(false);

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error === "already-signed" ? c.alreadySigned : c.failed);
      return;
    }
    router.push(redirectTo);
    router.refresh();
  }

  return (
    <div className="space-y-5">
      {minorNotice && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-100">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {minorNotice}
        </p>
      )}

      <Card className="space-y-3">
        <CardTitle>{bookingCode}</CardTitle>

        {/* Scroll gate: the release has to actually be put in front of the
            signer, not just linked. */}
        <div
          ref={scrollRef}
          onScroll={onScroll}
          tabIndex={0}
          role="region"
          aria-label="Agreement text"
          className="max-h-96 space-y-4 overflow-y-auto rounded-lg border border-border bg-surface-muted p-4 text-sm leading-relaxed"
        >
          {clauses.map((clause) => (
            <section key={clause.id} className="space-y-1.5">
              <h3
                className={
                  clause.acknowledge
                    ? "font-semibold text-foreground"
                    : "font-medium text-foreground"
                }
              >
                {clause.heading}
              </h3>
              <p className={clause.acknowledge ? "font-medium" : undefined}>
                {clause.body}
              </p>
              <p className="text-muted-foreground">{clause.bodyAlt}</p>
            </section>
          ))}
        </div>

        <p
          aria-live="polite"
          className={
            scrolledToEnd
              ? "text-xs text-emerald-600 dark:text-emerald-400"
              : "text-xs text-amber-700 dark:text-amber-300"
          }
        >
          {scrolledToEnd ? c.scrolled : c.scrollGate}
        </p>
      </Card>

      <Card className="space-y-4">
        <p className="text-sm font-medium">{c.acknowledgeHint}</p>
        {required.map((clause) => (
          <Check
            key={clause.id}
            id={`ack-${clause.id}`}
            checked={checked[clause.id] ?? false}
            disabled={!scrolledToEnd}
            onChange={(v) =>
              setChecked((prev) => ({ ...prev, [clause.id]: v }))
            }
            label={clause.heading}
          />
        ))}

        <hr className="border-border" />

        <Check
          id="read-confirm"
          checked={readConfirmed}
          disabled={!scrolledToEnd}
          onChange={setReadConfirmed}
          label={c.readConfirm}
        />
        {/* Separate from "I have read this": Ontario's e-commerce legislation
            wants express consent to the electronic form specifically. */}
        <Check
          id="consent"
          checked={consent}
          disabled={!scrolledToEnd}
          onChange={setConsent}
          label={c.consent}
        />
      </Card>

      {isGuardian && (
        <Card className="space-y-4">
          <CardTitle>{c.guardian}</CardTitle>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="g-name">{c.guardianName}</Label>
              <Input
                id="g-name"
                value={guardianName}
                onChange={(e) => setGuardianName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="g-rel">{c.guardianRelationship}</Label>
              <Input
                id="g-rel"
                value={guardianRelationship}
                onChange={(e) => setGuardianRelationship(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="g-phone">{c.guardianPhone}</Label>
              <Input
                id="g-phone"
                value={guardianPhone}
                onChange={(e) => setGuardianPhone(e.target.value)}
              />
            </div>
          </div>
        </Card>
      )}

      <Card className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="typed-name">{c.typedName}</Label>
          <Input
            id="typed-name"
            value={typedName}
            onChange={(e) => setTypedName(e.target.value)}
            autoComplete="name"
          />
        </div>

        <SignaturePad
          label={c.draw}
          clearLabel={c.clear}
          onChange={setSignature}
        />

        <FieldError>{error}</FieldError>

        <Button onClick={submit} disabled={!canSubmit || busy} className="self-start">
          {busy && <Loader2 className="animate-spin" aria-hidden />}
          {c.submit}
        </Button>
      </Card>
    </div>
  );
}

function Check({
  id,
  checked,
  disabled,
  onChange,
  label,
}: {
  id: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <label
      htmlFor={id}
      className={
        disabled
          ? "flex items-start gap-3 text-sm opacity-50"
          : "flex items-start gap-3 text-sm"
      }
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]"
      />
      <span>{label}</span>
    </label>
  );
}
