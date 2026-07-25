/**
 * Applies the saved theme before the first paint.
 *
 * This has to be a blocking inline script rather than a React effect: if the
 * attribute is set after hydration, a user who chose dark gets a white flash on
 * every navigation. Reading localStorage synchronously here avoids that.
 *
 * It only ever sets `data-theme`, and only to "dark" or "light".
 */
export function ThemeScript() {
  const js = `
try {
  var t = localStorage.getItem('theme');
  if (t === 'dark' || t === 'light') {
    document.documentElement.setAttribute('data-theme', t);
  }
} catch (e) {}
`.trim();

  return <script dangerouslySetInnerHTML={{ __html: js }} />;
}
