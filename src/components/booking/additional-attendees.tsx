"use client";

import { useId } from "react";
import { Hint, Input, Label } from "@/components/ui/field";
import type { Locale } from "@/i18n/routing";
import type { AdditionalAttendeeInput } from "@/lib/booking/attendee-form";

export function AdditionalAttendees({ locale, attendees, onChange, disabled = false }: {
  locale: Locale;
  attendees: AdditionalAttendeeInput[];
  onChange: (attendees: AdditionalAttendeeInput[]) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const zh = locale === "zh";
  function update(index: number, changes: Partial<AdditionalAttendeeInput>) {
    onChange(attendees.map((attendee, position) => position === index ? { ...attendee, ...changes } : attendee));
  }
  if (attendees.length === 0) return null;
  return (
    <div className="space-y-4">
      <Hint>{zh ? "每位成年学员使用本人邮箱单独签署；未满 18 岁填写监护人邮箱。全部学员签署完成后才能付款。" : "Each adult signs independently with their own email; use a guardian's email for a student under 18. Payment opens only after everyone has signed."}</Hint>
      {attendees.map((attendee, index) => (
        <fieldset key={index} disabled={disabled} className="space-y-3 rounded-xl border border-border bg-surface-2 p-4">
          <legend className="px-1 text-sm font-bold">{zh ? `学员 ${index + 2}` : `Student ${index + 2}`}</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-${index}-name`}>{zh ? "学员姓名" : "Student's full name"}</Label>
              <Input id={`${id}-${index}-name`} value={attendee.fullName} maxLength={120} required onChange={(event) => update(index, { fullName: event.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-${index}-email`}>{attendee.isMinor ? zh ? "监护人邮箱" : "Guardian's email" : zh ? "学员本人邮箱" : "Student's own email"}</Label>
              <Input id={`${id}-${index}-email`} type="email" value={attendee.email} maxLength={254} required onChange={(event) => update(index, { email: event.target.value })} />
            </div>
          </div>
          <label className="flex min-h-11 items-center gap-2 text-sm font-semibold">
            <input type="checkbox" checked={attendee.isMinor} onChange={(event) => update(index, { isMinor: event.target.checked, email: "" })} className="size-4 accent-accent" />
            {zh ? "学员未满 18 岁，由监护人签署" : "Student is under 18; their guardian signs"}
          </label>
        </fieldset>
      ))}
    </div>
  );
}
