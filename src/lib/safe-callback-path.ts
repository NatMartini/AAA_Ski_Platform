/** Sign-in can return only to a relative route on this site. */
export function safeCallbackPath(value: unknown, fallback = "/"): string {
  if (typeof value !== "string" || value.length > 4096 || !value.startsWith("/")
    || value.startsWith("//") || /[\\\u0000-\u0020\u007f]/.test(value)) return fallback;
  try {
    const parsed = new URL(value, "https://callback.invalid");
    if (parsed.origin !== "https://callback.invalid" || parsed.pathname.startsWith("//")) return fallback;
    let pathname = parsed.pathname;
    for (let iteration = 0; iteration < 3; iteration++) {
      if (pathname.startsWith("//") || /[\\\u0000-\u0020\u007f]/.test(pathname)) return fallback;
      const decoded = decodeURIComponent(pathname);
      if (decoded === pathname) break;
      pathname = decoded;
    }
    if (pathname.startsWith("//") || /[\\\u0000-\u0020\u007f]/.test(pathname)) return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}
