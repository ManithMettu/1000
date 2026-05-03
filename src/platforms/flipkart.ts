import type { Page } from "playwright";
import type { ProductPayload } from "../types";
import { emptyProduct } from "../types";
import { classifyOfferText, dedupeOffers, textOrNull } from "../utils/parser";

/** Dismiss overlay/login popup quickly. */
async function closePopup(page: Page): Promise<void> {
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(100);
}

interface FlipkartLD {
  name?: string;
  description?: string;
  image?: string[];
  color?: string;
  brand?: { name?: string };
  aggregateRating?: { ratingValue?: number; ratingCount?: number; reviewCount?: number };
  offers?: { price?: number; priceCurrency?: string; availability?: string };
}

export async function scrapeFlipkart(page: Page): Promise<ProductPayload> {
  const p = emptyProduct("flipkart");
  await closePopup(page);

  /* ── 1. JSON-LD structured data (most reliable, immune to DOM changes) ── */
  const ld: FlipkartLD | null = await page.evaluate(() => {
    const scripts = Array.from(
      document.querySelectorAll('script[type="application/ld+json"]')
    );
    for (const s of scripts) {
      try {
        const data = JSON.parse(s.textContent || "");
        const items = Array.isArray(data) ? data : [data];
        for (const item of items) {
          if (item["@type"] === "Product" && item.name) return item as FlipkartLD;
        }
      } catch {
        /* ignore */
      }
    }
    return null;
  });

  if (ld) {
    p.title = textOrNull(ld.name || "");
    if (ld.offers?.price != null) p.price = `₹${ld.offers.price}`;
    if (ld.aggregateRating?.ratingValue != null)
      p.rating = String(ld.aggregateRating.ratingValue);
    if (ld.aggregateRating?.ratingCount != null)
      p.reviews_count = `${ld.aggregateRating.ratingCount.toLocaleString("en-IN")} ratings`;
    if (Array.isArray(ld.image)) p.images = ld.image.filter(Boolean);
    if (ld.offers?.availability) {
      p.availability = ld.offers.availability.includes("OutOfStock")
        ? "Out of Stock"
        : "In Stock";
    }
    /* Extract MRP from description: "only for Rs.NNNN.0 from Flipkart" */
    const mrpMatch = (ld.description || "").match(/Rs\.?\s*([\d,]+(?:\.\d+)?)/i);
    if (mrpMatch) {
      const raw = mrpMatch[1].replace(/\.0+$/, "").replace(/\.(\d)$/, "");
      p.original_price = `₹${raw}`;
    }
    /* Calculate discount from price + MRP */
    if (ld.offers?.price != null && p.original_price) {
      const curr = ld.offers.price;
      const mrp = parseFloat(p.original_price.replace(/[₹,]/g, ""));
      if (mrp > curr) p.discount = `${Math.round((1 - curr / mrp) * 100)}% off`;
    }
  }

  /* ── 2. DOM extraction for fields not in JSON-LD ─────────────────────── */
  const dom = await page.evaluate(() => {
    const text = (el: Element | null) =>
      (el?.textContent || "").replace(/\s+/g, " ").trim();

    /* Remove the discount scan from DOM — we calculate it from JSON-LD fields above */

    /* Seller ("Sold by X") */
    let seller: string | null = null;
    const bodyText = document.body.textContent || "";
    const sm = bodyText.match(/[Ss]old\s+by\s*[:\-]?\s*([^\n,•]{2,60})/);
    if (sm) seller = sm[1].trim();

    /* Availability (more specific from DOM, overrides LD) */
    let avail = "";
    document.querySelectorAll("div, p, span").forEach((el) => {
      if (!avail && !(el as HTMLElement).querySelector("*")) {
        const t = text(el);
        if (/out\s+of\s+stock|in\s+stock|delivery|ships?\s+in/i.test(t) && t.length < 120)
          avail = t;
      }
    });

    /* Highlights — find "Highlights" heading → child li items */
    const highlights: string[] = [];
    document.querySelectorAll("p, span, div, h2, h3, h4").forEach((heading) => {
      if (text(heading).trim().toLowerCase() === "highlights") {
        const parent = heading.closest("section, div[class], article");
        if (parent) {
          parent.querySelectorAll("li").forEach((li) => {
            const t = text(li);
            if (t.length > 5 && t.length < 400) highlights.push(t);
          });
        }
      }
    });

    /* Specs — table rows or "Specifications" heading → row pairs */
    const specs: Record<string, string> = {};
    document.querySelectorAll("table tr").forEach((tr) => {
      const tds = tr.querySelectorAll("td, th");
      if (tds.length >= 2) {
        const k = text(tds[0]); const v = text(tds[1]);
        if (k && v && k.length < 80) specs[k] = v;
      }
    });
    document.querySelectorAll("p, span, div, h2, h3, h4").forEach((heading) => {
      if (/^specifications?$/i.test(text(heading).trim())) {
        const parent = heading.closest("section, div[class], article");
        if (!parent) return;
        parent.querySelectorAll("[class*='row' i], div > div").forEach((row) => {
          const divs = row.querySelectorAll("div, td, span");
          if (divs.length >= 2) {
            const k = text(divs[0]); const v = text(divs[1]);
            if (k && v && k.length < 80 && v.length < 200 && k !== v) specs[k] = v;
          }
        });
      }
    });

    /* Reviews count (more detailed from DOM) */
    let reviewsCount = "";
    document.querySelectorAll("span, a, div, p").forEach((el) => {
      if (!reviewsCount) {
        const t = text(el);
        const m = t.match(/([\d,]+)\s*(Ratings?|Reviews?)(\s*[&+]\s*\d[\d,]*\s*\w+)?/i);
        if (m && t.length < 120) reviewsCount = m[0].trim();
      }
    });

    /* Bank/card offers (text-content scan for genuine offer lines) */
    const offerLines: string[] = [];
    const genuineOfferRe =
      /bank\s*offer|cashback|emi|axis|hdfc|icici|sbi|kotak|citi|rbl|yes\s*bank|amex|indusind|no\s*cost|extra\s*₹|instant\s*discount/i;
    const adProductRe =
      /^[A-Z]{4,}(\s[A-Za-z0-9]+){1,}\s*(Running|Sports|Shoes|Sneakers|Footwear|For\s*Men|For\s*Women)/;
    /* Also skip lines starting with unknown all-caps brand names */
    const capsStartRe = /^[A-Z]{5,}\s+[A-Z][a-z]/;
    document.querySelectorAll("div, span, li, p").forEach((el) => {
      if ((el as HTMLElement).querySelector("div, ul")) return;
      const t = text(el);
      if (t.length < 6 || t.length > 250) return;
      if (!genuineOfferRe.test(t)) return;
      if (adProductRe.test(t)) return;
      if (capsStartRe.test(t)) return;
      offerLines.push(t);
    });

    return {
      seller,
      avail,
      highlights: highlights.slice(0, 30),
      specs,
      reviewsCount,
      offerLines: offerLines.slice(0, 60),
    };
  });

  if (!p.price) {
    /* Fallback: scan body for ₹NNN if JSON-LD had no price */
    const fb = await page.evaluate(() => {
      const m = (document.body.textContent || "").match(/₹\s*([\d,]+)/);
      return m ? `₹${m[1]}` : "";
    });
    if (fb) p.price = fb;
  }

  if (!p.discount) p.discount = null;
  if (dom.seller) p.seller = dom.seller;
  if (dom.avail) p.availability = dom.avail;
  p.highlights = dom.highlights;
  p.specifications = dom.specs;
  if (dom.reviewsCount) p.reviews_count = dom.reviewsCount;
  p.offers = dedupeOffers(dom.offerLines.map((t) => classifyOfferText(t)));

  return p;
}
