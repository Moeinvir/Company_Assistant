# ⚡ Parsis Bridge

**Parsis Bridge** یک پلتفرم ساخت و مدیریت دستیارهای هوش مصنوعی (AI Assistants) است؛
با هویت بصری «آتش‌شده» 🔥 — رابط کاربری React + TypeScript، بک‌اند NestJS + PostgreSQL و
قابلیت اجرای کامل به‌صورت **PWA قابل نصب و آفلاین**.

---

## ✨ امکانات

| ویژگی | توضیح |
| --- | --- |
| 🤖 **دستیارها** | ساخت، ویرایش، تکثیر و مدیریت دستیارها با System Prompt، مدل و تنظیمات RAG |
| 📚 **پایگاه دانش** | آپلود فایل (PDF/DOCX/TXT)، افزودن متن یا URL؛ استخراج متن، chunking و ساخت ایندکس برداری |
| 🧩 **ویجت توکار** | کد embed آماده (`public/embed.js`) برای نمایش دستیار روی هر سایت |
| 🔑 **کلیدهای Provider** | ذخیره‌سازی رمزنگاری‌شده (AES-256-GCM) کلیدهای OpenAI/Anthropic/… در بک‌اند |
| 📊 **آنالیتیکس** | رویدادهای مصرف، تأخیر، توکن‌ها و نمودارهای فعالیت |
| 👥 **Workspace و اعضا** | نقش‌های Owner/Admin/Member و جداسازی کامل داده بین Workspaceها |
| 📱 **PWA** | نصب‌پذیر، با Service Worker و شل آفلاین (manifest + icons + sw) |
| 🌐 **دوزبانه** | موتور i18n داخلی با پشتیبانی فارسی/انگلیسی (`src/i18n`) |
| 🔀 **دو حالت Backend** | `LocalBackend` دمو (کاملاً درون مرورگر) یا `HttpClient` متصل به REST API |

---

## 🏗 معماری

```
┌──────────────────────────────┐         ┌──────────────────────────────┐
│        Frontend (Vite)       │  REST   │        API (NestJS)          │
│  React 19 · Router · Zustand │ ◀──────▶│  Auth · WS · KB · Providers  │
│  PWA · i18n · LocalBackend   │  JWT    │  Analytics · Conversations   │
└──────────────────────────────┘         └──────────────┬───────────────┘
                                                        │ Prisma
                                                ┌───────▼────────┐
                                                │  PostgreSQL 16 │
                                                └────────────────┘
```

- **فرانت‌اند:** React 19 + Vite 7 + Tailwind CSS 4، آیکون‌ها با lucide-react، نمودارها با recharts.
- **دروازه API:** [src/lib/api/client.ts](src/lib/api/client.ts) تنها نقطه اتصال UI به داده است؛
  بسته به وجود `VITE_PYRE_API_URL` یا `LocalBackend` آفلاین یا `HttpClient` را انتخاب می‌کند.
- **بک‌اند:** NestJS 11 با ماژول‌های `auth`، `workspaces`، `assistants`، `knowledge`،
  `providers`، `conversations`، `analytics` و `health` (در [backend/src](backend/src)).
- **دیتابیس:** PostgreSQL با Prisma ORM — اسکیمای کامل در [backend/prisma/schema.prisma](backend/prisma/schema.prisma).

---

## 🚀 شروع سریع (Docker)

ساده‌ترین راه اجرای کل پلتفرم — frontend، API و PostgreSQL — با یک دستور:

```bash
docker compose up -d --build
```

سپس:

- **App:** http://localhost:8080
- **API:** http://localhost:3000/health
- **پایگاه داده:** `localhost:5432` (کاربر `pyre` / دیتابیس `pyre`)

یک `.env` نمونه هم کنار compose قرار دارد:

```bash
cp .env.docker.example .env   # و مقادیر JWT_SECRET و ... را تغییر دهید
```

> برای متوقف‌کردن: `docker compose down` (برای پاک‌کردن داده‌ها: `docker compose down -v`)

---

## 🛠 توسعه محلی (بدون Docker)

### 1) فرانت‌اند

```bash
npm install
npm run dev          # http://localhost:5273
```

### 2) بک‌اند + دیتابیس

```bash
cd backend
cp .env.example .env   # JWT_SECRET و PROVIDER_KEYS_ENCRYPTION_SECRET را با مقادیر تصادفی ≥32 کاراکتر تنظیم کنید
docker compose up -d postgres
npm install
npm run prisma:generate
npm run prisma:migrate -- --name initial
npm run start:dev      # http://localhost:3000
```

### 3) اتصال فرانت‌اند به بک‌اند

در ریشه پروژه یک `.env` بسازید:

```env
VITE_PYRE_API_URL=http://localhost:3000
```

اگر این متغیر تنظیم نشود، فرانت‌اند به‌صورت خودکار از `LocalBackend` (حالت دمو آفلاین برای
گوشی داده در localStorage) استفاده می‌کند.

---

## 🐳 محیط‌های اجرا

| محیط | دستور | توضیح |
| --- | --- | --- |
| Docker (all-in-one) | `docker compose up -d --build` | Frontend + API + Postgres |
| فقط Postgres برای dev | `docker compose -f backend/docker-compose.yml up -d postgres` | قدیمی‌تر، نگهداری schema با migrate دستی |
| Frontend dev | `npm run dev` | HMR، بدون backend |
| Backend dev | `npm run dev:backend` | Nest watch mode |
| Build production | `npm run build` + `npm run build:backend` | خروجی `dist/` و `backend/dist/` |

---

## 📦 ساختار پروژه

```
parsis-bridge/
├── src/                      # فرانت‌اند (React + Vite)
│   ├── pages/                # صفحات (Assistants, Knowledge, Playground, Integrations, ...)
│   ├── features/assistant/   # UI ساخت/ویرایش دستیار
│   ├── lib/api/              # کلاینت API (LocalBackend / HttpClient) + types
│   ├── lib/rag/              # chunking و بردار (vectorStore)
│   ├── i18n/                 # موتور ترجمه فارسی/انگلیسی
│   └── store/                # Zustand stores (session, toast, workspaceData)
├── backend/                  # NestJS API
│   ├── src/{auth,workspaces,assistants,knowledge,providers,conversations,analytics}
│   └── prisma/               # اسکیما + migrationها
├── public/                   # آیکون‌های PWA، embed.js، manifest.webmanifest
├── docs/                     # راهنمای کامل و معماری
├── Dockerfile                # فرانت‌اند (Nginx)
├── docker-compose.yml        # Stack کامل
└── backend/Dockerfile        # API (multi-stage Node)
```

---

## 📚 مستندات بیشتر

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — معماری فنی، ساختار داده و جریان‌ها
- [docs/API.md](docs/API.md) — مرجع اندپوینت‌های REST
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — استقرار، متغیرهای محیطی و نکات نگهداری
- [backend/README.md](backend/README.md) — راه‌اندازی سریع بک‌اند

---

## 🔥 هویت بصری

رنگ برند (نارنجی سوخته `#ff7a18` روی زمینه تیره) در [src/styles/globals.css](src/styles/globals.css)
تعریف شده است؛ لوگو و مسک آیکون در [public/icons](public/icons) و منبع SVG لوگو
[public/icons/icon.svg](public/icons/icon.svg) قابل بازتولید با
`node scripts/generate-icons.mjs`.

---

## License

MIT
