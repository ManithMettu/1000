import axios from "axios";
import * as cheerio from "cheerio";
import * as fs from "fs";
import * as path from "path";
import { chromium, type Page } from "playwright";
import { scrapeAmazon } from "./platforms/amazon";
import { scrapeFlipkart } from "./platforms/flipkart";
import { scrapeMeesho } from "./platforms/meesho";
import type { ProductPayload } from "./types";
import { emptyProduct } from "./types";
import { cacheGet, cacheSet } from "./utils/cache";
import { chromeLikeHeaders } from "./utils/httpHeaders";
import { classifyOfferText, dedupeOffers, textOrNull } from "./utils/parser";
import { withRetry } from "./utils/retry";
import { applyStealthScripts, CHROMIUM_LAUNCH_ARGS, looksLikeBlockedPage } from "./utils/stealth";
import { attachPdpNavigationGuard } from "./utils/navigationGuard";
import {
  InvalidProductUrlError,
  assertHtmlLooksLikeFlipkartPdp,
  assertProductDetailUrl,
} from "./utils/productUrl";
import { resolveHeaded, resolveHeadedPauseMs, resolveSlowMoMs } from "./utils/browserEnv";
import { getFallbackUserAgent, getPlaywrightUserAgent } from "./utils/userAgent";

export interface ScrapeResult {
  data: ProductPayload;
  source: "playwright" | "cheerio";
  screenshot_path?: string | null;
}

export function detectPlatform(url: string): ProductPayload["platform"] | null {
  const u = url.toLowerCase();
  if (/amazon\./.test(u)) return "amazon";
  if (u.includes("flipkart.com")) return "flipkart";
  if (u.includes("meesho.com")) return "meesho";
  return null;
}

function interactionLimits(platform: ProductPayload["platform"]): {
  scrollCap: number;
  maxClickScan: number;
} {
  if (platform === "meesho") return { scrollCap: 5200, maxClickScan: 16 };
  return { scrollCap: 7800, maxClickScan: 30 };
}

function ensureScreenshotsDir(): string {
  const dir = path.join(process.cwd(), "screenshots");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function assertNotBlocked(page: Page): Promise<void> {
  const html = await page.content();
  const title = await page.title();
  if (looksLikeBlockedPage(html, title)) {
    throw new Error(
      "Site returned a block page (access denied / bot check). Try again later, use a residential or mobile IP, or a proxy service."
    );
  }
}

async function humanDelay(page: Page, ms?: number): Promise<void> {
  await page.waitForTimeout(ms ?? 120 + Math.floor(Math.random() * 220));
}

async function autoScroll(page: Page, maxPx: number): Promise<void> {
  await page.evaluate(async (limit) => {
    const max = Math.min(document.body.scrollHeight, limit);
    for (let y = 0; y < max; y += 780) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 32));
    }
    window.scrollTo(0, max);
    await new Promise((r) => setTimeout(r, 60));
  }, maxPx);
  await page.waitForTimeout(100);
}

/**
 * Expand sections without leaving the PDP. Flipkart: avoid bare &lt;a&gt; links — they often go to browse/search.
 */
async function clickExpandables(
  page: Page,
  maxScan: number,
  platform: ProductPayload["platform"]
): Promise<void> {
  const strong =
    /view\s+all|see\s+more|available\s+offers|show\s+more|read\s+more|^\s*more\s*$/i;
  const useAnchors = platform !== "flipkart";
  const clickable = useAnchors
    ? page.locator('button, a, [role="button"], .a-button-text')
    : page.locator('button, [role="button"]');
  const n = await clickable.count();
  const cap = Math.min(n, maxScan);
  for (let i = 0; i < cap; i++) {
    const el = clickable.nth(i);
    const txt = (await el.innerText().catch(() => "")).trim();
    if (txt.length < 3 || txt.length > 220) continue;
    const low = txt.toLowerCase();
    if (
      strong.test(low) ||
      (/view|see|offer|more|all|emi/i.test(low) && !/buy now|add to cart/i.test(low))
    ) {
      await el.click({ timeout: 1600 }).catch(() => {});
      await page.waitForTimeout(85);
    }
  }
  const offerPatterns = [/view all offers/i, /available offers/i, /see all offers/i];
  for (const re of offerPatterns) {
    if (platform === "flipkart") {
      await page.getByRole("button", { name: re }).first().click({ timeout: 900 }).catch(() => {});
    } else {
      await page.getByText(re).first().click({ timeout: 900 }).catch(() => {});
    }
    await page.waitForTimeout(100);
  }
}

