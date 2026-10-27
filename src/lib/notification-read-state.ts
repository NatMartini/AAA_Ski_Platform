const EMPTY: readonly string[] = [];
const MAX_READ_KEYS = 300;
const CHANGE_EVENT = "ski-notifications-read";
const cache = new Map<string, { raw: string | null; keys: readonly string[] }>();

export function notificationReadStorageKey(userId: string): string {
  return `aaa-ski:notifications:v1:${userId}`;
}

export function parseNotificationReadKeys(raw: string | null): readonly string[] {
  if (!raw) return EMPTY;
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return EMPTY;
    return [...new Set(value.filter((key): key is string => typeof key === "string" && key.length <= 240))].slice(-MAX_READ_KEYS);
  } catch {
    return EMPTY;
  }
}

export function readNotificationKeys(userId: string): readonly string[] {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = window.localStorage.getItem(notificationReadStorageKey(userId));
    const previous = cache.get(userId);
    if (previous?.raw === raw) return previous.keys;
    const keys = parseNotificationReadKeys(raw);
    cache.set(userId, { raw, keys });
    return keys;
  } catch {
    return cache.get(userId)?.keys ?? EMPTY;
  }
}

export function serverNotificationReadKeys(): readonly string[] {
  return EMPTY;
}

export function subscribeNotificationReads(userId: string, onChange: () => void): () => void {
  const storageKey = notificationReadStorageKey(userId);
  const storage = (event: StorageEvent) => {
    if (event.key === storageKey || event.key === null) onChange();
  };
  const local = (event: Event) => {
    if ((event as CustomEvent<string>).detail === userId) onChange();
  };
  window.addEventListener("storage", storage);
  window.addEventListener(CHANGE_EVENT, local);
  return () => {
    window.removeEventListener("storage", storage);
    window.removeEventListener(CHANGE_EVENT, local);
  };
}

/** Only event identities are retained, never notification text or personal data. */
export function markNotificationsRead(userId: string, keys: string[]): void {
  const merged = [...new Set([...readNotificationKeys(userId), ...keys])].slice(-MAX_READ_KEYS);
  let raw = cache.get(userId)?.raw ?? null;
  try {
    raw = JSON.stringify(merged);
    window.localStorage.setItem(notificationReadStorageKey(userId), raw);
  } catch {
    // Private browsing/storage quotas still allow an in-memory read state.
    raw = cache.get(userId)?.raw ?? null;
  }
  cache.set(userId, { raw, keys: merged });
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: userId }));
}
