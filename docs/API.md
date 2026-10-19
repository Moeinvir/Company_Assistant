# مرجع API — Parsis Bridge

بک‌اند روی `http://localhost:3000` گوش می‌دهد (قابل تغییر با `API_PORT`/`PORT`).
همهٔ مسیرها به یک **Bearer token** نیاز دارند، به‌جز:

- `GET /health`
- `GET /public/widget/:publicKey` و `POST /public/widget/:publicKey/query`
  (عمومی؛ فقط با `publicKey` کار می‌کنند)

- Content-Type: `application/json`
- هدر مشترک: `Authorization: Bearer <jwt>`
- پاسخ اعتبارسنجی ناموفق: `400` با جزئیات `class-validator`
- پاسخ احراز هویت ناموفق: `401 Unauthorized`
- عضویت نداشتن در ورک‌اسپیس: `404` (نه `403`، تا وجود فضای کاری دیگران لو نرود)

---

## Health

### `GET /health`
```json
{ "status": "ok" }
```

---

## Auth

| متد | مسیر | توضیح |
| --- | --- | --- |
| POST | `/auth/sign-up` | `{ name, email, password }` → `AuthResult`؛ ایمیل تکراری `409` |
| POST | `/auth/sign-in` | `{ email, password }`؛ اعتبارنامه غلط `401` |
| GET | `/auth/session` | بازیابی session با توکن فعلی |
| POST | `/auth/sign-out` | باطل‌کردن session |
| PATCH | `/auth/profile` | `{ name?, image? }` — نام نمایشی و تصویر پروفایل |

`AuthResult` = `{ session: { token, expiresAt, user }, workspace, workspaces }`.

---

## Workspaces

| متد | مسیر | توضیح |
| --- | --- | --- |
| GET | `/workspaces` | workspaces کاربر (با نقش او) |
| POST | `/workspaces` | ایجاد `{ name, plan? }` |
| PATCH | `/workspaces/:workspaceId` | تغییر نام/plan |
| DELETE | `/workspaces/:workspaceId` | حذف + cascade کامل (فقط owner) |
| GET | `/workspaces/:workspaceId/members` | اعضا + نقش‌ها |
| GET | `/workspaces/:workspaceId/events` | کانال SSE تغییرات (`?token=` چون EventSource هدر نمی‌فرستد) |
| POST | `/workspaces/sample-data/clear` | حذف فقط رکوردهای `isSample` (محتوا و اسناد دست‌نخورده می‌مانند) |

---

## Assistants

| متد | مسیر | توضیح |
| --- | --- | --- |
| GET | `/assistants?workspaceId=…` | فهرست + `knowledgeBaseIds` + `stats` زنده |
| GET | `/assistants/:assistantId` | جزئیات |
| POST | `/assistants` | ایجاد؛ بدنهٔ `AssistantDraft` + `workspaceId` |
| PATCH | `/assistants/:assistantId` | ویرایش بخشی |
| POST | `/assistants/:assistantId/duplicate` | کپی کامل (prompt، RAG، widget، اتصال KB) |
| DELETE | `/assistants/:assistantId` | حذف |

`AssistantDraft` شامل `name`، `description`، `status`، `systemPrompt`، `model`،
`tone`، `embedding`، `rag`، `widget`، `knowledgeBaseIds` است. ساختار دقیق هرکدام در
[src/lib/api/types.ts](../src/lib/api/types.ts).

`stats` شمارشی زنده است که از رکوردهای واقعی ساخته می‌شود:
`{ conversations, messages, tokensUsed, avgLatencyMs, lastActivityAt }`.

---

## Knowledge Bases و Documents

