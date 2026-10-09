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

async function join(name, room = 'main') {
  const socket = new WebSocket(websocketUrl + '?room=' + room, { headers: { Origin: base } });
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
assert.match(await homepage.text(), /damnchat/);
assert.equal(homepage.headers.get('x-robots-tag'), 'index, follow');
for (const path of ['/about','/privacy']) {
  const page = await fetch(base + path, {headers:{'User-Agent':'Googlebot'}});
  assert.equal(page.status,200);
  assert.match(await page.text(), /Damn Chat/);
  assert.equal(page.headers.get('x-robots-tag'),'index, follow');
  assert.equal((await fetch(base + path,{method:'HEAD'})).status,200);
}
const robots = await fetch(base + '/robots.txt');
assert.equal(robots.status,200);
assert.match(robots.headers.get('content-type'),/text\/plain/);
assert.match(await robots.text(), /User-agent: \*\s+Allow: \/\s+Disallow: \/api\//);
const sitemap = await fetch(base + '/sitemap.xml');
assert.equal(sitemap.status,200);
assert.match(sitemap.headers.get('content-type'),/application\/xml/);
assert.deepEqual([...((await sitemap.text()).matchAll(/<loc>(.*?)<\/loc>/g))].map(match => match[1]),
  ['https://damnchat.me/','https://damnchat.me/about','https://damnchat.me/privacy']);
assert.equal((await fetch(base + '/?room=' + 'a'.repeat(32))).headers.get('x-robots-tag'),'noindex, nofollow');
assert.equal((await fetch(base + '/static/index.html',{redirect:'manual'})).headers.get('x-robots-tag'),'noindex, nofollow');
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

  const historyResponse = await fetch(base + "/api/messages?limit=100");
  assert.equal(historyResponse.headers.get('x-robots-tag'), 'noindex, nofollow');
  const history = await historyResponse.json();
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
  assert.equal(image.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.equal(Buffer.from(await image.arrayBuffer()).subarray(0, 4).toString(), "RIFF");

  const sharedImage = nextPacket(bob, packet => packet.type === "message" && packet.message.image_url === imageUrl);
  alice.send(JSON.stringify({ type: "message", body: "", image_url: imageUrl }));
  assert.equal((await sharedImage).message.image_url, imageUrl);
  const privateRoom = randomUUID().replaceAll('-', '');
  const privateSocket = await join('Private host', privateRoom);
  try {
    const received = nextPacket(privateSocket, p => p.type === 'message');
    privateSocket.send(JSON.stringify({type:'message',body:'Private smoke'}));
    const privateMessage = (await received).message;
    assert.equal((await (await fetch(base+'/api/messages?room='+privateRoom)).json()).messages.length,1);
    assert(!(await (await fetch(base+'/api/messages')).json()).messages.some(m => m.body === 'Private smoke'));
    assert.equal((await fetch(base+imageUrl+'?room='+privateRoom)).status,404);
    const reacted = nextPacket(privateSocket, p => p.type === 'reaction');
    privateSocket.send(JSON.stringify({type:'reaction',message_id:privateMessage.id,emoji:'🔥'}));
    assert.equal((await reacted).count,1);
    const watching = nextPacket(privateSocket, p => p.type === 'watch');
    privateSocket.send(JSON.stringify({type:'watch',action:'start',video:{kind:'youtube',id:'M7lc1UVf-VE'}}));
    assert.equal((await watching).watch.host_name,'Private host');
    const globalWatch = nextPacket(alice,p => p.type === 'watch_error');
    alice.send(JSON.stringify({type:'watch',action:'start',video:{kind:'youtube',id:'M7lc1UVf-VE'}}));
    assert.match((await globalWatch).message,/private rooms/);
    const invite = nextPacket(bob,p => p.type === 'message' && p.message.party?.room_id === privateRoom);
    const shared = nextPacket(privateSocket,p => p.type === 'party_shared');
    privateSocket.send(JSON.stringify({type:'party_share',note:'Join this test watch room',room_id:'main'}));
    const [card,confirmation] = await Promise.all([invite,shared]);
    assert.equal(card.message.party.video.id,'M7lc1UVf-VE');
    assert.equal(confirmation.next_at-confirmation.server_time,240000);
    const cooldown = nextPacket(privateSocket,p => p.type === 'party_error');
    privateSocket.send(JSON.stringify({type:'party_share',note:'Duplicate invitation'}));
    assert.equal((await cooldown).next_at,confirmation.next_at);
    const another = await join('Other member',privateRoom);
    try {
      const blocked = nextPacket(another,p => p.type === 'party_error');
      another.send(JSON.stringify({type:'party_share',note:'Still the same room'}));
      assert.equal((await blocked).next_at,confirmation.next_at);
    } finally { another.terminate(); }
    const saved = await (await fetch(base+'/api/messages')).json();
    assert(saved.messages.some(m => m.party?.room_id === privateRoom));
    assert.equal((await fetch(base+'/internal/party-share',{method:'POST',body:'{}'})).status,404);
  } finally { privateSocket.terminate(); }
  console.log("Cloud smoke passed: assets, chat, images, room isolation, reactions, private-only watch, invitation cards and shared cooldown.");
} finally {
  alice.terminate();
  bob.terminate();
}
