# """ #!/usr/bin/env python3
# """
# ╔══════════════════════════════════════════════════════════════════════════════╗
# ║          PRICESPY — E-Commerce Scraping Microservice v1.0                  ║
# ║          Supports: Amazon · Flipkart · Meesho                               ║
# ║          Features: IP Rotation · LLM Extraction · Offer Mining              ║
# ╚══════════════════════════════════════════════════════════════════════════════╝

# Single-file microservice. Run modes:
#   1. CLI scraper:  python scraper_service.py scrape <url>
#   2. REST API:     python scraper_service.py serve [--port 8000]
#   3. Batch:        python scraper_service.py batch <urls.txt>
#   4. Demo:         python scraper_service.py demo

# Dependencies (pip install):
#   requests, fake-useragent, anthropic, fastapi, uvicorn, beautifulsoup4,
#   lxml, rich, stem (optional, for Tor rotation)
# """

# # ─────────────────────────────────────────────────────────────────────────────
# # IMPORTS
# # ─────────────────────────────────────────────────────────────────────────────
# import os, sys, re, json, time, random, hashlib, logging, argparse, threading
# from datetime import datetime, timezone
# from typing import Optional, Any
# from dataclasses import dataclass, field, asdict
# from urllib.parse import urlparse, urlencode
# from collections import defaultdict

# # Third-party (graceful degradation if missing)
# try:
#     import requests
#     from requests.adapters import HTTPAdapter
#     from urllib3.util.retry import Retry
#     HAS_REQUESTS = True
# except ImportError:
#     HAS_REQUESTS = False
#     print("[WARN] requests not installed. Run: pip install requests")

# try:
#     from bs4 import BeautifulSoup
#     HAS_BS4 = True
# except ImportError:
#     HAS_BS4 = False

# try:
#     from fake_useragent import UserAgent
#     _ua = UserAgent()
#     def random_ua(): return _ua.random
# except ImportError:
#     _FALLBACK_UAS = [
#         "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
#         "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
#         "Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0",
#         "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 Edg/123.0.0.0",
#     ]
#     def random_ua(): return random.choice(_FALLBACK_UAS)

# try:
#     import anthropic as _anthropic_sdk
#     HAS_ANTHROPIC = True
# except ImportError:
#     HAS_ANTHROPIC = False

# try:
#     from rich.console import Console
#     from rich.table import Table
#     from rich.panel import Panel
#     from rich.text import Text
#     from rich.progress import Progress, SpinnerColumn, TextColumn, BarColumn
#     from rich import box
#     from rich.syntax import Syntax
#     from rich.columns import Columns
#     from rich.markup import escape
#     HAS_RICH = True
#     console = Console()
# except ImportError:
#     HAS_RICH = False
#     class Console:
#         def print(self, *args, **kw): print(*args)
#         def log(self, *args, **kw): print(*args)
#     console = Console()

# try:
#     from fastapi import FastAPI, HTTPException, BackgroundTasks
#     from fastapi.responses import JSONResponse
#     from pydantic import BaseModel as PydanticBase
#     import uvicorn
#     HAS_FASTAPI = True
# except ImportError:
#     HAS_FASTAPI = False

# # ─────────────────────────────────────────────────────────────────────────────
# # CONFIGURATION
# # ─────────────────────────────────────────────────────────────────────────────
# class Config:
#     # Anthropic
#     ANTHROPIC_API_KEY: str = os.getenv("ANTHROPIC_API_KEY", "")
#     CLAUDE_MODEL: str = "claude-sonnet-4-20250514"

#     # Rotation pools
#     # Free public proxies — replace with premium for production
#     PROXY_LIST: list[str] = [
#         # Format: "http://user:pass@host:port"
#         # Add your proxies here. Left empty → direct connection.
#     ]

#     # Free residential-ish proxy APIs (ScraperAPI, BrightData, etc.)
#     SCRAPER_API_KEY: str = os.getenv("SCRAPER_API_KEY", "")
#     SCRAPER_API_URL: str = "http://api.scraperapi.com"

#     # Timing (seconds)
#     MIN_DELAY: float = 1.5
#     MAX_DELAY: float = 4.0
#     REQUEST_TIMEOUT: int = 30
#     MAX_RETRIES: int = 3

#     # Cache
#     ENABLE_CACHE: bool = True
#     CACHE_TTL_SECONDS: int = 300   # 5 minutes

#     # Rate limiting (per domain)
#     RATE_LIMIT_RPS: float = 0.5    # 1 request per 2 seconds per domain

#     # API server
#     API_HOST: str = "0.0.0.0"
#     API_PORT: int = 8000

# # ─────────────────────────────────────────────────────────────────────────────
# # DATA MODELS
# # ─────────────────────────────────────────────────────────────────────────────
# @dataclass
# class Offer:
#     title: str
#     discount_percent: Optional[str] = None
#     bank_offer: Optional[str] = None
#     emi_info: Optional[str] = None
#     coupon_code: Optional[str] = None
#     cashback: Optional[str] = None
#     validity: Optional[str] = None
#     raw_text: Optional[str] = None

# @dataclass
# class Review:
#     rating: Optional[float] = None
#     count: Optional[str] = None
#     rating_breakdown: dict = field(default_factory=dict)   # {"5★": "60%", ...}
#     top_review_snippet: Optional[str] = None

# @dataclass
# class ProductImage:
#     url: str
#     alt: Optional[str] = None
#     is_primary: bool = False

# @dataclass
# class ProductData:
#     # Identity
#     url: str
#     platform: str                    # amazon | flipkart | meesho | unknown
#     scraped_at: str = ""
#     scrape_duration_ms: int = 0

#     # Core info
#     name: Optional[str] = None
#     brand: Optional[str] = None
#     model_number: Optional[str] = None
#     asin_or_id: Optional[str] = None

#     # Pricing
#     current_price: Optional[str] = None
#     original_price: Optional[str] = None
#     discount_percent: Optional[str] = None
#     price_per_unit: Optional[str] = None
#     currency: str = "INR"

#     # Availability
#     in_stock: Optional[bool] = None
#     stock_message: Optional[str] = None
#     seller_name: Optional[str] = None
#     seller_rating: Optional[str] = None
#     fulfilled_by: Optional[str] = None    # e.g. "Fulfilled by Amazon"

#     # Content
#     description: Optional[str] = None
#     highlights: list[str] = field(default_factory=list)
#     specifications: dict = field(default_factory=dict)
#     categories: list[str] = field(default_factory=list)

#     # Media
#     images: list[ProductImage] = field(default_factory=list)

#     # Social proof
#     review: Optional[Review] = None

#     # 💰 Offers & Deals (the star of the show)
#     offers: list[Offer] = field(default_factory=list)
#     bank_offers: list[str] = field(default_factory=list)
#     no_cost_emi: Optional[str] = None
#     exchange_offer: Optional[str] = None
#     combo_deals: list[str] = field(default_factory=list)

#     # Delivery
#     delivery_date: Optional[str] = None
#     delivery_charges: Optional[str] = None
#     delivery_location: Optional[str] = None

#     # Meta
#     extraction_method: str = "html"   # html | llm | hybrid
#     confidence_score: float = 0.0     # 0–1, how confident we are in the data
#     raw_html_length: int = 0
#     errors: list[str] = field(default_factory=list)
#     warnings: list[str] = field(default_factory=list)

#     def to_dict(self) -> dict:
#         d = asdict(self)
#         return d

#     def to_json(self, indent: int = 2) -> str:
#         return json.dumps(self.to_dict(), ensure_ascii=False, indent=indent)

# # ─────────────────────────────────────────────────────────────────────────────
# # IP ROTATION ENGINE
# # ─────────────────────────────────────────────────────────────────────────────
# class IPRotationEngine:
#     """
#     Multi-strategy IP rotation:
#       1. Direct (no proxy)         — development/testing
#       2. Proxy pool rotation       — list of http/socks proxies
#       3. ScraperAPI                — managed proxy with JS rendering
#       4. Tor SOCKS5 rotation       — free but slow (stem required)
#     Strategy is auto-selected based on config and availability.
#     """

