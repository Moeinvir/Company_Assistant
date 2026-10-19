# معماری Parsis Bridge

این سند معماری فنی پلتفرم را توضیح می‌دهد: لایه‌ها، جریان داده، مدل امنیتی و تصمیم‌های کلیدی.

---

## نمای کلان

```
┌─────────────────────────────────────────────────────────────────────┐
│                          مرورگر / PWA                               │
│                                                                     │
│  ┌─────────────┐   ┌──────────────────┐   ┌──────────────────────┐  │
│  │  Pages/UI   │──▶│  workspaceData   │──▶│   ApiClient (seam)   │  │
│  │  (React)    │   │  store (Zustand) │   │  LocalBackend │ HTTP │  │
│  └─────────────┘   └──────────────────┘   └──────────┬───────────┘  │
│                                                      │              │
│  ┌──────────────────────────────────────────┐        │              │
│  │  لایه‌های آفلاین: embedder · vectorStore │◀───────┘ (حالت دمو)   │
│  │  i18n · sw.js (PWA)                      │                       │
│  └──────────────────────────────────────────┘                       │
└──────────────────────────────────────┬──────────────────────────────┘
                                       │ REST + JWT (Bearer)
┌──────────────────────────────────────▼──────────────────────────────┐
│                     NestJS API (backend/src)                        │
│                                                                     │
│  auth ─ workspaces ─ assistants ─ knowledge ─ providers             │
│  conversations ─ analytics ─ health                                 │
│                                                                     │
│  AuthGuard (JWT + Session در DB) · ValidationPipe · CORS            │
└──────────────────────────────────────┬──────────────────────────────┘
                                       │ Prisma Client
                              ┌────────▼─────────┐
                              │  PostgreSQL 16   │
                              └──────────────────┘
```

---

## مرز API (The Seam)

قلب معماری فرانت‌اند، [src/lib/api/client.ts](../src/lib/api/client.ts) است؛ یک interface با نام
`ApiClient`. هیچ صفحه‌ای مستقیماً به داده دسترسی ندارد — همه از این مرز عبور می‌کنند و دو پیاده‌سازی دارد:

| پیاده‌سازی | فایل | چه زمانی فعال است |
| --- | --- | --- |
| `LocalBackend` | [src/lib/api/localBackend.ts](../src/lib/api/localBackend.ts) | پیش‌فرض — کل مدل داده درون مرورگر (localStorage). اپ در حالت دمو بدون هیچ سروری کار می‌کند و به‌صورت PWA قابل نصب است |
| `HttpClient` | [src/lib/api/httpClient.ts](../src/lib/api/httpClient.ts) | وقتی `VITE_PYRE_API_URL` تعریف شده باشد. همان متدها به REST اندپوینت‌های NestJS مپ می‌شوند؛ ایندکس، بازیابی و تولید پاسخ همه روی سرور انجام می‌شوند |

قرارداد مشترک:
- هر عملیات به workspace محدود است (`token, workspaceId`).
- هر mutation رکورد به‌روزشده را برمی‌گرداند.
- `subscribe()` رویدادهای سمت سرور (`documents.changed`, `assistants.changed`, ...) را منتشر می‌کند.
- `capabilities` اعتراف صریح هر حالت به محدودیت‌هایش است؛ مثلاً `HttpClient.resolveCredentials`
  عمداً نقشه خالی برمی‌گرداند چون استقرار واقعی نباید کلید Provider را به مرورگر بدهد.

این جداسازی یعنی می‌توان UI را با دروازه دمو توسعه داد و بعد تنها با یک متغیر محیطی به API واقعی وصل کرد.

---

## لایه‌های فرانت‌اند

```
src/
├── pages/            # صفحات مسیرها (lazy-loaded در App.tsx)
├── features/         # کامپوننت‌های دامنه‌ای (assistant builder, playground, ...)
├── components/       # primitives و layout مشترک
├── lib/api/          # دروازه API: client.ts · types.ts · httpClient.ts · localBackend.ts · embedder.ts
├── lib/rag/          # chunking، vectorStore و pipeline بازیابی (حالت دمو از hash-embedding 384 بعدی استفاده می‌کند)
├── i18n/             # موتور ترجمه (engine.ts) + ابزار DOM (dom.ts) — فارسی/انگلیسی
└── store/            # Zustand: session (auth) · workspaceData (کش داده) · toast
```

