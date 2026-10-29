/**
 * A stable id for one teaching finding, usable in the browser and on the server. It hashes the
 * finding's kind and Chinese text, so a review stays attached to exactly the sentence the coach
 * read: when FreeSki rewrites the text, old reviews fall away rather than mislabel the new one.
 */
export type FindingKind = "strength" | "improvement" | "drill";

function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function findingKey(kind: FindingKind, textZh: string): string {
  const normalized = textZh.replace(/\s+/g, " ").trim();
  return `${kind}:${fnv1a(normalized)}:${fnv1a(normalized.split("").reverse().join(""))}`;
}

export const FINDING_KEY = /^(strength|improvement|drill):[0-9a-f]{8}:[0-9a-f]{8}$/;
