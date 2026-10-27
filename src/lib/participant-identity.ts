/** Shared browser/server canonical name used for participant deduplication. */
export function canonicalParticipantName(fullName: string): string {
  return fullName.trim().toLowerCase().replace(/\s+/g, " ").replace(/[.,'’\-_\s]/g, "");
}
