/**
 * Renders a sample waiver PDF so the layout can be eyeballed without going
 * through the whole booking flow.
 *
 *   npm run sample:waiver -- guardian
 *
 * Writes to ./tmp/sample-waiver-<variant>.pdf (gitignored).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { renderWaiverPdf } from "../src/lib/waiver/render";
import { templateHash, acknowledgementIds } from "../src/lib/waiver/template-v1";
import { torontoWallTimeToUtc } from "../src/lib/time";

// 1x1 transparent PNG stands in for a drawn signature.
const BLANK_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function main() {
  const variant = process.argv[2] === "guardian" ? "guardian" : "adult";

  const pdf = await renderWaiverPdf({
    variant,
    bookingCode: "SKI-8F3K2M",
    coachName: "Kevin",
    resortName: "Mount St. Louis Moonstone",
    lessonStartAt: torontoWallTimeToUtc("2026-01-08", 13, 5),
    lessonEndAt: torontoWallTimeToUtc("2026-01-08", 14, 55),
    totalCents: 14500,
    currency: "CAD",
    season: "2025-26",
    participantName: variant === "guardian" ? "小明" : "张伟 (Zhang Wei)",
    participantIsMinor: variant === "guardian",
    signerName: variant === "guardian" ? "张丽" : "张伟 (Zhang Wei)",
    signerEmail: "student@example.com",
    typedName: variant === "guardian" ? "张丽" : "张伟",
    signatureImagePng: BLANK_PNG,
    guardianName: variant === "guardian" ? "张丽" : null,
    guardianRelationship: variant === "guardian" ? "母亲 / Mother" : null,
    guardianPhone: variant === "guardian" ? "+1 416 555 0134" : null,
    acknowledgedClauseIds: acknowledgementIds(variant),
    consentToElectronic: true,
    signedAt: new Date("2026-01-06T15:22:31Z"),
    ipAddress: "203.0.113.42",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1",
    templateHash: templateHash(variant),
  });

  await mkdir("tmp", { recursive: true });
  const out = `tmp/sample-waiver-${variant}.pdf`;
  await writeFile(out, pdf);
  console.log(`${out} — ${(pdf.length / 1024).toFixed(1)} KB`);
}

main();
