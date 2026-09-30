import { DurableObject } from "cloudflare:workers";
import { REACTIONS, validRoom, changeWatch, videoSource } from "./hangout.js";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_STORED_IMAGES_BYTES = 500 * 1024 * 1024;
const IMAGE_CHUNK_BYTES = 1024 * 1024;
const IMAGE_MIME = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const AVATARS = new Set([
  "orbit", "bloom", "pixel", "comet", "sunny", "wave", "sage", "luna",
  "gigachad", "jonah-hill", "roll-safe", "patrick", "handsome-squidward",
  "sad-frog", "facepalm", "doge",
]);
const IMAGE_PATH = /^\/api\/uploads\/([0-9a-f]{32}\.webp)$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function error(detail, status) {
  return json({ detail }, status);
}

function imageSignatureMatches(bytes, mime) {
  if (mime === "image/png") return bytes.length >= 8 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
  if (mime === "image/jpeg") return bytes.length >= 3 &&
    bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (mime === "image/webp") return bytes.length >= 12 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP";
  if (mime === "image/gif") return bytes.length >= 6 &&
    ["GIF87a", "GIF89a"].includes(String.fromCharCode(...bytes.subarray(0, 6)));
  return false;
}

async function readLimited(request, maxBytes) {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function visitorKey(request, salt) {
  const ip = request.headers.get("CF-Connecting-IP") || "local-preview";
  const input = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", input));
  return [...digest.subarray(0, 16)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function room(env, request) {
  return env.ROOM.getByName(new URL(request.url).searchParams.get("room") || "main");
}

function sameOrigin(request) {
  const origin = request.headers.get("Origin");
  return !origin || origin === new URL(request.url).origin;
}

async function uploadImage(request, env) {
  if (!sameOrigin(request)) return error("Cross-site uploads are not allowed.", 403);
  const declaredType = (request.headers.get("Content-Type") || "").split(";", 1)[0].toLowerCase();
  if (!IMAGE_MIME.has(declaredType)) return error("Choose a PNG, JPEG, WebP, or GIF image.", 415);
  const declaredLength = Number(request.headers.get("Content-Length"));
  if (declaredLength > MAX_IMAGE_BYTES) return error("Images must be 5 MB or smaller.", 413);

  const key = await visitorKey(request, env.RATE_SALT);
  const permit = await env.ROOM.getByName("main").fetch(new Request(new URL("/internal/upload-permit", request.url), {
    method: "POST", headers: { "X-Chat-Visitor": key },
  }));
  if (!permit.ok) return permit;

  const source = await readLimited(request, MAX_IMAGE_BYTES);
  if (source === null) return error("Images must be 5 MB or smaller.", 413);
  if (!source.length) return error("The uploaded image is empty.", 400);
  if (!imageSignatureMatches(source, declaredType)) {
    return error("The file contents do not match a supported image type.", 415);
  }

  let processed;
  try {
    const info = await env.IMAGES.info(new Blob([source]).stream());
    if (!info.width || !info.height || info.width * info.height > 25_000_000) {
      return error("The image is too large or invalid.", 415);
    }
    const converted = await env.IMAGES.input(new Blob([source]).stream())
      .transform({ width: 2048, height: 2048, fit: "scale-down" })
      .output({ format: "image/webp", quality: 85, anim: true });
    const response = converted.response();
    if (!response.ok) return error("The image could not be processed.", 415);
    processed = new Uint8Array(await response.arrayBuffer());
  } catch (failure) {
    console.error("Image processing failed:", failure);
    return error("The image is damaged, unsafe, or unsupported.", 415);
  }
  if (!processed.length || processed.length > MAX_IMAGE_BYTES) {
    return error("The processed image is larger than 5 MB.", 413);
  }

  const filename = `${crypto.randomUUID().replaceAll("-", "")}.webp`;
  const stored = await room(env, request).fetch(new Request(new URL(`/internal/uploads/${filename}`, request.url), {
    method: "PUT", body: processed, headers: { "Content-Type": "image/webp" },
  }));
  if (!stored.ok) return stored;
  return json({ image_url: `/api/uploads/${filename}`, media_type: "image/webp" }, 201);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    if ((path.startsWith("/api/") || path === "/ws") && !validRoom(url.searchParams.get("room") || "main")) {
      return error("Invalid room invite.", 422);
    }
    if (path === "/healthz" && request.method === "GET") return json({ ok: true });

    if (path === "/ws" && request.method === "GET") {
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
        return error("A WebSocket connection is required.", 426);
      }
      if (request.headers.get("Origin") !== url.origin) {
        return error("Cross-site WebSocket connections are not allowed.", 403);
      }
      if (!env.RATE_SALT) return error("Server is missing RATE_SALT configuration.", 503);
      const key = await visitorKey(request, env.RATE_SALT);
      const headers = new Headers(request.headers);
      headers.set("X-Chat-Visitor", key);
      return room(env, request).fetch(new Request(request, { headers }));
    }

    if (path === "/api/messages" && request.method === "GET") {
      return room(env, request).fetch(request);
    }
    if (path === "/api/uploads" && request.method === "POST") {
      if (!env.RATE_SALT) return error("Server is missing RATE_SALT configuration.", 503);
      return uploadImage(request, env);
    }
    if (IMAGE_PATH.test(path) && request.method === "GET") {
      return room(env, request).fetch(request);
    }
    if (path.startsWith("/api/") || path === "/ws") return error("Not found.", 404);

    if (request.method !== "GET" && request.method !== "HEAD") return error("Not found.", 404);
    const assetPath = path === "/" ? "/" : path.startsWith("/static/") ? path.slice(7) : null;
    if (!assetPath) return error("Not found.", 404);
    const assetUrl = new URL(assetPath + url.search, url.origin);
    const response = await env.ASSETS.fetch(new Request(assetUrl, request));
    if (path !== "/") return response;
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "no-cache");
    headers.set("X-Content-Type-Options", "nosniff");
    return new Response(response.body, { status: response.status, headers });
  },
};