#     def __init__(self):
#         self._proxy_pool = list(Config.PROXY_LIST)
#         self._pool_index = 0
#         self._lock = threading.Lock()
#         self._failure_counts: dict[str, int] = defaultdict(int)
#         self._strategy = self._detect_strategy()
#         logging.info(f"[IPRotation] Strategy: {self._strategy}")

#     def _detect_strategy(self) -> str:
#         if Config.SCRAPER_API_KEY:
#             return "scraperapi"
#         if self._proxy_pool:
#             return "proxy_pool"
#         return "direct"

#     def get_proxy(self) -> Optional[dict]:
#         if self._strategy == "scraperapi":
#             return None   # handled separately in URL rewriting
#         if self._strategy == "proxy_pool" and self._proxy_pool:
#             with self._lock:
#                 proxy = self._proxy_pool[self._pool_index % len(self._proxy_pool)]
#                 self._pool_index += 1
#             return {"http": proxy, "https": proxy}
#         return None

#     def mark_proxy_failed(self, proxy: Optional[dict]):
#         """Track failures; in production, remove after threshold."""
#         if proxy:
#             url = proxy.get("http", "")
#             self._failure_counts[url] += 1
#             if self._failure_counts[url] > 3 and url in self._proxy_pool:
#                 self._proxy_pool.remove(url)
#                 logging.warning(f"[IPRotation] Removed failing proxy: {url}")

#     def wrap_url_scraperapi(self, url: str, render_js: bool = False) -> str:
#         """Rewrite URL to route through ScraperAPI."""
#         params = {
#             "api_key": Config.SCRAPER_API_KEY,
#             "url": url,
#             "country_code": "in",
#         }
#         if render_js:
#             params["render"] = "true"
#         return f"{Config.SCRAPER_API_URL}?{urlencode(params)}"

#     def get_headers(self, platform: str) -> dict:
#         """Return convincing browser-like headers per platform."""
#         ua = random_ua()
#         base = {
#             "User-Agent": ua,
#             "Accept-Language": "en-IN,en-GB;q=0.9,en-US;q=0.8,en;q=0.7",
#             "Accept-Encoding": "gzip, deflate, br",
#             "Connection": "keep-alive",
#             "DNT": "1",
#             "Upgrade-Insecure-Requests": "1",
#         }
#         if platform == "amazon":
#             base.update({
#                 "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
#                 "Referer": "https://www.amazon.in/",
#                 "sec-ch-ua": '"Chromium";v="124", "Google Chrome";v="124"',
#                 "sec-ch-ua-mobile": "?0",
#                 "sec-ch-ua-platform": '"Windows"',
#                 "Sec-Fetch-Dest": "document",
#                 "Sec-Fetch-Mode": "navigate",
#                 "Sec-Fetch-Site": "same-origin",
#             })
#         elif platform == "flipkart":
#             base.update({
#                 "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
#                 "Referer": "https://www.flipkart.com/",
#                 "x-user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
#             })
#         elif platform == "meesho":
#             base.update({
#                 "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
#                 "Referer": "https://www.meesho.com/",
#             })
#         return base

# # ─────────────────────────────────────────────────────────────────────────────
# # RATE LIMITER
# # ─────────────────────────────────────────────────────────────────────────────
# class RateLimiter:
#     """Token-bucket rate limiter per domain."""

#     def __init__(self):
#         self._last_request: dict[str, float] = {}
#         self._lock = threading.Lock()

#     def wait(self, domain: str):
#         with self._lock:
#             now = time.monotonic()
#             min_gap = 1.0 / Config.RATE_LIMIT_RPS
#             last = self._last_request.get(domain, 0)
#             wait_time = max(0, min_gap - (now - last))
#             if wait_time > 0:
#                 time.sleep(wait_time)
#             # Add random jitter to look human
#             jitter = random.uniform(Config.MIN_DELAY, Config.MAX_DELAY)
#             time.sleep(jitter)
#             self._last_request[domain] = time.monotonic()

# # ─────────────────────────────────────────────────────────────────────────────
# # CACHE
# # ─────────────────────────────────────────────────────────────────────────────
# class InMemoryCache:
#     """Simple TTL-based cache. Replace with Redis for production."""

#     def __init__(self):
#         self._store: dict[str, tuple[Any, float]] = {}
#         self._lock = threading.Lock()

#     def _key(self, url: str) -> str:
#         return hashlib.md5(url.encode()).hexdigest()

#     def get(self, url: str) -> Optional[ProductData]:
#         if not Config.ENABLE_CACHE:
#             return None
#         key = self._key(url)
#         with self._lock:
#             entry = self._store.get(key)
#             if entry and (time.time() - entry[1]) < Config.CACHE_TTL_SECONDS:
#                 return entry[0]
#         return None

#     def set(self, url: str, data: ProductData):
#         if not Config.ENABLE_CACHE:
#             return
#         with self._lock:
#             self._store[self._key(url)] = (data, time.time())

#     def stats(self) -> dict:
#         return {"entries": len(self._store)}

# # ─────────────────────────────────────────────────────────────────────────────
# # HTTP FETCHER
# # ─────────────────────────────────────────────────────────────────────────────
# class Fetcher:
#     """Resilient HTTP fetcher with retry + rotation."""

#     def __init__(self, rotator: IPRotationEngine, rate_limiter: RateLimiter):
#         self.rotator = rotator
#         self.rate_limiter = rate_limiter

#     def _make_session(self) -> "requests.Session":
#         session = requests.Session()
#         retry = Retry(
#             total=Config.MAX_RETRIES,
#             backoff_factor=1.5,
#             status_forcelist=[429, 500, 502, 503, 504],
#             allowed_methods=["GET"],
#         )
#         adapter = HTTPAdapter(max_retries=retry)
#         session.mount("http://", adapter)
#         session.mount("https://", adapter)
#         return session

#     def fetch(self, url: str, platform: str) -> tuple[str, int]:
#         """Returns (html_text, status_code). Raises on fatal failure."""
#         domain = urlparse(url).netloc
#         self.rate_limiter.wait(domain)

#         headers = self.rotator.get_headers(platform)
#         proxy = self.rotator.get_proxy()

#         # ScraperAPI URL rewriting
#         fetch_url = url
#         if self.rotator._strategy == "scraperapi":
#             render_js = platform in ("meesho", "flipkart")
#             fetch_url = self.rotator.wrap_url_scraperapi(url, render_js)
#             proxy = None   # ScraperAPI handles routing

#         session = self._make_session()

#         for attempt in range(1, Config.MAX_RETRIES + 1):
#             try:
#                 resp = session.get(
#                     fetch_url,
#                     headers=headers,
#                     proxies=proxy,
#                     timeout=Config.REQUEST_TIMEOUT,
#                     allow_redirects=True,
#                 )
#                 if resp.status_code == 200:
#                     return resp.text, 200
#                 elif resp.status_code == 503:
#                     logging.warning(f"[Fetcher] 503 on attempt {attempt}. Rotating...")
#                     self.rotator.mark_proxy_failed(proxy)
#                     proxy = self.rotator.get_proxy()
#                     headers = self.rotator.get_headers(platform)
#                     time.sleep(2 ** attempt)
#                 else:
#                     return resp.text, resp.status_code
#             except Exception as e:
#                 logging.warning(f"[Fetcher] Attempt {attempt} failed: {e}")
#                 self.rotator.mark_proxy_failed(proxy)
#                 proxy = self.rotator.get_proxy()
#                 time.sleep(2 ** attempt)

#         raise RuntimeError(f"All {Config.MAX_RETRIES} fetch attempts failed for {url}")