نکات کلیدی:

- ** state داده در `workspaceData`** متمرکز است و با رویدادهای `subscribe` همگام می‌ماند؛
  صفحات فقط read-only از آن می‌خوانند و mutationها را به کلاینت API پاس می‌دهند.
- **i18n** مستقل از فریم‌ورک است: دیکشنری‌ها lookups کلید-محور دارند و `dom.ts` برای
  رشته‌های خارج از چرخه React (مثل embed.js) استفاده می‌شود.
- **PWA**: [public/sw.js](../public/sw.js) با سه استراتژی کار می‌کند —
  ناوبری network-first با fallback به شل کش‌شده، `/assets/` با stale-while-revalidate،
  و بقیه منابع same-origin با fallback به کش. ثبت آن در [src/main.tsx](../src/main.tsx)
  فقط در build تولیدی انجام می‌شود تا HMR در dev مزاحم نشود.

---

## لایه‌های بک‌اند

ماژول‌ها در [backend/src](../backend/src) — هرکدام controller + service + DTO مستقل:

| ماژول | مسئولیت |
| --- | --- |
| `auth` | ثبت‌نام/ورود، JWT + جدول `Session` قابل ابطال، `AuthGuard` |
| `workspaces` | CRUD فضای کاری، اعضا و نقش‌ها |
| `assistants` | CRUD دستیار + duplicate؛ مدل/tone/embedding/rag/widget به صورت JSON |
| `knowledge` | CRUD پایگاه دانش و اسناد، تخصیص KB به دستیار |
| `providers` | ذخیره رمزنگاری‌شده کلیدهای ارائه‌دهنده (AES-256-GCM + authTag) + پروکسی chat/models |
| `rag` | موتور RAG سمت سرور: `IngestionService` (chunk + embed + persisting) و `RetrievalService` (بازیابی + پاسخ grounded) |
| `playground` | اندپوینت‌های تست دستیار روی همان ایندکس ذخیره‌شده |
| `widget` | اندپوینت‌های عمومی ویجت (`/public/widget/...`) بدون session |
| `conversations` | خواندن/پاک‌کردن تاریخچه گفتگو |
| `analytics` | رویدادهای مصرف و فعالیت برای داشبورد، ساخته‌شده از رکوردهای واقعی |
| `events` | کانال SSE تغییرات هر ورک‌اسپیس (`documents.changed`, `assistants.changed`, ...) |

### احراز هویت و مجوز

1. `AuthService` پس از signUp/signIn یک **JWT** می‌سازد (`sub` + `jti`) و یک رکورد `Session`
   با انقضای ۷ روزه در دیتابیس می‌نویسد.
2. [AuthGuard](../backend/src/auth/auth.guard.ts) علاوه بر امضای JWT، **وجود session در DB**
   را هم بررسی می‌کند — پس خروج کاربر (`signOut`) توکن را فوراً باطل می‌کند.
3. هر اندپوینت workspace-scoped، عضویت کاربر را از روی `Membership` بررسی می‌کند
   (`requireWorkspace`) — برخلاف endpointهای عمومی مانند `widget.config` و `widget.query`
   که با `publicKey` کار می‌کنند.

### رمزنگاری کلیدهای Provider

[providers.service.ts](../backend/src/providers/providers.service.ts) هر کلید API را با
AES-256-GCM رمز می‌کند (کلید مشتق‌شده از `PROVIDER_KEYS_ENCRYPTION_SECRET` با SHA-256)،
همراه `iv` و `authTag` ذخیره می‌کند و در پاسخ‌ها فقط `maskedKey` را برمی‌گرداند.
 چون secret، خارج از دیتابیس از env خوانده می‌شود، لو‌ دادن دیتابیس به‌تنهایی
کلیدها را آشکار نمی‌کند.

### پروکسی ارائه‌دهنده (رفع CORS)

