import { FA } from "./fa";
import { faDigits, faPercent } from "./digits";

/** Unit nouns that follow a number: "12 passages" → "۱۲ قطعه". */
const UNITS: Record<string, string> = {
  document: "سند",
  documents: "سند",
  passage: "قطعه",
  passages: "قطعه",
  chunk: "قطعه",
  chunks: "قطعه",
  token: "توکن",
  tokens: "توکن",
  message: "پیام",
  messages: "پیام",
  conversation: "گفت‌وگو",
  conversations: "گفت‌وگو",
  query: "پرس‌وجو",
  queries: "پرس‌وجو",
  run: "اجرا",
  runs: "اجرا",
  chars: "نویسه",
  characters: "نویسه",
  dims: "بُعد",
  dimensions: "بُعد",
  models: "مدل",
  model: "مدل",
  responses: "پاسخ",
  share: "سهم",
  base: "پایگاه",
  bases: "پایگاه",
  "knowledge base": "پایگاه دانش",
  "knowledge bases": "پایگاه دانش",
  "base(s)": "پایگاه",
  "assistant(s)": "دستیار",
  assistant: "دستیار",
  assistants: "دستیار",
  "document(s)": "سند",
  "document(s) removed": "سند حذف شد",
  scanned: "قطعه بررسی شد",
  days: "روز",
  active: "فعال",
  draft: "پیش‌نویس",
  paused: "متوقف",
  error: "خطا",
  indexed: "ایندکس‌شده",
  processing: "در حال پردازش",
  failed: "ناموفق",
  attached: "متصل",
  "chat providers": "ارائه‌دهندهٔ گفت‌وگو",
  "embedding providers": "ارائه‌دهندهٔ Embedding",
  "workspace-scoped keys": "کلیدِ مخصوص این فضای کاری",
  "indexed passages": "قطعهٔ ایندکس‌شده",
  "passages indexed": "قطعهٔ ایندکس‌شده",
  "passages in scope": "قطعه در دامنهٔ جست‌وجو",
  "documents still indexing": "سند هنوز در حال ایندکس است",
  "knowledge bases attached": "پایگاه دانش متصل",
  "provider": "ارائه‌دهنده",
  "providers": "ارائه‌دهنده",
};

