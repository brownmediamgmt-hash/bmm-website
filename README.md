# Brown Media Management — Website

Dark cinema portfolio site with a working backend: booking requests, contact leads, portfolio management, and an admin panel. NL/EN language toggle.

## Run locally

Requires **Node.js 22.5+** (uses built-in SQLite — no native dependencies).

```bash
npm install
ADMIN_PASSWORD=your-strong-password node server.js
```

- Site: http://localhost:3000
- Admin: http://localhost:3000/admin.html

Default admin password is `changeme` if you don't set the env var — **always set ADMIN_PASSWORD before going live.**

## What the backend does

| Endpoint | What |
|---|---|
| `GET /api/portfolio` | Published portfolio items (public) |
| `POST /api/bookings` | Booking requests from the site |
| `POST /api/contact` | Contact form leads |
| `POST /api/admin/login` | Admin login → token |
| `GET/PATCH/DELETE /api/admin/bookings` | Manage bookings (pending → confirmed/declined/done) |
| `GET/PATCH/DELETE /api/admin/leads` | Manage leads (new → contacted/won/lost) |
| `GET/POST/PATCH/DELETE /api/admin/portfolio` | Full portfolio CRUD, NL+EN fields, publish toggle |

All data lives in `data/bmm.db` (SQLite). Back this file up — it's your whole CRM.

## Email notifications (bookings + leads → your inbox)

Every booking and contact message is saved in the admin panel **and** can be emailed to you. Set these environment variables:

```bash
NOTIFY_EMAIL=you@yourdomain.nl        # where notifications arrive
SMTP_HOST=smtp.gmail.com              # your mail provider
SMTP_PORT=587
SMTP_USER=you@gmail.com               # the sending account
SMTP_PASS=your-app-password
```

**Using Gmail:** go to Google Account → Security → 2-Step Verification → App passwords, create one for "Mail", and use that as `SMTP_PASS` (your normal password won't work).

Run locally with email enabled:
```bash
ADMIN_PASSWORD=xxx NOTIFY_EMAIL=you@gmail.com SMTP_HOST=smtp.gmail.com SMTP_PORT=587 SMTP_USER=you@gmail.com SMTP_PASS=xxxx node server.js
```

On Render/Railway you add these in the dashboard under Environment Variables. If you skip this setup, everything still works — submissions just live in the admin panel only.

## SEO — what's built in

- Keyword-targeted title and meta description (videoproductie, bedrijfsvideo laten maken, videograaf Groningen, video production company Netherlands)
- Structured data (JSON-LD): ProfessionalService schema with your services + FAQPage schema (eligible for FAQ rich results in Google)
- Semantic headings written around real search terms in both NL and EN
- Open Graph tags for clean link previews on LinkedIn/WhatsApp/Instagram

**Action needed from you:** update the `canonical` URL and `url` fields in `public/index.html` (search for `brownmediamanagement.nl`) to your real domain once you have it. Then submit the site to [Google Search Console](https://search.google.com/search-console).

## Admin panel

Log in at `/admin.html`. Three tabs:
- **Bookings** — every shoot request with date, service, location. Change status via dropdown.
- **Leads** — contact form messages. Track new → contacted → won/lost.
- **Portfolio** — add/edit/delete projects. Paste a YouTube or Vimeo URL and it embeds automatically in a 2.39:1 frame on the site. Use `sort_order` to control ordering, `published` to hide drafts.

## Adding your videos

In Admin → Portfolio, paste any of these as Video URL:
- `https://youtu.be/XXXX`
- `https://www.youtube.com/watch?v=XXXX`
- `https://vimeo.com/123456789`

No video yet? Add a Thumbnail URL (image link) or leave both empty for a "Preview volgt" placeholder.

## Deploying

Works on any host that runs Node 22+: Render, Railway, Fly.io, Hetzner VPS, etc.

1. Push this folder to a Git repo (`.gitignore` already excludes `data/` and `node_modules/`)
2. Set env vars: `ADMIN_PASSWORD` (required), `PORT` (host usually sets this)
3. Start command: `node server.js`
4. **Important:** mount a persistent disk/volume at `data/` so the database survives redeploys (on Render: add a Disk, mount path `/opt/render/project/src/data`)

## Customizing

- Texts (NL + EN): edit the `I18N` object near the bottom of `public/index.html`
- Colors/fonts: the `:root` CSS variables at the top of `public/index.html`
- Instagram link: in the footer of `public/index.html`
