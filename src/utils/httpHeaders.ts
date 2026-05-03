/** Headers that match a real Chrome desktop/mobile session (helps some WAFs). */

export function chromeVersionFromUa(ua: string): string {
  const m = /Chrome\/([\d.]+)/.exec(ua);
  return m ? m[1].split(".")[0] : "120";
}

export function chromeLikeHeaders(userAgent: string): Record<string, string> {
  const v = chromeVersionFromUa(userAgent);
  const mobile = /Mobile|Android/i.test(userAgent);
  const secChUa = `"Google Chrome";v="${v}", "Chromium";v="${v}", "Not_A Brand";v="24"`;

  return {
    "Accept-Language": "en-IN,en-GB;q=0.9,en-US;q=0.8,en;q=0.7",
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Encoding": "gzip, deflate, br",
    "Sec-Ch-Ua": secChUa,
    "Sec-Ch-Ua-Mobile": mobile ? "?1" : "?0",
    "Sec-Ch-Ua-Platform": mobile ? '"Android"' : '"Windows"',
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
  };
}
