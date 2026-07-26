"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FieldError, Hint, Input, Label, Select } from "@/components/ui/field";
import type { Locale } from "@/i18n/routing";
import { Loader2, Plus, X } from "lucide-react";

export type NewParticipant = {
  id: string;
  fullName: string;
  isMinor: boolean;
  isSelf: boolean;
  level: string | null;
  phone: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
};

const COPY = {
  zh: {
    title: "添加学员",
    who: "这是谁",
    self: "我自己",
    child: "我的孩子(未满 18 岁)",
    fullName: "姓名",
    minorQuestion: "是否未满 18 周岁?",
    minorYes: "未满 18 周岁",
    minorNo: "已满 18 周岁",
    minorHelp: "未满 18 周岁的学员,免责协议须由父母或监护人签署。",
    emergencyName: "紧急联系人(建议填写)",
    emergencyPhone: "紧急联系电话(建议填写)",
    emergencyHelp: "建议填写,便于课上发生意外时联系。可留空。",
    level: "水平",
    levels: {
      "": "不确定",
      FIRST_TIME: "第一次滑",
      BEGINNER: "初级",
      INTERMEDIATE: "中级",
      ADVANCED: "高级",
    },
    save: "添加",
    cancel: "取消",
    adultNotSelf:
      "成年学员需使用本人的 Google 账号预定并签署免责协议,无法代为添加。",
    duplicate: "该账号下已有同名学员。如需区分,请使用不同的名字。",
    selfExists: "你已经添加过自己了。",
    failed: "添加失败,请检查填写内容。",
  },
  en: {
    title: "Add participant",
    who: "Who is this",
    self: "Myself",
    child: "My child (under 18)",
    fullName: "Full name",
    minorQuestion: "Under 18?",
    minorYes: "Under 18",
    minorNo: "18 or over",
    minorHelp:
      "For a participant under 18, a parent or guardian signs the waiver.",
    emergencyName: "Emergency contact (recommended)",
    emergencyPhone: "Emergency phone (recommended)",
    emergencyHelp:
      "Recommended so you can be reached if something happens on the hill. You can leave it blank.",
    level: "Ability",
    levels: {
      "": "Not sure",
      FIRST_TIME: "First time",
      BEGINNER: "Beginner",
      INTERMEDIATE: "Intermediate",
      ADVANCED: "Advanced",
    },
    save: "Add",
    cancel: "Cancel",
    adultNotSelf:
      "Adult students must book and sign with their own Google account, so they cannot be added here.",
    duplicate: "You already have a participant with that name. Use a distinct name to tell them apart.",
    selfExists: "You have already added yourself.",
    failed: "Could not add. Please check the details.",
  },
} as const;

export function AddParticipantDialog({
  locale,
  label,
  hasSelf,
  onAdded,
}: {
  locale: Locale;
  label: string;
  hasSelf: boolean;
  onAdded: (participant: NewParticipant) => void;
}) {
  const c = COPY[locale];
  const [open, setOpen] = useState(false);
  const [isSelf, setIsSelf] = useState(!hasSelf);
  const [fullName, setFullName] = useState("");
  const [isMinor, setIsMinor] = useState(false);
  const [emergencyContactName, setEmergencyName] = useState("");
  const [emergencyContactPhone, setEmergencyPhone] = useState("");
  const [skillLevel, setSkillLevel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);

    const res = await fetch("/api/participants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fullName,
        isMinor,
        isSelf,
        skillLevel: skillLevel || null,
        emergencyContactName: emergencyContactName || null,
        emergencyContactPhone: emergencyContactPhone || null,
      }),
    });
    setBusy(false);

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(
        body.error === "adult-not-self"
          ? c.adultNotSelf
          : body.error === "duplicate"
            ? c.duplicate
            : body.error === "self-exists"
              ? c.selfExists
              : c.failed,
      );
      return;
    }

    const { id } = (await res.json()) as { id: string };
    onAdded({
      id,
      fullName,
      isMinor,
      isSelf,
      level: null,
      phone: null,
      emergencyContactName: emergencyContactName || null,
      emergencyContactPhone: emergencyContactPhone || null,
    });
    setOpen(false);
    setFullName("");
    setIsMinor(false);
  }

  if (!open) {
    return (
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => setOpen(true)}
      >
        <Plus aria-hidden />
        {label}
      </Button>
    );
  }

  return (
    <div className="w-full space-y-4 rounded-xl border border-border bg-surface-muted p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{c.title}</h3>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label={c.cancel}
          className="rounded p-1 text-muted-foreground hover:text-foreground"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{c.who}</legend>
        {!hasSelf && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="who"
              checked={isSelf}
              onChange={() => setIsSelf(true)}
              className="accent-[var(--accent)]"
            />
            {c.self}
          </label>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="who"
            checked={!isSelf}
            onChange={() => {
              setIsSelf(false);
              // Someone else on your account can only be a minor, so preselect
              // it; the question below stays visible and editable.
              setIsMinor(true);
            }}
            className="accent-[var(--accent)]"
          />
          {c.child}
        </label>
        {/* Stated plainly rather than only on failure: an adult friend or
            spouse simply cannot be added, and it is better to say so up front. */}
        {!isSelf && <Hint>{c.adultNotSelf}</Hint>}
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="p-name">{c.fullName}</Label>
          <Input
            id="p-name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="p-minor">{c.minorQuestion}</Label>
          <Select
            id="p-minor"
            value={isMinor ? "yes" : "no"}
            onChange={(e) => setIsMinor(e.target.value === "yes")}
          >
            <option value="no">{c.minorNo}</option>
            <option value="yes">{c.minorYes}</option>
          </Select>
          <Hint>{c.minorHelp}</Hint>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="p-emg">{c.emergencyName}</Label>
          <Input
            id="p-emg"
            value={emergencyContactName}
            onChange={(e) => setEmergencyName(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="p-emgp">{c.emergencyPhone}</Label>
          <Input
            id="p-emgp"
            value={emergencyContactPhone}
            onChange={(e) => setEmergencyPhone(e.target.value)}
          />
          <Hint>{c.emergencyHelp}</Hint>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="p-level">{c.level}</Label>
          <Select
            id="p-level"
            value={skillLevel}
            onChange={(e) => setSkillLevel(e.target.value)}
          >
            {Object.entries(c.levels).map(([value, text]) => (
              <option key={value} value={value}>
                {text}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <FieldError>{error}</FieldError>

      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          onClick={save}
          disabled={busy || !fullName}
        >
          {busy && <Loader2 className="animate-spin" aria-hidden />}
          {c.save}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setOpen(false)}
        >
          {c.cancel}
        </Button>
      </div>
    </div>
  );
}
