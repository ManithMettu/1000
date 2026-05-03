import type { BrowserContext } from "playwright";

/** Reduces trivial automation signals (does not defeat advanced bot vendors). */
export async function applyStealthScripts(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", {
      get: () => undefined,
      configurable: true,
    });
    try {
      delete (navigator as unknown as { webdriver?: boolean }).webdriver;
    } catch {
      /* ignore */
    }
  });
}

export const CHROMIUM_LAUNCH_ARGS = [
  "--disable-blink-features=AutomationControlled",
  "--disable-dev-shm-usage",
  "--no-sandbox",
];

/** Do not match normal cookie banners (“enable cookies” appears on many real PDPs). */
export function looksLikeBlockedPage(html: string, title: string): boolean {
  const s = `${title}\n${html.slice(0, 16000)}`.toLowerCase();
  return /access denied|403 forbidden|403\b|request blocked|blocked by|attention required|sorry.*automated|please verify you are a human|errors\.edgesuite|(?:^|\s)cloudflare(?:\s|$)|unusual traffic|pardon our interruption|checking your browser before accessing/i.test(
    s
  );
}
