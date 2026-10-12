# مرجع API — Parsis Bridge

بک‌اند روی `http://localhost:3000` (قابل تغییر با `PORT`) گوش می‌دهد. همه مسیرها
(except `/health` و widget endpoints عمومی) به یک **Bearer token** نیاز دارند که
از ورود/ثبت‌نام به دست می‌آید.

- Content-Type: `application/json`
- مشترک: `Authorization: Bearer <jwt>`
- پاسخ اعتبارسنجی ناموفق: `400` با جزئیات `class-validator`
- پاسخ احراز هویت ناموفق: `401 Unauthorized`

---

## Health

### `GET /health`
```json
{ "status": "ok" }
```

---

## Auth

### `POST /auth/signup`
```json
{ "name": "Sara", "email": "sara@example.com", "password": "at-least-8-chars" }
```
**200** → `AuthResult` (token, session.user, workspace پیش‌فرض، فهرست workspaces).
خطای ایمیل تکراری → `409`.

### `POST /auth/signin`
```json
{ "email": "sara@example.com", "password": "at-least-8-chars" }
```
اعتبارنامه غلط → `401`.

### `POST /auth/restore` · `POST /auth/signout`
بازیابی session با توکن موجود / باطل‌کردن session (حذف رکورد `Session`).

---

## Workspaces

| متد | مسیر | توضیح |
| --- | --- | --- |
| GET | `/workspaces` | workspaces کاربر (با نقش او) |
| POST | `/workspaces` | ایجاد `{ name, plan? }` |
| PATCH | `/workspaces/:id` | تغییر نام/plan (owner/admin) |
| DELETE | `/workspaces/:id` | حذف + cascade کامل (owner) |
| GET | `/workspaces/:id/members` | اعضا + نقش‌ها |

---

## Assistants

| متد | مسیر | توضیح |
| --- | --- | --- |
| GET/POST | `/workspaces/:workspaceId/assistants` | فهرست / ایجاد با `AssistantDraft` |
| GET/PATCH/DELETE | `/assistants/:id` | جزئیات / ویرایش / حذف |
| POST | `/assistants/:id/duplicate` | کپی کامل شامل prompt و تنظیمات RAG/Widget |

`AssistantDraft` شامل: `name`, `description`, `systemPrompt`, `model`, `tone`,
`embedding`, `rag`, `widget` (بخش‌های JSON — ساختار دقیق در [src/lib/api/types.ts](../src/lib/api/types.ts)).

---

## Knowledge Bases & Documents

| متد | مسیر | توضیح |
| --- | --- | --- |
| GET/POST | `/workspaces/:workspaceId/knowledge` | فهرست / ایجاد KB |
| PATCH/DELETE | `/knowledge/:id` | ویرایش / حذف KB |
| GET | `/knowledge/:id/documents` | متادیتای اسناد |
| POST | `/knowledge/:id/documents/text` | افزودن متن خام |
| POST | `/knowledge/:id/documents/file` | افزودن فایل / URL |
| PATCH | `/documents/:id` | ویرایش نام/محتوا (reindex) |
| GET | `/documents/:id/content` | متن کامل استخراج‌شده |
| DELETE | `/documents/:id` / `/knowledge/:id/documents` | حذف یکی / همه |
| POST | `/knowledge/:id/reindex` | ساخت مجدد ایندکس با embedding جدید |
| POST | `/assistants/:id/bind` | چسباندن/جداکردن KB به دستیار |

## Providers (کلیدهای API)

| متد | مسیر | توضیح |
| --- | --- | --- |
| GET | `/workspaces/:workspaceId/providers` | فقط `maskedKey` + وضعیت |
| PUT | `/workspaces/:workspaceId/providers/:provider` | ذخیره کلید (AES-256-GCM)؛ `baseUrl` اختیاری |
| DELETE | `.../providers/:provider` | حذف کلید |
| POST | `.../providers/:provider/verify` | ثبت نتیجه تست (`ok`, `message`) |

`provider` یکی از شناسه‌های [ProviderId](../src/lib/api/types.ts) است.

## Conversations

| متد | مسیر | توضیح |
| --- | --- | --- |
| GET | `/workspaces/:workspaceId/conversations` | فهرست (assistantId اختیاری) |
| GET | `/conversations/:id/messages` | پیام‌ها |
| DELETE | `/workspaces/:workspaceId/conversations` | پاک‌کردن تاریخچه |

## Analytics

| متد | مسیر | توضیح |
| --- | --- | --- |
| GET | `/workspaces/:workspaceId/analytics/overview?range=7d` | UsageEvent/Activity خلاصه |
| GET | `/workspaces/:workspaceId/analytics/activity?limit=50` | فهرست فعالیت‌ها |

## Widget (عمومی — بدون Authorization)

| متد | مسیر | توضیح |
| --- | --- | --- |
| GET | `/widget/:publicKey/config` | تنظیمات ویجت + hints |
| POST | `/widget/:publicKey/query` | پرسش مهمان؛ `{ response, conversationId }` |

> این دو اندپوینت فقط با `publicKey` کار می‌کنند و هیچ داده‌ی حساسی
> (کلیدها، prompts داخلی) را لو نمی‌دهند.

---

## قواعد عمومی

- اکثر فراخوانی‌ها نسخه به‌روزشده رکورد را برمی‌گردانند (چرخه باز در UI ساده).
- خطاهای workspace-scoped بدون عضویت: `404 Workspace not found` (نمایش 403 اجتناب می‌شود تا وجود فضای کاری دیگران لو نرود).
- pagination فعلاً ساده است؛ برای فهرست‌های بزرگ، limit/offset در roadmap است.
