# Deploy Wolfpack to the cloud (step by step)

| URL | App | Platform |
|---|---|---|
| https://wolfpackcricket.com | Public site | Vercel |
| https://umpire.wolfpackcricket.com | Umpire pad | Vercel |
| https://api.wolfpackcricket.com | API + live scores | Railway (not Vercel) |
| Neon | Postgres | Neon |

Do **not** put the API on Vercel. Live scoring needs a process that stays online (Socket.IO). Vercel is only for the two websites.

Push this repo to GitHub first (Railway and Vercel deploy from GitHub).

---

## 1. Neon (database)

1. Open [https://console.neon.tech](https://console.neon.tech) and sign in.
2. **New project**
   - Name: `wolfpack`
   - Region: **Singapore** or **Frankfurt** (closest to Pakistan)
3. Open the project → **Dashboard** → copy the connection string.  
   It looks like:
   `postgresql://USER:PASSWORD@ep-xxxx.region.aws.neon.tech/neondb?sslmode=require`
4. Keep that string. You will paste it into Railway as `DATABASE_URL`.

You do **not** create admin passwords by typing into Neon. Seed and Admin UI do that.

---

## 2. Railway (API) — `api.wolfpackcricket.com`

1. Open [https://railway.app](https://railway.app) and sign in with GitHub.
2. **New project** → **Deploy from GitHub repo** → pick this Wolfpack repo.
3. Open the new service → **Settings**
   - **Root directory:** leave empty (repo root)
4. **Settings → Build**
   - Build command:
     ```
     npm install && npx prisma generate --schema backend/prisma/schema.prisma
     ```
5. **Settings → Deploy**
   - Start command:
     ```
     npm run start:api
     ```
6. **Variables** → add:

   | Name | Value |
   |---|---|
   | `DATABASE_URL` | Neon connection string from step 1 |
   | `JWT_SECRET` | a long random string (password manager / 32+ chars) |
   | `CLIENT_ORIGINS` | `https://wolfpackcricket.com,https://www.wolfpackcricket.com,https://umpire.wolfpackcricket.com` |
   | `PORT` | Railway sets this automatically. Do not hardcode 4000. |

7. Deploy. Wait until it is **Online**.
8. Open **Settings → Networking → Custom domain**
   - Domain: `api.wolfpackcricket.com`
   - Railway shows a **CNAME** target (something like `xxxx.up.railway.app`)
9. In your domain registrar (where you bought wolfpackcricket.com), add:

   | Type | Host / Name | Value |
   |---|---|---|
   | CNAME | `api` | the Railway CNAME they showed |

10. Wait for DNS (often 5–30 minutes). In Railway, the domain should show **SSL issued**.
11. Test in a browser:  
    `https://api.wolfpackcricket.com/api/health`  
    You should see `{"ok":true,"name":"Wolfpack Tape Ball League"}`.

### Load the schema and first admin (once)

On your laptop, with the **Neon** URL (not local Docker):

```bash
cd backend
npx prisma db push
npx tsx prisma/seed.ts
```

When prompted, set:

```
DATABASE_URL="postgresql://...neon.tech/neondb?sslmode=require"
```

Or temporarily put the Neon URL in `backend/.env`, run those two commands, then put your local Docker URL back.

Seed creates:

- Admin: `admin@wolfpackcricket.com` / `password123`
- Umpire: `umpire@wolfpackcricket.com` / `password123`
- Tournament, venues, squads — **no matches**

Then change those passwords after first login (or create new users in Admin and stop using the demo ones).

---

## 3. Vercel — public site `wolfpackcricket.com`

1. Open [https://vercel.com](https://vercel.com) and sign in with GitHub.
2. **Add New → Project** → the same GitHub repo.
3. Configure:

   | Setting | Value |
   |---|---|
   | Framework preset | Vite |
   | Root Directory | `web-app` (click Edit) |
   | Include files outside root | **On** (so `@lms/shared` builds) |
   | Install command | `cd .. && npm install` |
   | Build command | `npm run build` |
   | Output directory | `dist` |

4. **Environment variables** (Production):

   | Name | Value |
   |---|---|
   | `VITE_API_URL` | `https://api.wolfpackcricket.com` |

   This must be set **before** the first production build. If you add it later, click **Redeploy**.

5. Deploy.
6. **Settings → Domains** → Add:
   - `wolfpackcricket.com`
   - `www.wolfpackcricket.com`
7. Vercel shows DNS records. At your registrar add **exactly what Vercel shows**, usually:

   | Type | Host | Value |
   |---|---|---|
   | A | `@` | `76.76.21.21` (Vercel will show the current IP) |
   | CNAME | `www` | `cname.vercel-dns.com` |

   Use Vercel’s values if they differ.
8. Wait until both domains show **Valid**. Open https://wolfpackcricket.com

---

## 4. Vercel — umpire site `umpire.wolfpackcricket.com`

1. Vercel → **Add New → Project** → **same repo again**.
2. Configure:

   | Setting | Value |
   |---|---|
   | Framework preset | Vite |
   | Root Directory | `umpire-app` |
   | Include files outside root | **On** |
   | Install command | `cd .. && npm install` |
   | Build command | `npm run build` |
   | Output directory | `dist` |

3. Environment variable:

   | Name | Value |
   |---|---|
   | `VITE_API_URL` | `https://api.wolfpackcricket.com` |

4. Deploy.
5. **Settings → Domains** → add `umpire.wolfpackcricket.com`
6. At your registrar:

   | Type | Host | Value |
   |---|---|---|
   | CNAME | `umpire` | `cname.vercel-dns.com` (or the target Vercel shows) |

7. Open https://umpire.wolfpackcricket.com and log in with the umpire account.

---

## 5. DNS checklist (all in one place)

At the place you bought **wolfpackcricket.com**:

| Type | Host | Points to |
|---|---|---|
| A | `@` | Vercel IP (from public project) |
| CNAME | `www` | Vercel (`cname.vercel-dns.com`) |
| CNAME | `umpire` | Vercel (`cname.vercel-dns.com`) |
| CNAME | `api` | Railway (`xxxx.up.railway.app`) |

Do not create an A record and a CNAME for the same host.

HTTPS: Vercel and Railway issue certificates after DNS is correct. Do not upload your own cert unless they ask.

---

## 6. After it is live

1. https://api.wolfpackcricket.com/api/health → `ok: true`
2. https://wolfpackcricket.com → public scores / gallery
3. https://wolfpackcricket.com/admin → admin login
4. https://umpire.wolfpackcricket.com → scoring pad
5. Create a fixture in Admin, assign the umpire, paste a YouTube link on the pad when you stream.

---

## Images

- Logo: already in each app’s `public/` folder; Vercel ships it.
- Gallery: Admin → Gallery. Small JPEGs (under 2.5 MB) store in Neon. For many large photos later, use Cloudinary and paste the URL instead.
- YouTube: not hosted by you. Umpire pastes the link; the public page embeds it.

---

## 100 fans on a live match

Yes, that is fine on this setup. Railway keeps Socket.IO open; every viewer gets the same score snapshot.

Avoid Render’s **free** web service for the API — it sleeps and live scores freeze. Railway (or Render paid) should stay awake.

---

## Local vs production

| | Local | Production |
|---|---|---|
| Database | Docker Postgres `:5433` | Neon |
| API | `localhost:4000` | `api.wolfpackcricket.com` |
| Sites | `localhost:5173` / `5174` | umpire / www domains |
| `VITE_API_URL` | unset (Vite proxy) | `https://api.wolfpackcricket.com` |
