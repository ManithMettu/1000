/** Normalized product payload returned by all scrapers */

export type OfferType =
  | "bank_offer"
  | "cashback"
  | "no_cost_emi"
  | "discount"
  | "other";

export interface ClassifiedOffer {
  type: OfferType;
  text: string;
}

export interface ProductPayload {
  title: string | null;
  price: string | null;
  original_price: string | null;
  discount: string | null;
  images: string[];
  rating: string | null;
  reviews_count: string | null;
  availability: string | null;
  seller: string | null;
  offers: ClassifiedOffer[];
  highlights: string[];
  specifications: Record<string, string>;
  additional_details: Record<string, string>;
  platform: "amazon" | "flipkart" | "meesho";
}

export function emptyProduct(
  platform: ProductPayload["platform"]
): ProductPayload {
  return {
    title: null,
    price: null,
    original_price: null,
    discount: null,
    images: [],
    rating: null,
    reviews_count: null,
    availability: null,
    seller: null,
    offers: [],
    highlights: [],
    specifications: {},
    additional_details: {},
    platform,
  };
}
