import type { ProductPayload } from "../types";

export class InvalidProductUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidProductUrlError";
  }
}

/**
 * Ensures the URL is a product detail page (PDP), not search / category / shop grid.
 * Flipkart encodes PDPs as .../p/itm<token>; Amazon as /dp/<ASIN> or /gp/product/<ASIN>.
 */
export function assertProductDetailUrl(
  urlStr: string,
  platform: ProductPayload["platform"]
): void {
  let u: URL;
  try {
    u = new URL(urlStr);
  } catch {
    throw new InvalidProductUrlError("Invalid URL");
  }
  const path = u.pathname;
  const q = u.search;

  if (platform === "flipkart") {
    if (!/\/p\/itm/i.test(path)) {
      throw new InvalidProductUrlError(
        "Not a Flipkart product page. The path must include /p/itm (open one product from the grid and copy that link). Category and search pages only show many products, so the scraper cannot read one product’s full details."
      );
    }
    return;
  }

  if (platform === "amazon") {
    const pdp =
      /\/dp\/[a-z0-9]{10}(?:\/|$|\?|#)/i.test(path) || /\/gp\/product\/[a-z0-9]{10}/i.test(path);
    if (pdp) return;
    throw new InvalidProductUrlError(
      "Not an Amazon product page. Use a link that contains /dp/ plus a 10-character ASIN, or /gp/product/... Search and department listing URLs are not a single product page."
    );
  }

  if (platform === "meesho") {
    if (!/\/p\/[a-z0-9][a-z0-9_-]{2,}/i.test(path)) {
      throw new InvalidProductUrlError(
        "Not a Meesho product page. Open a product and use a URL whose path includes /p/ and the product id."
      );
    }
    if (/\/search\//i.test(path) || /[?&]search=/.test(q)) {
      throw new InvalidProductUrlError(
        "Meesho search URLs are not supported. Open a specific product and paste that URL."
      );
    }
    return;
  }
}

/** Detect category/search HTML when the URL check is skipped (e.g. cheerio fallback). */
export function assertHtmlLooksLikeFlipkartPdp(html: string): void {
  if (/showing\s+\d+\s*[–-]\s*\d+\s+products?\s+of/i.test(html)) {
    throw new InvalidProductUrlError(
      "Flipkart returned a listing or search page, not a single product. Use a product URL whose path contains /p/itm…"
    );
  }
}