export class ChatRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.env = env;
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id TEXT NOT NULL,
        name TEXT NOT NULL,
        avatar TEXT NOT NULL,
        body TEXT NOT NULL,
        image_url TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS images (
        filename TEXT PRIMARY KEY,
        size INTEGER NOT NULL,
        chunks INTEGER NOT NULL,
        referenced INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS rate_limits (
        bucket TEXT PRIMARY KEY,
        count INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS reactions (
        message_id INTEGER NOT NULL, client_id TEXT NOT NULL, emoji TEXT NOT NULL,
        PRIMARY KEY (message_id, client_id, emoji)
      );
      CREATE TABLE IF NOT EXISTS room_shares (room_id TEXT PRIMARY KEY, next_at INTEGER NOT NULL);
    `);
    const messageColumns = this.sql.exec("PRAGMA table_info(messages)").toArray().map(column => column.name);
    if (!messageColumns.includes("reply_to_id")) this.sql.exec("ALTER TABLE messages ADD COLUMN reply_to_id INTEGER");
    if (!messageColumns.includes("party_json")) this.sql.exec("ALTER TABLE messages ADD COLUMN party_json TEXT");
    const imageColumns = this.sql.exec("PRAGMA table_info(images)").toArray().map(column => column.name);
    if (!imageColumns.includes("referenced")) {
      this.sql.exec("ALTER TABLE images ADD COLUMN referenced INTEGER NOT NULL DEFAULT 0");
    }
    this.lastRateCleanup = 0;
  }

  history(limit = 100, beforeId = null) {
    const rows = this.sql.exec(
      "SELECT * FROM messages WHERE (? IS NULL OR id < ?) ORDER BY id DESC LIMIT ?",
      beforeId, beforeId, limit + 1,
    ).toArray();
    return { messages: this.decorate(rows.slice(0, limit).reverse()), has_more: rows.length > limit };
  }

  decorate(rows) {
    if (!rows.length) return [];
    const placeholders = rows.map(() => "?").join(",");
    const reactions = this.sql.exec(`SELECT message_id, emoji, COUNT(*) AS count FROM reactions WHERE message_id IN (${placeholders}) GROUP BY message_id, emoji`, ...rows.map(row => row.id)).toArray();
    const parentIds = [...new Set(rows.map(row => row.reply_to_id).filter(Boolean))];
    const parents = parentIds.length ? this.sql.exec(`SELECT id, name, body, image_url FROM messages WHERE id IN (${parentIds.map(() => "?").join(",")})`, ...parentIds).toArray() : [];
    return rows.map(row => {
      const parent = parents.find(item => item.id === row.reply_to_id);
      const {party_json, ...fields} = row;
      return {...fields, party:party_json ? JSON.parse(party_json) : null, reply_to:parent ? {id:parent.id, name:parent.name, body:parent.body.slice(0,160), image:!!parent.image_url} : null,
        reactions:reactions.filter(item => item.message_id === row.id).map(({emoji,count}) => ({emoji,count}))};
    });
  }

  watchSnapshot(exclude = null) {
    const watch = this.ctx.storage.kv.get("watch");
    if (!watch) return null;
    return {...watch, host_online:this.joinedSockets(exclude).some(socket => socket.deserializeAttachment().session_id === watch.host_id)};
  }

  watchPresence(exclude) {
    if (!this.joinedSockets(exclude).length) this.ctx.storage.kv.delete("watch");
    this.broadcast({type:"watch", watch:this.watchSnapshot(exclude), server_time:Date.now()}, exclude);
  }

  takeRate(bucket, maximum, windowMs) {
    const now = Date.now();
    if (now - this.lastRateCleanup > 60 * 60 * 1000) {
      this.sql.exec("DELETE FROM rate_limits WHERE expires_at < ?", now);
      this.lastRateCleanup = now;
    }
    const current = this.sql.exec("SELECT count FROM rate_limits WHERE bucket = ?", bucket).toArray()[0];
    if (current && current.count >= maximum) return false;
    this.sql.exec(
      "INSERT INTO rate_limits (bucket, count, expires_at) VALUES (?, 1, ?) " +
      "ON CONFLICT(bucket) DO UPDATE SET count = count + 1",
      bucket, now + windowMs,
    );
    return true;
  }

  removeAbandonedImages() {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const abandoned = this.sql.exec(
      "SELECT filename, chunks FROM images WHERE referenced = 0 AND created_at < ?", cutoff,
    ).toArray();
    for (const image of abandoned) {
      for (let index = 0; index < image.chunks; index++) {
        this.ctx.storage.kv.delete(`image:${image.filename}:${index}`);
      }
      this.sql.exec("DELETE FROM images WHERE filename = ?", image.filename);
    }
  }

  async fetch(request) {
    const url = new URL(request.url);
    // Only reachable through the internal DO binding, never from the public router.
    if (url.pathname === "/internal/party-share" && request.method === "POST") {
      const data = await request.json(), now = Date.now();
      if (!validRoom(data.room_id) || data.room_id === "main" || !UUID.test(data.client_id) ||
          typeof data.name !== "string" || data.name.length > 80 || !AVATARS.has(data.avatar) ||
          typeof data.note !== "string" || data.note.length > 160) return error("Invalid invitation.", 400);
      const next = this.sql.exec("SELECT next_at FROM room_shares WHERE room_id = ?", data.room_id).toArray()[0]?.next_at || 0;
      if (next > now) return json({message:"This room has already sent an invite. Wait for the countdown.", next_at:next, server_time:now},429);
      if (!this.takeRate(`party:${data.visitor}:${Math.floor(now/240000)}`, 3, 240000)) return json({message:"Too many invitations from this connection. Try again in four minutes."},429);
      const nextAt = now + 240000;
      const party = {room_id:data.room_id, video:videoSource(data.video), expires_at:now + 1800000};
      let id;
      this.ctx.storage.transactionSync(() => {
        this.sql.exec("INSERT INTO messages (client_id,name,avatar,body,created_at,party_json) VALUES (?,?,?,?,?,?)",
          data.client_id,data.name,data.avatar,data.note.trim() || "Come hang out with us.",new Date(now).toISOString(),JSON.stringify(party));
        id = this.sql.exec("SELECT last_insert_rowid() AS id").toArray()[0].id;
        this.sql.exec("INSERT INTO room_shares (room_id,next_at) VALUES (?,?) ON CONFLICT(room_id) DO UPDATE SET next_at=excluded.next_at",data.room_id,nextAt);
      });
      this.broadcast({type:"message",message:this.decorate(this.sql.exec("SELECT * FROM messages WHERE id = ?",id).toArray())[0]});
      return json({next_at:nextAt,server_time:now});
    }
    if (url.pathname === "/ws") {
      const visitor = request.headers.get("X-Chat-Visitor");
      if (!visitor || !/^[0-9a-f]{32}$/.test(visitor)) return error("Invalid visitor.", 400);
      if (this.ctx.getWebSockets().length >= 200) return error("The room is full. Try again later.", 503);
      const bucket = `connect:${visitor}:${Math.floor(Date.now() / 60000)}`;
      if (!this.takeRate(bucket, 20, 60000)) return error("Too many connections. Try again in a minute.", 429);
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ visitor, joined: false, room_id:url.searchParams.get("room") || "main", session_id:crypto.randomUUID() });
      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname === "/api/messages" && request.method === "GET") {
      const rawLimit = url.searchParams.get("limit");
      const rawBefore = url.searchParams.get("before_id");
      const limit = rawLimit === null ? 100 : Number(rawLimit);
      const beforeId = rawBefore === null ? null : Number(rawBefore);
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200 ||
          (rawBefore !== null && (!Number.isSafeInteger(beforeId) || beforeId < 1))) {
        return error("Invalid history parameters.", 422);
      }
      return json(this.history(limit, beforeId));
    }

    if (url.pathname === "/internal/upload-permit" && request.method === "POST") {
      const visitor = request.headers.get("X-Chat-Visitor");
      if (!visitor || !/^[0-9a-f]{32}$/.test(visitor)) return error("Invalid visitor.", 400);
      const bucket = `image:${visitor}:${Math.floor(Date.now() / 86400000)}`;
      if (!this.takeRate(bucket, 20, 86400000)) {
        return error("Daily image upload limit reached. Try again tomorrow.", 429);
      }
      return json({ ok: true });
    }

    const internalUpload = url.pathname.match(/^\/internal\/uploads\/([0-9a-f]{32}\.webp)$/);
    if (internalUpload && request.method === "PUT") {
      const filename = internalUpload[1];
      const bytes = new Uint8Array(await request.arrayBuffer());
      if (!bytes.length || bytes.length > MAX_IMAGE_BYTES || !imageSignatureMatches(bytes, "image/webp")) {
        return error("Invalid processed image.", 415);
      }
      this.removeAbandonedImages();
      const used = this.sql.exec("SELECT COALESCE(SUM(size), 0) AS total FROM images").toArray()[0].total;
      if (used + bytes.length > MAX_STORED_IMAGES_BYTES) {
        return error("The chat image storage is full.", 507);
      }
      const count = Math.ceil(bytes.length / IMAGE_CHUNK_BYTES);
      try {
        for (let index = 0; index < count; index++) {
          this.ctx.storage.kv.put(`image:${filename}:${index}`, bytes.slice(index * IMAGE_CHUNK_BYTES, (index + 1) * IMAGE_CHUNK_BYTES));
        }
        this.sql.exec(
          "INSERT INTO images (filename, size, chunks, referenced, created_at) VALUES (?, ?, ?, 0, ?)",
          filename, bytes.length, count, new Date().toISOString(),
        );
      } catch {
        for (let index = 0; index < count; index++) this.ctx.storage.kv.delete(`image:${filename}:${index}`);
        return error("Image could not be saved. Please try again.", 500);
      }
      return json({ ok: true }, 201);
    }

    const imageMatch = url.pathname.match(IMAGE_PATH);
    if (imageMatch && request.method === "GET") {
      const filename = imageMatch[1];
      const info = this.sql.exec("SELECT size, chunks FROM images WHERE filename = ?", filename).toArray()[0];
      if (!info) return error("Not found.", 404);
      const chunks = [];
      for (let index = 0; index < info.chunks; index++) {
        const chunk = this.ctx.storage.kv.get(`image:${filename}:${index}`);
        if (!chunk) return error("Image storage is incomplete.", 500);
        chunks.push(chunk);
      }
      return new Response(new Blob(chunks), {
        headers: {
          "Content-Type": "image/webp",
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    }
    return error("Not found.", 404);
  }

  joinedSockets(exclude = null) {
    return this.ctx.getWebSockets().filter(socket =>
      socket !== exclude && socket.deserializeAttachment()?.joined);
  }

  send(socket, payload) {
    try { socket.send(JSON.stringify(payload)); } catch { /* The browser disconnected. */ }
  }

  broadcast(payload, exclude = null) {
    for (const socket of this.joinedSockets(exclude)) this.send(socket, payload);
  }

  presence(exclude = null) {
    const sockets = this.joinedSockets(exclude);
    const payload = JSON.stringify({ type: "presence", count: sockets.length });
    for (const socket of sockets) {
      try { socket.send(payload); } catch { /* The browser disconnected. */ }
    }
  }

  async webSocketMessage(socket, raw) {
    if (typeof raw !== "string" || raw.length > 4096) {
      socket.close(1003, "Only short text messages are supported.");
      return;
    }
    let payload;
    try { payload = JSON.parse(raw); } catch {
      this.send(socket, { type: "error", message: "Invalid message format." });
      return;
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      this.send(socket, { type: "error", message: "Invalid message format." });
      return;
    }
    const member = socket.deserializeAttachment();
    if (!member?.joined) {
      const name = typeof payload.name === "string" ? payload.name.trim().replace(/\s+/gu, " ") : "";
      const avatar = payload.avatar ?? "gigachad";
      if (payload.type !== "join" || !name || Array.from(name).length > 40 || /\p{C}/u.test(name) ||
          typeof payload.client_id !== "string" || !UUID.test(payload.client_id) || !AVATARS.has(avatar)) {
        this.send(socket, { type: "error", message: "Enter a name between 1 and 40 characters to join." });
        socket.close(1008, "Invalid join.");
        return;
      }
      const joined = { visitor: member?.visitor || "unknown", joined: true, name, avatar, client_id: payload.client_id, session_id:member.session_id, room_id:member.room_id || "main" };
      socket.serializeAttachment(joined);
      const own = this.sql.exec("SELECT message_id, emoji FROM reactions WHERE client_id = ?", payload.client_id).toArray();
      this.send(socket, { type: "welcome", name, avatar, client_id: payload.client_id, session_id:joined.session_id,
        own_reactions:own, watch:joined.room_id === "main" ? null : this.watchSnapshot(), party_next_at:this.ctx.storage.kv.get("party_next_at") || 0, server_time:Date.now(), ...this.history() });
      this.presence();
      return;
    }
    if (payload.type === "party_share") {
      if (!member.room_id || member.room_id === "main") return this.send(socket,{type:"party_error",message:"Create a private room to share an invitation."});
      if (typeof payload.note !== "string" || payload.note.length > 160) return this.send(socket,{type:"party_error",message:"Keep your invitation under 160 characters."});
      if (!this.takeRate(`share:${member.visitor}:${Math.floor(Date.now()/60000)}`,10,60000)) return this.send(socket,{type:"party_error",message:"Too many attempts. Try again in a minute."});
      try {
        const response = await this.env.ROOM.getByName("main").fetch(new Request("https://room/internal/party-share",{
          method:"POST",body:JSON.stringify({room_id:member.room_id,client_id:member.client_id,name:member.name,avatar:member.avatar,
            visitor:member.visitor,note:payload.note,video:this.watchSnapshot()?.video || null}),
        }));
        const result = await response.json();
        if (result.next_at) this.ctx.storage.kv.put("party_next_at",result.next_at);
        if (response.ok) this.broadcast({type:"party_shared",...result});
        else this.send(socket,{type:"party_error",message:result.message || result.detail || "Couldn't share the invitation.",...result});
      } catch { this.send(socket,{type:"party_error",message:"Couldn't confirm the invitation. Reconnect before trying again."}); }
      return;
    }
    if (payload.type === "reaction" || payload.type === "watch") {
      if (!this.takeRate(`action:${member.visitor}:${Math.floor(Date.now()/60000)}`, 120, 60000)) return;
      if (payload.type === "watch") {
        if (!member.room_id || member.room_id === "main") return this.send(socket,{type:"watch_error",message:"Watch together is available in private rooms. Create a room first."});
        try {
          const current = this.watchSnapshot();
          const changed = changeWatch(current, payload, member, !!current?.host_online);
          if (changed) this.ctx.storage.kv.put("watch", changed);
          else this.ctx.storage.kv.delete("watch");
          this.broadcast({type:"watch", watch:this.watchSnapshot(), server_time:Date.now()});
        } catch (failure) { this.send(socket, {type:"watch_error", message:failure.message}); }
      } else if (Number.isSafeInteger(payload.message_id) && REACTIONS.has(payload.emoji)) {
        const mid = payload.message_id, emoji = payload.emoji;
        if (!this.sql.exec("SELECT id FROM messages WHERE id = ?", mid).toArray().length) return;
        const exists = this.sql.exec("SELECT 1 FROM reactions WHERE message_id = ? AND client_id = ? AND emoji = ?", mid, member.client_id, emoji).toArray().length > 0;
        if (exists) this.sql.exec("DELETE FROM reactions WHERE message_id = ? AND client_id = ? AND emoji = ?", mid, member.client_id, emoji);
        else this.sql.exec("INSERT INTO reactions (message_id, client_id, emoji) VALUES (?, ?, ?)", mid, member.client_id, emoji);
        const count = this.sql.exec("SELECT COUNT(*) AS count FROM reactions WHERE message_id = ? AND emoji = ?", mid, emoji).toArray()[0].count;
        this.broadcast({type:"reaction", message_id:mid, emoji, count, client_id:member.client_id, active:!exists});
      }
      return;
    }
    if (payload.type !== "message" || typeof payload.body !== "string") {
      this.send(socket, { type: "error", message: "Send text, an uploaded image, or both." });
      return;
    }
    const body = payload.body.trim();
    const imageUrl = payload.image_url ?? null;
    const replyToId = payload.reply_to_id ?? null;
    if (replyToId !== null && (!Number.isSafeInteger(replyToId) || replyToId < 1 ||
        !this.sql.exec("SELECT id FROM messages WHERE id = ?", replyToId).toArray().length)) {
      this.send(socket, {type:"error", message:"That message is not in this room."});
      return;
    }
    const imageMatch = typeof imageUrl === "string" ? imageUrl.match(IMAGE_PATH) : null;
    if (Array.from(body).length > 2000 || (imageUrl !== null && !imageMatch) || (!body && !imageUrl)) {
      this.send(socket, { type: "error", message: "Send text, an uploaded image, or both." });
      return;
    }
    if (imageMatch && !this.sql.exec("SELECT filename FROM images WHERE filename = ?", imageMatch[1]).toArray().length) {
      this.send(socket, { type: "error", message: "That uploaded image is no longer available." });
      return;
    }
    const bucket = `message:${member.visitor}:${Math.floor(Date.now() / 60000)}`;
    if (!this.takeRate(bucket, 30, 60000)) {
      this.send(socket, { type: "error", message: "Too many messages. Try again in a minute." });
      return;
    }
    const createdAt = new Date().toISOString();
    try {
      this.sql.exec(
        "INSERT INTO messages (client_id, name, avatar, body, image_url, created_at, reply_to_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
        member.client_id, member.name, member.avatar, body, imageUrl, createdAt, replyToId,
      );
      if (imageMatch) this.sql.exec("UPDATE images SET referenced = 1 WHERE filename = ?", imageMatch[1]);
      const id = this.sql.exec("SELECT last_insert_rowid() AS id").toArray()[0].id;
      this.broadcast({ type: "message", message: this.decorate([{
        id, client_id: member.client_id, name: member.name, avatar: member.avatar,
        body, image_url: imageUrl, created_at: createdAt, reply_to_id:replyToId,
      }])[0] });
    } catch {
      this.send(socket, { type: "error", message: "Your message could not be saved. Please try again." });
    }
  }

  webSocketClose(socket, code, reason) {
    const joined = socket.deserializeAttachment()?.joined;
    try { socket.close(code, reason); } catch { /* Already closed. */ }
    if (joined) { this.presence(socket); this.watchPresence(socket); }
  }

  webSocketError(socket) {
    const joined = socket.deserializeAttachment()?.joined;
    try { socket.close(1011, "Connection error."); } catch { /* Already closed. */ }
    if (joined) { this.presence(socket); this.watchPresence(socket); }
  }
}
