/** Allow `tsc` to resolve `exports` in proxy packages without Node16 module settings. */
declare module "https-proxy-agent" {
  import type { Agent } from "http";
  export class HttpsProxyAgent extends Agent {
    constructor(proxy: string, opts?: object);
  }
}

declare module "socks-proxy-agent" {
  import type { Agent } from "http";
  export class SocksProxyAgent extends Agent {
    constructor(proxy: string, opts?: object);
  }
}
