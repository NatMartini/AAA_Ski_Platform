import { z } from "zod";
import { isDateKey } from "./time";
import { isWithinSeason } from "./season";

/**
 * All request bodies are parsed here before anything touches the database.
 * Nothing downstream re-validates, so these schemas are the boundary.
 */

export const dateKeySchema = z
  .string()
  .refine(isDateKey, { message: "Expected a YYYY-MM-DD calendar date" });

/** A date that must fall inside a ski season (1 Dec – 1 May). */
export const seasonDateSchema = dateKeySchema.refine(isWithinSeason, {
  message: "Date is outside the ski season (1 December – 1 May)",
});

export const hourSchema = z.number().int().min(0).max(24);

export const coachDaySchema = z
  .object({
    date: seasonDateSchema,
    resortId: z.string().min(1),
    startHour: hourSchema,
    endHour: hourSchema,
    breakStartHour: hourSchema.nullable().optional(),
    breakEndHour: hourSchema.nullable().optional(),
    hourlyRateCentsOverride: z.number().int().min(0).max(1_000_000).nullable().optional(),
    note: z.string().max(300).nullable().optional(),
  })
  .refine((d) => d.endHour > d.startHour, {
    message: "End hour must be after start hour",
    path: ["endHour"],
  })
  .refine(
    (d) =>
      d.breakStartHour == null ||
      d.breakEndHour == null ||
      d.breakEndHour > d.breakStartHour,
    { message: "Break end must be after break start", path: ["breakEndHour"] },
  )
  .refine(
    (d) =>
      d.breakStartHour == null ||
      d.breakEndHour == null ||
      (d.breakStartHour >= d.startHour && d.breakEndHour <= d.endHour),
    { message: "Break must sit inside the working window", path: ["breakStartHour"] },
  );

export const coachSettingsSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  /** Coach introduction shown at the top of the booking page. */
  bioZh: z.string().trim().max(2000).nullable().optional(),
  bioEn: z.string().trim().max(2000).nullable().optional(),
  hourlyRateCents: z.number().int().min(0).max(1_000_000),
  handoverDiscountCents: z.number().int().min(0).max(1_000_000),
  extraPersonCents: z.number().int().min(0).max(1_000_000),
  maxGroupSize: z.number().int().min(1).max(20),
  csiaLevel: z.number().int().min(1).max(4).nullable(),
  csiaParkLevel: z.number().int().min(1).max(2).nullable(),
  teachableSkills: z.array(z.string().max(40)).max(40).default([]),
  teachableLevels: z.array(z.string().max(40)).max(10).default([]),
  minHours: z.number().int().min(1).max(12),
  maxHours: z.number().int().min(1).max(12),
  leadTimeHours: z.number().int().min(0).max(720),

  emtEnabled: z.boolean(),
  emtEmail: z.string().trim().email().nullable().optional().or(z.literal("")),
  emtName: z.string().trim().max(120).nullable().optional(),
  wechatPayEnabled: z.boolean(),
  alipayEnabled: z.boolean(),

  wechatId: z.string().trim().max(80).nullable().optional(),
  contactEmail: z.string().trim().email().nullable().optional().or(z.literal("")),
  contactPhone: z.string().trim().max(40).nullable().optional(),

  // Required before the coach can take bookings: it is shown on the review
  // page and frozen onto every booking.
  cancellationPolicyZh: z.string().trim().max(4000),
  cancellationPolicyEn: z.string().trim().max(4000),

  isPublished: z.boolean(),
})
  .refine((s) => s.maxHours >= s.minHours, {
    message: "Maximum hours cannot be below minimum hours",
    path: ["maxHours"],
  })
  .refine((s) => !s.emtEnabled || Boolean(s.emtEmail), {
    message: "An e-Transfer address is required when e-Transfer is enabled",
    path: ["emtEmail"],
  })
  .refine(
    (s) =>
      !s.isPublished ||
      (s.cancellationPolicyZh.length > 0 && s.cancellationPolicyEn.length > 0),
    {
      message:
        "A cancellation policy in both languages is required before taking bookings",
      path: ["cancellationPolicyZh"],
    },
  );

