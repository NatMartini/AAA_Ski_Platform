import sharp from "sharp";

/**
 * Normalises an uploaded image before it touches disk.
 *
 * Payment screenshots come straight from phones, which means they can carry
 * GPS coordinates in EXIF. Re-encoding through sharp drops all metadata as a
 * side effect, which is exactly what we want — we need the pixels, not the
 * location the student was standing in.
 *
 * Adapted from the Autofocus project's upload pipeline, minus the NSFW model:
 * nothing here is ever displayed publicly, and tfjs is a heavy dependency to
 * carry for no benefit.
 */

export const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

/** Sanity ceiling on the input, to stop a memory bomb. Not a UX limit. */
export const MAX_INPUT_BYTES = 25 * 1024 * 1024;

/** Target for the stored file. Screenshots compress well below this. */
const TARGET_MAX_BYTES = 2 * 1024 * 1024;
const MAX_DIMENSION = 2400;

export type ProcessedImage = {
  buffer: Buffer;
  width: number;
  height: number;
  extension: "webp";
  contentType: "image/webp";
};

/**
 * A declared Content-Type is attacker-controlled. Check the actual leading
 * bytes so an HTML or script payload cannot be stored with an image name.
 */
export function verifyMagicBytes(buf: Buffer, mime: string): boolean {
  if (buf.length < 12) return false;

  switch (mime) {
    case "image/jpeg":
      return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    case "image/png":
      return (
        buf[0] === 0x89 &&
        buf[1] === 0x50 &&
        buf[2] === 0x4e &&
        buf[3] === 0x47 &&
        buf[4] === 0x0d &&
        buf[5] === 0x0a &&
        buf[6] === 0x1a &&
        buf[7] === 0x0a
      );
    case "image/webp":
      return (
        buf.subarray(0, 4).toString("ascii") === "RIFF" &&
        buf.subarray(8, 12).toString("ascii") === "WEBP"
      );
    default:
      return false;
  }
}

export class ImageRejected extends Error {
  constructor(
    readonly code:
      | "unsupported-type"
      | "too-large"
      | "empty"
      | "content-mismatch"
      | "corrupt",
  ) {
    super(code);
    this.name = "ImageRejected";
  }
}

export async function processUpload(
  buf: Buffer,
  declaredMime: string,
): Promise<ProcessedImage> {
  if (buf.length === 0) throw new ImageRejected("empty");
  if (buf.length > MAX_INPUT_BYTES) throw new ImageRejected("too-large");
  if (!ALLOWED_MIME.has(declaredMime)) throw new ImageRejected("unsupported-type");
  if (!verifyMagicBytes(buf, declaredMime)) {
    throw new ImageRejected("content-mismatch");
  }

  try {
    // Step down quality until it fits. Screenshots are mostly flat colour and
    // usually land under the target on the first pass.
    for (const quality of [82, 70, 58, 45]) {
      const out = await sharp(buf, { failOn: "error" })
        .rotate() // bake in EXIF orientation before the metadata is dropped
        .resize({
          width: MAX_DIMENSION,
          height: MAX_DIMENSION,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality })
        .toBuffer({ resolveWithObject: true });

      if (out.info.size <= TARGET_MAX_BYTES || quality === 45) {
        return {
          buffer: out.data,
          width: out.info.width,
          height: out.info.height,
          extension: "webp",
          contentType: "image/webp",
        };
      }
    }
    throw new ImageRejected("corrupt");
  } catch (err) {
    if (err instanceof ImageRejected) throw err;
    throw new ImageRejected("corrupt");
  }
}

export function imageErrorMessage(
  code: ImageRejected["code"],
  locale: "en" | "zh",
): string {
  const messages: Record<ImageRejected["code"], { en: string; zh: string }> = {
    "unsupported-type": {
      en: "Please upload a JPEG, PNG or WebP image.",
      zh: "请上传 JPEG、PNG 或 WebP 图片。",
    },
    "too-large": {
      en: "That file is too large. Please upload an image under 25 MB.",
      zh: "文件过大,请上传 25 MB 以内的图片。",
    },
    empty: { en: "That file is empty.", zh: "文件为空。" },
    "content-mismatch": {
      en: "That file does not look like a real image.",
      zh: "该文件不是有效的图片。",
    },
    corrupt: {
      en: "We could not read that image. Please try another screenshot.",
      zh: "无法读取该图片,请换一张截图。",
    },
  };
  return messages[code][locale];
}
