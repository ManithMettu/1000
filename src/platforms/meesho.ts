import type { Page } from "playwright";
import type { ProductPayload } from "../types";
import { emptyProduct } from "../types";
import { classifyOfferText, dedupeOffers, textOrNull } from "../utils/parser";

export async function scrapeMeesho(page: Page): Promise<ProductPayload> {
  const p = emptyProduct("meesho");

  const title = await page.locator("h1, [class*='Title']").first().innerText().catch(() => "");
  p.title = textOrNull(title);

  const price = await page.locator('[class*="Price"], span:has-text("₹")').first().innerText().catch(() => "");
  p.price = textOrNull(price);

  const orig = await page.locator("span:has-text('MRP'), del, s").first().innerText().catch(() => "");
  p.original_price = textOrNull(orig);

  const disc = await page.locator("span:has-text('% off'), span:has-text('OFF')").first().innerText().catch(() => "");
  p.discount = textOrNull(disc);

  const imgs = await page.evaluate(() => {
    const out: string[] = [];
    document.querySelectorAll("img[src*='meesho'], picture img").forEach((el) => {
      const u = (el as HTMLImageElement).src;
      if (u?.startsWith("http")) out.push(u);
    });
    return [...new Set(out)];
  });
  p.images = imgs;

  const rating = await page.locator('[class*="rating"], span:has-text("★")').first().innerText().catch(() => "");
  p.rating = textOrNull(rating);

  const reviews = await page.locator("span:has-text('Reviews'), span:has-text('ratings')").first().innerText().catch(() => "");
  p.reviews_count = textOrNull(reviews);

  const seller = await page.locator(":has-text('Sold by'), :has-text('Supplier')").first().innerText().catch(() => "");
  p.seller = textOrNull(seller);

  p.highlights = await page.evaluate(() => {
    const out: string[] = [];
    document.querySelectorAll("ul li, [class*='ighlight'] li").forEach((li, i) => {
      if (i > 45) return;
      const t = (li.textContent || "").trim();
      if (t.length > 5 && t.length < 400) out.push(t);
    });
    return [...new Set(out)].slice(0, 30);
  });

  const tables = await page.evaluate(() => {
    const spec: Record<string, string> = {};
    const extra: Record<string, string> = {};
    document.querySelectorAll("table tr").forEach((tr) => {
      const cells = tr.querySelectorAll("td, th");
      if (cells.length >= 2) {
        const k = (cells[0].textContent || "").trim();
        const v = (cells[1].textContent || "").trim();
        if (k && v) {
          if (/detail|spec|attribute/i.test(k)) extra[k] = v;
          else spec[k] = v;
        }
      }
    });
    return { spec, extra };
  });
  p.specifications = tables.spec;
  p.additional_details = tables.extra;

  const offerStrings = await page.evaluate(() => {
    const out: string[] = [];
    document
      .querySelectorAll("[class*='offer' i], [class*='Offer'], section, article")
      .forEach((el) => {
        const t = (el.textContent || "").trim();
        if (t.length < 10 || t.length > 1200) return;
        if (!/offer|cashback|emi|bank|₹|% off/i.test(t)) return;
        t.split("\n").forEach((line) => {
          const s = line.trim();
          if (s.length > 6 && s.length < 400) out.push(s);
        });
      });
    return out.slice(0, 80);
  });
  p.offers = dedupeOffers(offerStrings.map((t) => classifyOfferText(t)));

  const avail = await page.locator(":has-text('stock'), :has-text('delivery')").first().innerText().catch(() => "");
  p.availability = textOrNull(avail);

  return p;
}
