import type { Page } from "playwright";
import type { ProductPayload } from "../types";
import { emptyProduct } from "../types";
import { classifyOfferText, dedupeOffers, textOrNull } from "../utils/parser";

const T = { timeout: 3_000 };

export async function scrapeAmazon(page: Page): Promise<ProductPayload> {
  const p = emptyProduct("amazon");

  /* ── Title ───────────────────────────────────────────────── */
  p.title = textOrNull(
    await page
      .locator("#productTitle, h1#title, #title_feature_div h1")
      .first()
      .innerText(T)
      .catch(() => "")
  );

  /* ── Price ───────────────────────────────────────────────── */
  const priceScreen = await page
    .locator(".a-price .a-offscreen")
    .first()
    .innerText(T)
    .catch(() => "");
  const priceAlt = await page
    .locator(
      ".a-price-whole, #priceblock_dealprice, #corePrice_feature_div .a-price"
    )
    .first()
    .innerText(T)
    .catch(() => "");
  p.price = textOrNull(priceScreen || priceAlt);

  /* ── Original price / discount ───────────────────────────── */
  p.original_price = textOrNull(
    await page
      .locator(".basisPrice .a-offscreen, .a-text-price .a-offscreen")
      .first()
      .innerText(T)
      .catch(() => "")
  );
  p.discount = textOrNull(
    await page
      .locator(".savingsPercentage, #discountPercentage_feature_div")
      .first()
      .innerText(T)
      .catch(() => "")
  );

  /* ── Images ──────────────────────────────────────────────── */
  p.images = await page.evaluate(() => {
    const out: string[] = [];
    const push = (u: string | null | undefined) => {
      if (u && u.startsWith("http")) out.push(u.split(" ")[0]);
    };
    /* Main image */
    document
      .querySelectorAll(
        "#landingImage, #imgTagWrapperId img, #imageBlock img, li.item img"
      )
      .forEach((el) => push((el as HTMLImageElement).src));
    /* Thumbnail strip */
    document.querySelectorAll("#altImages img").forEach((el) => {
      /* Amazon thumbns have ._SX38_ etc – promote to full size */
      let src = (el as HTMLImageElement).src || "";
      src = src.replace(/\._\w+_\./, ".");
      push(src);
    });
    return [...new Set(out)];
  });

  /* ── Rating / reviews ────────────────────────────────────── */
  p.rating = textOrNull(
    await page.locator("#acrPopover .a-size-base, #averageCustomerReviews .a-color-base").first().innerText(T).catch(() => "")
  );
  const reviewRaw = await page
    .locator("#acrCustomerReviewText, #acrCustomerReviewLink")
    .first()
    .innerText(T)
    .catch(() => "");
  p.reviews_count = textOrNull(reviewRaw.replace(/ratings?/i, "").trim());

  /* ── Availability ────────────────────────────────────────── */
  p.availability = textOrNull(
    await page
      .locator(
        "#availability span, #deliveryBlockMessage, #mir-layout-DELIVERY_BLOCK"
      )
      .first()
      .innerText(T)
      .catch(() => "")
  );

  /* ── Seller ──────────────────────────────────────────────── */
  p.seller = textOrNull(
    await page
      .locator("#sellerProfileTriggerId, #merchant-info")
      .first()
      .innerText(T)
      .catch(() => "")
  );

  /* ── Offers ──────────────────────────────────────────────── */
  const offerSnippets = await page.evaluate(() => {
    const out: string[] = [];
    document
      .querySelectorAll(
        "#coupons-at-glance, #promoPriceBlockMessage, .offers-items, [data-csa-c-content-id*='offer']"
      )
      .forEach((b) => {
        const t = (b.textContent || "").trim();
        if (t) out.push(t);
      });
    return out;
  });
  /* Offer modal (opened by clickExpandables) */
  const modalOffers = await page.evaluate(() => {
    const selectors = [
      ".a-popover-inner",
      "#a-popover-offer-list",
      "#offer-list",
      ".offers-items",
    ];
    const out: string[] = [];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        (el.textContent || "")
          .split("\n")
          .forEach((line) => {
            const s = line.trim();
            if (s.length > 3) out.push(s);
          });
      }
    }
    return out;
  });
  p.offers = dedupeOffers(
    [...offerSnippets, ...modalOffers].map((t) => classifyOfferText(t))
  );

  /* ── Highlights / feature bullets ───────────────────────── */
  p.highlights = await page.evaluate(() => {
    const out: string[] = [];
    document
      .querySelectorAll("#feature-bullets ul li span.a-list-item")
      .forEach((el) => {
        const t = (el.textContent || "").trim();
        if (t) out.push(t);
      });
    return out;
  });

  /* ── Specifications ──────────────────────────────────────── */
  p.specifications = await page.evaluate(() => {
    const obj: Record<string, string> = {};
    document
      .querySelectorAll(
        "#productDetails_detailBullets_sections1 tr, #prodDetails tr, #detailBullets_feature_div li"
      )
      .forEach((el) => {
        /* Table row */
        const cells = el.querySelectorAll("th, td");
        if (cells.length >= 2) {
          const k = (cells[0].textContent || "").replace(/\s+/g, " ").trim();
          const v = (cells[1].textContent || "").replace(/\s+/g, " ").trim();
          if (k && v) obj[k] = v;
          return;
        }
        /* Bullet list item with <span> pairs */
        const spans = el.querySelectorAll("span");
        if (spans.length >= 2) {
          const k = (spans[0].textContent || "").replace(/[:\s]+$/, "").trim();
          const v = (spans[1].textContent || "").replace(/\u200e/g, "").trim();
          if (k && v) obj[k] = v;
        }
      });
    return obj;
  });

  /* ── Description / A+ ───────────────────────────────────── */
  const desc = await page
    .locator("#productDescription_feature_div, #productDescription, #aplus")
    .first()
    .innerText(T)
    .catch(() => "");
  if (desc) p.additional_details["description"] = desc.slice(0, 8000);

  return p;
}
