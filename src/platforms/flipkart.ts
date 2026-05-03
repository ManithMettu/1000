import type { Page } from "playwright";
import type { ProductPayload } from "../types";
import { emptyProduct } from "../types";
import { classifyOfferText, dedupeOffers, textOrNull } from "../utils/parser";

async function closeLoginPopup(page: Page): Promise<void> {
  const candidates = [
    'button:has-text("✕")',
    '[class*="close"]',
    'button[aria-label="Close"]',
    'div:has-text("Login") >> .. >> button',
  ];
  for (const sel of candidates) {
    const b = page.locator(sel).first();
    if (await b.isVisible().catch(() => false)) {
      await b.click({ timeout: 2000 }).catch(() => {});
      break;
    }
  }
  await page.keyboard.press("Escape").catch(() => {});
}

async function collectOfferTexts(page: Page): Promise<string[]> {
  const texts: string[] = [];
  const panels = page.locator('[class*="offer"], [class*="OFFER"], ._16FRpwa, .yoqnHx');
  const n = await panels.count().catch(() => 0);
  for (let i = 0; i < Math.min(n, 40); i++) {
    const t = await panels.nth(i).innerText().catch(() => "");
    t.split("\n").forEach((line) => {
      const s = line.trim();
      if (s.length > 4) texts.push(s);
    });
  }
  return texts;
}

export async function scrapeFlipkart(page: Page): Promise<ProductPayload> {
  const p = emptyProduct("flipkart");
  await closeLoginPopup(page);

  const title = await page.locator("span.B_NuCI, h1 span").first().innerText().catch(() => "");
  p.title = textOrNull(title);

  const price = await page.locator("div._30jeq3, div._25b18c").first().innerText().catch(() => "");
  p.price = textOrNull(price);

  const orig = await page.locator("div._3I9_wc, ._3Ay6Sb + span").first().innerText().catch(() => "");
  p.original_price = textOrNull(orig);

  const disc = await page.locator("div._3Ay6Sb span").first().innerText().catch(() => "");
  p.discount = textOrNull(disc);

  const imgs = await page.evaluate(() => {
    const out: string[] = [];
    document.querySelectorAll('img[src*="rukmini"], ._396cs4, li._3qtDIv img').forEach((el) => {
      const u = (el as HTMLImageElement).src;
      if (u && u.startsWith("http")) out.push(u);
    });
    return [...new Set(out)];
  });
  p.images = imgs;

  const rating = await page.locator("div._3LWZlK").first().innerText().catch(() => "");
  p.rating = textOrNull(rating);

  const reviews = await page.locator("span._2_R_DZ span").first().innerText().catch(() => "");
  p.reviews_count = textOrNull(reviews);

  const seller = await page.locator("#sellerName, ._14SellerName, span:has-text('Sold by')").first().innerText().catch(() => "");
  p.seller = textOrNull(seller);

  const highlights = await page
    .locator("div._2aQIzr li, ._1UhVsV._3hqFK7 li")
    .allInnerTexts()
    .catch(() => [] as string[]);
  p.highlights = highlights.map((x) => x.trim()).filter(Boolean);

  const specRows = await page.evaluate(() => {
    const obj: Record<string, string> = {};
    document.querySelectorAll("table tr._1UhVsV, ._14CfVK tr, table._14cfVK tr").forEach((tr) => {
      const tds = tr.querySelectorAll("td, th");
      if (tds.length >= 2) {
        const k = (tds[0].textContent || "").trim();
        const v = (tds[1].textContent || "").trim();
        if (k && v) obj[k] = v;
      }
    });
    return obj;
  });
  p.specifications = specRows;

  const moreDesc = await page.locator("div._1mXcCf, #productDescription").first().innerText().catch(() => "");
  if (moreDesc) p.additional_details["description"] = moreDesc.slice(0, 8000);

  const offerStrings = await collectOfferTexts(page);
  p.offers = dedupeOffers(offerStrings.map((t) => classifyOfferText(t)));

  const avail = await page.locator("div._16FRpwa:has-text('Delivery'), ._16FRpwa").first().innerText().catch(() => "");
  p.availability = textOrNull(avail);

  return p;
}
