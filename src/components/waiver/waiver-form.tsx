"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { Card, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/field";
import { SignaturePad } from "./signature-pad";
import type { Locale } from "@/i18n/routing";
import { cn } from "@/lib/utils";
import { AlertTriangle, Check as CheckIcon, Loader2, ShieldAlert } from "lucide-react";

export type ClauseView = {
  id: string;
  heading: string;
  body: string;
  bodyAlt: string;
  acknowledge: boolean;
};

const COPY = {
  zh: {
    progress: "已确认 {done} / {total} 条",
    allDone: "全部条款已确认",
    acknowledgeHint:
      "请逐条阅读。每读完一条,在该条下方勾选确认;未读到的条款无法勾选。",
    readThisFirst: "请先读完本条",
    acknowledge: "我已阅读并同意本条",
    finalTitle: "最后确认",
    readConfirm: "我已完整阅读本协议,并理解签署本协议意味着放弃部分法律权利。",
    consent: "我同意以电子方式签署本协议,并理解电子签名与手写签名具有同等效力。",
    finishClauses: "请先逐条确认上方所有条款。",
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
    progress: "{done} of {total} acknowledged",
    allDone: "Every clause acknowledged",
    acknowledgeHint:
      "Read the agreement one clause at a time. Each clause has its own tick box below it, which unlocks once you have read that far.",
    readThisFirst: "Read this clause first",
    acknowledge: "I have read and agree to this clause",
    finalTitle: "Final confirmation",
    readConfirm:
      "I have read this entire agreement. I understand that I am giving up legal rights by signing it.",
    consent:
      "I agree to sign this agreement electronically, and I understand that my electronic signature has the same effect as a handwritten one.",
    finishClauses: "Acknowledge every clause above first.",
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
  warning,
  prefill,
  postTo,
  redirectTo,
}: {
  locale: Locale;
  bookingCode: string;
  clauses: ClauseView[];
  isGuardian: boolean;
  minorNotice: string | null;
  /** Conspicuous "you are giving up rights" banner, shown above everything. */
  warning: string;
  /**
   * Starting values for the signer's own details, taken from what this account
   * has already told us. Every field stays editable — this is a courtesy, not
   * an assertion about who is signing.
   */
  prefill?: {
    typedName?: string | null;
    guardianName?: string | null;
    guardianPhone?: string | null;
  };
  /** Differs between the normal flow and a coach-issued signing link. */
  postTo: string;
  redirectTo: string;
}) {
  const router = useRouter();
  const c = COPY[locale];

  const [seen, setSeen] = useState<Record<string, boolean>>({});
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [readConfirmed, setReadConfirmed] = useState(false);
  const [consent, setConsent] = useState(false);
  const [typedName, setTypedName] = useState(prefill?.typedName ?? "");
  const [guardianName, setGuardianName] = useState(prefill?.guardianName ?? "");
  const [guardianRelationship, setGuardianRelationship] = useState("");
  const [guardianPhone, setGuardianPhone] = useState(
    prefill?.guardianPhone ?? "",
  );
  const [signature, setSignature] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const listRef = useRef<HTMLOListElement>(null);
  const required = clauses.filter((cl) => cl.acknowledge);
  const doneCount = required.filter((cl) => checked[cl.id]).length;
  const allAcknowledged = doneCount === required.length;

  /*
   * A clause counts as read when its end has actually scrolled past — that is
   * what unlocks its tick box. This replaces the old single "scrolled to the
   * bottom of a box" gate: a release is only enforceable if reasonable steps
   * were taken to bring *each* term to the signer's attention, and one scroll
   * to the end of a 14-clause wall of text is a thin version of that.
   *
   * Observed at the foot of each clause rather than its top, so skimming past
   * a long clause's heading does not unlock it.
   */
  useEffect(() => {
    const root = listRef.current;
    if (!root) return;

    function markSeen(ids: string[]) {
      if (ids.length === 0) return;
      setSeen((prev) => {
        if (ids.every((id) => prev[id])) return prev;
        const next = { ...prev };
        for (const id of ids) next[id] = true;
        return next;
      });
    }

    const marks = [
      ...root.querySelectorAll<HTMLElement>("[data-clause-end]"),
    ];

    /*
     * Two mechanisms on purpose, because being unable to tick a box you have
     * read is a dead end for the user — there is no other way to sign.
     *
     * IntersectionObserver is the good one: it reports what is already on
     * screen at mount, keeps reporting through reflows, and runs no layout
     * work per scroll frame. But it is driven by the rendering pipeline, so a
     * page that never composites (a background tab, an automated browser)
     * gets no callbacks at all. The geometric measure covers that case, and
     * costs nothing when the observer is doing its job.
     */
    // Stops a little above the fold, so the tick box is already live by the
    // time it is under the reader's thumb.
    const FOLD = 0.85;

    const observer = new IntersectionObserver(
      (entries) =>
        markSeen(
          entries
            .filter((e) => e.isIntersecting)
            .map((e) => (e.target as HTMLElement).dataset.clauseEnd)
            .filter((id): id is string => Boolean(id)),
        ),
      { rootMargin: `0px 0px -${Math.round((1 - FOLD) * 100)}% 0px` },
    );
    for (const mark of marks) observer.observe(mark);

    function measure() {
      const limit = window.innerHeight * FOLD;
      markSeen(
        marks
          .filter((m) => m.getBoundingClientRect().top <= limit)
          .map((m) => m.dataset.clauseEnd)
          .filter((id): id is string => Boolean(id)),
      );
    }
    const frame = requestAnimationFrame(measure);
    window.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);

    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [clauses]);

  const canSubmit =
    allAcknowledged &&
    readConfirmed &&
    consent &&
    typedName.trim().length > 0 &&
    signature !== null &&
    (!isGuardian || guardianName.trim().length > 0);

  async function submit() {
    if (!required.every((cl) => checked[cl.id])) {
      setError(c.needAll);
      return;
    }
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
      {/* Above everything, before the agreement itself. A release is only
          enforceable if reasonable steps were taken to bring it to the
          signer's attention, and burying this would defeat that. */}
      <p
        className="animate-fade-up flex items-start gap-3 rounded-xl border p-4 text-sm font-semibold leading-relaxed"
        style={{
          background: "var(--amber-bg)",
          borderColor: "var(--amber-border)",
          color: "var(--amber)",
        }}
      >
        <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden />
        {warning}
      </p>

      {minorNotice && (
        <p
          className="flex items-start gap-2.5 rounded-xl border p-4 text-sm leading-relaxed"
          style={{
            background: "var(--amber-bg)",
            borderColor: "var(--amber-border)",
            color: "var(--amber)",
          }}
        >
          <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {minorNotice}
        </p>
      )}

      <Card className="space-y-2">
        <CardTitle>{bookingCode}</CardTitle>
        <p className="text-sm text-ink-2">{c.acknowledgeHint}</p>
      </Card>

      {/* Sticky counter: with per-clause ticks the reader needs to know how
          much is left without scrolling back. */}
      <div className="sticky top-16 z-30 -mx-1 px-1">
        <div className="flex items-center gap-3 rounded-full border border-border bg-[var(--surface)]/90 px-4 py-2 shadow-[var(--shadow-sm)] backdrop-blur-md">
          <div
            className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3"
            role="progressbar"
            aria-valuenow={doneCount}
            aria-valuemin={0}
            aria-valuemax={required.length}
          >
            <div
              className="h-full rounded-full transition-[width] duration-300"
              style={{
                width: `${(doneCount / Math.max(required.length, 1)) * 100}%`,
                background: allAcknowledged ? "var(--success)" : "var(--accent)",
              }}
            />
          </div>
          <span
            aria-live="polite"
            className="shrink-0 text-xs font-bold tabular-nums"
            style={{ color: allAcknowledged ? "var(--success)" : "var(--ink-2)" }}
          >
            {allAcknowledged
              ? c.allDone
              : c.progress
                  .replace("{done}", String(doneCount))
                  .replace("{total}", String(required.length))}
          </span>
        </div>
      </div>

      <ol ref={listRef} className="space-y-3">
        {clauses.map((clause, i) => {
          const unlocked = seen[clause.id] ?? false;
          const on = checked[clause.id] ?? false;
          return (
            <li key={clause.id}>
              <Card
                className={cn(
                  "space-y-2 transition-colors",
                  on && "border-[var(--success)]",
                )}
              >
                <h3 className="flex items-start gap-2 text-base">
                  <span
                    aria-hidden
                    className="font-display mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-lg bg-surface-3 text-xs font-extrabold tabular-nums text-ink-3"
                  >
                    {i + 1}
                  </span>
                  {clause.heading}
                </h3>
                <div className="space-y-1.5 pl-8 text-sm leading-relaxed">
                  <p className={clause.acknowledge ? "font-medium" : undefined}>
                    {clause.body}
                  </p>
                  <p className="text-ink-2">{clause.bodyAlt}</p>
                </div>

                {/* The observer target: the very end of the clause body. */}
                <span data-clause-end={clause.id} aria-hidden className="block" />

                {clause.acknowledge && (
                  <div className="pl-8">
                    <label
                      htmlFor={`ack-${clause.id}`}
                      className={cn(
                        "flex items-start gap-2.5 rounded-xl border p-2.5 text-sm font-semibold",
                        !unlocked && "cursor-not-allowed opacity-55",
                        on
                          ? "border-[var(--success)] bg-[var(--success-bg)] text-[var(--success)]"
                          : "border-border bg-surface-2 text-ink-2",
                      )}
                    >
                      <input
                        id={`ack-${clause.id}`}
                        type="checkbox"
                        checked={on}
                        disabled={!unlocked}
                        onChange={(e) =>
                          setChecked((prev) => ({
                            ...prev,
                            [clause.id]: e.target.checked,
                          }))
                        }
                        className="mt-0.5 size-4 shrink-0 accent-[var(--success)]"
                      />
                      <span>{unlocked ? c.acknowledge : c.readThisFirst}</span>
                      {on && (
                        <CheckIcon className="ml-auto size-4 shrink-0" aria-hidden />
                      )}
                    </label>
                  </div>
                )}
              </Card>
            </li>
          );
        })}
      </ol>

      <Card className="space-y-4">
        <CardTitle>{c.finalTitle}</CardTitle>
        {!allAcknowledged && (
          <p className="text-sm" style={{ color: "var(--amber)" }}>
            {c.finishClauses}
          </p>
        )}
        <Check
          id="read-confirm"
          checked={readConfirmed}
          disabled={!allAcknowledged}
          onChange={setReadConfirmed}
          label={c.readConfirm}
        />
        {/* Separate from "I have read this": Ontario's e-commerce legislation
            wants express consent to the electronic form specifically. */}
        <Check
          id="consent"
          checked={consent}
          disabled={!allAcknowledged}
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

        <Button
          onClick={submit}
          disabled={!canSubmit || busy}
          size="lg"
          className="w-full sm:w-auto sm:self-start"
        >
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
      className={cn(
        "flex items-start gap-3 text-sm",
        disabled && "cursor-not-allowed opacity-50",
      )}
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