async function runPlaywright(
  url: string,
  platform: ProductPayload["platform"],
  userAgent: string,
  takeScreenshot: boolean,
  headed: boolean
): Promise<{ data: ProductPayload; screenshot_path: string | null }> {
  const slowMo = resolveSlowMoMs();
  const browser = await chromium.launch({
    headless: !headed,
    slowMo,
    args: CHROMIUM_LAUNCH_ARGS,
  });
  let screenshot_path: string | null = null;
  let activePage: Page | undefined;
  try {
    const headers = chromeLikeHeaders(userAgent);
    const context = await browser.newContext({
      userAgent,
      locale: "en-IN",
      timezoneId: "Asia/Kolkata",
      viewport: { width: 1366, height: 900 },
      extraHTTPHeaders: headers,
    });
    await applyStealthScripts(context);

    const page = await context.newPage();
    /* 3 s default: pages are already loaded before extraction, so 12 s stacks 40+ timeouts → multi-minute hangs. */
    page.setDefaultTimeout(3_000);
    page.setDefaultNavigationTimeout(50_000);
    activePage = page;
    attachPdpNavigationGuard(page, url, platform);
    const limits = interactionLimits(platform);

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    /* Flipkart often never reaches network "load" (long-polling); avoid hanging here. */
    if (platform !== "flipkart") {
      await page.waitForLoadState("load", { timeout: 18_000 }).catch(() => {});
    }
    if (platform === "meesho") {
      await page.waitForURL(/\/p\//i, { timeout: 18_000 }).catch(() => {});
    }
    await assertNotBlocked(page);
    assertProductDetailUrl(page.url(), platform);
    await humanDelay(page);
    await autoScroll(page, limits.scrollCap);
    await clickExpandables(page, limits.maxClickScan, platform);
    await page.waitForTimeout(platform === "meesho" ? 280 : 200);

    let data: ProductPayload;
    if (platform === "amazon") data = await scrapeAmazon(page);
    else if (platform === "flipkart") data = await scrapeFlipkart(page);
    else data = await scrapeMeesho(page);

    if (takeScreenshot) {
      const file = path.join(ensureScreenshotsDir(), `shot-${Date.now()}.png`);
      await page.screenshot({ path: file, fullPage: false }).catch(() => {});
      screenshot_path = file;
    }
    return { data, screenshot_path };
  } finally {
    const pause = resolveHeadedPauseMs(headed);
    if (activePage && pause > 0) {
      await activePage.waitForTimeout(pause).catch(() => {});
    }
    await browser.close().catch(() => {});
  }
}

function cheerioExtract(html: string, platform: ProductPayload["platform"]): ProductPayload {
  const $ = cheerio.load(html);
  const p = emptyProduct(platform);
  p.title = textOrNull($('meta[property="og:title"]').attr("content") || $("title").text() || $("h1").first().text());

  const body = $.text();
  const priceMatch = body.match(/₹\s*[\d,]+|Rs\.?\s*[\d,]+|INR\s*[\d,]+/);
  p.price = priceMatch ? textOrNull(priceMatch[0]) : null;

  $('meta[property="og:image"], meta[name="og:image"]').each((_, el) => {
    const u = $(el).attr("content");
    if (u?.startsWith("http")) p.images.push(u);
  });
  $("img[src]").each((_, el) => {
    const u = $(el).attr("src");
    if (u?.startsWith("http") && p.images.length < 12) p.images.push(u);
  });
  p.images = [...new Set(p.images)];

  const offerLike = body.match(/(\d+%\s*(?:cash\s*back|off)|no[\s-]?cost\s*emi|bank\s+offer[^\n]{0,120})/gi);
  if (offerLike) {
    p.offers = dedupeOffers(offerLike.map((t) => classifyOfferText(t)));
  }
  p.additional_details["fallback"] = "static_html";
  return p;
}

async function runCheerio(url: string, platform: ProductPayload["platform"]): Promise<ProductPayload> {
  const ua = getFallbackUserAgent(0);
  const res = await axios.get<string>(url, {
    timeout: 18_000,
    headers: {
      "User-Agent": ua,
      ...chromeLikeHeaders(ua),
    },
    validateStatus: () => true,
  });
  if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
  const html = res.data;
  if (looksLikeBlockedPage(html, "")) {
    throw new Error("HTTP response looks like a block / challenge page");
  }
  if (platform === "flipkart") assertHtmlLooksLikeFlipkartPdp(html);
  return cheerioExtract(html, platform);
}

export async function scrapeProduct(
  url: string,
  options?: { screenshot?: boolean; headed?: boolean }
): Promise<ScrapeResult> {
  const cached = cacheGet<ScrapeResult>(url);
  if (cached) return { ...cached, data: { ...cached.data } };

  const platform = detectPlatform(url);
  if (!platform) throw new Error("Unsupported platform. Use Amazon, Flipkart, or Meesho product URLs.");

  const takeScreenshot = Boolean(options?.screenshot);
  const headed = resolveHeaded(options?.headed);

  try {
    const out = await withRetry(async (attempt) => {
      const ua = getPlaywrightUserAgent(attempt);
      const { data, screenshot_path } = await runPlaywright(
        url,
        platform,
        ua,
        takeScreenshot,
        headed
      );
      if (!data.title && !data.price) throw new Error("Insufficient data from Playwright");
      if (data.title && /^access\s+denied$|^403\b|^blocked$|^sorry/i.test(data.title.trim())) {
        throw new Error(`Playwright returned a block page (title: "${data.title}"). Falling back.`);
      }
      return { data, screenshot_path };
    });

    const result: ScrapeResult = {
      data: out.data,
      source: "playwright",
      screenshot_path: out.screenshot_path,
    };
    cacheSet(url, result);
    return result;
  } catch (firstErr) {
    if (firstErr instanceof InvalidProductUrlError) throw firstErr;
    try {
      const data = await runCheerio(url, platform);
      if (!data.title && !data.price) {
        throw new Error("Cheerio fallback returned no product data — page may be blocked or requires JS");
      }
      const result: ScrapeResult = { data, source: "cheerio", screenshot_path: null };
      cacheSet(url, result);
      return result;
    } catch {
      const msg = firstErr instanceof Error ? firstErr.message : String(firstErr);
      throw new Error(`Scrape failed after retries; cheerio fallback also failed. Last: ${msg}`);
    }
  }
}
