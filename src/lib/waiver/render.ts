import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import {
  clausesFor,
  ELECTRONIC_CONSENT,
  READ_CONFIRMATION,
  TEMPLATE_REVISION,
  TEMPLATE_VERSION,
  TITLE,
  WARNING,
  type WaiverVariant,
} from "./template-v1";
import { formatAuditTimestamp, formatTorontoDateTime } from "../time";
import { formatMoneyShort } from "../pricing";

/**
 * Renders the signed waiver to a PDF.
 *
 * The PDF is the artifact that has to stand on its own years later, so it
 * carries everything needed to interpret it without the database: the full
 * wording that was displayed, which clauses were individually acknowledged,
 * the drawn signature, and an audit page recording who signed, when, from
 * where, and against which version of the text.
 *
 * Chinese has to render — participants have Chinese names — so a CJK font is
 * embedded. Subsetting keeps the output around 50 KB instead of 7 MB.
 */

const FONT_PATH = path.resolve("assets/fonts/NotoSansSC-Regular.ttf");

let fontBytesCache: Buffer | null = null;

async function fontBytes(): Promise<Buffer> {
  fontBytesCache ??= await readFile(FONT_PATH);
  return fontBytesCache;
}

const PAGE = { width: 595.28, height: 841.89 }; // A4 portrait
const MARGIN = 56;
const CONTENT_WIDTH = PAGE.width - MARGIN * 2;

const INK = rgb(0.07, 0.13, 0.18);
const MUTED = rgb(0.35, 0.42, 0.48);
const RULE = rgb(0.82, 0.86, 0.9);

export type WaiverRenderInput = {
  variant: WaiverVariant;
  bookingCode: string;
  coachName: string;
  resortName: string;
  lessonStartAt: Date;
  lessonEndAt: Date;
  totalCents: number;
  currency: string;
  season: string;

  participantName: string;
  participantIsMinor: boolean;

  signerName: string;
  signerEmail: string;
  typedName: string;
  signatureImagePng: Buffer;

  guardianName: string | null;
  guardianRelationship: string | null;
  guardianPhone: string | null;

  acknowledgedClauseIds: string[];
  consentToElectronic: boolean;

  signedAt: Date;
  ipAddress: string;
  userAgent: string;
  templateHash: string;
};