# # ─────────────────────────────────────────────────────────────────────────────
# # PLATFORM DETECTION
# # ─────────────────────────────────────────────────────────────────────────────
# def detect_platform(url: str) -> str:
#     host = urlparse(url).netloc.lower()
#     if "amazon" in host:
#         return "amazon"
#     if "flipkart" in host:
#         return "flipkart"
#     if "meesho" in host:
#         return "meesho"
#     return "unknown"

# def extract_amazon_asin(url: str) -> Optional[str]:
#     match = re.search(r"/dp/([A-Z0-9]{10})", url)
#     return match.group(1) if match else None

# # ─────────────────────────────────────────────────────────────────────────────
# # AMAZON PARSER
# # ─────────────────────────────────────────────────────────────────────────────
# class AmazonParser:
#     def parse(self, html: str, url: str) -> ProductData:
#         soup = BeautifulSoup(html, "lxml")
#         data = ProductData(url=url, platform="amazon")

#         data.asin_or_id = extract_amazon_asin(url)

#         # Name
#         title_tag = soup.find("span", id="productTitle")
#         data.name = title_tag.get_text(strip=True) if title_tag else None

#         # Brand
#         brand_row = soup.find("tr", class_="po-brand") or soup.find("a", id="bylineInfo")
#         if brand_row:
#             td = brand_row.find("td", class_="po-break-word")
#             data.brand = td.get_text(strip=True) if td else brand_row.get_text(strip=True)

#         # Prices
#         price_whole = soup.find("span", class_="a-price-whole")
#         price_frac  = soup.find("span", class_="a-price-fraction")
#         if price_whole:
#             whole = price_whole.get_text(strip=True).replace(",", "").replace(".", "")
#             frac  = price_frac.get_text(strip=True) if price_frac else "00"
#             data.current_price = f"₹{whole}.{frac}"

#         orig = soup.find("span", class_="a-price a-text-price")
#         if orig:
#             o = orig.find("span", class_="a-offscreen")
#             data.original_price = o.get_text(strip=True) if o else None

#         saving = soup.find("span", id="savingsPercentage") or soup.find("td", id="dealprice_savings")
#         if saving:
#             data.discount_percent = saving.get_text(strip=True)

#         # Stock
#         avail = soup.find("div", id="availability")
#         if avail:
#             text = avail.get_text(strip=True)
#             data.stock_message = text
#             data.in_stock = "in stock" in text.lower()

#         # Seller
#         seller = soup.find("a", id="sellerProfileTriggerId")
#         data.seller_name = seller.get_text(strip=True) if seller else None

#         fulfilled = soup.find("span", class_="mbcMerchantName")
#         if not fulfilled:
#             if soup.find(string=re.compile(r"Fulfilled by Amazon", re.I)):
#                 data.fulfilled_by = "Amazon"

#         # Description / Highlights
#         feature_div = soup.find("div", id="feature-bullets")
#         if feature_div:
#             items = feature_div.find_all("span", class_="a-list-item")
#             data.highlights = [i.get_text(strip=True) for i in items if i.get_text(strip=True)]

#         desc_div = soup.find("div", id="productDescription") or soup.find("div", id="aplus")
#         if desc_div:
#             data.description = desc_div.get_text(" ", strip=True)[:1000]

#         # Specifications
#         tables = soup.find_all("table", id=re.compile(r"productDetails|technicalSpecifications"))
#         for tbl in tables:
#             for row in tbl.find_all("tr"):
#                 th = row.find("th")
#                 td = row.find("td")
#                 if th and td:
#                     data.specifications[th.get_text(strip=True)] = td.get_text(strip=True)

#         # Images
#         # Amazon stores images in a JSON blob
#         img_json = re.search(r"\"colorImages\":\s*\{[^}]+\"initial\":\s*(\[.*?\])\}", html, re.S)
#         if img_json:
#             try:
#                 imgs = json.loads(img_json.group(1))
#                 for idx, img in enumerate(imgs[:8]):
#                     hi = img.get("hiRes") or img.get("large") or img.get("medium", "")
#                     if hi:
#                         data.images.append(ProductImage(url=hi, is_primary=(idx == 0)))
#             except Exception:
#                 pass

#         # Fallback image
#         if not data.images:
#             main_img = soup.find("img", id="landingImage") or soup.find("img", id="imgBlkFront")
#             if main_img:
#                 src = main_img.get("data-old-hires") or main_img.get("src", "")
#                 if src:
#                     data.images.append(ProductImage(url=src, is_primary=True))

#         # Reviews
#         rating_el = soup.find("span", id="acrPopupLink") or soup.find("span", attrs={"data-hook": "rating-out-of-text"})
#         review_count_el = soup.find("span", id="acrCustomerReviewText") or soup.find("span", attrs={"data-hook": "total-review-count"})
#         review = Review()
#         if rating_el:
#             m = re.search(r"([\d.]+)", rating_el.get_text())
#             review.rating = float(m.group(1)) if m else None
#         if review_count_el:
#             review.count = review_count_el.get_text(strip=True)
#         # Histogram
#         for row in soup.select("table#histogramTable tr"):
#             star = row.find("td", class_="aok-nowrap")
#             pct  = row.find("td", class_="a-text-right")
#             if star and pct:
#                 review.rating_breakdown[star.get_text(strip=True)] = pct.get_text(strip=True)
#         data.review = review

#         # Offers — Amazon groups them in #itembox-InstantOrderUpdate and promotions
#         offers = []

#         # Bank / Credit card offers
#         for promo in soup.select("[id*='PromotionMessage'], [class*='promo'], [id*='instantOrderUpdate']"):
#             txt = promo.get_text(" ", strip=True)
#             if len(txt) > 10:
#                 o = Offer(title=txt[:200])
#                 if re.search(r"bank|hdfc|sbi|icici|axis|kotak|credit|debit", txt, re.I):
#                     o.bank_offer = txt[:200]
#                 if re.search(r"cashback|cb", txt, re.I):
#                     o.cashback = txt[:200]
#                 if re.search(r"emi|0%", txt, re.I):
#                     o.emi_info = txt[:200]
#                 offers.append(o)

#         # "N Offers" section
#         offer_section = soup.find("div", id="sopp_feature_div") or soup.find("div", id="desktop_buybox")
#         if offer_section:
#             for li in offer_section.select("li, .offer-item"):
#                 txt = li.get_text(" ", strip=True)
#                 if len(txt) > 8:
#                     offers.append(Offer(title=txt[:200], raw_text=txt[:500]))

#         # Promo tags scattered across page
#         for span in soup.select("[data-feature-name='promotions'] li"):
#             txt = span.get_text(" ", strip=True)
#             if txt and len(txt) > 5:
#                 offers.append(Offer(title=txt[:200]))

#         # No cost EMI block
#         emi_block = soup.find("div", id="emi-installment-base-message") or soup.find("span", id="priceToPay-label-NoCostEMI")
#         if emi_block:
#             data.no_cost_emi = emi_block.get_text(" ", strip=True)[:300]

#         # Exchange offer
#         for tag in soup.select("[id*='exchange'], [class*='exchange']"):
#             txt = tag.get_text(strip=True)
#             if "exchange" in txt.lower() and len(txt) > 5:
#                 data.exchange_offer = txt[:200]
#                 break

#         data.offers = offers[:20]  # cap

#         # Delivery
#         delivery = soup.find("div", id="mir-layout-DELIVERY_BLOCK") or soup.find("div", id="deliveryBlockMessage")
#         if delivery:
#             data.delivery_date = delivery.get_text(" ", strip=True)[:200]

#         data.extraction_method = "html"
#         data.confidence_score = self._score(data)
#         return data

#     def _score(self, d: ProductData) -> float:
#         score = 0.0
#         if d.name: score += 0.25
#         if d.current_price: score += 0.25
#         if d.images: score += 0.15
#         if d.review and d.review.rating: score += 0.15
#         if d.offers: score += 0.10
#         if d.specifications: score += 0.10
#         return round(score, 2)

