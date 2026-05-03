/** Chromium must use Chrome-family UAs; Firefox/Safari strings look suspicious and slow retries. */
const CHROME_DESKTOP = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
];

/** Desktop Chrome for all marketplaces (Meesho www works reliably with this). */
export function getPlaywrightUserAgent(attempt: number): string {
  return CHROME_DESKTOP[Math.abs(attempt) % CHROME_DESKTOP.length];
}

/** For axios/cheerio fallback — always Chrome-family for consistency with headers. */
export function getFallbackUserAgent(attempt = 0): string {
  return CHROME_DESKTOP[attempt % CHROME_DESKTOP.length];
}
