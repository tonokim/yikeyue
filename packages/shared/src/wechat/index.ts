import { z } from "zod";

export const wechatSubscribeJobSchema = z.object({
  event: z.string(),
  touser: z.string(),
  data: z.record(z.any()),
});

export type WechatSubscribeJobPayload = z.infer<typeof wechatSubscribeJobSchema>;

export const wechatPayCallbackSchema = z.object({
  appid: z.string(),
  mchid: z.string(),
  out_trade_no: z.string(),
  transaction_id: z.string(),
  trade_type: z.string(),
  trade_state: z.string(),
  trade_state_desc: z.string(),
  bank_type: z.string(),
  attach: z.string().optional(),
  success_time: z.string(),
  payer: z.object({
    openid: z.string(),
  }),
  amount: z.object({
    total: z.number(),
    payer_total: z.number().optional(),
    currency: z.string(),
    payer_currency: z.string().optional(),
  }),
});

export type WechatPayCallbackPayload = z.infer<typeof wechatPayCallbackSchema>;
