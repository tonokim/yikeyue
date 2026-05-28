import crypto from "crypto";
import { config } from "../config.js";

export function urlsafeBase64Encode(str: string | Buffer): string {
  const buf = typeof str === "string" ? Buffer.from(str, "utf-8") : str;
  return buf.toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

export interface QiniuClientOptions {
  accessKey?: string;
  secretKey?: string;
  rsHost?: string;
  httpClient?: typeof fetch;
}

export class QiniuClient {
  private accessKey: string;
  private secretKey: string;
  private rsHost: string;
  private httpClient: typeof fetch;

  constructor(options: QiniuClientOptions = {}) {
    this.accessKey = options.accessKey || config.QINIU_ACCESS_KEY;
    this.secretKey = options.secretKey || config.QINIU_SECRET_KEY;
    this.rsHost = options.rsHost || "https://rs.qiniu.com";
    this.httpClient = options.httpClient || fetch;
  }

  private generateQBoxToken(path: string, body = ""): string {
    const signingStr = `${path}\n${body}`;
    const hmac = crypto.createHmac("sha1", this.secretKey);
    hmac.update(signingStr);
    const sign = hmac.digest();
    const encodedSign = urlsafeBase64Encode(sign);
    return `${this.accessKey}:${encodedSign}`;
  }

  async stat(bucket: string, key: string): Promise<{ fsize: number; hash: string; mimeType: string; putTime: number }> {
    const entry = `${bucket}:${key}`;
    const encodedEntry = urlsafeBase64Encode(entry);
    const path = `/stat/${encodedEntry}`;
    const url = `${this.rsHost}${path}`;

    const token = this.generateQBoxToken(path);
    const res = await this.httpClient(url, {
      method: "POST",
      headers: {
        "Authorization": `QBox ${token}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Qiniu stat failed: status=${res.status}, body=${text}`);
    }

    return res.json() as Promise<any>;
  }

  async delete(bucket: string, key: string): Promise<void> {
    const entry = `${bucket}:${key}`;
    const encodedEntry = urlsafeBase64Encode(entry);
    const path = `/delete/${encodedEntry}`;
    const url = `${this.rsHost}${path}`;

    const token = this.generateQBoxToken(path);
    const res = await this.httpClient(url, {
      method: "POST",
      headers: {
        "Authorization": `QBox ${token}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      if (res.status === 612) {
        return;
      }
      throw new Error(`Qiniu delete failed: status=${res.status}, body=${text}`);
    }
  }
}

let defaultQiniuClient: QiniuClient | null = null;

export function getQiniuClient(): QiniuClient {
  if (!defaultQiniuClient) {
    defaultQiniuClient = new QiniuClient();
  }
  return defaultQiniuClient;
}

export function setQiniuClient(client: QiniuClient): void {
  defaultQiniuClient = client;
}
