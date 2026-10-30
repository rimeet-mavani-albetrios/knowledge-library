# Knowledge Library

Your own AI-powered library for useful links: AI tools, GitHub repos, prompts, skills, tutorials.

Paste links, and a robot reads each website and writes a **summary, what you can do with it, tags, key features and price**.
Later, find anything by **saying what you want to do**, like *"convert pdf to excel"*: the best matches come first,
then links about something close. See your whole collection as a **map** where links about similar things sit close together.

It's free to run: Node.js on **Render**, a **Neon** Postgres database, and **Groq**'s free AI.

## What it can do

**Adding links**
- Paste one link or hundreds. Any text works, even a spreadsheet's CSV lines; the links are found automatically.
  Before adding, you see the list of links found, which ones are **already saved**, and can take any out.
- Import a bookmarks file from Chrome, Edge, Firefox or Safari: **each link keeps its folder name as a tag**.
  A `.txt` / `.csv` file works too.
- **"Save to library" button** for your browser's bookmarks bar: one click saves the website you're on
  (menu **⋯ → Save button for your browser**).
- Live progress for each link: Waiting → Reading page → Writing summary → Done.
- Duplicates are caught, even with `www`, `http`/`https`, trailing `/` or `?utm=` tracking codes.

**Filled in automatically for every link**
- The robot reads the page you saved **plus up to 3 important pages of the same website** (features, pricing, docs…)
- A clean title, preview picture, site icon and site name
- The page's section titles ("What's on the website") and its important links: Docs, Pricing, Download…
- By the free AI: a summary and a longer overview, **what you can do with it** ("convert PDF to Excel"),
  who it's for, up to 6 key features, a 3-step quick start, the level (beginner to advanced), and search words
- A category (AI tool, workflow, prompts, tutorial, docs, article…), the price, and 3–6 **tags in your own style**
  ("AI Agents", "PDF Tools"). The AI reuses the tags you already have, so they don't split into look-alikes.
- For GitHub repos: stars, language, license and last update

**Finding links**
- **Search by what you want to do**, by meaning *and* by words, so "run AI on my own computer" finds Ollama.
- Results come in two groups: up to 12 **best matches**, then **also related** (search "ai" and you also get ML and
  LLM links). The first few related links show, and a button shows the rest, so a search is a short page.
- **Suggestions while you type:** links whose name matches (open one straight away), matching tags, and your
  recent searches (kept on your device). Use ↑ ↓ and Enter, or Esc to close the list.
- **Common words count less:** "ai" is in most links, so "ai video" is mostly about "video".
- Each card shows **why it matched**: the sentence with your words in bold.
- **Spelling mistakes are fine**: "image genration" shows results for "image generation".
- Your **favorites** (⭐) and the links you **open most** get a small push up in search.
- **Cards or a list:** pictures to browse, or short rows that fit about 8 links on a laptop screen. Searches and
  phones use the list until you pick one; your choice is remembered. Every link has an **Open** button.
- **Knowledge map:** every link is a dot, colored by category. Search lights up the matching dots.
  On phones and while searching it waits behind the toolbar's **Map** button, so your links come first.
- **Jump back in** at the top of the home page: the links you **opened last**, your **favorites** and your **To try**
  list, as app icons like a phone's home screen. One tap opens the website.
- **One toolbar** above the results that stays at the top while you scroll (on big screens): categories that slide
  sideways (with ‹ › buttons), **Filters**, **Sort**, **Map**, **Select**, and cards or list.
- The **Filters** panel has named sections with counts: where links come from, show only (free, favorites,
  **broken links**), your status (To try, Using, Done), level, collection, and tags with a "Find a tag" box.
  Chosen filters show as chips with an ×. Sort by newest, recently opened, most used, favorites first, oldest,
  A to Z or GitHub stars.
- **Our own menus:** Sort, Filters and the category in the edit form use the app's own menus instead of the
  browser's built-in dropdowns, so they look the same everywhere. On phones they slide up from the bottom.
- Loads 24 links at a time and fetches more as you scroll.
- A detail panel with what the link does, your note and status, and **alternatives in your library** first;
  everything else the robot found is under "More details". The arrows (or ← →) go to the next or previous result.