export async function renderWaiverPdf(
  input: WaiverRenderInput,
): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(await fontBytes(), { subset: true });

  doc.setTitle(`${TITLE.en} — ${input.bookingCode}`);
  doc.setSubject(`Waiver ${input.bookingCode}`);
  doc.setCreator("AAA Ski Platform");
  doc.setProducer("AAA Ski Platform");
  doc.setCreationDate(input.signedAt);

  const writer = new Writer(doc, font);

  writer.heading(TITLE.en, 14);
  writer.heading(TITLE.zh, 11, MUTED);
  writer.gap(6);

  // The "you are giving up rights" warning goes above everything, boxed, as it
  // was on last season's paper version. Being conspicuous is the point: a
  // release is only enforceable if reasonable steps were taken to bring it to
  // the signer's attention.
  writer.notice(WARNING.en, WARNING.zh);
  writer.gap(8);
  writer.rule();
  writer.gap(10);

  // Lesson this signature was captured for. The waiver covers the whole season
  // with this coach, so the booking is context rather than a limit.
  writer.kv("Booking / 订单号", input.bookingCode);
  writer.kv("Instructor / 教练", input.coachName);
  writer.kv("Resort / 雪场", input.resortName);
  writer.kv(
    "Lesson / 课程",
    `${formatTorontoDateTime(input.lessonStartAt, "en")} – ${formatTorontoDateTime(
      input.lessonEndAt,
      "en",
    )}`,
  );
  writer.kv(
    "Fee / 费用",
    `${formatMoneyShort(input.totalCents)} ${input.currency}`,
  );
  writer.kv("Season / 雪季", input.season);
  writer.gap(4);
  writer.kv("Participant / 学员", input.participantName);
  // No date of birth is collected, so the record states the status that
  // actually matters for the agreement rather than implying an exact age.
  writer.kv(
    "Status / 身份",
    input.participantIsMinor
      ? "Under 18 — signed by parent or legal guardian / 未满 18 周岁,由监护人签署"
      : "18 or over — signed in person / 已满 18 周岁,由本人签署",
  );
  writer.gap(10);
  writer.rule();
  writer.gap(10);

  const acknowledged = new Set(input.acknowledgedClauseIds);
  for (const clause of clausesFor(input.variant)) {
    writer.clauseHeading(clause.headingEn, clause.headingZh);
    writer.body(clause.bodyEn);
    writer.gap(3);
    writer.body(clause.bodyZh, MUTED);
    if (clause.acknowledge) {
      writer.gap(3);
      writer.checkbox(
        acknowledged.has(clause.id),
        "Separately acknowledged by the signer / 签署人已单独勾选确认",
      );
    }
    writer.gap(9);
  }

  writer.rule();
  writer.gap(8);
  writer.checkbox(true, READ_CONFIRMATION.en);
  writer.checkbox(true, READ_CONFIRMATION.zh);
  writer.checkbox(input.consentToElectronic, ELECTRONIC_CONSENT.en);
  writer.checkbox(input.consentToElectronic, ELECTRONIC_CONSENT.zh);
  writer.gap(14);

  // Signature block
  writer.ensure(190);
  writer.label("SIGNATURE / 签名");
  writer.gap(4);

  const png = await doc.embedPng(new Uint8Array(input.signatureImagePng));
  const maxW = 240;
  const maxH = 80;
  const scale = Math.min(maxW / png.width, maxH / png.height, 1);
  const drawW = png.width * scale;
  const drawH = png.height * scale;

  writer.ensure(drawH + 70);
  writer.page.drawImage(png, {
    x: MARGIN,
    y: writer.y - drawH,
    width: drawW,
    height: drawH,
  });
  writer.moveDown(drawH + 4);
  writer.page.drawLine({
    start: { x: MARGIN, y: writer.y },
    end: { x: MARGIN + maxW, y: writer.y },
    thickness: 0.75,
    color: RULE,
  });
  writer.moveDown(14);

  writer.kv("Signed by / 签署人", input.signerName);
  writer.kv("Typed name / 打印姓名", input.typedName);
  writer.kv("Verified email / 已验证邮箱", input.signerEmail);
  if (input.variant === "guardian") {
    writer.kv("Guardian / 监护人", input.guardianName ?? "—");
    writer.kv("Relationship / 关系", input.guardianRelationship ?? "—");
    writer.kv("Phone / 电话", input.guardianPhone ?? "—");
  }
  writer.kv("Signed at / 签署时间", formatTorontoDateTime(input.signedAt, "en"));

  // Audit page: everything needed to establish integrity of the record.
  writer.newPage();
  writer.heading("Signature audit record", 13);
  writer.body(
    "This page records how the signature above was captured. It is generated by the server; none of these values are supplied by the signer's browser except the user agent string, which is recorded as received.",
  );
  writer.gap(3);
  writer.body(
    "本页记录上述签名的采集过程。所有数值均由服务器生成;仅 User-Agent 一项为浏览器提供,按原样记录。",
    MUTED,
  );
  writer.gap(10);
  writer.rule();
  writer.gap(10);

  writer.kv("Booking reference", input.bookingCode);
  writer.kv("Participant", input.participantName);
  writer.kv("Signer", `${input.signerName} <${input.signerEmail}>`);
  writer.kv(
    "Signer role",
    input.variant === "guardian" ? "Parent / legal guardian" : "Participant",
  );
  writer.kv("Identity basis", "Google account with verified email address");
  writer.kv("Signed at", formatAuditTimestamp(input.signedAt));
  writer.kv("IP address", input.ipAddress);
  writer.kv("Template version", `v${TEMPLATE_VERSION}.${TEMPLATE_REVISION}`);
  writer.kv("Template SHA-256", input.templateHash);
  writer.kv(
    "Clauses acknowledged",
    input.acknowledgedClauseIds.join(", ") || "—",
  );
  writer.kv("Electronic signature consent", input.consentToElectronic ? "Yes" : "No");
  writer.gap(6);
  writer.label("USER AGENT");
  writer.body(input.userAgent, MUTED, 8);

  writer.gap(12);
  writer.rule();
  writer.gap(8);
  writer.body(
    "A SHA-256 digest of this completed PDF is stored alongside the signature record, so any later alteration of this file can be detected.",
    MUTED,
    8,
  );

  return Buffer.from(await doc.save());
}