# # ─────────────────────────────────────────────────────────────────────────────
# # FLIPKART PARSER
# # ─────────────────────────────────────────────────────────────────────────────
# class FlipkartParser:
#     def parse(self, html: str, url: str) -> ProductData:
#         soup = BeautifulSoup(html, "lxml")
#         data = ProductData(url=url, platform="flipkart")

#         # Flipkart ID from URL
#         pid_match = re.search(r"pid=([A-Z0-9]+)", url)
#         data.asin_or_id = pid_match.group(1) if pid_match else None

#         # Name — multiple possible selectors
#         for sel in ["span.VU-ZEz", "h1.yhB1nd", "h1 span", ".B_NuCI"]:
#             el = soup.select_one(sel)
#             if el:
#                 data.name = el.get_text(strip=True)
#                 break

#         # Price
#         price_el = soup.select_one("div.Nx9bqj, div._30jeq3, div.CEmiEU")
#         if price_el:
#             data.current_price = price_el.get_text(strip=True)

#         orig_el = soup.select_one("div.yRaY8j, div._3I9_wc")
#         if orig_el:
#             data.original_price = orig_el.get_text(strip=True)

#         disc_el = soup.select_one("div.UkUFwK span, div._3Ay6Sb span")
#         if disc_el:
#             data.discount_percent = disc_el.get_text(strip=True)

#         # Highlights
#         for li in soup.select("div._1mXcCf li, div.RmoJze li, ul._1xgFaf li"):
#             t = li.get_text(strip=True)
#             if t:
#                 data.highlights.append(t)

#         # Specs table
#         for row in soup.select("table._14cfVK tr, div._3k-BhJ tr"):
#             cells = row.find_all("td")
#             if len(cells) >= 2:
#                 data.specifications[cells[0].get_text(strip=True)] = cells[1].get_text(strip=True)

#         # Images
#         for img in soup.select("img._396cs4, img._2r_T1I, div._2KpZ6l img"):
#             src = img.get("src", "")
#             if src and "http" in src and "rukminim" in src:
#                 # Upgrade to high-res
#                 src = re.sub(r"/\d+/\d+/", "/832/832/", src)
#                 data.images.append(ProductImage(url=src, is_primary=not data.images))

#         # Reviews
#         review = Review()
#         rating_el = soup.select_one("div._3LWZlK, div.ipqd2A span")
#         if rating_el:
#             try:
#                 review.rating = float(rating_el.get_text(strip=True))
#             except ValueError:
#                 pass
#         count_el = soup.select_one("span._2_R_DZ, span._13vcmD")
#         if count_el:
#             review.count = count_el.get_text(strip=True)
#         data.review = review

#         # Offers
#         offers = []
#         for offer_div in soup.select("div._16ZMS5, li._1k-j3T, div.UBPDI4, div._3F0EYz"):
#             txt = offer_div.get_text(" ", strip=True)
#             if not txt or len(txt) < 5:
#                 continue
#             o = Offer(title=txt[:200], raw_text=txt[:400])
#             if re.search(r"bank|hdfc|sbi|icici|axis|credit|debit", txt, re.I):
#                 o.bank_offer = txt[:200]
#             if re.search(r"emi|equated", txt, re.I):
#                 o.emi_info = txt[:200]
#             if re.search(r"cashback", txt, re.I):
#                 o.cashback = txt[:200]
#             if re.search(r"coupon|code", txt, re.I):
#                 m = re.search(r"[A-Z]{4,12}\d*", txt)
#                 o.coupon_code = m.group() if m else None
#             offers.append(o)

#         # Exchange offer
#         for el in soup.select("[class*='exchange'], [class*='Exchange']"):
#             txt = el.get_text(strip=True)
#             if txt and "exchange" in txt.lower():
#                 data.exchange_offer = txt[:200]
#                 break

#         # No-cost EMI
#         emi_el = soup.select_one("[class*='emi'], [class*='EMI']")
#         if emi_el:
#             data.no_cost_emi = emi_el.get_text(strip=True)[:200]

#         data.offers = offers[:20]

#         # Delivery
#         del_el = soup.select_one("div._31FMez, div._3XINqE")
#         if del_el:
#             data.delivery_date = del_el.get_text(" ", strip=True)[:200]

#         # Seller
#         seller_el = soup.select_one("div#sellerName span, div._1RLviY span")
#         if seller_el:
#             data.seller_name = seller_el.get_text(strip=True)

#         # Stock
#         oos = soup.find(string=re.compile(r"out of stock|sold out", re.I))
#         data.in_stock = oos is None

#         data.extraction_method = "html"
#         data.confidence_score = self._score(data)
#         return data

#     def _score(self, d: ProductData) -> float:
#         score = 0.0
#         if d.name: score += 0.25
#         if d.current_price: score += 0.25
#         if d.images: score += 0.15
#         if d.review and d.review.rating: score += 0.15
#         if d.offers: score += 0.10
#         if d.specifications: score += 0.10
#         return round(score, 2)

# # ─────────────────────────────────────────────────────────────────────────────
# # MEESHO PARSER
# # ─────────────────────────────────────────────────────────────────────────────
# class MeeshoParser:
#     def parse(self, html: str, url: str) -> ProductData:
#         soup = BeautifulSoup(html, "lxml")
#         data = ProductData(url=url, platform="meesho")

#         # Meesho is React-rendered; try to grab __NEXT_DATA__ JSON
#         next_data = soup.find("script", id="__NEXT_DATA__")
#         if next_data:
#             try:
#                 nd = json.loads(next_data.string)
#                 props = nd.get("props", {}).get("pageProps", {})
#                 pdp   = props.get("productDetails", props.get("product", {}))

#                 data.name  = pdp.get("name") or pdp.get("product_name")
#                 data.brand = pdp.get("brand_name") or pdp.get("brand")

#                 # Price info
#                 price_info = pdp.get("price_info", pdp)
#                 data.current_price  = f"₹{price_info.get('sp', price_info.get('selling_price', ''))}"
#                 data.original_price = f"₹{price_info.get('mrp', price_info.get('maximum_retail_price', ''))}"

#                 mrp = price_info.get("mrp", 0) or price_info.get("maximum_retail_price", 0)
#                 sp  = price_info.get("sp", 0)  or price_info.get("selling_price", 0)
#                 if mrp and sp and int(mrp) > 0:
#                     disc = round((int(mrp) - int(sp)) / int(mrp) * 100)
#                     data.discount_percent = f"{disc}% off"

#                 # Images
#                 imgs = pdp.get("images", []) or pdp.get("product_images", [])
#                 for idx, img in enumerate(imgs[:8]):
#                     url_img = img.get("url", img) if isinstance(img, dict) else img
#                     if url_img:
#                         data.images.append(ProductImage(url=str(url_img), is_primary=(idx == 0)))

#                 # Reviews
#                 review = Review()
#                 review.rating = pdp.get("rating") or pdp.get("average_rating")
#                 review.count  = str(pdp.get("rating_count", pdp.get("review_count", "")))
#                 data.review = review

#                 # Specs / details
#                 details = pdp.get("product_attributes", pdp.get("attributes", []))
#                 if isinstance(details, list):
#                     for item in details:
#                         if isinstance(item, dict):
#                             data.specifications[item.get("name", "")] = item.get("value", "")
#                 elif isinstance(details, dict):
#                     data.specifications = details

#                 # Highlights
#                 h = pdp.get("highlights", pdp.get("product_highlights", []))
#                 data.highlights = h if isinstance(h, list) else []

#                 # Offers from Meesho JSON
#                 offers_raw = pdp.get("offers", pdp.get("promotions", []))
#                 for o_raw in (offers_raw or []):
#                     txt = o_raw.get("title", "") or o_raw.get("description", "")
#                     if txt:
#                         o = Offer(title=txt[:200])
#                         if "bank" in txt.lower():
#                             o.bank_offer = txt
#                         if "cashback" in txt.lower():
#                             o.cashback = txt
#                         data.offers.append(o)