| متد | مسیر | توضیح |
| --- | --- | --- |
| GET | `/knowledge-bases?workspaceId=…` | فهرست + `documentCount` + `chunkCount` |
| POST | `/knowledge-bases` | ایجاد `{ workspaceId, name, description }` |
| PATCH | `/knowledge-bases/:knowledgeBaseId` | ویرایش نام/توضیح |
| DELETE | `/knowledge-bases/:knowledgeBaseId` | حذف KB (اسناد و قطعه‌ها cascade) |
| GET | `/knowledge-bases/:knowledgeBaseId/documents` | متادیتای اسناد |
| POST | `/knowledge-bases/:knowledgeBaseId/documents/text` | `{ name, content, embedding }` |
| POST | `/knowledge-bases/:knowledgeBaseId/documents/file` | `{ file: { name, size, type, text }, embedding }` |
| POST | `/knowledge-bases/:knowledgeBaseId/documents/url` | `{ url, embedding }` — متن در سرور fetch می‌شود |
| POST | `/knowledge-bases/:knowledgeBaseId/reindex` | ایندکس مجدد همهٔ اسناد با `embedding` جدید |
| PATCH | `/documents/:documentId` | ویرایش نام/محتوا/embedding (سند دوباره ایندکس می‌شود) |
| GET | `/documents/:documentId/content` | متن کامل استخراج‌شده |
| DELETE | `/documents/:documentId` | حذف یک سند (قطعه‌ها cascade) |
| DELETE | `/knowledge-bases/:knowledgeBaseId/documents` | حذف همهٔ اسناد یک KB |

### چرخهٔ ایندکس‌گذاری

آپلود بلافاصله پاسخ می‌دهد و سند با وضعیت `queued` برمی‌گردد. ایندکس‌گذاری در
پس‌زمینه انجام می‌شود و وضعیت از این نردبان می‌گذرد:

```
queued → processing → chunking → embedding → indexing → indexed
                                                        ↘ failed (با `error`)
```

هر تغییر وضعیت روی کانال SSE (`documents.changed`) منتشر می‌شود، بنابراین UI بدون
polling به‌روز می‌شود.

`embedding` یک شیء است:

```json
{ "provider": "local", "model": "pyre-hash-384", "dimensions": 384,
  "chunkSize": 900, "chunkOverlap": 150 }
```

- `provider: "local"` یعنی embedder درون‌ساخت (`pyre-hash-384`) که بدون کلید و بدون
  شبکه کار می‌کند؛ همان تابعی که مرورگر استفاده می‌کند، پس امتیازها در هر دو طرف
  قابل‌مقایسه‌اند.
- برای ارائه‌دهندهٔ دیگر، کافی است کلید ورک‌اسپیس ذخیره شده باشد و endpoint
  سازگار با OpenAI (`POST /embeddings`) داشته باشد: `openai`, `mistral`, `groq`,
  `openrouter`, `custom`. ارائه‌دهندهٔ پشتیبانی‌نشده سند را با پیام گویا `failed`
  می‌کند (به‌جای نوشتن ایندکسی که قابل جست‌وجو نیست).

---

## Playground (با احراز هویت)

| متد | مسیر | توضیح |
| --- | --- | --- |
| POST | `/playground/query` | `QueryRequest` → `QueryResponse` (بازیابی + تولید پاسخ) |
| POST | `/playground/search` | `SearchRequest` → فقط بازیابی، بدون فراخوانی مدل |

```json
{ "assistantId": "asst_…", "question": "شرایط بازگشت کالا چیست؟",
  "history": [{ "role": "user", "content": "…" }],
  "topKOverride": 4, "scoreThresholdOverride": 0.2,
  "strategyOverride": "hybrid", "temperatureOverride": 0.2 }
```

بدون کلید ارائه‌دهنده، پاسخ **extractive** است: از متن قطعه‌های بازیابی‌شده ساخته
می‌شود و در `message.meta.notes` صریحاً گفته می‌شود که هیچ فراخوانی مدلی انجام نشده.
هر فراخوانی یک ردیف `UsageEvent` ثبت می‌کند که صفحهٔ آنالیتیکس و `stats` دستیار
از آن ساخته می‌شوند.

---

## Providers (کلیدهای API و پروکسی ارائه‌دهنده)

| متد | مسیر | توضیح |
| --- | --- | --- |
| GET | `/provider-keys?workspaceId=…` | فقط `maskedKey` + وضعیت (کلید خام هرگز برنمی‌گردد) |
| POST | `/provider-keys` | ذخیره کلید (AES-256-GCM)؛ `{ workspaceId, provider, apiKey?, baseUrl? }` |
| DELETE | `/provider-keys/:provider?workspaceId=…` | حذف کلید |
| GET | `/provider-keys/:provider/models?workspaceId=…&baseUrl=…` | فهرست مدل‌های واقعی همان حساب |
| POST | `/provider-keys/:provider/check` | تست اتصال؛ `apiKey` اختیاری (تست کلید هنوز ذخیره‌نشده) |
| POST | `/provider-keys/:provider/chat` | تکمیل گفتگو در سمت سرور (کلید از سرور خوانده می‌شود) |
| POST | `/provider-keys/:provider/verify` | ثبت نتیجهٔ تست روی ردیف ذخیره‌شده (`ok`, `message`) |

