export interface TemplateConfig<E extends string, D> {
  event: E;
  templateId: string;
  buildData: (data: D) => Record<string, { value: any }>;
}

export type WeChatEvent = string;

export const WECHAT_TEMPLATES: Record<string, TemplateConfig<any, any>> = {
  // Empty for production (placeholders/configs registered by individual capabilities later)
};

export function getTemplateConfig(event: string): TemplateConfig<any, any> {
  const config = WECHAT_TEMPLATES[event];
  if (!config) {
    throw new Error(`WeChat template for event '${event}' is not registered`);
  }
  return config;
}
