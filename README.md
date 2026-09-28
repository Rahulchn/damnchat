# Chatter — one shared group chat

Enter a display name and join the room. Everyone sees the same conversation, with live messages and saved history. There are no passwords, accounts, or login tokens.

Messages can include an optional PNG, JPEG, WebP, or GIF image up to 5 MB. The
server validates and re-encodes images before saving them, which removes embedded
metadata such as EXIF/GPS data. Uploaded files receive random names and are stored
locally in the ignored `uploads/` directory.

Choose from eight locally stored photo and meme avatars before joining. Your avatar appears in the room and is saved with each message. The earlier illustrated avatars remain available for displaying old messages, without deleting history. The interface adapts from a desktop sidebar to a full-screen phone layout.

Built with Python FastAPI, native WebSockets, async SQLAlchemy, SQLite, and plain HTML/CSS/JavaScript.

There is also a separate Cloudflare Workers version for always-on hosting without
keeping this PC or a tunnel running. It uses the same frontend, with a
SQLite-backed Durable Object for chat history and re-encoded image uploads.

Pasted YouTube, public Google Drive, Vimeo, Instagram, TikTok, Dailymotion,
Streamable, Pexels, xHamster, and direct MP4/WebM/Ogg links show a player after
the viewer clicks Play in chat. The viewer's browser contacts the video provider;
the chat server does not fetch the link. Unrecognized URLs remain clickable links.
Private or removed media and providers that block embedding may not play.

## Run locally

```powershell
cd C:\path\to\CHAT
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8765
```

Open http://127.0.0.1:8765 in two tabs and enter a name in each. Messages appear in both tabs. The name field is remembered for convenience; each visit starts at the join screen. Leaving the room returns to that screen. The most recent 100 messages load on joining, and older history can be loaded in the room.

For friends on the same Wi-Fi, run with `--host 0.0.0.0` instead, then share `http://YOUR-PC-IP:8765`. The PC and server must stay running. This does not publish the app on the internet.

## Share temporarily over the internet

The project includes a one-command launcher that starts CHAT, creates a temporary
Cloudflare Quick Tunnel, and prints the public URL:

```powershell
cd C:\path\to\CHAT
powershell -ExecutionPolicy Bypass -File .\scripts\start-public.ps1
```

Keep that PowerShell window open and press `Ctrl+C` to stop the tunnel. If CHAT
was not already running, the launcher stops its hidden Uvicorn process too.

For the manual method, start the application server in one PowerShell window:

```powershell
cd C:\path\to\CHAT
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8765
```

In a second PowerShell window, start the tunnel:

```powershell
cd C:\path\to\CHAT
powershell -ExecutionPolicy Bypass -File .\scripts\start-tunnel.ps1
```

The script checks that CHAT is reachable locally, then runs:

```powershell
cloudflared tunnel --protocol http2 --url http://127.0.0.1:8765
```

Share the generated `https://...trycloudflare.com` URL. Keep both PowerShell
windows open. Quick Tunnel URLs are temporary, have no uptime guarantee, and
change whenever a new tunnel is created. The explicit HTTP/2 protocol avoids
networks that block outbound QUIC traffic, while `127.0.0.1` avoids Windows
resolving `localhost` to an IPv6 listener that Uvicorn may not be using.

## Host on Cloudflare Free

The Cloudflare version starts as a **new, empty public room**. It does not upload
`chat.db`, `uploads/`, `.env`, or any other local chat data. The local FastAPI
version continues to work separately. This setup needs a free Cloudflare
account, but no PC or tunnel after deployment.

1. [Create a Cloudflare account](https://dash.cloudflare.com/sign-up) and select
   the Workers Free plan. Install Node.js if you do not already have it.
2. In this project directory, run `npm ci`. For a local test, copy
   `.dev.vars.example` to `.dev.vars`, replace its placeholder with a long random
   string, then run `npm run dev:cloud`. In another terminal, run
   `npm run smoke:cloud`. The local test URL is `http://127.0.0.1:8787`.
3. Run `npx wrangler login`, then `npm run deploy:cloud`. Wrangler prints the
   `https://chatter-cloud.<your-subdomain>.workers.dev` URL. The deployed app
   will return a configuration error on joining/uploading until step 4.
4. Run `npx wrangler secret put RATE_SALT` and enter a **different**, long,
   randomly generated value at the prompt. Do not put this production value in
   `.dev.vars`, `wrangler.jsonc`, GitHub, or a chat message. Reload the deployed
   URL and verify it from two devices. Wrangler stores this secret in Cloudflare,
   not this repository.

To use your own domain later, claim/register it through the GitHub Student
Developer Pack offer, add it to Cloudflare, complete the registrar nameserver
setup, then add a **Custom Domain** to this Worker in Cloudflare. A free first
year of domain registration may have a paid renewal; `workers.dev` does not
require a purchased domain. Do not change the domain until the `workers.dev`
version is working.

Free-tier limits apply. This implementation caps one room at 200 concurrent
connections, 30 messages/minute and 20 uploads/day per visitor, 5 MB per image,
and 500 MB of stored chat images. Cloudflare's own request, storage, and image
transformation limits can stop the app sooner under heavy traffic. There is no
automatic migration, backup, or guarantee of unlimited free hosting. Images are
converted to WebP before storage; the original image and its metadata are not
kept by this app. Cloudflare receives visitors' IPs and the data they post.

**Public-room warning:** Anyone with the URL can read messages and images and
post under any display name. This project currently has no real accounts, age
verification, reporting, moderation, or administrator delete controls. Do not
invite the public to an 18+ room until you decide and implement appropriate
safeguards and review applicable platform policies and local requirements.
Hosting on Cloudflare also does not make third-party videos embeddable when their
provider blocks playback.

## Data and configuration

- `DATABASE_URL` defaults to `sqlite+aiosqlite:///./chat.db`, relative to the working directory. Start from this project directory to keep using the same database.
- Group messages use a separate `group_messages` table. Existing account and private-message tables are left intact, but are no longer read or exposed by the app. Private conversations are not copied into the group room.
- All new group messages and history are available to everyone who can reach this app. Display names are not verified or reserved; two visitors may use the same name. The browser's per-tab ID only styles its own messages and is not authentication.
- Shared images are also available to everyone who can reach the room. They remain on the host machine until manually removed from `uploads/`; deleting an uploaded file leaves its old message without a working image.
- For PostgreSQL later, install `asyncpg` and set `DATABASE_URL` to your PostgreSQL connection string. Keep credentials in a local `.env` file and never commit it. This changes the database connection; existing SQLite data is not automatically transferred.
- Run one server worker. Room broadcast and online counts live in that process. Multiple workers would require a shared event layer.
- The new avatar images came from third-party URLs supplied for this project. Check their reuse rights before publicly distributing or hosting the app.

## Tests

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m pytest -q
```

Tests use isolated databases. If Windows blocks the default temporary directory, pass `--basetemp=.pytest-tmp` (pytest uses and clears that test-only folder).

## Protocol

Connect to `/ws`, then send `{"type":"join","name":"Rahul","client_id":"a-valid-uuid"}`. The welcome event includes group history; presence events report connected browsers. Send `{"type":"message","body":"Hello everyone!"}` to publish a message. The server uses the name bound at joining and broadcasts only after saving the message. Errors are displayed without discarding the draft.

`GET /api/messages?limit=100&before_id=123` returns older public group messages in chronological order with a `has_more` flag. Authentication and direct-message endpoints have been removed.
