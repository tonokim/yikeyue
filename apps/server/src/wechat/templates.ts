export interface TemplateConfig<E extends string, D> {
  event: E;
  templateId: string;
  buildData: (data: D) => Record<string, { value: any }>;
}

export type WeChatEvent = string;

import { config } from "../config.js";

export const WECHAT_TEMPLATES: Record<string, TemplateConfig<any, any>> = {
  "consultant.bound": {
    event: "consultant.bound",
    templateId: config.WECHAT_TEMPLATE_CONSULTANT_BOUND,
    buildData: (data: { storeName: string; consultantName: string; date: string }) => ({
      thing1: { value: data.storeName.substring(0, 20) },
      name2: { value: data.consultantName.substring(0, 10) },
      time3: { value: data.date },
    }),
  },
  "consultant.unbound": {
    event: "consultant.unbound",
    templateId: config.WECHAT_TEMPLATE_CONSULTANT_UNBOUND,
    buildData: (data: { storeName: string; consultantName: string; date: string }) => ({
      thing1: { value: data.storeName.substring(0, 20) },
      name2: { value: data.consultantName.substring(0, 10) },
      time3: { value: data.date },
    }),
  },
};

export function getTemplateConfig(event: string): TemplateConfig<any, any> {
  const config = WECHAT_TEMPLATES[event];
  if (!config) {
    throw new Error(`WeChat template for event '${event}' is not registered`);
  }
  return config;
}
