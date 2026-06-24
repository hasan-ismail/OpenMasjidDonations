# OpenMasjid Donations

A beautiful, **self-hosted donation website** for your masjid, powered by **Stripe** —
part of the [OpenMasjid](https://github.com/hasan-ismail/OpenMasjidOS) family.

Put it on a screen by the door with a QR code, or open it on any phone. A supporter
picks a cause, chooses a **preset or custom amount** (one-time or monthly), and pays
securely by card on your masjid's own branded page. An admin manages everything —
appeals, amounts, theme, Stripe keys, and a donations log — from a polished,
login-protected panel. It runs as **one container** on a cheap mini-PC or a
Raspberry Pi, on your masjid's own network.

> **Status:** early development. **Slice 1** (this commit) is the scaffold: the
> container boots, serves a themed shell and a `/healthz` check, and matches the
> OpenMasjidOS look. Stripe, appeals, and the admin panel arrive in the slices that
> follow (see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)).

---

## Install (the easy way)

Install it from the **App Store inside [OpenMasjidOS](https://github.com/hasan-ismail/OpenMasjidOS)**
with one click. When it's running, press **Open** — it signs you in with your
OpenMasjidOS login and matches your dashboard's light/dark theme and wallpaper.
There's nothing to fill in at install time; add your Stripe keys and your first
appeal inside the app.

## Install (standalone, without the platform)

```bash
docker compose up -d
```

Then open `http://<this-machine>:7870`. The app works fully on its own (with its own
admin password); the OpenMasjidOS sign-in and theme-matching simply switch on when
it's launched from the platform.

> **Privacy & security:** your Stripe **secret key never leaves the server** and is
> never shown in the browser. Supporters' card details are entered in Stripe's own
> secure field and go **straight to Stripe** — they never pass through this app.
> Taking donations from outside your masjid's network means exposing the app
> publicly; only do so behind HTTPS.

---

## Develop

You need Node 20+ (the image uses Node 22). In two terminals:

```bash
# 1) the server (API + static host) on :8080
cd server && npm install && npm run dev

# 2) the web app (donor site + admin) on :5173, proxying /api to the server
cd web && npm install && npm run dev
```

Open `http://localhost:5173`. Build everything the way the image does:

```bash
cd web && npm install && npm run build      # → web/dist
cd server && npm install && npm run build    # → server/dist
# or build the whole container:
docker build -t openmasjiddonations:dev .
```

For Stripe work (later slices) use **test keys** and Stripe's test cards.

---

## How it's built

- **One container.** A multi-stage `Dockerfile` builds the web app and the server,
  then a small `node:22-slim` runtime serves the built site **and** the API on
  container port **8080**.
- **`server/`** — Node + TypeScript + **Fastify**. Stores data in **SQLite**
  (better-sqlite3) on the data volume; talks to Stripe server-side; reimplements the
  OpenMasjidOS **Fabric** (single sign-on + appearance + notifications).
- **`web/`** — **React + Vite + TypeScript**, styled with the OpenMasjidOS design
  tokens (so it matches the dashboard) plus Tailwind utilities, Motion for gentle
  animation, and Stripe's Payment Element for card entry.
- **License: [AGPL-3.0](LICENSE).**

This is an OpenMasjidOS **app**; the platform that runs it lives in
[OpenMasjidOS](https://github.com/hasan-ismail/OpenMasjidOS), and apps are listed in
[OpenMasjidAPPS](https://github.com/hasan-ismail/OpenMasjidAPPS).