- **Website facts** in the detail window: an "At a glance" row (Trust A · 4.6 on iPhone · Since 2016 · USA) and tabs
  **Overview / Popularity / Company / Trust / History**. Who runs the website and where (from its own Privacy or
  Terms page, plus Wikidata), its iPhone app rating, GitHub stars week by week, a trust grade A–F with the reasons,
  the trackers on its home page, and a **Look back** slider that shows the home page in earlier years (Internet
  Archive). **Is it right for you?** (owner only): type what you need and the free AI scores the fit out of 10.

**Everything else**
- Light, dark, or match-my-device theme
- Edit anything the AI got wrong, refresh a summary, or delete a link
- **Change many links at once:** press **Select**, tick the links (or "Select all"), then add a tag, move them to a
  collection, have the robot read them again, or delete them
- Rename a tag on every link at once; renaming it to an existing tag merges the two
- Collections and personal notes
- Weekly broken-link check
- Backups: download everything as JSON, CSV or a bookmarks file
- Owner login: only you can change the library; visitors can search and browse (or make it fully private)
- Works on phones
- Keyboard: `/` search, `N` add links. In the search box, `↓` goes to the results; then `← → ↑ ↓` move between links,
  `Enter` opens the details and `O` opens the website

## Try it on your computer

You need [Node.js](https://nodejs.org) 22 or newer.

```bash
npm install
```

```bash
npm run seed
```

```bash
npm run dev
```

Open http://localhost:4747. `npm run seed` adds 15 demo links. On your computer you don't need a database or a
password: the app keeps its data in the `.data` folder and lets you edit everything.

**For AI summaries,** get a free key at [console.groq.com/keys](https://console.groq.com/keys), open the `.env` file
(copy `.env.example` to `.env` if it's missing) and put it after `GROQ_API_KEY=`. Then restart `npm run dev`.
Links that only got a basic description are rewritten by the AI automatically.

## Put it online for free

**1. Put the code on GitHub.** Create a new repository and push this folder to it.

**2. Make a free database on [Neon](https://neon.com).** Sign up, create a project, and copy the
**connection string** (it starts with `postgresql://`).

**3. Get a free AI key on [Groq](https://console.groq.com/keys).**

**4. Deploy on [Render](https://render.com).** Sign in with GitHub, choose **New → Blueprint**, and pick your
repository. Render reads `render.yaml` and asks for:

| Setting | What to enter |
|---|---|
| `DATABASE_URL` | Your Neon connection string |
| `GROQ_API_KEY` | Your Groq key |
| `ADMIN_PASSWORD` | A password you choose, for adding and editing links |
| `GITHUB_TOKEN` | Optional. A [GitHub token](https://github.com/settings/personal-access-tokens/new) with no permissions, so the robot can read star counts for many repos |
| `CLOUDFLARE_API_TOKEN` | Optional. A free [Cloudflare token](https://dash.cloudflare.com/profile/api-tokens) (Custom token, Account → Radar → Read) for "Popular in" |
| `GOOGLE_API_KEY` | Optional. A free [Google Cloud](https://console.cloud.google.com) API key with "YouTube Data API v3" and "Safe Browsing API" turned on |
| `RESEND_API_KEY`, `WEEKLY_EMAIL_TO` | Optional, for the weekly email. A free [Resend](https://resend.com) key, and the email you signed up to Resend with |

After a few minutes your library is online at `https://<name>.onrender.com`. Click **Log in**, enter your
password, and add links.

**5. Keep it awake (optional).** Render's free server sleeps after 15 minutes without visitors, and the next
visit then takes about a minute. To avoid that, create a free job on [cron-job.org](https://cron-job.org) that
opens `https://<name>.onrender.com/api/health` every 10 minutes. That uses about 744 of Render's 750 free hours
per month, so it works for one free service.

Others can make their own copy: after you push to GitHub, add this button to the top of the README
(replace `YOUR-NAME/YOUR-REPO`):

```markdown
[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/YOUR-NAME/YOUR-REPO)
```

## Settings

All settings are environment variables, in `.env` on your computer or in Render's **Environment** tab.

| Name | What it does |
|---|---|
| `GROQ_API_KEY` | Turns on AI summaries, categories and tags |
| `ADMIN_PASSWORD` | Owner password. Online, nobody can change the library without it |
| `DATABASE_URL` | Neon/Postgres connection. Empty = built-in database in `.data/` |
| `LIBRARY_TITLE` | The name at the top of the website |
| `PRIVATE_LIBRARY` | `true` = only you (logged in) can see the library |
| `GITHUB_TOKEN` | Optional, for GitHub star counts (5,000 lookups/hour instead of 60) |
| `CLOUDFLARE_API_TOKEN` | Optional, for "Popular in": each website's world rank and top countries (Cloudflare Radar) |
| `GOOGLE_API_KEY` | Optional, for YouTube tutorials and Google's safety check (YouTube Data API v3 + Safe Browsing API) |
| `RESEND_API_KEY` | Optional. Turns on the weekly email ("Your library this week") through [Resend](https://resend.com)'s free plan |
| `WEEKLY_EMAIL_TO` | Where the weekly email goes. Without your own domain in Resend, it must be the email you signed up to Resend with |
| `WEEKLY_EMAIL_FROM` | Optional: your own sender, like `Library <library@yourdomain.com>`, once you verified that domain in Resend |
| `PUBLIC_URL` | Optional: the website's address for the email's buttons. On Render it's filled in by itself |
| `SESSION_SECRET` | Keeps logins safe. Render creates it for you |
| `AI_BASE_URL`, `AI_API_KEY`, `AI_MODELS` | Optional: use another OpenAI-compatible AI, like Gemini's free plan |
| `FACTS_RUNNER` | Optional. `off` stops the background website-facts checks (opening a link still collects its facts) |
| `CRON_SECRET` | Optional: turns on the daily wake-up (price watch, what's new). The same text goes in GitHub's secrets |

## Free limits (October 2026)

| Service | Free amount | What it means |
|---|---|---|
| Render | 512 MB memory, 750 hours/month | One always-on server. This app uses about 160 MB |
| Neon | 0.5–1 GB, sleeps when unused | Room for about 10,000–20,000 links (each link keeps the text of its pages, for search) |
| Resend | 3,000 emails/month, 100/day | The weekly email uses 4–5 a month. Its test sender only sends to your own address |
| Groq | About 1,000 requests and 200,000 tokens per day, per model | About 70–80 links per day per model. The robot uses 3 models, so about 200–250 per day. Bigger imports finish over the next days automatically |
| YouTube Data API | 10,000 units per day (a search costs 100) | Up to 80 links per day get their YouTube tutorials; each link is checked again once a month |
| Cloudflare Radar | Free with a token | About one lookup a second; each website's popularity is checked once a month |
| Safe Browsing | Free for personal use | Each link is checked once a week, up to 500 addresses in one request |

## How it works

```
You paste links ──▶ Server saves them as "waiting" ──▶ Cards appear right away
                         │
                         ▼
          Robot, in the background (server/worker.js):
          read the page + 3 useful pages ─▶ Groq AI: summary, tasks, tags… ─▶ meaning fingerprint
                         │
                         ▼
          Neon database ──▶ The website checks every 2 seconds and updates the cards
```

- **Search** mixes two searches in the database: by words (Postgres full-text search) and by meaning
  (pgvector). A small free AI model inside the server ([all-MiniLM-L6-v2](https://huggingface.co/Xenova/all-MiniLM-L6-v2))
  turns text into "meaning fingerprints". Where a word is found decides how much it counts: the name and
  "what you can do with it" most, then tags, search words and headings, then summaries, then the page text.
  **Rare words count more:** a word that's in most of your links ("ai") says little, so it counts little; a rare one
  ("logo") counts a lot. Filler words and everyday verbs ("website", "make") count half.
  A link is a **best match** when most of that weight is in those important places (and it's about the same thing),
  or when its meaning is very close. Only the strongest 12 are best matches. Spelling is fixed first
  (`server/words.js`), using the words in your library.
- **Old links get the new details by themselves:** links read by an older robot are read again quietly, about
  20 every 15 minutes while the library is used. This only adds details: names, summaries and tags you edited stay.
- **Broken addresses are repaired once:** links imported from a CSV before the fix kept the next column
  (`https://klap.app/,AI`). At its next start the server cuts that off, merges any copies it finds, and reads them again.
- **The map** squeezes each fingerprint (384 numbers) into an x and a y with PCA (`server/map.js`).
- **Scrolling** asks the server for 24 links at a time with a "next page" marker (`/api/links?cursor=…`),
  so it stays fast with thousands of links.
- **Chores** (retrying AI summaries, the weekly broken-link check) only run while someone uses the library,
  so the database can sleep and stay within the free plan.
- **Website facts** (`server/facts/`): each kind of fact is one file in `server/facts/kinds/` (company, wikidata,
  app, age, tls, trackers, archive, stars). The runner checks a few links per round (at most 90 seconds every
  15 minutes while the library is used), favorites and most-opened first, and checks each fact again after some
  days or weeks. Opening a link whose facts aren't known yet collects them right away. Only "who runs it" uses the
  free AI (about 2,500 letters of the legal page). The trust grade is worked out from the other facts
  (`server/facts/trust.js`). All sources are free and need no key: RDAP, Wikidata, Apple's lookup, the Wayback Machine.
- **The daily wake-up** (`.github/workflows/daily.yml`): Render's free server sleeps, so once a day (03:30 UTC,
  9:00 in India) GitHub Actions wakes it and calls `POST /api/cron/daily` with the secret `CRON_SECRET`. The library then
  checks website facts for a few minutes: **price watch** (each pricing page once a month; a price change is noted
  in the link's history and a rise shows a small "Price went up" tag for 30 days) and **what's new** (features a
  website added since last month), then runs the jobs in `server/cron/`. Each check asks the free AI one short
  question ("what's new" only asks when the page changed), and only a few links are checked at a time. To turn it on: add `CRON_SECRET` in Render's **Environment** tab, then add the same `CRON_SECRET`
  and `LIBRARY_URL` (your library's address) in GitHub → **Settings → Secrets and variables → Actions**.
  **GitHub pauses scheduled workflows after 60 days with no activity in the repository.** If the wake-up stops,
  open **Actions → Daily wake-up → Run workflow** once (or push any change) and it starts again.

## Weekly email

Every Monday morning (the daily wake-up at 9:00 India time) the library can email you **"Your library this week"**:
price changes, new features, links that stopped working, and websites getting more popular, from the last 7 days.
Each item has a button that opens it in your library. A week without changes gets a short "quiet week" note.

1. Make a free account at [resend.com](https://resend.com) with the email where you want it.
2. Create an API key (**API Keys → Create API Key**).
3. Add `RESEND_API_KEY` and `WEEKLY_EMAIL_TO` (that same email) to `.env` and to Render's **Environment** tab.
4. In the library, the **⋯** menu has **Weekly email** (on/off) and **Send test email**.

It is on by itself once the key is set, sends at most once a week, and the settings live in the database
(`meta` table: `weekly_email`, `weekly_email_sent`). Code: `server/email/` and `server/cron/weekly-email.js`.

## Files

| Path | What it is |
|---|---|
| `server/index.js` | Starts the server: the API plus the website |
| `server/api.js` | Every `/api/...` address the website uses |
| `server/links.js` | Reading and saving links: lists, search, filters, tags |
| `server/words.js` | The words that matter in a search, and spelling fixes |
| `server/worker.js` | The robot that reads websites and asks the AI |
| `server/robot/` | Page and website reading, GitHub details, AI, tags, duplicates, fingerprints |
| `server/facts/` | Website facts: the runner, the trust grade, the "Is it right for you?" check, one file per fact |
| `server/map.js` | Places each link on the knowledge map |
| `server/schema.sql` | The database table |
| `web/src/` | The website (React) |
| `render.yaml` | Render setup |
| `.env.example` | All settings, explained |

## Credits

Built with [Express](https://expressjs.com), [React](https://react.dev), [Vite](https://vite.dev),
[TanStack Query](https://tanstack.com/query), [PGlite](https://pglite.dev), [pgvector](https://github.com/pgvector/pgvector),
[Transformers.js](https://huggingface.co/docs/transformers.js), [Cheerio](https://cheerio.js.org),
[Lucide](https://lucide.dev) icons, and the [Bricolage Grotesque](https://fonts.google.com/specimen/Bricolage+Grotesque)
and [Figtree](https://fonts.google.com/specimen/Figtree) fonts.