export const participantSchema = z.object({
  fullName: z.string().trim().min(1).max(120),
  /** Under 18. Drives who must sign the waiver. */
  isMinor: z.boolean(),
  isSelf: z.boolean(),
  phone: z.string().trim().max(40).nullable().optional(),
  wechatId: z.string().trim().max(80).nullable().optional(),
  email: z.string().trim().email().nullable().optional().or(z.literal("")),
  skillLevel: z
    .enum(["FIRST_TIME", "BEGINNER", "INTERMEDIATE", "ADVANCED"])
    .nullable()
    .optional(),
  /** Ability key from lib/skills.ts. */
  level: z.string().trim().max(40).nullable().optional(),
  // Recommended but never required — a booking must not be blocked on it.
  emergencyContactName: z.string().trim().max(120).nullable().optional(),
  emergencyContactPhone: z.string().trim().max(40).nullable().optional(),
});

/** Upper bound; the coach's own maxGroupSize is enforced at booking time. */
const headcountSchema = z.number().int().min(1).max(20).default(1);

export const createBookingSchema = z.object({
  coachId: z.string().min(1),
  date: seasonDateSchema,
  startHour: hourSchema,
  hours: z.number().int().min(1).max(12),
  headcount: headcountSchema,
  participantId: z.string().min(1),
  /** Skill keys the student wants to work on; unknown keys are dropped. */
  requestedSkills: z.array(z.string().max(40)).max(12).default([]),
  paymentPlan: z.enum(["FULL", "DEPOSIT"]).default("FULL"),
  notes: z.string().trim().max(1000).nullable().optional(),
});

export const quoteSchema = z.object({
  coachId: z.string().min(1),
  date: seasonDateSchema,
  startHour: hourSchema,
  hours: z.number().int().min(1).max(12),
});

export const coachCreateBookingSchema = z.object({
  date: seasonDateSchema,
  startHour: hourSchema,
  hours: z.number().int().min(1).max(12),
  headcount: headcountSchema,
  studentName: z.string().trim().min(1).max(120),
  /** The signing link is issued to this address and only it can sign. */
  studentEmail: z.string().trim().email(),
  /** Under 18 — the signing link then asks a guardian to sign. */
  studentIsMinor: z.boolean().default(false),
  requestedSkills: z.array(z.string().max(40)).max(12).default([]),
  notes: z.string().trim().max(1000).nullable().optional(),
});

export const waiverSignSchema = z.object({
  typedName: z.string().trim().min(1).max(120),
  /** PNG data URL from the signature canvas. */
  signatureImage: z
    .string()
    .startsWith("data:image/png;base64,")
    .max(400_000),
  consentToElectronic: z.literal(true),
  agreedCheckboxes: z.record(z.string(), z.literal(true)),
  guardianName: z.string().trim().max(120).nullable().optional(),
  guardianPhone: z.string().trim().max(40).nullable().optional(),
  guardianRelationship: z.string().trim().max(80).nullable().optional(),
});

export const paymentProofSchema = z.object({
  method: z.enum(["EMT", "WECHAT", "ALIPAY"]),
  /** Which instalment this proof is for. */
  stage: z.enum(["DEPOSIT", "FULL", "BALANCE"]).default("FULL"),
  /** Storage key returned by the upload endpoint, not a URL. */
  proofKey: z.string().min(1).max(300),
  reference: z.string().trim().max(200).nullable().optional(),
});

export const cancelBookingSchema = z.object({
  /**
   * Required. A cancellation the student cannot explain is worse than no
   * cancellation feature at all — this text is emailed to them verbatim.
   */
  reason: z.string().trim().min(1).max(500),
});

export const lessonSummarySchema = z.object({
  summary: z.string().trim().max(4000),
});

export const settleBalanceSchema = z.object({
  /** Free-text note for the coach's own records, e.g. "cash on the hill". */
  note: z.string().trim().max(200).nullable().optional(),
});

export const reviewSchema = z.object({
  action: z.enum(["confirm", "reject"]),
  note: z.string().trim().max(500).nullable().optional(),
});

/** Flatten a ZodError into `{ field: message }` for form rendering. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    out[key] ??= issue.message;
  }
  return out;
}
