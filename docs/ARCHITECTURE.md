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
| `LocalBackend` | [src/lib/api/localBackend.ts](../src/lib/api/localBackend.ts) | پیش‌فرض — کل مدل داده درون مرورگر (localStorage). اپ در حالت دمو بدون هیچ سروری کار می‌کند وindexed قابل نصب PWA است |
| `HttpClient` | [src/lib/api/httpClient.ts](../src/lib/api/httpClient.ts) | وقتی `VITE_PYRE_API_URL` تعریف شده باشد. همان متدها به REST اندپوینت‌های NestJS مپ می‌شوند |

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
├── lib/rag/          # chunking و vectorStore (حالت دمو از hash-embedding 384 بعدی استفاده می‌کند)
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
| `providers` | ذخیره رمزنگاری‌شده کلیدهای ارائه‌دهنده (AES-256-GCM + authTag) |
| `conversations` | خواندن/پاک‌کردن تاریخچه گفتگو |
| `analytics` | رویدادهای مصرف و فعالیت برای داشبورد |

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

---

## مدل داده

اسکیما در [backend/prisma/schema.prisma](../backend/prisma/schema.prisma):

```
User ──< Membership >── Workspace
Workspace ──< Assistant ──< AssistantKnowledgeBase >── KnowledgeBase ──< Document
Workspace ──< ProviderCredential · ActivityEvent · UsageEvent · Conversation ──< Message
User ──< Session
```

- **تک‌کاربره‌بودن داده:** همه رکوردهای دامنه ریشه `workspaceId` دارند؛ حذف Workspace با
  `onDelete: Cascade` همه‌چیز را پاک می‌کند.
- **متن سند** فعلاً در ستون `content` جدول `Document` (`@db.Text`) ذخیره می‌شود؛ برای
  مقیاس بزرگ باینری‌ها به object storage منتقل شوند و ایندکس چانک به جدول برداری مخصوص
  (مثلاً pgvector) برود.
- `Assistant.model/tone/embedding/rag/widget/stat` به‌عنوان `Json` نگهداری می‌شوند تا
  توسعه تنظیمات فرم‌محور بدون migration انجام شود.

---

## جریان‌های کلیدی

### پردازش سند (حالت دمو)
```
File/URL/Text ─▶ extract (pdf.js · mammoth) ─▶ chunk ─▶ hash-embedding (384d)
             ─▶ vectorStore.local ─▶ Document(status=indexed) + رویداد documents.changed
```

### یک پرسش Playground
```
Question ─▶ embedder ─▶ vectorStore.search(topK) ─▶ بازسازی prompt
         ─▶ provider call (کلید client-side در دمو / proxy در استقرار واقعی)
         ─▶ پاسخ + رویداد UsageEvent (latency, tokens, topScore)
```

### ویجت توکار
```
<script src="/embed.js" data-key="publicKey">  →  iframe/شادو روت
   └─ GET widget.config(publicKey)   (بدون session)
   └─ POST widget.query(publicKey,q)
```

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

- ورکر ناهمگام استخراج/ایندکس‌سازی و اندپوینت‌های provider-backed playground
  هنوز در بک‌اند پیاده نشده‌اند (اسناد با وضعیت `queued` ذخیره می‌شوند).
- پیاده‌سازی `HttpClient` برای برخی اندپوینت‌های پیشرفته‌تر (embed worker، streaming)
  قابل تکمیل است؛ رابط `ApiClient` برای این توسعه‌ها آماده است.
- توزیع چانک‌ها بین Postgres و vector store در حالت HTTP باید در سمت API تکمیل شود.