const METHOD: Record<string, string> = { hybrid: "حالت ترکیبی", vector: "حالت برداری", keyword: "حالت کلیدواژه‌ای" };
const SIZE_UNIT: Record<string, string> = { B: "بایت", KB: "کیلوبایت", MB: "مگابایت", GB: "گیگابایت" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const FA_DATE = "fa-IR-u-ca-persian";

function tr(text: string): string {
  return translateCore(text) ?? text;
}

/** Persian name for a fragment such as "Trial", resolved case-insensitively. */
function word(text: string): string {
  return FA.get(text) ?? FA.get(text.charAt(0).toUpperCase() + text.slice(1)) ?? UNITS[text] ?? text;
}

function persianDate(date: Date, withTime: boolean, withYear: boolean): string {
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "long" };
  if (withYear) opts.year = "numeric";
  const day = new Intl.DateTimeFormat(FA_DATE, opts).format(date);
  if (!withTime) return day;
  const time = new Intl.DateTimeFormat("fa-IR", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
  return `${day}، ${time}`;
}

type Rule = [RegExp, (m: RegExpMatchArray) => string];

const RULES: Rule[] = [
  // relative time / durations / sizes
  [/^(\d+)m ago$/, (m) => `${m[1]} دقیقه پیش`],
  [/^(\d+)h ago$/, (m) => `${m[1]} ساعت پیش`],
  [/^(\d+)d ago$/, (m) => `${m[1]} روز پیش`],
  [/^([\d.,]+) ms$/, (m) => `${m[1]} میلی‌ثانیه`],
  [/^([\d.,]+) s$/, (m) => `${m[1]} ثانیه`],
  [/^([\d.,]+) (B|KB|MB|GB)$/, (m) => `${m[1]} ${SIZE_UNIT[m[2]!]}`],
  [/^(\d+)K context$/, (m) => `زمینهٔ ${m[1]}K`],
  [/^· (\d+) dims$/, (m) => `· ${m[1]} بُعد`],
  [/^top score ([\d.,]+) ?%?$/, (m) => `بالاترین امتیاز ${m[1]}%`],
  [/^best score (.+)$/, (m) => `بهترین امتیاز ${m[1]}`],
  [/^top (\d+)$/, (m) => `${m[1]} قطعهٔ برتر`],
  [/^hue (\d+) ?°$/, (m) => `فام ${m[1]}°`],
  [/^~ ?([\d.,]+) tokens$/, (m) => `حدود ${m[1]} توکن`],
  [/^chunk # ?(\d+)$/, (m) => `قطعهٔ شمارهٔ ${m[1]}`],

  // dates
  [/^([A-Z][a-z]{2}) (\d{1,2})$/, (m) => {
    const month = MONTHS.indexOf(m[1]!);
    return month < 0 ? m[0] : persianDate(new Date(new Date().getFullYear(), month, Number(m[2])), false, false);
  }],
  [/^([A-Z][a-z]{2}) (\d{1,2}), (\d{2}):(\d{2}) (AM|PM)$/, (m) => {
    const month = MONTHS.indexOf(m[1]!);
    if (month < 0) return m[0];
    let hour = Number(m[3]) % 12;
    if (m[5] === "PM") hour += 12;
    return persianDate(new Date(new Date().getFullYear(), month, Number(m[2]), hour, Number(m[4])), true, false);
  }],
  [/^([A-Z][a-z]+) (\d{1,2}), (\d{4})$/, (m) => {
    const d = new Date(m[0]);
    return Number.isNaN(d.getTime()) ? m[0] : persianDate(d, false, true);
  }],

  // dashboard / analytics / page headers
  [/^Health, retrieval quality and ingestion state for (.+)\.$/, (m) => `سلامت، کیفیت بازیابی و وضعیت پردازش اسناد در «${m[1]}».`],
  [/^Query volume, latency, retrieval quality and provider mix for (.+)\.$/, (m) => `حجم پرس‌وجو، تأخیر، کیفیت بازیابی و سهم ارائه‌دهنده‌ها در «${m[1]}».`],
  [/^(\d+) documents? searchable across (\d+) bases? · (\d+) passages ready for retrieval\.$/, (m) => `${m[1]} سند در ${m[2]} پایگاه قابل جست‌وجو است · ${m[3]} قطعه آمادهٔ بازیابی.`],
  [/^(\d+) passages across (\d+) knowledge (?:base|bases) will be scanned per query, keeping the top (\d+) above (\d+)%\.$/, (m) => `در هر پرس‌وجو ${m[1]} قطعه از ${m[2]} پایگاه دانش بررسی می‌شود و ${m[3]} قطعهٔ برتر با امتیاز بالای ${m[4]}٪ نگه داشته می‌شود.`],
  [/^(.+) accepts roughly ([\d.,]+)K tokens\. Each query sends the system prompt, up to (\d+) passages and the conversation so far\.$/, (m) => `${m[1]} حدود ${m[2]}K توکن می‌پذیرد. هر پرس‌وجو پرامپت سیستمی، حداکثر ${m[3]} قطعه و گفت‌وگوی تا این لحظه را ارسال می‌کند.`],
  [/^(\d+) passages were scanned and none scored above zero\. Confirm documents are indexed and attached\.$/, (m) => `${m[1]} قطعه بررسی شد و هیچ‌کدام امتیاز بالای صفر نگرفت. مطمئن شوید اسناد ایندکس و متصل شده‌اند.`],
  [/^(\d+) passages scanned in (.+) using (.+)\.$/, (m) => `${m[1]} قطعه در ${tr(m[2]!)} با ${METHOD[m[3]!] ?? m[3]} بررسی شد.`],
  [/^Leave empty to inherit the fire theme accent \(currently (.+)\)\.$/, (m) => `برای استفاده از رنگ تأکید تم آتش (فعلاً ${m[1]}) خالی بگذارید.`],
  [/^Fire theme — (.+)$/, (m) => `تم آتش — ${word(m[1]!)}`],
  [/^(.+) — widget preview$/, (m) => `پیش‌نمایش ویجت — ${m[1]}`],
  [/^(.+) plan$/, (m) => `طرح ${word(m[1]!)}`],
  [/^(.+)'s workspace$/, (m) => `فضای کاری ${m[1]}`],
  [/^Embedding (\d+) passages with (.+)$/, (m) => `Embedding ${m[1]} قطعه با ${tr(m[2]!)}`],
  [/^active (.+)$/, (m) => `فعالیت ${tr(m[1]!)}`],
  [/^(.+) chat$/, (m) => `گفت‌وگو با ${m[1]}`],
  [/^No passage scored above the (\d+)% threshold across (\d+) indexed passages\.$/, (m) => `هیچ قطعه‌ای از میان ${m[2]} قطعهٔ ایندکس‌شده امتیاز بالای آستانهٔ ${m[1]}٪ نگرفت.`],
  [/^(.+) returned (\d{3}.*)$/, (m) => `${m[1]} پاسخ ${m[2]} برگرداند`],
  [/^Tone: (.+)$/, (m) => `لحن: ${m[1]}`],

  // confirmations & provider UI
  [/^Delete [“"](.+)[”"]\?$/, (m) => `«${m[1]}» حذف شود؟`],
  [/^Delete (\d+) selected documents\?$/, (m) => `${m[1]} سند انتخاب‌شده حذف شود؟`],
  [/^Delete knowledge base [“"](.+)[”"]\?$/, (m) => `پایگاه دانش «${m[1]}» حذف شود؟`],
  [/^Connect (.+)$/, (m) => `اتصال ${m[1]}`],
  [/^Remove (.+) key$/, (m) => `حذف کلید ${m[1]}`],
  [/^Remove the (.+) key\?$/, (m) => `کلید ${m[1]} حذف شود؟`],
  [/^Format: (.+)$/, (m) => `قالب: ${m[1]}`],
  [/^Default: (.+)$/, (m) => `پیش‌فرض: ${m[1]}`],
  [/^· key (.+)$/, (m) => `· کلید ${m[1]}`],
  [/^· checked (.+)$/, (m) => `· بررسی‌شده ${tr(m[1]!)}`],
  [/^(.+) key stored$/, (m) => `کلید ${m[1]} ذخیره شد`],
  [/^Local runtime reachable — (\d+) models? installed\.$/, (m) => `اجرای محلی در دسترس است — ${m[1]} مدل نصب شده است.`],
  [/^Request to (.+) timed out after (\d+)s\.$/, (m) => `درخواست به ${m[1]} پس از ${m[2]} ثانیه منقضی شد.`],
  [/^Request to (.+) was cancelled\.$/, (m) => `درخواست به ${m[1]} لغو شد.`],
  [/^Could not reach (.+)\. This is usually a network or CORS restriction\.$/, (m) => `اتصال به ${m[1]} برقرار نشد. معمولاً به‌دلیل محدودیت شبکه یا CORS است.`],
  [/^(.+) returned a response that was not valid JSON\.$/, (m) => `${m[1]} پاسخی برگرداند که JSON معتبر نبود.`],
  [/^(.+) requires an API key\.$/, (m) => `${m[1]} به کلید API نیاز دارد.`],
  [/^(.+) requires an API key for embeddings\.$/, (m) => `${m[1]} برای Embedding به کلید API نیاز دارد.`],
  [/^(.+) does not implement an embedding endpoint in this build\.$/, (m) => `${m[1]} در این نسخه نقطهٔ پایانی Embedding ندارد.`],
  [/^Request failed with (.+)$/, (m) => `درخواست با خطای ${m[1]} ناموفق بود`],
  [/^The site returned (.+)\.$/, (m) => `سایت پاسخ ${m[1]} برگرداند.`],
  [/^Expected (\d+) embeddings, received (\d+)\.$/, (m) => `انتظار ${m[1]} Embedding می‌رفت اما ${m[2]} دریافت شد.`],
  [/^Generation failed: (.+)$/, (m) => `تولید پاسخ ناموفق بود: ${m[1]}`],
  [/^(.+) is not connected, so no generation call was made\. This answer is assembled directly from the retrieved passages\.$/, (m) => `${m[1]} متصل نیست، پس فراخوانی تولید پاسخ انجام نشد. این پاسخ مستقیماً از قطعه‌های بازیابی‌شده ساخته شده است.`],
  [/^(.+) is not a supported file type\. Upload PDF, DOCX, plain text, Markdown, CSV, JSON, YAML or HTML — or paste the text with “?"?Add text"?”?\.$/, (m) => `«${m[1]}» نوع فایل پشتیبانی‌شده نیست. فایل PDF، DOCX، متن ساده، Markdown، CSV، JSON، YAML یا HTML بارگذاری کنید، یا متن را با «افزودن متن» بچسبانید.`],
  [/^No readable text was found in (.+)\.$/, (m) => `در «${m[1]}» متن قابل خواندنی پیدا نشد.`],

  // activity feed
  [/^Assistant [“"](.+)[”"] created$/, (m) => `دستیار «${m[1]}» ساخته شد`],
  [/^Assistant [“"](.+)[”"] updated$/, (m) => `دستیار «${m[1]}» به‌روزرسانی شد`],
  [/^Assistant [“"](.+)[”"] deleted$/, (m) => `دستیار «${m[1]}» حذف شد`],
  [/^Assistant [“"](.+)[”"] duplicated from [“"](.+)[”"]$/, (m) => `دستیار «${m[1]}» از روی «${m[2]}» کپی شد`],
  [/^Knowledge base [“"](.+)[”"] created$/, (m) => `پایگاه دانش «${m[1]}» ساخته شد`],
  [/^Knowledge base [“"](.+)[”"] deleted$/, (m) => `پایگاه دانش «${m[1]}» حذف شد`],
  [/^Document [“"](.+)[”"] added$/, (m) => `سند «${m[1]}» اضافه شد`],
  [/^Document [“"](.+)[”"] deleted$/, (m) => `سند «${m[1]}» حذف شد`],
  [/^All documents removed from [“"](.+)[”"]$/, (m) => `همهٔ اسناد «${m[1]}» حذف شد`],
  [/^Workspace [“"](.+)[”"] created$/, (m) => `فضای کاری «${m[1]}» ساخته شد`],
  [/^[“"](.+)[”"] indexed$/, (m) => `«${m[1]}» ایندکس شد`],
  [/^[“"](.+)[”"] failed to index$/, (m) => `ایندکس «${m[1]}» ناموفق بود`],
  [/^Playground query on [“"]?(.+?)[”"]?$/, (m) => `پرس‌وجو در محیط آزمایش روی «${m[1]}»`],
  [/^"RAG configuration guide" indexed$/, () => "«راهنمای پیکربندی RAG» ایندکس شد"],
  [/^(\d+) documents indexed across (\d+) knowledge bases$/, (m) => `${m[1]} سند در ${m[2]} پایگاه دانش ایندکس شد`],
];

function translateCore(text: string): string | null {
  const exact = FA.get(text);
  if (exact !== undefined) return exact;

  for (const [re, fn] of RULES) {
    const m = text.match(re);
    if (m) return fn(m);
  }

  // "a · b · c" — translate each segment independently.
  if (text.includes(" · ")) {
    const parts = text.split(" · ");
    let changed = false;
    const out = parts.map((p) => {
      const t = translateCore(p.trim());
      if (t !== null) changed = true;
      return t ?? p;
    });
    if (changed) return out.join(" · ");
  }

  // "12 passages", "3 active", "45% share" — number followed by a unit noun.
  const num = text.match(/^(~?[\d.,]+%?) (.+)$/);
  if (num) {
    const unit = UNITS[num[2]!] ?? FA.get(num[2]!);
    if (unit) return `${num[1]} ${unit}`;
  }

  // Compact / bare numbers: "42", "1.2K", "87%".
  if (/^~?[\d.,]+[KMB]?%?$/.test(text)) return text;

  return null;
}

/** Final typography pass for strings the translator produced. */
function finish(text: string): string {
  return faPercent(faDigits(text))
    .replace(/[“"]([^“”"]+)[”"]/g, "«$1»");
}

/**
 * Translates one complete UI string from English to Persian.
 * Returns the input unchanged when it is not a known UI string, so user
 * content (names, documents, chat messages) is never altered.
 */
export function translateFa(input: string): string {
  const text = input.replace(/\s+/g, " ").trim();
  if (!text) return input;
  if (/[\u0600-\u06FF]/.test(text)) return input; // already Persian
  const out = translateCore(text);
  if (out === null) return input;
  const result = finish(out);
  if (result === text) return input;
  const lead = input.match(/^\s*/)![0];
  const trail = input.match(/\s*$/)![0];
  return lead + result + trail;
}
