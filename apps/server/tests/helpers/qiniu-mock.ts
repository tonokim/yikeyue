import { QiniuClient } from "../../src/storage/client.js";

export class FakeQiniuClient extends QiniuClient {
  public files = new Map<string, { fsize: number; mimeType: string }>();
  public deletedKeys: string[] = [];

  constructor() {
    super({
      accessKey: "mock-access-key",
      secretKey: "mock-secret-key",
      rsHost: "http://mock-rs.qiniu.com",
    });
  }

  /**
   * Pre-seed a file in the in-memory fake client
   */
  addFile(bucket: string, key: string, fileInfo: { fsize: number; mimeType: string }) {
    this.files.set(`${bucket}:${key}`, fileInfo);
  }

  override async stat(bucket: string, key: string) {
    const file = this.files.get(`${bucket}:${key}`);
    if (!file) {
      throw new Error(`Qiniu stat failed: status=612, body=no such file`);
    }
    return {
      fsize: file.fsize,
      hash: "mock-hash",
      mimeType: file.mimeType,
      putTime: Date.now(),
    };
  }

  override async delete(bucket: string, key: string): Promise<void> {
    this.deletedKeys.push(`${bucket}:${key}`);
    this.files.delete(`${bucket}:${key}`);
  }
}