#                 data.in_stock = pdp.get("is_available", True)
#                 data.confidence_score = 0.85  # JSON source = high confidence
#                 data.extraction_method = "json_ld"
#                 return data
#             except Exception as e:
#                 data.warnings.append(f"JSON parse failed: {e}")

#         # Fallback HTML scraping for Meesho
#         for sel in ["h1.sc-eDnWTT", "h1", "p.sc-eDnWTT"]:
#             el = soup.select_one(sel)
#             if el and len(el.get_text(strip=True)) > 5:
#                 data.name = el.get_text(strip=True)
#                 break

#         for sel in ["h4.sc-eDnWTT", "[class*='price']", "[class*='Price']"]:
#             el = soup.select_one(sel)
#             if el:
#                 txt = el.get_text(strip=True)
#                 if "₹" in txt or re.search(r"\d{2,}", txt):
#                     data.current_price = txt
#                     break

#         for img in soup.select("img[src*='meesho'], img[src*='cloudfront']"):
#             src = img.get("src", "")
#             if src:
#                 data.images.append(ProductImage(url=src, is_primary=not data.images))

#         data.extraction_method = "html"
#         data.confidence_score = self._score(data)
#         return data

#     def _score(self, d: ProductData) -> float:
#         score = 0.0
#         if d.name: score += 0.3
#         if d.current_price: score += 0.3
#         if d.images: score += 0.2
#         if d.review and d.review.rating: score += 0.2
#         return round(score, 2)

# # ─────────────────────────────────────────────────────────────────────────────
# # LLM EXTRACTION ENGINE
# # ─────────────────────────────────────────────────────────────────────────────
# class LLMExtractor:
#     """
#     Uses Claude to extract structured product data from raw HTML.
#     Triggered when: confidence < threshold, or as hybrid enrichment.
#     """
#     CONFIDENCE_THRESHOLD = 0.5
#     SCHEMA = {
#         "name": "string",
#         "brand": "string",
#         "current_price": "string (e.g. ₹1,299)",
#         "original_price": "string",
#         "discount_percent": "string (e.g. 20% off)",
#         "in_stock": "boolean",
#         "stock_message": "string",
#         "seller_name": "string",
#         "description": "string (max 200 words)",
#         "highlights": ["list of strings"],
#         "specifications": {"key": "value"},
#         "delivery_date": "string",
#         "delivery_charges": "string",
#         "no_cost_emi": "string",
#         "exchange_offer": "string",
#         "offers": [
#             {
#                 "title": "string",
#                 "bank_offer": "string or null",
#                 "cashback": "string or null",
#                 "coupon_code": "string or null",
#                 "emi_info": "string or null",
#                 "validity": "string or null"
#             }
#         ],
#         "combo_deals": ["list of strings"],
#         "image_urls": ["list of image URLs (first is primary)"],
#         "review": {
#             "rating": "float 0-5",
#             "count": "string",
#             "top_review_snippet": "string"
#         }
#     }

#     def __init__(self):
#         if not HAS_ANTHROPIC:
#             raise RuntimeError("anthropic SDK not installed. pip install anthropic")
#         if not Config.ANTHROPIC_API_KEY:
#             raise RuntimeError("ANTHROPIC_API_KEY not set.")
#         self.client = _anthropic_sdk.Anthropic(api_key=Config.ANTHROPIC_API_KEY)

#     def _clean_html(self, html: str, platform: str) -> str:
#         """Strip scripts/styles, keep meaningful text. Truncate for token limit."""
#         soup = BeautifulSoup(html, "lxml")
#         for tag in soup(["script", "style", "noscript", "meta", "link", "svg", "iframe"]):
#             tag.decompose()
#         text = soup.get_text(" ", strip=True)
#         # Keep first ~15k chars (≈ 3-4k tokens)
#         return text[:15000]

#     def extract(self, html: str, url: str, platform: str, partial: Optional[ProductData] = None) -> dict:
#         clean = self._clean_html(html, platform)
#         schema_str = json.dumps(self.SCHEMA, indent=2)

#         existing = ""
#         if partial:
#             existing = f"\nPartially extracted data so far:\n{partial.to_json()}\n\nFill in missing/incorrect fields."

#         prompt = f"""You are a world-class e-commerce data extraction specialist.

# Platform: {platform.upper()}
# URL: {url}
# {existing}

# Extract ALL product information from the page text below. Return ONLY a JSON object matching this schema:
# {schema_str}

# Rules:
# - Extract EVERY offer/deal/promotion you can find (bank offers, cashback, coupons, no-cost EMI, exchange offers).
# - Prices must include currency symbol (₹).
# - If a field is not found, use null.
# - Return raw JSON only. No markdown fences. No explanation.

# PAGE TEXT:
# {clean}"""

#         response = self.client.messages.create(
#             model=Config.CLAUDE_MODEL,
#             max_tokens=2000,
#             messages=[{"role": "user", "content": prompt}]
#         )
#         raw = response.content[0].text.strip()
#         # Strip any accidental markdown fences
#         raw = re.sub(r"^```json\s*|^```\s*|\s*```$", "", raw, flags=re.MULTILINE).strip()
#         return json.loads(raw)

#     def merge_into(self, data: ProductData, llm_result: dict) -> ProductData:
#         """Merge LLM-extracted data into existing ProductData, preferring non-null values."""
#         def pick(existing, new):
#             return existing if existing else new

#         data.name = pick(data.name, llm_result.get("name"))
#         data.brand = pick(data.brand, llm_result.get("brand"))
#         data.current_price = pick(data.current_price, llm_result.get("current_price"))
#         data.original_price = pick(data.original_price, llm_result.get("original_price"))
#         data.discount_percent = pick(data.discount_percent, llm_result.get("discount_percent"))
#         data.description = pick(data.description, llm_result.get("description"))
#         data.delivery_date = pick(data.delivery_date, llm_result.get("delivery_date"))
#         data.delivery_charges = pick(data.delivery_charges, llm_result.get("delivery_charges"))
#         data.no_cost_emi = pick(data.no_cost_emi, llm_result.get("no_cost_emi"))
#         data.exchange_offer = pick(data.exchange_offer, llm_result.get("exchange_offer"))
#         data.seller_name = pick(data.seller_name, llm_result.get("seller_name"))

#         if data.in_stock is None:
#             data.in_stock = llm_result.get("in_stock")

#         if not data.highlights and llm_result.get("highlights"):
#             data.highlights = llm_result["highlights"]

#         if not data.specifications and llm_result.get("specifications"):
#             data.specifications = llm_result["specifications"]

#         # Merge images
#         existing_urls = {img.url for img in data.images}
#         for idx, url_img in enumerate(llm_result.get("image_urls", [])[:8]):
#             if url_img and url_img not in existing_urls:
#                 data.images.append(ProductImage(url=url_img, is_primary=(not data.images and idx == 0)))
#                 existing_urls.add(url_img)

#         # Merge offers
#         existing_titles = {o.title for o in data.offers}
#         for o_raw in llm_result.get("offers", []):
#             if not isinstance(o_raw, dict):
#                 continue
#             t = o_raw.get("title", "")
#             if t and t not in existing_titles:
#                 data.offers.append(Offer(
#                     title=t,
#                     bank_offer=o_raw.get("bank_offer"),
#                     cashback=o_raw.get("cashback"),
#                     coupon_code=o_raw.get("coupon_code"),
#                     emi_info=o_raw.get("emi_info"),
#                     validity=o_raw.get("validity"),
#                 ))
#                 existing_titles.add(t)

#         # Combo deals
#         if llm_result.get("combo_deals"):
#             data.combo_deals.extend(llm_result["combo_deals"])

