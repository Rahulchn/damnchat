import { DurableObject } from "cloudflare:workers";

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

function room(env) {
  return env.ROOM.getByName("main");
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
  const permit = await room(env).fetch(new Request(new URL("/internal/upload-permit", request.url), {
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
  const stored = await room(env).fetch(new Request(new URL(`/internal/uploads/${filename}`, request.url), {
    method: "PUT", body: processed, headers: { "Content-Type": "image/webp" },
  }));
  if (!stored.ok) return stored;
  return json({ image_url: `/api/uploads/${filename}`, media_type: "image/webp" }, 201);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
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
      return room(env).fetch(new Request(request, { headers }));
    }

    if (path === "/api/messages" && request.method === "GET") {
      return room(env).fetch(request);
    }
    if (path === "/api/uploads" && request.method === "POST") {
      if (!env.RATE_SALT) return error("Server is missing RATE_SALT configuration.", 503);
      return uploadImage(request, env);
    }
    if (IMAGE_PATH.test(path) && request.method === "GET") {
      return room(env).fetch(request);
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
    `);
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
    return { messages: rows.slice(0, limit).reverse(), has_more: rows.length > limit };
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
    if (url.pathname === "/ws") {
      const visitor = request.headers.get("X-Chat-Visitor");
      if (!visitor || !/^[0-9a-f]{32}$/.test(visitor)) return error("Invalid visitor.", 400);
      if (this.ctx.getWebSockets().length >= 200) return error("The room is full. Try again later.", 503);
      const bucket = `connect:${visitor}:${Math.floor(Date.now() / 60000)}`;
      if (!this.takeRate(bucket, 20, 60000)) return error("Too many connections. Try again in a minute.", 429);
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ visitor, joined: false });
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
      const joined = { visitor: member?.visitor || "unknown", joined: true, name, avatar, client_id: payload.client_id };
      socket.serializeAttachment(joined);
      this.send(socket, { type: "welcome", name, avatar, client_id: payload.client_id, ...this.history() });
      this.presence();
      return;
    }
    if (payload.type !== "message" || typeof payload.body !== "string") {
      this.send(socket, { type: "error", message: "Send text, an uploaded image, or both." });
      return;
    }
    const body = payload.body.trim();
    const imageUrl = payload.image_url ?? null;
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
        "INSERT INTO messages (client_id, name, avatar, body, image_url, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        member.client_id, member.name, member.avatar, body, imageUrl, createdAt,
      );
      if (imageMatch) this.sql.exec("UPDATE images SET referenced = 1 WHERE filename = ?", imageMatch[1]);
      const id = this.sql.exec("SELECT last_insert_rowid() AS id").toArray()[0].id;
      this.broadcast({ type: "message", message: {
        id, client_id: member.client_id, name: member.name, avatar: member.avatar,
        body, image_url: imageUrl, created_at: createdAt,
      } });
    } catch {
      this.send(socket, { type: "error", message: "Your message could not be saved. Please try again." });
    }
  }

  webSocketClose(socket, code, reason) {
    const joined = socket.deserializeAttachment()?.joined;
    try { socket.close(code, reason); } catch { /* Already closed. */ }
    if (joined) this.presence(socket);
  }

  webSocketError(socket) {
    const joined = socket.deserializeAttachment()?.joined;
    try { socket.close(1011, "Connection error."); } catch { /* Already closed. */ }
    if (joined) this.presence(socket);
  }
}
