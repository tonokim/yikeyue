export class WeChatApiError extends Error {
  public readonly errcode: number;
  public readonly errmsg: string;

  constructor(errcode: number, errmsg: string) {
    super(`WeChat API error: errcode=${errcode}, errmsg=${errmsg}`);
    this.name = "WeChatApiError";
    this.errcode = errcode;
    this.errmsg = errmsg;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