#         # Review
#         rev_raw = llm_result.get("review", {})
#         if rev_raw and (not data.review or not data.review.rating):
#             rev = data.review or Review()
#             rev.rating = rev_raw.get("rating")
#             rev.count  = rev_raw.get("count")
#             rev.top_review_snippet = rev_raw.get("top_review_snippet")
#             data.review = rev

#         data.extraction_method = "hybrid"
#         return data

# # ─────────────────────────────────────────────────────────────────────────────
# # CORE SCRAPING ORCHESTRATOR
# # ─────────────────────────────────────────────────────────────────────────────
# class ScraperOrchestrator:
#     """
#     Main entry point. Coordinates fetching, parsing, LLM enrichment, caching.
#     """

#     def __init__(self):
#         self.rotator      = IPRotationEngine()
#         self.rate_limiter = RateLimiter()
#         self.fetcher      = Fetcher(self.rotator, self.rate_limiter)
#         self.cache        = InMemoryCache()
#         self.parsers      = {
#             "amazon":   AmazonParser(),
#             "flipkart": FlipkartParser(),
#             "meesho":   MeeshoParser(),
#         }
#         self._llm: Optional[LLMExtractor] = None
#         self._init_llm()

#     def _init_llm(self):
#         try:
#             self._llm = LLMExtractor()
#             logging.info("[LLM] Claude extractor initialized.")
#         except Exception as e:
#             logging.warning(f"[LLM] Disabled: {e}")

#     def scrape(self, url: str, force_llm: bool = False) -> ProductData:
#         """
#         Full pipeline:
#           1. Check cache
#           2. Detect platform
#           3. Fetch HTML (with IP rotation)
#           4. Parse with platform-specific parser
#           5. If confidence low → enrich with LLM
#           6. Cache result
#           7. Return structured data
#         """
#         t0 = time.time()

#         # Cache
#         cached = self.cache.get(url)
#         if cached:
#             logging.info("[Cache] HIT")
#             return cached

#         platform = detect_platform(url)
#         logging.info(f"[Scraper] Platform: {platform} | URL: {url[:80]}...")

#         # Fetch
#         html, status = self.fetcher.fetch(url, platform)
#         if status not in (200, 206):
#             raise RuntimeError(f"HTTP {status} for {url}")

#         # Parse
#         parser = self.parsers.get(platform)
#         if parser and HAS_BS4:
#             data = parser.parse(html, url)
#         else:
#             data = ProductData(url=url, platform=platform)
#             data.errors.append("No parser available (bs4 missing?)")

#         data.raw_html_length = len(html)
#         data.scraped_at = datetime.now(timezone.utc).isoformat()

#         # LLM enrichment
#         if self._llm and (force_llm or data.confidence_score < LLMExtractor.CONFIDENCE_THRESHOLD):
#             logging.info(f"[LLM] Enriching (confidence={data.confidence_score})")
#             try:
#                 llm_result = self._llm.extract(html, url, platform, data)
#                 data = self._llm.merge_into(data, llm_result)
#                 data.confidence_score = min(1.0, data.confidence_score + 0.3)
#             except Exception as e:
#                 data.warnings.append(f"LLM enrichment failed: {e}")
#                 logging.warning(f"[LLM] Failed: {e}")

#         data.scrape_duration_ms = int((time.time() - t0) * 1000)
#         self.cache.set(url, data)
#         return data

# # ─────────────────────────────────────────────────────────────────────────────
# # RICH CLI DISPLAY
# # ─────────────────────────────────────────────────────────────────────────────
# def display_result(data: ProductData):
#     if not HAS_RICH:
#         print(data.to_json())
#         return

#     console.print()
#     # Header panel
#     header = Text()
#     header.append("⚡ PRICESPY", style="bold yellow")
#     header.append(f"  [{data.platform.upper()}]", style="bold cyan")
#     header.append(f"  ·  {data.scraped_at[:19].replace('T', ' ')} UTC", style="dim")
#     header.append(f"  ·  {data.scrape_duration_ms}ms", style="dim")
#     confidence_style = "green" if data.confidence_score > 0.7 else "yellow" if data.confidence_score > 0.4 else "red"
#     header.append(f"  ·  Confidence: {data.confidence_score:.0%}", style=confidence_style)
#     console.print(Panel(header, border_style="yellow"))

#     # Product name + price
#     if data.name:
#         console.print(f"\n[bold white]{data.name}[/bold white]")
#     if data.brand:
#         console.print(f"[dim]Brand: {data.brand}[/dim]")

#     # Price row
#     price_text = Text()
#     if data.current_price:
#         price_text.append(f"  {data.current_price} ", style="bold green")
#     if data.original_price:
#         price_text.append(f"{data.original_price} ", style="dim strike")
#     if data.discount_percent:
#         price_text.append(f" {data.discount_percent}", style="bold red")
#     if price_text:
#         console.print(Panel(price_text, title="💰 Price", border_style="green"))

#     # Availability
#     if data.in_stock is not None:
#         avail = "[bold green]✔ In Stock[/bold green]" if data.in_stock else "[bold red]✘ Out of Stock[/bold red]"
#         console.print(f"  Stock: {avail}")
#     if data.stock_message:
#         console.print(f"  [dim]{escape(data.stock_message)}[/dim]")
#     if data.seller_name:
#         console.print(f"  Seller: [cyan]{escape(data.seller_name)}[/cyan]" + (f" (via {data.fulfilled_by})" if data.fulfilled_by else ""))

#     # Delivery
#     if data.delivery_date:
#         console.print(f"\n  📦 Delivery: [italic]{escape(data.delivery_date[:100])}[/italic]")

#     # Offers — the highlight section
#     if data.offers or data.no_cost_emi or data.exchange_offer or data.bank_offers:
#         offers_tbl = Table(title="🏷️  Offers & Deals", box=box.ROUNDED, border_style="yellow", show_lines=True)
#         offers_tbl.add_column("Type", style="bold yellow", width=14)
#         offers_tbl.add_column("Details", style="white")
#         if data.no_cost_emi:
#             offers_tbl.add_row("No-Cost EMI", escape(data.no_cost_emi[:120]))
#         if data.exchange_offer:
#             offers_tbl.add_row("Exchange", escape(data.exchange_offer[:120]))
#         for o in data.offers[:15]:
#             kind = "Bank Offer" if o.bank_offer else \
#                    "Cashback"   if o.cashback else \
#                    "Coupon"     if o.coupon_code else \
#                    "EMI"        if o.emi_info else "Offer"
#             detail = o.bank_offer or o.cashback or o.emi_info or o.title
#             row_text = escape(detail[:150])
#             if o.coupon_code:
#                 row_text += f"\n[bold yellow]Code: {escape(o.coupon_code)}[/bold yellow]"
#             if o.validity:
#                 row_text += f"\n[dim]Valid: {escape(o.validity)}[/dim]"
#             offers_tbl.add_row(kind, row_text)
#         for b in data.bank_offers[:3]:
#             offers_tbl.add_row("Bank", escape(b[:150]))
#         console.print(offers_tbl)

#     # Combo deals
#     if data.combo_deals:
#         console.print("\n[bold]🛍️ Combo Deals:[/bold]")
#         for c in data.combo_deals[:5]:
#             console.print(f"  • {escape(c)}")

#     # Highlights
#     if data.highlights:
#         hl_tbl = Table(title="✨ Highlights", box=box.SIMPLE_HEAVY, border_style="cyan")
#         hl_tbl.add_column("", style="cyan")
#         for h in data.highlights[:8]:
#             hl_tbl.add_row(escape(h[:120]))
#         console.print(hl_tbl)

#     # Specs
#     if data.specifications:
#         spec_tbl = Table(title="📋 Specifications", box=box.SIMPLE, border_style="blue")
#         spec_tbl.add_column("Key", style="bold blue", width=25)
#         spec_tbl.add_column("Value", style="white")
#         for k, v in list(data.specifications.items())[:15]:
#             spec_tbl.add_row(escape(str(k)[:30]), escape(str(v)[:80]))
#         console.print(spec_tbl)