/**
 * Small layout helper: tracks the cursor, wraps text and starts new pages.
 *
 * Wrapping has to handle both scripts. Latin breaks on spaces; Chinese has no
 * spaces, so it breaks between characters. Doing only word-wrapping would push
 * a whole Chinese paragraph off the right edge as one long "word".
 */
class Writer {
  page: PDFPage;
  y: number;

  constructor(
    private doc: PDFDocument,
    private font: PDFFont,
  ) {
    this.page = doc.addPage([PAGE.width, PAGE.height]);
    this.y = PAGE.height - MARGIN;
  }

  newPage(): void {
    this.page = this.doc.addPage([PAGE.width, PAGE.height]);
    this.y = PAGE.height - MARGIN;
  }

  /** Start a new page if less than `needed` points remain. */
  ensure(needed: number): void {
    if (this.y - needed < MARGIN) this.newPage();
  }

  moveDown(amount: number): void {
    this.y -= amount;
  }

  gap(amount: number): void {
    this.y -= amount;
  }

  rule(): void {
    this.ensure(8);
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: PAGE.width - MARGIN, y: this.y },
      thickness: 0.5,
      color: RULE,
    });
  }

  /** Boxed, tinted callout for the conspicuous rights-waiver warning. */
  notice(en: string, zh: string): void {
    const size = 8.5;
    const pad = 8;
    const inner = CONTENT_WIDTH - pad * 2;
    const enLines = wrap(en, this.font, size, inner);
    const zhLines = wrap(zh, this.font, size, inner);
    const height =
      (enLines.length + zhLines.length) * size * 1.45 + pad * 2 + 6;

    this.ensure(height + 6);
    const top = this.y;
    this.page.drawRectangle({
      x: MARGIN,
      y: top - height,
      width: CONTENT_WIDTH,
      height,
      color: rgb(0.99, 0.96, 0.9),
      borderColor: rgb(0.85, 0.6, 0.25),
      borderWidth: 1,
    });

    this.moveDown(pad);
    for (const line of enLines) {
      this.moveDown(size * 1.45);
      this.page.drawText(line, {
        x: MARGIN + pad,
        y: this.y,
        size,
        font: this.font,
        color: rgb(0.35, 0.2, 0.02),
      });
    }
    this.moveDown(6);
    for (const line of zhLines) {
      this.moveDown(size * 1.45);
      this.page.drawText(line, {
        x: MARGIN + pad,
        y: this.y,
        size,
        font: this.font,
        color: rgb(0.45, 0.32, 0.12),
      });
    }
    this.y = top - height;
  }

  heading(text: string, size: number, color = INK): void {
    // Wraps: the formal title is long enough to run off the page otherwise,
    // and a silently clipped heading on a legal document is not acceptable.
    for (const line of wrap(text, this.font, size, CONTENT_WIDTH)) {
      this.ensure(size + 8);
      this.moveDown(size * 1.25);
      this.page.drawText(line, {
        x: MARGIN,
        y: this.y,
        size,
        font: this.font,
        color,
      });
    }
    this.moveDown(4);
  }

  clauseHeading(en: string, zh: string): void {
    this.ensure(34);
    this.moveDown(11);
    this.page.drawText(`${en}  ·  ${zh}`, {
      x: MARGIN,
      y: this.y,
      size: 10,
      font: this.font,
      color: INK,
    });
    this.moveDown(6);
  }

  label(text: string): void {
    this.ensure(14);
    this.moveDown(9);
    this.page.drawText(text, {
      x: MARGIN,
      y: this.y,
      size: 7.5,
      font: this.font,
      color: MUTED,
    });
    this.moveDown(3);
  }

  body(text: string, color = INK, size = 9): void {
    const lineHeight = size * 1.45;
    for (const line of wrap(text, this.font, size, CONTENT_WIDTH)) {
      this.ensure(lineHeight);
      this.moveDown(lineHeight);
      this.page.drawText(line, {
        x: MARGIN,
        y: this.y,
        size,
        font: this.font,
        color,
      });
    }
  }

  kv(key: string, value: string): void {
    const size = 9;
    const keyWidth = 150;
    const lines = wrap(value, this.font, size, CONTENT_WIDTH - keyWidth);
    this.ensure(size * 1.5 * lines.length);
    this.moveDown(size * 1.5);
    this.page.drawText(key, {
      x: MARGIN,
      y: this.y,
      size,
      font: this.font,
      color: MUTED,
    });
    lines.forEach((line, i) => {
      if (i > 0) {
        this.moveDown(size * 1.4);
        this.ensure(size * 1.4);
      }
      this.page.drawText(line, {
        x: MARGIN + keyWidth,
        y: this.y,
        size,
        font: this.font,
        color: INK,
      });
    });
  }

  checkbox(checked: boolean, text: string): void {
    const size = 8.5;
    const boxSize = 8;
    const indent = 14;
    const lines = wrap(text, this.font, size, CONTENT_WIDTH - indent);

    this.ensure(size * 1.5 * lines.length + 2);
    this.moveDown(size * 1.5);

    this.page.drawRectangle({
      x: MARGIN,
      y: this.y - 1,
      width: boxSize,
      height: boxSize,
      borderColor: MUTED,
      borderWidth: 0.7,
    });
    if (checked) {
      // A filled square reads as "ticked" without needing a glyph that may not
      // exist in the subset.
      this.page.drawRectangle({
        x: MARGIN + 1.8,
        y: this.y + 0.8,
        width: boxSize - 3.6,
        height: boxSize - 3.6,
        color: INK,
      });
    }

    lines.forEach((line, i) => {
      if (i > 0) {
        this.moveDown(size * 1.4);
        this.ensure(size * 1.4);
      }
      this.page.drawText(line, {
        x: MARGIN + indent,
        y: this.y,
        size,
        font: this.font,
        color: INK,
      });
    });
  }
}