در حالت بک‌اند، هیچ درخواستی به ارائه‌دهنده از مرورگر خارج نمی‌شود؛ مسیر این است:

```
Browser ─▶ POST /provider-keys/:provider/chat ─▶ (کلید رمزگشایی‌شده از DB) ─▶ Provider
        ◀─ { text, promptTokens, completionTokens, model, finishReason } ◀─┘
```

- `GET /provider-keys/:provider/models` هم از همین مسیر مدل‌های واقعی حساب را می‌گیرد
  (OpenRouter و گیت‌وی‌های سازگار با OpenAI)، پس UI مدل‌های در دسترس را نشان می‌دهد.
- `POST /provider-keys/:provider/check` یک کلید تازه‌چسبانده‌شده را هم می‌پذیرد تا
  «تست قبل از ذخیره» بدون خطای «کلید پیدا نشد» کار کند.
- منطق اختصاصی هر vendor (مسیر endpoint، هدرها، شکل payload، نرمال‌سازی پاسخ و ترجمه
  خطا) در [provider-wire.ts](../backend/src/providers/provider-wire.ts) و بدون وابستگی به
  Nest/DB قرار دارد تا مستقیم تست شود؛ [providers.service.ts](../backend/src/providers/providers.service.ts)
  فقط lookup اعتبارنامه + یک `fetch` با timeout است.
- در حالت دمو (بدون `VITE_PYRE_API_URL`) همان کلاینت قبلی مستقیم با مرورگر به ارائه‌دهنده
  وصل می‌شود؛ این حالت صادقانه برای یک اپراتور محلی است، نه یک استقرار چندکاربره.

---

## مدل داده

اسکیما در [backend/prisma/schema.prisma](../backend/prisma/schema.prisma):

```
User ──< Membership >── Workspace
Workspace ──< Assistant ──< AssistantKnowledgeBase >── KnowledgeBase ──< Document ──< DocumentChunk
Workspace ──< ProviderCredential · ActivityEvent · UsageEvent · Conversation ──< Message
User ──< Session
```

- **تک‌کاربره‌بودن داده:** همه رکوردهای دامنه ریشه `workspaceId` دارند؛ حذف Workspace با
  `onDelete: Cascade` همه‌چیز را پاک می‌کند.
- **متن سند** در ستون `content` جدول `Document` (`@db.Text`) ذخیره می‌شود؛ برای
  مقیاس بزرگ باینری‌ها به object storage منتقل شوند.
- **ایندکس بازیابی** در جدول `DocumentChunk` نگهداری می‌شود: متن قطعه + بردار
  L2-normalized (`Float[]`) + `dimensions`. هر سند پارامترهای chunking/embedding خودش را
  روی ردیف دارد، پس یک re-index بازتولیدپذیر است و پرسش می‌تواند بفهمد بردارش با
  قطعه‌های مقابل قابل‌مقایسه هست یا نه. مسیر ارتقا: ستون `vector` با pgvector + ایندکس
  `ivfflat`/`hnsw`.
- `Assistant.model/tone/embedding/rag/widget/stat` به‌عنوان `Json` نگهداری می‌شوند تا
  توسعه تنظیمات فرم‌محور بدون migration انجام شود.

---

## جریان‌های کلیدی

### پردازش سند — سمت سرور (حالت HTTP)
```
File/URL/Text ─▶ POST (content از مرورگر، URL در سرور fetch می‌شود)
              └▶ Document(status=queued) + پاسخ فوری
                 └▶ IngestionService (ناهمگام)
                      chunk ─▶ embed (pyre-hash-384) ─▶ DocumentChunk (متن + بردار)
                      ─▶ Document(status=indexed, chunkCount, indexedAt)
                      ─▶ رویدادهای documents.changed در هر مرحله
```
نردبان وضعیت: `queued → processing → chunking → embedding → indexing → indexed`
(یا `failed` با پیام گویا). جدول `DocumentChunk` با `onDelete: Cascade` به سند وصل است،
پس حذف سند ایندکسش را هم پاک می‌کند.

