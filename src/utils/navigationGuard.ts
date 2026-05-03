import type { Page } from "playwright";
import type { ProductPayload } from "../types";

/** Stable id for “same product” (path segment), not full query string. */
export function productPageIdentity(
  urlStr: string,
  platform: ProductPayload["platform"]
): string | null {
  let u: URL;
  try {
    u = new URL(urlStr);
  } catch {
    return null;
  }
  const path = u.pathname;
  if (platform === "flipkart") {
    const m = path.match(/\/p\/(itm[a-z0-9]+)/i);
    return m ? m[1].toLowerCase() : null;
  }
  if (platform === "amazon") {
    const m = path.match(/\/dp\/([a-z0-9]{10})(?:\/|$)/i) || path.match(/\/gp\/product\/([a-z0-9]{10})/i);
    return m ? m[1].toLowerCase() : null;
  }
  if (platform === "meesho") {
    const m = path.match(/\/p\/([^/?#]+)/);
    return m ? m[1].toLowerCase() : null;
  }
  return null;
}

function sameIdentity(
  currentUrl: string,
  platform: ProductPayload["platform"],
  expected: string | null
): boolean {
  if (!expected) return true;
  const got = productPageIdentity(currentUrl, platform);
  return got === expected;
}

/**
 * If the PDP navigates away (e.g. clicking an &lt;a href&gt; to browse/search), reload the exact URL you started with.
 */
/**
 * Meesho uses heavy client-side routing; restoring here often fights the SPA and closes the browser early.
 * Flipkart/Amazon benefit from restoring when a bad click leaves the PDP.
 */
export function attachPdpNavigationGuard(
  page: Page,
  originalUrl: string,
  platform: ProductPayload["platform"]
): void {
  if (platform === "meesho") return;

  const expected = productPageIdentity(originalUrl, platform);
  if (!expected) return;

  let restoring = false;
  const armedAt = Date.now();
  /** Ignore SPA/hydration churn right after load */
  const graceMs = 2800;

  page.on("framenavigated", (frame) => {
    if (frame !== page.mainFrame()) return;
    void (async () => {
      if (restoring || Date.now() - armedAt < graceMs) return;
      await page.waitForTimeout(50);
      const cur = page.url();
      if (sameIdentity(cur, platform, expected)) return;
      restoring = true;
      try {
        await page.goto(originalUrl, { waitUntil: "domcontentloaded", timeout: 28_000 });
      } catch {
        /* ignore */
      } finally {
        restoring = false;
      }
    })();
  });
}
