import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Private file storage for payment screenshots and signed waiver PDFs.
 *
 * These files must NOT live under public/. Anything Next serves from public/ is
 * readable by anyone who guesses or is handed the URL, with no auth check at
 * all — and a payment screenshot routinely shows a bank balance and account
 * number, while a waiver carries a handwritten signature.
 *
 * So: files go in a directory outside the web root, the database stores an
 * opaque *key* rather than a URL, and reads go through route handlers that
 * check who is asking.
 */

const ROOT = path.resolve(process.env.STORAGE_DIR ?? "./storage");

/** Keys look like "proofs/<bookingId>/<uuid>.webp". */
export type StorageKey = string;

export class StorageKeyError extends Error {
  constructor(key: string) {
    super(`Refusing unsafe storage key: ${key}`);
    this.name = "StorageKeyError";
  }
}

/**
 * Resolve a key to an absolute path, refusing anything that escapes the root.
 *
 * Checking for ".." in the string is not enough — URL-encoded traversal,
 * absolute paths and Windows drive letters all have to be caught, so we resolve
 * first and then assert containment.
 */
export function resolveKey(key: StorageKey): string {
  if (typeof key !== "string" || key.length === 0) throw new StorageKeyError(key);
  if (key.includes("\0")) throw new StorageKeyError(key);
  if (path.isAbsolute(key)) throw new StorageKeyError(key);

  const full = path.resolve(ROOT, key);
  const rel = path.relative(ROOT, full);
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new StorageKeyError(key);

  return full;
}

export function buildKey(prefix: string, extension: string): StorageKey {
  const ext = extension.replace(/^\./, "").toLowerCase();
  if (!/^[a-z0-9]{1,8}$/.test(ext)) throw new Error(`Bad extension: ${extension}`);
  // Only ever built server-side from fixed prefixes, but validate anyway so a
  // stray id can never introduce a separator.
  if (!/^[A-Za-z0-9/_-]+$/.test(prefix)) throw new Error(`Bad prefix: ${prefix}`);
  return `${prefix}/${randomUUID()}.${ext}`;
}

export async function writeObject(
  key: StorageKey,
  data: Buffer,
): Promise<{ key: StorageKey; bytes: number; sha256: string }> {
  const full = resolveKey(key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, data);
  return { key, bytes: data.length, sha256: sha256(data) };
}

export async function readObject(key: StorageKey): Promise<Buffer> {
  return readFile(resolveKey(key));
}

export async function objectExists(key: StorageKey): Promise<boolean> {
  try {
    return existsSync(resolveKey(key));
  } catch {
    return false;
  }
}

export async function objectSize(key: StorageKey): Promise<number | null> {
  try {
    return (await stat(resolveKey(key))).size;
  } catch {
    return null;
  }
}

/** Used by the retention job. Missing files are not an error. */
export async function deleteObject(key: StorageKey): Promise<void> {
  try {
    await unlink(resolveKey(key));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") throw err;
  }
}

export function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export const KEY_PREFIX = {
  proof: (bookingId: string) => `proofs/${bookingId}`,
  waiver: () => `waivers`,
  qr: (coachId: string) => `qr/${coachId}`,
  video: (bookingId: string) => `videos/${bookingId}`,
} as const;

/** Content types we are willing to serve back out of storage. */
export const SERVEABLE_TYPES: Record<string, string> = {
  webp: "image/webp",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  pdf: "application/pdf",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
};

export function contentTypeForKey(key: StorageKey): string {
  const ext = path.extname(key).replace(/^\./, "").toLowerCase();
  return SERVEABLE_TYPES[ext] ?? "application/octet-stream";
}
