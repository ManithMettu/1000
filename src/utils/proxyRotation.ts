

import type { BrowserContextOptions } from "playwright";

const BUILT_IN_PORTS: Record<string, string> = {
  "http:": "80",
  "https:": "443",
  "socks4:": "1080",
  "socks5:": "1080",
};

function splitProxyList(raw: string): string[] {
  return raw
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function getConfiguredProxyUrls(): string[] {
  const multi = process.env.SCRAPE_PROXIES?.trim();
  if (multi) return splitProxyList(multi);
  const one = process.env.SCRAPE_PROXY?.trim();
  return one ? [one] : [];
}

export function getProxyUrlForAttempt(attempt: number, urls: string[] = getConfiguredProxyUrls()): string | undefined {
  if (urls.length === 0) return undefined;
  return urls[((attempt % urls.length) + urls.length) % urls.length];
}

/** Playwright `newContext({ proxy })` shape. */
export function toPlaywrightProxy(proxyUrl: string): NonNullable<BrowserContextOptions["proxy"]> | null {
  try {
    const u = new URL(proxyUrl);
    const protocol = u.protocol.toLowerCase();
    if (!/^(https?|socks4|socks5):$/.test(protocol)) return null;
    const host = u.hostname;
    if (!host) return null;
    let port = u.port;
    if (!port) port = BUILT_IN_PORTS[protocol] ?? "";
    if (!port) return null;
    const server = `${protocol}//${host}:${port}`;
    const username = u.username ? decodeURIComponent(u.username) : undefined;
    const password = u.password ? decodeURIComponent(u.password) : undefined;
    return { server, username, password };
  } catch {
    return null;
  }
}

const warnedBadProxy = new Set<string>();

function redactProxyForLog(url: string): string {
  try {
    const u = new URL(url);
    if (u.username || u.password) {
      u.username = "";
      u.password = "***";
    }
    return u.toString();
  } catch {
    return url.slice(0, 80);
  }
}

function requireValidParsedProxy(
  raw: string
): NonNullable<BrowserContextOptions["proxy"]> | undefined {
  const parsed = toPlaywrightProxy(raw);
  if (parsed) return parsed;
  if (!warnedBadProxy.has(raw)) {
    warnedBadProxy.add(raw);
    console.warn(`[scraper] Ignoring invalid proxy URL: ${redactProxyForLog(raw)}`);
  }
  return undefined;
}

export function getPlaywrightProxyForAttempt(attempt: number): BrowserContextOptions["proxy"] {
  const raw = getProxyUrlForAttempt(attempt);
  if (!raw) return undefined;
  return requireValidParsedProxy(raw);
}

/** Full proxy URL for axios, or `undefined` if that slot is empty or not a supported scheme. */
export function getAxiosProxyUrlForAttempt(attempt: number): string | undefined {
  const raw = getProxyUrlForAttempt(attempt);
  if (!raw) return undefined;
  return requireValidParsedProxy(raw) ? raw : undefined;
}

export function countConfiguredProxies(): number {
  return getConfiguredProxyUrls().length;
}
