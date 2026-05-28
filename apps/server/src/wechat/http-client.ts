export interface WeChatClientOptions {
  apiBaseUrl?: string; // defaults to https://api.weixin.qq.com
  payBaseUrl?: string; // defaults to https://api.mch.weixin.qq.com
  httpClient?: typeof fetch; // optional fetch override
}

export const DEFAULT_WECHAT_API_BASE_URL = "https://api.weixin.qq.com";
export const DEFAULT_WECHAT_PAY_BASE_URL = "https://api.mch.weixin.qq.com";

export class WeChatHttpClient {
  public apiBaseUrl: string;
  public payBaseUrl: string;
  private httpClient: typeof fetch;

  constructor(options: WeChatClientOptions = {}) {
    this.apiBaseUrl = options.apiBaseUrl || DEFAULT_WECHAT_API_BASE_URL;
    this.payBaseUrl = options.payBaseUrl || DEFAULT_WECHAT_PAY_BASE_URL;
    this.httpClient = options.httpClient || fetch;
  }

  async requestApi<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.apiBaseUrl}${path}`;
    const res = await this.httpClient(url, options);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`WeChat API HTTP error! status: ${res.status}, body: ${body}`);
    }
    return res.json() as Promise<T>;
  }

  async requestPay<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.payBaseUrl}${path}`;
    const res = await this.httpClient(url, options);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`WeChat Pay HTTP error! status: ${res.status}, body: ${body}`);
    }
    return res.json() as Promise<T>;
  }

  get fetch() {
    return this.httpClient;
  }
}
