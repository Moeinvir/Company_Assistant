const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

/**
 * Converts Latin digits to Persian digits, but only for standalone numbers.
 * Digits attached to letters or hyphens (model ids such as "gpt-4o",
 * "sk-ant-3", "v2", "BM25") are left untouched so identifiers keep working,
 * and so do IP addresses / versions with several dots (127.0.0.1).
 * A trailing K/M/B (compact numbers such as "1.2K") is allowed.
 */
const NUMBER = /(?<![A-Za-z0-9_\-/.@#:])\d+(?:[.,]\d+)*(?:[KMB](?![A-Za-z]))?(?![A-Za-z_\-/@])/g;

export function faDigits(text: string): string {
  if (!/\d/.test(text)) return text;
  return text.replace(NUMBER, (num) => {
    if (/^\d+(?:\.\d+){2,}/.test(num)) return num;
    return num
      .replace(/\d/g, (d) => FA_DIGITS[Number(d)]!)
      .replace(/(?<=[۰-۹])\.(?=[۰-۹])/g, "٫")
      .replace(/(?<=[۰-۹]),(?=[۰-۹])/g, "٬");
  });
}

export function faPercent(text: string): string {
  return text.replace(/(?<=[۰-۹])\s?%/g, "٪");
}