`provider` یکی از شناسه‌های
[ProviderId](../src/lib/api/types.ts) است (`openai`، `anthropic`، `google`، `mistral`،
`groq`، `openrouter`، `ollama`، `cohere`، `voyage`، `local`، `custom`).

نمونهٔ `chat`:

```json
{
  "workspaceId": "ws_…",
  "model": "openai/gpt-4.1-mini",
  "messages": [{ "role": "user", "content": "سلام" }],
  "temperature": 0.2,
  "maxTokens": 512
}
```

پاسخ: `{ text, promptTokens, completionTokens, model, finishReason }`.

نکته‌های امنیتی و خطاها:

- کلید همیشه روی سرور می‌ماند؛ `chat` هیچ کلیدی از کلاینت نمی‌پذیرد و مقدار کلید در
  URL یا لاگ قرار نمی‌گیرد.
- خطاهای بالادستی با `upstreamStatus` و پیام امن برمی‌گردند؛ متن خطای ارائه‌دهنده قبل از
  بازگشت از کلید پاک‌سازی می‌شود (`502` برای خطای ارائه‌دهنده، `400` برای ورودی ناقص).
- `baseUrl` سفارشی اعتبارسنجی می‌شود: فقط `http/https`، بدون کاربر/رمز داخل URL و بدون
  آدرس‌های metadata ابری (`169.254.169.254`). لوکال‌هاست برای Ollama و گیت‌وی‌های
  self-hosted مجاز است.

---

## Conversations

| متد | مسیر | توضیح |
| --- | --- | --- |
| GET | `/conversations?workspaceId=…&assistantId=…` | فهرست (حداکثر ۱۰۰، جدیدترین اول) |
| GET | `/conversations/:conversationId/messages` | پیام‌ها |
| DELETE | `/conversations?workspaceId=…` | پاک‌کردن تاریخچه |

---

## Analytics

| متد | مسیر | توضیح |
| --- | --- | --- |
| GET | `/analytics/overview?workspaceId=…&range=7d\|30d\|90d` | `AnalyticsSnapshot` از داده‌های ثبت‌شده |
| GET | `/analytics/activity?workspaceId=…&limit=20` | فهرست فعالیت‌ها |

`totals` شامل `queries`, `tokens`, `documentsIndexed`, `conversations`, `errors`,
`avgLatencyMs`, `p95LatencyMs`, `avgRetrieved`, `groundRate` است و به‌همراه
`series` روزانه، `byProvider`، `byAssistant`، `latencyBuckets` و `topQueries`
از `UsageEvent`، `Document` و `Conversation` ساخته می‌شود. مقدار صفر یعنی واقعاً
اتفاقی نیفتاده — هیچ عدد نمایشی/ساختگی وجود ندارد.

---

## Widget (عمومی — بدون Authorization)

| متد | مسیر | توضیح |
| --- | --- | --- |
| GET | `/public/widget/:publicKey` | `PublicWidgetConfig` شامل `widget`, `hints`, `documentCount` |
| POST | `/public/widget/:publicKey/query` | `{ question, conversationId? }` → `{ response, conversationId }` |

- کلید عمومی فقط و فقط یک دستیار را مشخص می‌کند؛ یک پرسش تنها KBهای متصل به همان
  دستیار و در همان ورک‌اسپیس را می‌خواند.
- یک `conversationId` فقط وقتی پذیرفته می‌شود که به همان دستیار و کانال `widget`
  تعلق داشته باشد؛ شناسهٔ حدسی نمی‌تواند گفتگوی دیگری را بخواند یا ادامه دهد.
- کلید ناشناس → `404`، ویجت خاموش یا دستیار غیرفعال → `403` با پیام قابل‌نمایش.
- مسیر iframe در فرانت: `/widget/:publicKey` (فایل `public/embed.js` همین را بار می‌کند).

---

## قواعد عمومی

- اکثر فراخوانی‌ها نسخهٔ به‌روزشدهٔ رکورد را برمی‌گردانند (چرخهٔ باز در UI ساده).
- خطاهای workspace-scoped بدون عضویت: `404 Workspace not found`.
- pagination فعلاً ساده است؛ برای فهرست‌های بزرگ، limit/offset در roadmap است.