#     # Reviews
#     if data.review and (data.review.rating or data.review.count):
#         stars = "★" * int(data.review.rating or 0) + "☆" * (5 - int(data.review.rating or 0))
#         console.print(f"\n  ⭐ [bold]{data.review.rating or '?'}[/bold] [yellow]{stars}[/yellow]  ({data.review.count or '?'} reviews)")
#         if data.review.rating_breakdown:
#             for star, pct in data.review.rating_breakdown.items():
#                 console.print(f"     {star}: {pct}")
#         if data.review.top_review_snippet:
#             console.print(f'     [italic]"{escape(data.review.top_review_snippet[:200])}"[/italic]')

#     # Images
#     if data.images:
#         console.print(f"\n  📸 [bold]{len(data.images)}[/bold] image(s) available")
#         for img in data.images[:3]:
#             prefix = "[primary]" if img.is_primary else ""
#             console.print(f"     {prefix} {img.url[:100]}")

#     # Warnings / Errors
#     if data.warnings:
#         console.print(f"\n[yellow]⚠ Warnings:[/yellow]")
#         for w in data.warnings:
#             console.print(f"   [yellow]{escape(w)}[/yellow]")
#     if data.errors:
#         console.print(f"\n[red]✖ Errors:[/red]")
#         for e in data.errors:
#             console.print(f"   [red]{escape(e)}[/red]")

#     # JSON footer
#     console.print(f"\n[dim]Extraction method: {data.extraction_method} | HTML size: {data.raw_html_length:,} bytes[/dim]")
#     console.print()

# # ─────────────────────────────────────────────────────────────────────────────
# # REST API (FastAPI)
# # ─────────────────────────────────────────────────────────────────────────────
# def build_api(orchestrator: ScraperOrchestrator):
#     if not HAS_FASTAPI:
#         raise RuntimeError("fastapi not installed. pip install fastapi uvicorn")

#     app = FastAPI(
#         title="PriceSpy — E-Commerce Scraping API",
#         description="Scrapes Amazon, Flipkart, Meesho with IP rotation & LLM enrichment.",
#         version="1.0.0",
#     )

#     class ScrapeRequest(PydanticBase):
#         url: str
#         force_llm: bool = False

#     class BatchRequest(PydanticBase):
#         urls: list[str]
#         force_llm: bool = False

#     @app.get("/health")
#     def health():
#         return {
#             "status": "ok",
#             "cache": orchestrator.cache.stats(),
#             "rotation_strategy": orchestrator.rotator._strategy,
#             "llm_enabled": orchestrator._llm is not None,
#             "timestamp": datetime.now(timezone.utc).isoformat(),
#         }

#     @app.post("/scrape")
#     def scrape_endpoint(req: ScrapeRequest):
#         try:
#             data = orchestrator.scrape(req.url, force_llm=req.force_llm)
#             return JSONResponse(content=data.to_dict())
#         except Exception as e:
#             raise HTTPException(status_code=500, detail=str(e))

#     @app.post("/scrape/batch")
#     def batch_endpoint(req: BatchRequest):
#         results = []
#         errors  = []
#         for url in req.urls:
#             try:
#                 data = orchestrator.scrape(url, force_llm=req.force_llm)
#                 results.append(data.to_dict())
#             except Exception as e:
#                 errors.append({"url": url, "error": str(e)})
#         return JSONResponse(content={"results": results, "errors": errors, "total": len(req.urls)})

#     @app.get("/scrape")
#     def scrape_get(url: str, force_llm: bool = False):
#         try:
#             data = orchestrator.scrape(url, force_llm=force_llm)
#             return JSONResponse(content=data.to_dict())
#         except Exception as e:
#             raise HTTPException(status_code=500, detail=str(e))

#     return app

# # ─────────────────────────────────────────────────────────────────────────────
# # DEMO MODE (no real network calls)
# # ─────────────────────────────────────────────────────────────────────────────
# def run_demo():
#     """Generates a realistic mock ProductData to showcase the output schema."""
#     data = ProductData(
#         url="https://www.amazon.in/dp/B0DEMO12345",
#         platform="amazon",
#         scraped_at=datetime.now(timezone.utc).isoformat(),
#         scrape_duration_ms=1342,
#         name="boAt Airdopes 141 TWS Ear Buds with 42H Playtime, Beast™ Mode(Low Latency Upto 80ms), ENx™ Tech, IWP™ Tech, ASAP™ Charge, IPX4 & Voice Asst. Compatibility",
#         brand="boAt",
#         model_number="Airdopes 141",
#         asin_or_id="B09X7FRM5G",
#         current_price="₹1,299",
#         original_price="₹4,490",
#         discount_percent="71% off",
#         currency="INR",
#         in_stock=True,
#         stock_message="In Stock. Usually dispatched within 24 hours.",
#         seller_name="Appario Retail Private Ltd",
#         fulfilled_by="Amazon",
#         description="Experience music like never before with boAt Airdopes 141 featuring 42H playtime with Beast™ Mode for ultra-low latency gaming.",
#         highlights=[
#             "42 Hours Total Playtime with ASAP Charge",
#             "Beast™ Mode with 80ms Low Latency",
#             "ENx™ Tech for Clear Calls",
#             "IPX4 Water & Sweat Resistance",
#             "10mm Drivers for Immersive Audio",
#         ],
#         specifications={
#             "Driver Size": "10mm Dynamic Drivers",
#             "Frequency Response": "20Hz-20kHz",
#             "Impedance": "32 Ω",
#             "Battery Life": "42 Hours (Earbuds 6H + Case 36H)",
#             "Charging Time": "1.5 Hours",
#             "Connectivity": "Bluetooth v5.2",
#             "Water Resistance": "IPX4",
#             "Weight": "5g per earbud",
#         },
#         images=[
#             ProductImage(url="https://m.media-amazon.com/images/I/61QMnfH1URL._SX522_.jpg", is_primary=True, alt="boAt Airdopes 141 - Active Black"),
#             ProductImage(url="https://m.media-amazon.com/images/I/71yWmX5QKXL._SX522_.jpg", is_primary=False, alt="Side view"),
#             ProductImage(url="https://m.media-amazon.com/images/I/71NXMSH23ML._SX522_.jpg", is_primary=False, alt="Case view"),
#         ],
#         review=Review(
#             rating=4.1,
#             count="1,84,326 ratings",
#             rating_breakdown={"5★": "52%", "4★": "22%", "3★": "12%", "2★": "6%", "1★": "8%"},
#             top_review_snippet="Best budget TWS earbuds! Sound quality is great for the price. Beast mode actually works for gaming."
#         ),
#         offers=[
#             Offer(title="10% Instant Discount on SBI Credit Card", bank_offer="10% Instant Discount on SBI Credit Card on min purchase of ₹5,000. T&C Apply.", validity="31 May 2025"),
#             Offer(title="₹130 cashback on HDFC Bank Credit Card EMI", cashback="₹130 cashback on HDFC Bank Credit Card EMI transactions", validity="30 Apr 2025"),
#             Offer(title="No Cost EMI from ₹217/month", emi_info="No Cost EMI available on select cards for 6 months"),
#             Offer(title="5% back with Amazon Pay ICICI Credit Card", cashback="5% cashback on Amazon Pay ICICI Bank Credit Card"),
#             Offer(title="Use code BOATFLY50", coupon_code="BOATFLY50", cashback="₹50 off on orders above ₹999"),
#             Offer(title="Axis Bank Credit Card: 10% off up to ₹750", bank_offer="10% off on Axis Bank Credit Cards. Max discount ₹750."),
#         ],
#         no_cost_emi="No Cost EMI available from ₹217/month for 6 months on select cards",
#         exchange_offer="Get up to ₹350 off on exchange of old earphones",
#         combo_deals=["Buy with boAt BassHeads 100 for ₹1,598 (Save ₹500)", "Buy with boAt Rockerz 255 for ₹2,299 (Save ₹300)"],
#         delivery_date="FREE delivery Tomorrow by 8 PM. Order within 3 hrs 20 mins.",
#         delivery_charges="FREE",
#         extraction_method="hybrid",
#         confidence_score=0.95,
#         raw_html_length=487250,
#     )
#     display_result(data)
#     console.print("[dim]— Demo mode. No real network request was made. —[/dim]\n")

