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
  /** Flipkart SPAs fire many navigations; restores caused multi‑minute hangs during verification. */
  if (platform === "meesho" || platform === "flipkart") return;

  const expected = productPageIdentity(originalUrl, platform);
  if (!expected) return;

  let restoring = false;
  let restoresDone = 0;
  const maxRestores = 3;
  const armedAt = Date.now();
  /** Ignore SPA/hydration churn right after load */
  const graceMs = 2800;
  /** Flipkart fires many navigations; transient URLs may not parse — avoid reload storms */
  const hydrateMs = 9000;

  page.on("framenavigated", (frame) => {
    if (frame !== page.mainFrame()) return;
    void (async () => {
      if (restoring || Date.now() - armedAt < graceMs) return;
      if (restoresDone >= maxRestores) return;
      await page.waitForTimeout(60);
      const cur = page.url();
      if (!/^https?:\/\//i.test(cur)) return;
      const got = productPageIdentity(cur, platform);
      const age = Date.now() - armedAt;
      if (age < hydrateMs && got === null) return;
      if (sameIdentity(cur, platform, expected)) return;
      restoresDone += 1;
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