### پردازش سند (حالت دمو)
```
File/URL/Text ─▶ extract (pdf.js · mammoth) ─▶ chunk ─▶ hash-embedding (384d)
             ─▶ vectorStore.local ─▶ Document(status=indexed) + رویداد documents.changed
```

هر دو مسیر از یک chunker و یک embedder (پورت‌شده در `backend/src/rag/*`) استفاده
می‌کنند، بنابراین امتیازهای بازیابی در دو حالت قابل‌مقایسه‌اند.

### یک پرسش Playground
```
POST /playground/query (یا /public/widget/:key/query برای ویجت)
  └▶ RetrievalService: load assistant ─▶ load DocumentChunk های KBهای متصل
     └▶ embed(query) ─▶ hybrid score (cosine + BM25)
        └▶ prompt بازسازی‌شده ─▶ ProvidersService.chatForWorkspace
           └▶ پاسخ + ResponseMetadata ─▶ UsageEvent (latency, tokens, topScore, query)
```
بدون کلید ارائه‌دهنده، پاسخ **extractive** است و در `meta.notes` صریحاً اعلام می‌شود.

### ویجت توکار
```
<script src="/embed.js" data-assistant="publicKey">  →  iframe روی /widget/:publicKey
   └─ GET  /public/widget/:publicKey        (بدون session)
   └─ POST /public/widget/:publicKey/query  (بدون session؛ conversationId برای ادامه)
```
دسترسی فقط با `publicKey` تعیین می‌شود: یک دستیار، KBهای متصل به خودش، در ورک‌اسپیس
خودش. `conversationId` تنها وقتی پذیرفته می‌شود که به همان دستیار و کانال `widget`
تعلق داشته باشد.

---

## تصمیم‌های طراحی و trade-offها

| تصمیم | چرا |
| --- | --- |
| دو پیاده‌سازی پشت یک interface | UX دمو کامل بدون سرور؛ مهاجرت فقط با یک متغیر env |
| JWT + session table | امکان ابطال فوری توکن‌ها (استاندارد stateless JWT این را نمی‌دهد) |
| کلید Provider رمز شده در DB، هرگز به فرانت نمی‌رسد (حالت HTTP) | اگر DB لو برود کلیدها امن‌اند؛ فرانت فقط maskedKey می‌بیند |
| متن سند داخل PostgreSQL | سادگی dev؛ مسیر ارتقا به object storage + pgvector مستند شده |
| ۀmigration تنظیمات دستیار به JSON | iteration سریع UI بدون قفل‌شدن به schema |
| PWA با شل آفلاین | بعد از اولین بازدید، اپ بدون اینترنت بالا می‌آید (داده دمو ذاتاً محلی است) |

---

## محدودیت‌های شناخته‌شده

- **embedding با ارائه‌دهندهٔ vendor** فقط برای endpointهای سازگار با OpenAI
  (`POST /embeddings`) پیاده شده است: `openai`, `mistral`, `groq`, `openrouter`,
  `custom`. برای بقیه، سند با پیام گویا `failed` می‌شود. در حالت دمو همین محدودیت
  در سمت مرورگر وجود دارد.
- **صف ایندکس‌سازی درون‌پروسه‌ای است** (`IngestionService`). یک نمونهٔ API، یک worker.
  برای چند نمونه، صف باید به یک transport مشترک (مثلاً BullMQ/Redis) منتقل شود؛
  واسط `schedule()` همین جای تعویض است.
- **جست‌وجوی برداری در حافظهٔ برنامه و روی حداکثر ۲۰٬۰۰۰ قطعه در هر پرسش** انجام
  می‌شود (`MAX_SCANNED_CHUNKS`). برای ایندکس بزرگ‌تر، ستون `vector` باید pgvector شود.
- **streaming پاسخ مدل** پیاده نشده است؛ پاسخ کامل برمی‌گردد و UI در یک مرحله
  نمایش می‌دهد.
- **کاربران/نقش‌ها:** دعوت عضو پیاده نشده است؛ نقش‌ها در DB هستند ولی مسیر invite
  وجود ندارد.
- **حذف Workspace هیچ‌گاه با این API انجام نشود بدون تأیید**: cascade کامل است و
  قابل بازگشت نیست.
