/**
 * Validation for lesson video uploads.
 *
 * Unlike images there is no re-encode step: transcoding video would mean
 * ffmpeg, minutes of CPU per clip and a job queue, for two coaches uploading a
 * handful of phone clips a week. Instead the file is stored as-is and the
 * checks are about what we are willing to store and hand back out:
 *
 *   - a container we recognise from its actual leading bytes, not its
 *     Content-Type header, so an HTML payload cannot arrive dressed as a video;
 *   - a size ceiling that a phone clip fits inside and a feature film does not.
 *
 * Note that "we recognise the container" is not "we have inspected the
 * contents". These files are only ever served from an authenticated route to
 * the student they belong to and the coach who filmed them, with a
 * Content-Disposition that stops the browser treating them as a document.
 */

export const ALLOWED_VIDEO_MIME: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};

/** Roughly two minutes of 1080p phone video. */
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

export class VideoRejected extends Error {
  constructor(readonly code: "too-large" | "bad-type" | "bad-content") {
    super(code);
    this.name = "VideoRejected";
  }
}

/**
 * ISO-BMFF (mp4/mov) files start with a box: a 4-byte length then "ftyp".
 * WebM is a Matroska file and starts with the EBML magic number.
 */
export function detectVideo(buf: Buffer): "mp4" | "mov" | "webm" | null {
  if (buf.length < 16) return null;

  if (buf.toString("ascii", 4, 8) === "ftyp") {
    const brand = buf.toString("ascii", 8, 12);
    // "qt  " is QuickTime; everything else in practice is an mp4 flavour
    // (isom, iso2, mp41, mp42, avc1, and Apple's own M4V).
    return brand.startsWith("qt") ? "mov" : "mp4";
  }
  if (buf.readUInt32BE(0) === 0x1a45dfa3) return "webm";

  return null;
}

export function checkVideo(
  buf: Buffer,
  declaredMime: string,
): { extension: "mp4" | "mov" | "webm"; contentType: string } {
  if (buf.length > MAX_VIDEO_BYTES) throw new VideoRejected("too-large");
  if (!(declaredMime in ALLOWED_VIDEO_MIME)) throw new VideoRejected("bad-type");

  const actual = detectVideo(buf);
  if (!actual) throw new VideoRejected("bad-content");

  // The stored content type follows the bytes, not the header: if a browser
  // labelled a WebM as mp4, we serve it as what it actually is.
  const contentType =
    Object.entries(ALLOWED_VIDEO_MIME).find(([, ext]) => ext === actual)?.[0] ??
    "application/octet-stream";

  return { extension: actual, contentType };
}
