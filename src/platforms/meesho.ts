import type { Page } from "playwright";
import type { ProductPayload } from "../types";
import { emptyProduct } from "../types";
import { classifyOfferText, dedupeOffers, textOrNull } from "../utils/parser";

export async function scrapeMeesho(page: Page): Promise<ProductPayload> {
  const p = emptyProduct("meesho");

  const extracted = await page.evaluate(() => {
    const text = (el: Element | null) =>
      (el?.textContent || "").replace(/\s+/g, " ").trim();

    /* ── Title ────────────────────────────────────────────── */
    const titleEl =
      document.querySelector("h1") ||
      document.querySelector('[class*="ProductTitle" i]') ||
      document.querySelector('[class*="Title" i]');
    const title = text(titleEl);

    /* ── Prices ───────────────────────────────────────────── */
    let price = "";
    let originalPrice = "";
    let discount = "";
    document.querySelectorAll("h4, h5, h3, span, p, div").forEach((el) => {
      const t = text(el);
      if (!price && /^₹\s*[\d,]+$/.test(t) && !(el as HTMLElement).querySelector("*"))
        price = t;
      if (!discount && /\d+%\s*off/i.test(t) && t.length < 25) discount = t;
    });
    /* MRP / strikethrough */
    document.querySelectorAll("del, s, [class*='MRP' i], [class*='mrp']").forEach((el) => {
      if (!originalPrice) {
        const t = text(el).replace(/m\.?r\.?p\.?\s*/i, "").trim();
        if (/^₹?\s*[\d,]+$/.test(t)) originalPrice = `₹${t.replace(/[₹\s]/g, "")}`;
      }
    });

    /* ── Images ───────────────────────────────────────────── */
    const images: string[] = [];
    document.querySelectorAll("img[src*='meesho'], picture img, [class*='product' i] img").forEach((el) => {
      const u = (el as HTMLImageElement).src || "";
      if (u.startsWith("http") && !u.includes("logo") && !u.includes("icon") && !images.includes(u))
        images.push(u);
    });

    /* ── Rating / reviews ─────────────────────────────────── */
    let rating = "";
    let reviewsCount = "";
    document.querySelectorAll("p, span, div").forEach((el) => {
      const t = text(el);
      if (!rating && /^\d\.\d$/.test(t)) rating = t;
      if (!reviewsCount && /\d[\d,]*\s*(ratings?|reviews?)/i.test(t) && t.length < 50)
        reviewsCount = t;
    });

    /* ── Seller ───────────────────────────────────────────── */
    let seller: string | null = null;
    document.querySelectorAll("p, span, div").forEach((el) => {
      if (!seller) {
        const t = text(el);
        if (/sold\s+by|supplier|ship.*by/i.test(t) && t.length < 120) seller = t;
      }
    });

    /* ── Highlights ───────────────────────────────────────── */
    const highlights: string[] = [];
    document.querySelectorAll("ul li").forEach((li, i) => {
      if (i > 45) return;
      const t = text(li);
      if (t.length > 5 && t.length < 400) highlights.push(t);
    });

    /* ── Specs ────────────────────────────────────────────── */
    const specs: Record<string, string> = {};
    document.querySelectorAll("table tr").forEach((tr) => {
      const cells = tr.querySelectorAll("td, th");
      if (cells.length >= 2) {
        const k = text(cells[0]);
        const v = text(cells[1]);
        if (k && v) specs[k] = v;
      }
    });

    /* ── Offers ───────────────────────────────────────────── */
    const offerLines: string[] = [];
    document
      .querySelectorAll("[class*='offer' i], [class*='Offer'], section, article")
      .forEach((el) => {
        const t = text(el);
        if (t.length < 10 || t.length > 1200) return;
        if (!/offer|cashback|emi|bank|₹|% off/i.test(t)) return;
        t.split("\n").forEach((line) => {
          const s = line.trim();
          if (s.length > 6 && s.length < 400) offerLines.push(s);
        });
      });

    /* ── Availability ─────────────────────────────────────── */
    let avail: string | null = null;
    document.querySelectorAll("p, span, div").forEach((el) => {
      if (!avail) {
        const t = text(el);
        if (/in\s+stock|out\s+of\s+stock|delivery|ships?\s+in/i.test(t) && t.length < 100)
          avail = t;
      }
    });

    return {
      title,
      price,
      originalPrice,
      discount,
      images,
      rating,
      reviewsCount,
      seller,
      highlights: [...new Set(highlights)].slice(0, 30),
      specs,
      offerLines: offerLines.slice(0, 80),
      avail,
    };
  });

  p.title = textOrNull(extracted.title);
  p.price = textOrNull(extracted.price);
  p.original_price = textOrNull(extracted.originalPrice);
  p.discount = textOrNull(extracted.discount);
  p.images = extracted.images;
  p.rating = textOrNull(extracted.rating);
  p.reviews_count = textOrNull(extracted.reviewsCount);
  p.seller = extracted.seller;
  p.highlights = extracted.highlights;
  p.specifications = extracted.specs;
  p.additional_details = {};
  p.offers = dedupeOffers(extracted.offerLines.map((t) => classifyOfferText(t)));
  p.availability = extracted.avail;

  return p;
}
