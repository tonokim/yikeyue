export const SHANGHAI_DATE_FMT = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" });

/**
 * Format a Date to a YYYY-MM-DD string in Asia/Shanghai timezone.
 */
export const shanghaiDate = (d: Date) => SHANGHAI_DATE_FMT.format(d);