# # ─────────────────────────────────────────────────────────────────────────────
# # MAIN ENTRY POINT
# # ─────────────────────────────────────────────────────────────────────────────
# def main():
#     logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

#     parser = argparse.ArgumentParser(
#         prog="pricespy",
#         description="PriceSpy — E-Commerce Scraping Microservice (Amazon · Flipkart · Meesho)"
#     )
#     sub = parser.add_subparsers(dest="cmd")

#     # scrape
#     p_scrape = sub.add_parser("scrape", help="Scrape a single product URL")
#     p_scrape.add_argument("url", help="Product page URL")
#     p_scrape.add_argument("--llm", action="store_true", help="Force LLM enrichment")
#     p_scrape.add_argument("--json", action="store_true", help="Output raw JSON")
#     p_scrape.add_argument("--out", help="Save JSON to file")

#     # serve
#     p_serve = sub.add_parser("serve", help="Start REST API server")
#     p_serve.add_argument("--port", type=int, default=Config.API_PORT)
#     p_serve.add_argument("--host", default=Config.API_HOST)

#     # batch
#     p_batch = sub.add_parser("batch", help="Scrape multiple URLs from file")
#     p_batch.add_argument("file", help="Text file with one URL per line")
#     p_batch.add_argument("--out", help="Output JSON file", default="batch_results.json")
#     p_batch.add_argument("--llm", action="store_true")

#     # demo
#     sub.add_parser("demo", help="Run with mock data (no network)")

#     args = parser.parse_args()

#     if args.cmd == "demo" or args.cmd is None:
#         run_demo()
#         if args.cmd is None:
#             console.print("[bold]Usage:[/bold]  python scraper_service.py [scrape URL | serve | batch FILE | demo]\n")
#         return

#     if args.cmd == "scrape":
#         orch = ScraperOrchestrator()
#         with Progress(SpinnerColumn(), TextColumn("{task.description}"), console=console, transient=True) as prog:
#             prog.add_task(f"Scraping {args.url[:60]}...", total=None)
#             data = orch.scrape(args.url, force_llm=args.llm)

#         if args.json or args.out:
#             raw = data.to_json()
#             print(raw)
#             if args.out:
#                 with open(args.out, "w") as f:
#                     f.write(raw)
#                 console.print(f"[green]✔ Saved to {args.out}[/green]")
#         else:
#             display_result(data)

#     elif args.cmd == "serve":
#         orch = ScraperOrchestrator()
#         app = build_api(orch)
#         console.print(f"[bold green]🚀 PriceSpy API running on http://{args.host}:{args.port}[/bold green]")
#         console.print(f"   Docs: http://localhost:{args.port}/docs")
#         uvicorn.run(app, host=args.host, port=args.port, log_level="info")

#     elif args.cmd == "batch":
#         with open(args.file) as f:
#             urls = [l.strip() for l in f if l.strip() and not l.startswith("#")]
#         console.print(f"[bold]Batch scraping {len(urls)} URLs...[/bold]")
#         orch = ScraperOrchestrator()
#         results = []
#         errors = []
#         for i, url in enumerate(urls, 1):
#             console.print(f"[{i}/{len(urls)}] {url[:70]}")
#             try:
#                 data = orch.scrape(url, force_llm=args.llm)
#                 results.append(data.to_dict())
#                 console.print(f"  [green]✔[/green] {data.name or '(no name)'} — {data.current_price or '?'}")
#             except Exception as e:
#                 errors.append({"url": url, "error": str(e)})
#                 console.print(f"  [red]✖ {e}[/red]")
#         output = {"results": results, "errors": errors, "total": len(urls), "success": len(results)}
#         with open(args.out, "w") as f:
#             json.dump(output, f, indent=2, ensure_ascii=False)
#         console.print(f"\n[bold green]✔ Done. {len(results)}/{len(urls)} succeeded. Saved to {args.out}[/bold green]")

# if __name__ == "__main__":
#     main() """
# scraper_service.py
# LIVE WORKING Meesho Scraper (Dynamic page support)
# pip install playwright beautifulsoup4 lxml

# scraper_service.py
# Use REAL installed Google Chrome (not Playwright Chromium)
# pip install playwright beautifulsoup4 lxml
# playwright install

# scraper_service.py
# Launch REAL Google Chrome in GUEST MODE and scrape Meesho
# pip install playwright beautifulsoup4 lxml
# playwright install

# scraper_service.py
# FULL WORKING Meesho Scraper using Existing Chrome Session (CDP Attach)
# ------------------------------------------------------------
# STEP 1 (run first in terminal):
#
# /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
# --remote-debugging-port=9222 \
# --user-data-dir=/tmp/meesho-debug
#
# STEP 2:
# Open Meesho manually once in that browser.
#
# STEP 3:
# python3 scraper_service.py
#
# pip install playwright beautifulsoup4 lxml
# playwright install
import json
import time
import re
import os
import random
from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright

# ------------------------------------------------
# CONFIG
# ------------------------------------------------
PRODUCT_URL = "https://www.meesho.com/ndc-feb-fancy-retro-women-dresses-and-frocks/p/74ilo8"

CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

# NEW PROFILE FOLDER
USER_DATA_DIR = "/Users/manithmettu/Desktop/meesho_profile"


# ------------------------------------------------
# HELPERS
# ------------------------------------------------
def clean(txt):
    return re.sub(r"\s+", " ", txt).strip()


def page_text(soup):
    return soup.get_text(" ", strip=True)


def human_scroll(page):
    for _ in range(7):
        page.evaluate("window.scrollBy(0, 2200)")
        time.sleep(random.uniform(1, 2))


def get_title(soup):
    h1 = soup.find("h1")
    if h1:
        return clean(h1.text)

    if soup.title:
        return clean(soup.title.text)

    return None


def get_price(soup):
    m = re.findall(r"₹\s?[\d,]+", page_text(soup))
    return m[0] if m else None


def get_images(soup):
    imgs = []

    for img in soup.find_all("img"):
        src = img.get("src")
        if src and src.startswith("http"):
            imgs.append(src)

    return list(set(imgs))[:10]


# ------------------------------------------------
# MAIN
# ------------------------------------------------
def scrape_meesho(url):

    os.makedirs(USER_DATA_DIR, exist_ok=True)

    with sync_playwright() as p:

        print("Launching REAL Chrome with NEW profile...")

        context = p.chromium.launch_persistent_context(
            user_data_dir=USER_DATA_DIR,
            executable_path=CHROME_PATH,
            headless=False,
            channel="chrome",
            no_viewport=True,
            args=[
                "--start-maximized",
                "--disable-blink-features=AutomationControlled"
            ]
        )

        page = context.new_page()

        print("Opening product page...")
        page.goto(url, wait_until="domcontentloaded", timeout=90000)

        time.sleep(5)

        print("Scrolling...")
        human_scroll(page)

        html = page.content()
        soup = BeautifulSoup(html, "lxml")

        data = {
            "title": get_title(soup),
            "price": get_price(soup),
            "images": get_images(soup),
            "scraped_at": time.strftime("%Y-%m-%d %H:%M:%S")
        }

        print(json.dumps(data, indent=4, ensure_ascii=False))

        input("\nPress ENTER to close...")
        context.close()


# ------------------------------------------------
# RUN
# ------------------------------------------------
if __name__ == "__main__":
    url = input("Enter Meesho Product URL: ").strip()

    if not url:
        url = PRODUCT_URL

    scrape_meesho(url)