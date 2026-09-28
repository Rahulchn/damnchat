import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import WebSocket from "ws";

const base = process.env.CHAT_CLOUD_TEST_URL || "http://127.0.0.1:8787";
const websocketUrl = base.replace(/^http/, "ws") + "/ws";

function nextPacket(socket, predicate) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off("message", onMessage);
      reject(new Error("Timed out waiting for a chat event"));
    }, 10000);
    function onMessage(data) {
      const packet = JSON.parse(data.toString());
      if (packet.type === "error") {
        clearTimeout(timeout);
        socket.off("message", onMessage);
        reject(new Error(packet.message));
      } else if (predicate(packet)) {
        clearTimeout(timeout);
        socket.off("message", onMessage);
        resolve(packet);
      }
    }
    socket.on("message", onMessage);
  });
}

async function join(name) {
  const socket = new WebSocket(websocketUrl, { headers: { Origin: base } });
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  const welcome = nextPacket(socket, packet => packet.type === "welcome");
  socket.send(JSON.stringify({ type: "join", name, client_id: randomUUID(), avatar: "orbit" }));
  assert.equal((await welcome).name, name);
  return socket;
}

const homepage = await fetch(base + "/");
assert.equal(homepage.status, 200);
assert.match(await homepage.text(), /Chatter/);
assert.equal((await fetch(base + "/static/app.js")).status, 200);
assert.equal((await fetch(base + "/static/styles.css")).status, 200);
assert.equal((await fetch(base + "/static/avatars/doge.png")).status, 200);
assert.equal((await fetch(base + "/api/video-preview?url=https://example.com")).status, 404);

const alice = await join("Cloud Alice");
const bob = await join("Cloud Bob");
try {
  const body = `cloud-smoke-${randomUUID()}`;
  const aMessage = nextPacket(alice, packet => packet.type === "message" && packet.message.body === body);
  const bMessage = nextPacket(bob, packet => packet.type === "message" && packet.message.body === body);
  alice.send(JSON.stringify({ type: "message", body }));
  const [aCopy, bCopy] = await Promise.all([aMessage, bMessage]);
  assert.deepEqual(aCopy, bCopy);

  const history = await (await fetch(base + "/api/messages?limit=100")).json();
  assert(history.messages.some(message => message.body === body));
  assert.equal((await fetch(base + "/api/messages?limit=201")).status, 422);

  const unsafe = await fetch(base + "/api/uploads", {
    method: "POST", headers: { "Content-Type": "image/svg+xml", Origin: base },
    body: '<svg xmlns="http://www.w3.org/2000/svg"/>',
  });
  assert.equal(unsafe.status, 415);

  const png = await readFile(new URL("../app/static/avatars/doge.png", import.meta.url));
  const uploaded = await fetch(base + "/api/uploads", {
    method: "POST", headers: { "Content-Type": "image/png", Origin: base }, body: png,
  });
  if (uploaded.status !== 201) throw new Error(`Image upload failed: ${uploaded.status} ${await uploaded.text()}`);
  const imageUrl = (await uploaded.json()).image_url;
  assert.match(imageUrl, /^\/api\/uploads\/[0-9a-f]{32}\.webp$/);
  const image = await fetch(base + imageUrl);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get("content-type"), "image/webp");
  assert.equal(Buffer.from(await image.arrayBuffer()).subarray(0, 4).toString(), "RIFF");

  const sharedImage = nextPacket(bob, packet => packet.type === "message" && packet.message.image_url === imageUrl);
  alice.send(JSON.stringify({ type: "message", body: "", image_url: imageUrl }));
  assert.equal((await sharedImage).message.image_url, imageUrl);
  console.log("Cloud chat smoke test passed: assets, WebSockets, history, and image upload.");
} finally {
  alice.close();
  bob.close();
}