/** True for scripts that wrap between characters rather than on spaces. */
function isCjk(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return (
    (code >= 0x2e80 && code <= 0x9fff) || // CJK radicals through unified ideographs
    (code >= 0xf900 && code <= 0xfaff) || // compatibility ideographs
    (code >= 0xff00 && code <= 0xff60) || // fullwidth forms
    (code >= 0x3000 && code <= 0x303f) // CJK punctuation
  );
}

/**
 * Wraps mixed Latin/CJK text to a pixel width.
 *
 * Tokenises into runs: whitespace-delimited words for Latin, single characters
 * for CJK, then greedily fills lines. Anything still too wide on its own (a
 * long URL, say) is broken by character rather than allowed to overflow.
 */
export function wrap(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string[] {
  const paragraphs = text.split("\n");
  const out: string[] = [];

  for (const paragraph of paragraphs) {
    const tokens: string[] = [];
    let buffer = "";

    for (const char of paragraph) {
      if (isCjk(char)) {
        if (buffer) {
          tokens.push(buffer);
          buffer = "";
        }
        tokens.push(char);
      } else if (char === " ") {
        if (buffer) {
          tokens.push(buffer);
          buffer = "";
        }
        tokens.push(" ");
      } else {
        buffer += char;
      }
    }
    if (buffer) tokens.push(buffer);

    let line = "";
    for (const token of tokens) {
      const candidate = line + token;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        line = candidate;
        continue;
      }
      // Never start a line with a space left over from the break.
      if (token === " ") {
        if (line) out.push(line);
        line = "";
        continue;
      }
      if (line) out.push(line);
      if (font.widthOfTextAtSize(token, size) <= maxWidth) {
        line = token;
      } else {
        // Single token wider than the column: split it by character.
        let chunk = "";
        for (const char of token) {
          if (font.widthOfTextAtSize(chunk + char, size) > maxWidth) {
            out.push(chunk);
            chunk = char;
          } else {
            chunk += char;
          }
        }
        line = chunk;
      }
    }
    if (line) out.push(line);
    if (paragraph === "") out.push("");
  }

  return out;
}
