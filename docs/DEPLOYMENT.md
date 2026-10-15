# استقرار و نگهداری — Parsis Bridge

راهنمای اجرا، استقرار و بهره‌برداری از این پلتفرم.

---

## گزینه ۱: Docker Compose (پیشنهادی)

کل stack — frontend (Nginx)، API (Node 22) و PostgreSQL 16 — با یک دستور بالا می‌آید:

```bash
cp .env.docker.example .env    # مقادیر secret را عوض کنید
docker compose up -d --build
```

| سرویس | آدرس | Health |
| --- | --- | --- |
| Frontend | http://localhost:8080 | — |
| API | http://localhost:3000 | `GET /health` |
| Postgres | `localhost:5432` | `pg_isready` |

migrationها هنگام اتصال به‌صورت خودکار با `prisma migrate deploy` اجرا می‌شوند.
نگهداری داده‌ها در volume `pgdata` است؛ `docker compose down -v` همه‌چیز (شامل داده) را پاک می‌کند.

---

## متغیرهای محیطی

### Frontend ([Dockerfile](../Dockerfile))
| متغیر | معنا |
| --- | --- |
| `VITE_PYRE_API_URL` | آدرس API که فرانت به آن وصل می‌شود. اگر خالی باشد حالت دمو آفلاین فعال می‌شود. |

> این متغیر در زمان **build** bake می‌شود — اگر فایل `.env` را تغییر دادید،
> image را دوباره build کنید.

### API ([backend/Dockerfile](../backend/Dockerfile))
| متغیر | الزامی | معنا |
| --- | --- | --- |
| `DATABASE_URL` | ✅ | اتصال Postgres (`postgresql://…`) |
| `JWT_SECRET` | ✅ | ≥ 32 کاراکتر برای امضای JWT |
| `PROVIDER_KEYS_ENCRYPTION_SECRET` | ✅ | ≥ 32 کاراکتر؛ clave داده‌های AES برای رمز Provider key |
| `WEB_ORIGIN` | ⚪ | لیست originهای مجاز CORS (کاما-جدا). خالی = CORS غیرفعال |
| `PORT` | ⚪ | پیش‌فرض `3000`؛ مقدار export‌شده در محیط هاست بر این فایل اولویت دارد (dotenv مقدار موجود را overwrite نمی‌کند). مقدار غیرعددی یا صفر نادیده گرفته می‌شود |
| `API_PORT` | ⚪ | اختیاری و همیشه بر `PORT` (و مقدار ارثی محیط) اولویت دارد — برای pin کردن پورت در همان `.env` |

⚠️ هر دو secret باید **متفاوت** و تصادفی باشند؛ مثلاً:
```bash
openssl rand -hex 32
```
اگر `PROVIDER_KEYS_ENCRYPTION_SECRET` را بعداً عوض کنید، کلیدهای ذخیره‌شده
دیگر رمزگشایی نمی‌شوند — باید کاربران دوباره کلیدهای Provider را وارد کنند.

---

## اجرا بدون Docker

### Postgres مخصوص dev
```bash
docker compose -f backend/docker-compose.yml up -d postgres
```

### API
```bash
cd backend
cp .env.example .env && # … secrets
npm install
npm run prisma:generate
npm run prisma:migrate -- --name initial
npm run start:dev
```

### Frontend
```bash
npm install
echo "VITE_PYRE_API_URL=http://localhost:3000" > .env
npm run dev                  # http://localhost:5273
npm run build                # خروجی dist/
npm run preview              # serve نسخه build + تست SW
```

---

## استقرار در API واقعی (بدون compose)

- API: `npm run build:backend && npm --prefix backend run start:prod` — با PM2 یا systemd.
- Frontend: خروجی `dist/` روی هر static host؛ بک‌اند را روی مبدأ دیگر گذاشته و
  `VITE_PYRE_API_URL` را به آن نشانه بدهید. حتماً در `WEB_ORIGIN` origin فرانت را اضافه کنید.
- پس از هر تغییر اسکیمای Prisma: `npm run prisma:deploy` (بدون ساخت migration در prod).

---

## PWA در Production

- Service Worker (`public/sw.js`) هنگام build در ریشه `dist/` کپی می‌شود —
  دقت کنید host شما **نسخه‌های آپدیت‌شده** را cache نسازد
  (`Cache-Control: no-cache` برای sw.js و `manifest.webmanifest`)،

  وگرنه کلاینت‌ها گیر نسخه قبلی می‌کنند.
- Cloudflare/Netlify: یک «workers/headers» rule برای این دو فایل کافی است.
- برای iOS: `apple-touch-icon`‌تان یه 180×180 تولیدی سرش آماده است.

---

## Backup و نگهداری

- دیتابیس: `docker compose exec postgres pg_dump -U pyre pyre > backup.sql`
- Restore: `cat backup.sql | docker compose exec -T postgres psql -U pyre pyre`
- فشرده‌سازی دیسک یا rotate volume لازم نیست — حجم نسخه عمدتاً محدود است.
- پاک‌سازی sessionهای منقضی می‌تواند به‌صورت دستی:
  `DELETE FROM "Session" WHERE "expiresAt" < now();`

---

## عیب‌یابی سریع

| علامت | علت احتمالی | راه‌حل |
| --- | --- | --- |
| API بالا نمی‌آید: `JWT_SECRET must be configured` | secret کمتر از ۳۲ کاراکتر | بازنویسی `.env` با مقدار طولانی‌تر |
| فرانت در حالت دمو می‌ماند | `VITE_PYRE_API_URL` در زمان build تنظیم نشده | rebuild با env درست |
| CORS error در کنسول مرورگر | `WEB_ORIGIN` origin فرانت را شامل نمی‌شود | مقدار را با دید گسترده تنظیم کنید |
| خطای Provider: `PROVIDER_KEYS_ENCRYPTION_SECRET must be set…` | secret تنظیم نشده یا کوتاه است | مقدار ≥۳۲ کاراکتر قرار دهید |
| توکن کاربر ناگهان نامعتبر | ابطال session (خروج) | ورود مجدد؛ sessionها ۷ روز اعتبار دارند |
| Migration هنگام بالا آمدن داکر fail می‌شود | Postgres آماده نشده | `depends_on` با healthcheck انجام شده؛ اگر مشکل ادامه داشت یک‌بار restart کنید |
| لاگین با «Failed to fetch» و درخواست به پورت اشتباه | `VITE_PYRE_API_URL` با پورت واقعی API یکی نیست | پورت را از خط `API listening on http://localhost:…` در لاگ بک‌اند بردارید، `.env` فرانت را به همان مقدار اصلاح و dev server را restart کنید |
| API روی پورت تصادفی بالا می‌آید | محیط هاست `PORT=0` (یا غیرعددی) export کرده؛ dotenv مقدار موجود را overwrite نمی‌کند | پورت نامعتبر نادیده گرفته می‌شود و `3000` استفاده می‌شود؛ برای پورت دیگر، `PORT` معتبر در `backend/.env` و همان مقدار در `VITE_PYRE_API_URL` بگذارید |

---

## نکات امنیتی

- هرگز فایل واقعی `.env` را commit نکنید — فقط `.env.example` و `.env.docker.example` مستند شده‌اند.
- ترافیک production حتماً پشت TLS (Nginx/Caddy/Cloudflare) قرار گیرد؛ JWT و کلیدهای Provider روی HTTP خام فاش می‌شوند.
- با استفاده از `WEB_ORIGIN`، CORS را به originهای فرانت محدود کنید (در حالت compose الان همین است).
