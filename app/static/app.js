const el = id => document.getElementById(id);
const storage = {
  get(key) { try { return sessionStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { sessionStorage.setItem(key, value); } catch {} }
};
const themeButtons = [...document.querySelectorAll(".theme-toggle")];
function setTheme(theme, persist=false) {
  document.documentElement.dataset.theme=theme;
  document.querySelector('meta[name="theme-color"]').content=theme==="dark" ? "#080b14" : "#f4f0ff";
  themeButtons.forEach(button => {
    const next=theme==="dark" ? "light" : "dark";
    button.querySelector(".theme-glyph").textContent=theme==="dark" ? "☀" : "☾";
    button.querySelector(".theme-label").textContent=next[0].toUpperCase()+next.slice(1)+" mode";
    button.setAttribute("aria-label","Switch to "+next+" mode");
  });
  if (persist) try { localStorage.setItem("chatter_theme",theme); } catch {}
}
setTheme(document.documentElement.dataset.theme || "dark");
themeButtons.forEach(button => button.addEventListener("click",() => {
  setTheme(document.documentElement.dataset.theme==="dark" ? "light" : "dark",true);
}));
function makeId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
  return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join("-");
}
let clientId = storage.get("group_client_id");
if (!/^[0-9a-f-]{36}$/i.test(clientId || "")) clientId = makeId();
storage.set("group_client_id", clientId);
try { localStorage.removeItem("chat_token"); } catch {}
el("display-name").value = storage.get("group_name") || "";
const AVATARS = ["gigachad", "jonah-hill", "roll-safe", "patrick", "handsome-squidward", "sad-frog", "facepalm", "doge"];
const AVATAR_FILES = {
  gigachad: "gigachad.webp", "jonah-hill": "jonah-hill.jpg", "roll-safe": "roll-safe.jpg",
  patrick: "patrick.png", "handsome-squidward": "handsome-squidward.png",
  "sad-frog": "sad-frog.png", facepalm: "facepalm.png", doge: "doge.png",
  orbit: "orbit.svg", bloom: "bloom.svg", pixel: "pixel.svg", comet: "comet.svg",
  sunny: "sunny.svg", wave: "wave.svg", sage: "sage.svg", luna: "luna.svg"
};
const avatarLabel = id => id.split("-").map(part => part[0].toUpperCase() + part.slice(1)).join(" ");
const savedAvatar = storage.get("group_avatar");
let chosenAvatar = AVATARS.includes(savedAvatar) ? savedAvatar : "gigachad";
function avatarNode(id, name = "") {
  const wrapper = document.createElement("span"); wrapper.className = "avatar";
  const img = document.createElement("img");
  img.src = "/static/avatars/" + (AVATAR_FILES[id] || AVATAR_FILES.orbit);
  img.alt = name ? name + "'s avatar" : ""; img.width = 80; img.height = 80;
  wrapper.append(img); return wrapper;
}
function showAvatar(target, avatar) {
  el(target).replaceChildren(avatarNode(avatar).firstChild);
}
function previewProfile() {
  showAvatar("preview-avatar",chosenAvatar);
  el("preview-name").textContent = el("display-name").value.trim() || "The mystery guest";
  el("avatar-name").textContent = avatarLabel(chosenAvatar);
  el("avatar-picker").querySelectorAll("button").forEach(button => {
    button.setAttribute("aria-pressed",String(button.dataset.avatar === chosenAvatar));
  });
}
AVATARS.forEach(id => {
  const button = document.createElement("button");
  button.type = "button"; button.className = "avatar-option"; button.dataset.avatar = id;
  button.setAttribute("aria-label", "Choose " + avatarLabel(id) + " avatar");
  button.title = avatarLabel(id);
  button.append(avatarNode(id).firstChild);
  button.addEventListener("click", () => { chosenAvatar=id; storage.set("group_avatar",id); previewProfile(); });
  el("avatar-picker").append(button);
});
let fireResetTimer = null;
function setFireScene(scene) {
  el("fire-loader").dataset.fireState = scene;
}
function strikeFire() {
  clearTimeout(fireResetTimer);
  if (!el("display-name").value.trim()) {
    setFireScene("idle");
    return;
  }
  setFireScene("strike");
  fireResetTimer = setTimeout(() => {
    if (!state.joined) setFireScene("idle");
  }, 320);
}
el("display-name").addEventListener("input", () => {
  previewProfile();
  strikeFire();
});
previewProfile();
function resizeComposer() {
  const input=el("message-input");
  input.style.height="auto";
  input.style.height=Math.min(input.scrollHeight,130)+"px";
  el("character-count").textContent=input.value.length.toLocaleString()+" / 2,000";
  updateSendState();
}
el("message-input").addEventListener("input",resizeComposer);
const state = { name: "", socket: null, joined: false, ready: false, timer: null,
  retry: 0, messages: new Map(), hasMore: false, pending: null, pendingTimer: null,
  historyVersion: 0, image: null, uploading: false, uploadController: null,
  joinTimer: null, session: 0, reply: null, nodes: new Map(), ownReactions: new Set() };
hangout.init({el, makeId, state:() => state, videoDetails, leave});
returnUI.init({el,state:() => state,room:() => hangout.room,error:roomError,loadOlder});
watchLayout.init(el,resizeComposer);

function updateSendState() {
  const hasContent=!!el("message-input").value.trim() || !!state.image;
  const blocked=!state.ready || !!state.pending || state.uploading;
  el("send-button").disabled=blocked || !hasContent;
  el("image-button").disabled=blocked;
  el("remove-image").disabled=state.uploading;
}

function ready(value, label) {
  state.ready = value;
  el("connection-status").textContent = label;
  el("status-dot").classList.toggle("offline",!value);
  el("status-dot").parentElement.setAttribute("aria-label",label);
  updateSendState();
  el("join-button").disabled = state.joined && !value;
  el("watch-open").disabled = !value;
  if (!value) hangout.partyPending = false;
  hangout.updateParty();
  if (!value) el("online-count").textContent = "";
}
function clearPending() {
  clearTimeout(state.pendingTimer);
  state.pending = null;
  state.uploading = false;
  el("send-label").textContent = "Send";
  updateSendState();
}
function roomError(message) { el("room-error").textContent = message; }

const URL_PATTERN = /https?:\/\/[^\s<>"']+/gi;
const TRAILING_URL_PUNCTUATION = /[),.!?;:\]}]+$/;

function cleanUrlCandidate(value) {
  return value.replace(TRAILING_URL_PUNCTUATION, "");
}

function videoDetails(value) {
  const media = linkMedia.classify(value);
  return media?.type === "video" ? media : null;
}

function firstUrlIn(text) {
  const match = text.match(URL_PATTERN)?.[0];
  if (!match) return null;
  try {
    const url = new URL(cleanUrlCandidate(match));
    return ['http:', 'https:'].includes(url.protocol) ? url : null;
  } catch { return null; }
}

function appendLinkedText(container, text) {
  let cursor = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const candidate = cleanUrlCandidate(match[0]);
    container.append(document.createTextNode(text.slice(cursor, match.index)));
    const link = document.createElement("a");
    link.className = "message-link"; link.href = candidate; link.textContent = candidate;
    link.target = "_blank"; link.rel = "noopener noreferrer nofollow";
    container.append(link);
    cursor = match.index + candidate.length;
  }
  container.append(document.createTextNode(text.slice(cursor)));
}

function mediaNode(details) {
  const card = document.createElement("div"); card.className = "video-card";
  const audio = details.type === "audio", music = details.type === "music", image = details.type === "image";
  if (audio || music) card.classList.add("audio-card");
  if (image) card.classList.add("shared-image-card");
  if (details.vertical) card.classList.add("is-vertical");
  const heading = document.createElement("div"); heading.className = "media-card-heading";
  const mediaLabel = document.createElement("span");
  mediaLabel.textContent = music ? "♫ MUSIC" : audio ? "♫ AUDIO" : image ? "▧ IMAGE" :
    details.type === "file" ? "▤ FILE" : details.type === "post" ? "↗ POST" : "▶ VIDEO";
  const provider = document.createElement("span"); provider.textContent = details.provider;
  heading.append(mediaLabel,provider); card.append(heading);
  const frame = document.createElement("div"); frame.className = "video-player-wrap";
  let player;
  if (details.kind === "embed") {
    player = document.createElement("iframe");
    player.title = details.title; player.loading = "lazy";
    player.allow = "autoplay; fullscreen; picture-in-picture; encrypted-media";
    player.referrerPolicy = "strict-origin-when-cross-origin"; player.allowFullscreen = true;
    if (music) { player.height = String(details.height); frame.style.height = details.height + "px"; }
    if (details.provider === "xHamster") {
      // Let the provider request cookie access for its own age/session flow,
      // while still preventing top-level redirects and pop-up windows.
      player.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-presentation allow-storage-access-by-user-activation");
    }
  } else if (image) {
    player = document.createElement("img"); player.alt = "Image shared in chat"; player.decoding = "async";
  } else {
    player = document.createElement(audio ? "audio" : "video");
    player.controls = true; player.preload = "metadata";
    player.playsInline = true;
  }
  const status = document.createElement("p");
  status.className = "video-provider-note";
  status.setAttribute("role", "status");
  function startPlayback() {
    if (details.kind === "direct") {
      status.textContent = audio ? "Loading audio…" : "Loading video…";
      status.hidden = false;
      player.addEventListener("loadedmetadata", () => { status.hidden = true; }, {once:true});
      player.addEventListener("error", () => {
        frame.replaceChildren();
        status.textContent = `This ${audio ? "audio" : "video"} file couldn't play here. It may be unavailable, restricted, or in an unsupported format.`;
        status.hidden = false;
      }, {once:true});
    }
    if (image) player.addEventListener("error", () => { frame.replaceChildren(); status.textContent = "This image couldn't load. Open the original link to check it."; status.hidden = false; }, {once:true});
    player.src = details.player;
    frame.replaceChildren(player);
    if (details.kind === "direct") player.play().catch(() => {
      // The browser may require another tap; keep its visible controls.
    });
  }
  const activate=document.createElement("button");
  activate.type="button"; activate.className="video-activate";
  activate.textContent = image ? "▧ View image in chat" : details.type === "file" ? "▤ Preview Drive file" :
    details.type === "post" ? "View Instagram post" : music ? "♫ Listen on Spotify in chat" : audio ? "♫ Play audio in chat" : `▶ Play ${details.provider} in chat`;
  activate.addEventListener("click",startPlayback,{once:true});
  frame.append(activate);
  if (details.alternatePlayer) {
    const retry = document.createElement("button");
    retry.type = "button"; retry.className = "video-source-link video-retry";
    retry.textContent = "Not playing? Try the other in-chat player";
    retry.addEventListener("click", () => {
      player.src = details.alternatePlayer;
      frame.replaceChildren(player);
    });
    card.append(retry);
  }
  const source = document.createElement("a");
  source.className = "video-source-link"; source.href = details.source;
  source.target = "_blank"; source.rel = "noopener noreferrer nofollow";
  source.textContent = `${details.provider} · Open original`;
  card.append(frame);
  if (details.kind === "direct" || image) { status.hidden = true; card.append(status); }
  if (music) {
    const note = document.createElement("p"); note.className = "video-provider-note";
    note.textContent = "Spotify controls playback availability; some listeners may get a preview or be asked to sign in.";
    card.append(note);
  }
  if (details.provider === "xHamster") {
    const note = document.createElement("p");
    note.className = "video-provider-note";
    note.textContent = "If playback stays on the thumbnail, the provider may require age confirmation or block embedded playback. damnchat cannot override that check.";
    card.append(note);
  }
  if (details.provider !== "xHamster") card.append(source);
  if (details.type === "video" && hangout.room !== "main" && (details.provider === "YouTube" || (details.kind === "direct" && /\.(mp4|webm|ogv)(?:\?|$)/i.test(details.player)))) {
    const together = document.createElement("button"); together.type = "button"; together.className = "video-source-link video-retry";
    together.textContent = "▶ Watch this together";
    together.addEventListener("click", () => {
      el("watch-url").value = details.source;
      el("watch-error").textContent = "";
      el("watch-dialog").showModal();
    });
    card.append(together);
  }
  return card;
}

function linkFallbackNode(url) {
  const card = document.createElement("div"); card.className = "link-fallback";
  const link = document.createElement("a");
  link.href = url.href; link.target = "_blank"; link.rel = "noopener noreferrer nofollow";
  const host = document.createElement("strong"); host.textContent = url.hostname.replace(/^www\./, "");
  const note = document.createElement("span"); note.textContent = "Open link ↗";
  link.append(host, note);
  card.append(link);
  if (["spotify.link","spoti.fi"].includes(url.hostname.toLowerCase())) {
    const tip = document.createElement("span"); tip.textContent = "Spotify short link · Share the full open.spotify.com song link for an in-chat player.";
    card.append(tip);
  }
  return card;
}

function messageNode(message) {
  const mine = message.client_id === clientId;
  const item = document.createElement("article"); item.className = "message" + (mine ? " mine" : "");
  item.id = "message-" + message.id;
  const content = document.createElement("div"); content.className = "message-content";
  const meta = document.createElement("div"); meta.className = "message-meta";
  const name = document.createElement("strong"); name.textContent = message.name + (mine ? " · you" : "");
  const time = document.createElement("time"), date = new Date(message.created_at);
  time.dateTime = message.created_at; time.title = date.toLocaleString();
  time.textContent = date.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"});
  const body = document.createElement("div"); body.className = "bubble";
  if (message.reply_to) {
    const quote = document.createElement("button"); quote.type = "button"; quote.className = "quoted-message";
    quote.setAttribute("aria-label", "Jump to original message from " + message.reply_to.name);
    quote.addEventListener("click", () => returnUI.jump(message.reply_to.id));
    const author = document.createElement("strong"); author.textContent = "↳ " + message.reply_to.name;
    const excerpt = document.createElement("span"); excerpt.textContent = message.reply_to.body || (message.reply_to.image ? "Shared an image" : "Message");
    quote.append(author, excerpt); body.append(quote);
  }
  if (message.image_url) {
    body.classList.add("image-bubble");
    const link=document.createElement("a"); link.href=hangout.scoped(message.image_url);
    link.target="_blank"; link.rel="noopener"; link.title="Open full-size image";
    const image=document.createElement("img"); image.src=hangout.scoped(message.image_url);
    image.alt="Image shared by "+message.name; image.loading="lazy"; image.decoding="async";
    link.append(image); body.append(link);
  }
  if (message.party) {
    const card = hangout.partyCard(message);
    if (card) { body.classList.add("party-bubble"); body.append(card); }
  } else if (message.body) {
    const caption=document.createElement("div"); caption.className="message-caption";
    appendLinkedText(caption,message.body); body.append(caption);
    const media=linkMedia.first(message.body);
    if (media) { body.classList.add("video-bubble"); body.append(mediaNode(media)); }
    else {
      const linkedUrl=firstUrlIn(message.body);
      if (linkedUrl) { body.classList.add("link-bubble"); body.append(linkFallbackNode(linkedUrl)); }
    }
  }
  meta.append(name,time); content.append(meta,body);
  const actions = document.createElement("div"); actions.className = "message-actions";
  const reply = document.createElement("button"); reply.type = "button"; reply.textContent = "↳ Reply";
  reply.addEventListener("click", () => {
    state.reply = message;
    el("reply-label").textContent = `Replying to ${message.name}: ${message.body.slice(0,100) || "Image"}`;
    el("reply-preview").classList.remove("hidden"); el("message-input").focus();
  });
  const react = document.createElement("button"); react.type = "button"; react.textContent = "+ React"; react.setAttribute("aria-expanded", "false");
  const picker = document.createElement("div"); picker.className = "reaction-picker hidden";
  for (const emoji of ["🔥", "😂", "❤️", "👀", "💀"]) {
    const button = document.createElement("button"); button.type = "button"; button.textContent = emoji; button.setAttribute("aria-label", "React " + emoji);
    button.addEventListener("click", () => { hangout.send({type:"reaction", message_id:message.id, emoji}); picker.classList.add("hidden"); react.setAttribute("aria-expanded", "false"); });
    picker.append(button);
  }
  react.addEventListener("click", () => { picker.classList.toggle("hidden"); react.setAttribute("aria-expanded", String(!picker.classList.contains("hidden"))); });
  actions.append(reply, react, picker);
  if (message.body) {
    const copy = document.createElement("button"); copy.type = "button"; copy.textContent = "⧉ Copy";
    copy.setAttribute("aria-label", "Copy message from " + message.name);
    copy.addEventListener("click", async () => {
      copy.disabled = true;
      try {
        await navigator.clipboard.writeText(message.body);
        copy.textContent = "✓ Copied";
        copy.setAttribute("aria-label", "Message copied");
      } catch { roomError("Copy isn't available in this browser. Select the message text to copy it instead."); }
      finally {
        setTimeout(() => { copy.disabled = false; copy.textContent = "⧉ Copy"; copy.setAttribute("aria-label", "Copy message from " + message.name); }, 1600);
      }
    });
    actions.append(copy);
  }
  const reactions = document.createElement("div"); reactions.className = "message-reactions";
  content.append(reactions, actions); renderReactions(reactions, message);
  item.append(avatarNode(message.avatar,message.name),content); return item;
}
function renderReactions(target, message) {
  target.replaceChildren();
  for (const {emoji, count} of message.reactions || []) {
    if (!count) continue;
    const button = document.createElement("button"); button.type = "button";
    button.textContent = `${emoji} ${count}`;
    button.setAttribute("aria-label", `${emoji}: ${count} reactions`);
    button.setAttribute("aria-pressed", String(state.ownReactions.has(`${message.id}:${emoji}`)));
    button.addEventListener("click", () => hangout.send({type:"reaction", message_id:message.id, emoji}));
    target.append(button);
  }
}
function cancelReply() { state.reply = null; el("reply-preview").classList.add("hidden"); }
el("reply-cancel").addEventListener("click", cancelReply);
function renderMessages() {
  const messages = [...state.messages.values()].sort((a,b) => a.id-b.id);
  const nodes=[]; let previousDay="";
  for (const message of messages) {
    const date=new Date(message.created_at), day=date.toLocaleDateString();
    if (day!==previousDay) {
      const divider=document.createElement("div"); divider.className="date-divider";
      const today=new Date(), yesterday=new Date(); yesterday.setDate(today.getDate()-1);
      divider.textContent=day===today.toLocaleDateString() ? "Today" :
        day===yesterday.toLocaleDateString() ? "Yesterday" :
        date.toLocaleDateString([], {month:"long",day:"numeric",year:"numeric"});
      nodes.push(divider); previousDay=day;
    }
    if (!state.nodes.has(message.id)) state.nodes.set(message.id, messageNode(message));
    nodes.push(state.nodes.get(message.id));
  }
  const container = el("messages"), wanted = new Set(nodes);
  // Preserve existing media elements when new messages arrive.
  for (const child of [...container.children]) if (!wanted.has(child)) child.remove();
  nodes.forEach((node, index) => {
    if (container.children[index] !== node) container.insertBefore(node, container.children[index] || null);
  });
  el("empty-state").classList.toggle("hidden", !!messages.length);
  el("load-older").classList.toggle("hidden", !state.hasMore);
  hangout.expireCards();
  if (el("search-dialog").open) returnUI.renderSearch();
}
function bottom() {
  el("message-scroll").scrollTop = el("message-scroll").scrollHeight;
  el("new-messages").classList.add("hidden");
  returnUI.readIfVisible();
}
el("new-messages").addEventListener("click",bottom);
el("message-scroll").addEventListener("scroll", () => {
  const scroll=el("message-scroll");
  if (scroll.scrollHeight-scroll.scrollTop-scroll.clientHeight<70) el("new-messages").classList.add("hidden");
});
function connect(session=state.session) {
  if (!state.joined || session!==state.session) return;
  clearTimeout(state.timer);
  ready(false, state.retry ? "Reconnecting…" : "Connecting…");
  const socket = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + hangout.scoped("/ws"));
  state.socket = socket;
  socket.addEventListener("open", () => {
    if (state.socket !== socket) return;
    socket.send(JSON.stringify({type:"join",name:state.name,client_id:clientId,avatar:chosenAvatar}));
  });
  socket.addEventListener("message", event => {
    if (state.socket !== socket) return;
    let payload; try { payload = JSON.parse(event.data); } catch { return; }
    if (payload.type === "welcome") {
      state.retry = 0; state.name = payload.name; clientId = payload.client_id;
      chosenAvatar=payload.avatar || chosenAvatar;
      storage.set("group_avatar",chosenAvatar);
      storage.set("group_name",state.name); storage.set("group_client_id",clientId);
      state.historyVersion++;
      state.messages = new Map(payload.messages.map(m => [m.id,m]));
      state.nodes.clear();
      state.ownReactions = new Set((payload.own_reactions || []).map(item => `${item.message_id}:${item.emoji}`));
      hangout.sessionId = payload.session_id;
      state.hasMore = payload.has_more;
      el("join-view").classList.add("hidden"); el("room-view").classList.remove("hidden");
      document.body.classList.add("in-room");
      el("current-name").textContent = state.name;
      el("sidebar-name").textContent = state.name;
      showAvatar("sidebar-avatar",chosenAvatar); showAvatar("composer-avatar",chosenAvatar);
      ready(true,"Live"); renderMessages(); bottom(); resizeComposer();
      hangout.receive(payload.watch || null, payload.server_time);
      hangout.partyState({next_at:payload.party_next_at || 0,server_time:payload.server_time});
      returnUI.connected();
      if (matchMedia("(min-width: 761px)").matches) el("message-input").focus();
    } else if (payload.type === "presence") {
      el("online-count").textContent = payload.count + " online";
    } else if (payload.type === "watch") {
      hangout.receive(payload.watch, payload.server_time);
    } else if (payload.type === "party_shared" || payload.type === "party_error") {
      hangout.partyState(payload);
    } else if (payload.type === "watch_error") {
      el("watch-error").textContent = payload.message;
      el("watch-status").textContent = payload.message;
    } else if (payload.type === "reaction") {
      const message = state.messages.get(payload.message_id);
      if (payload.client_id === clientId) {
        const key = `${payload.message_id}:${payload.emoji}`;
        if (payload.active) state.ownReactions.add(key); else state.ownReactions.delete(key);
      }
      if (message) {
        message.reactions = (message.reactions || []).filter(item => item.emoji !== payload.emoji);
        if (payload.count) message.reactions.push({emoji:payload.emoji, count:payload.count});
        const target = state.nodes.get(message.id)?.querySelector(".message-reactions");
        if (target) renderReactions(target, message);
      }
    } else if (payload.type === "message") {
      const message = payload.message;
      const scroll = el("message-scroll");
      const nearBottom = scroll.scrollHeight-scroll.scrollTop-scroll.clientHeight < 100;
      if (!state.messages.has(message.id)) returnUI.receive(message.id,message.client_id === clientId,nearBottom);
      state.messages.set(message.id,message);
      if (state.pending && message.client_id === clientId && message.body === state.pending.body &&
          (message.image_url || null) === state.pending.imageUrl && (message.reply_to_id || null) === state.pending.replyToId) {
        if (el("message-input").value === state.pending.draft) el("message-input").value = "";
        clearSelectedImage();
        cancelReply();
        clearPending(); roomError(""); resizeComposer();
      }
      renderMessages();
      if ((nearBottom && !document.hidden && !document.querySelector("dialog[open]")) || message.client_id === clientId) bottom();
      else el("new-messages").classList.remove("hidden");
    } else if (payload.type === "error") {
      if (!state.ready) {
        leave(); el("join-error").textContent = payload.message;
      } else { clearPending(); roomError(payload.message); }
    }
  });
  socket.addEventListener("close", event => {
    if (state.socket !== socket || !state.joined) return;
    if (state.pending) {
      clearPending(); roomError("Connection lost before confirmation. Your draft is kept; check the history before sending again.");
    }
    if (event.code === 1008) { leave(); el("join-error").textContent = "Please enter a valid name and join again."; return; }
    ready(false,"Reconnecting…");
    state.timer = setTimeout(() => connect(session), Math.min(1000 * 2 ** state.retry++,10000));
    if (!el("join-view").classList.contains("hidden")) {
      el("join-error").textContent = "Cannot connect yet. Retrying…";
      el("join-button").disabled = false;
    }
  });
}
function leave() {
  document.body.classList.remove("in-room");
  returnUI.reset();
  hangout.leave(); cancelReply(); state.nodes.clear();
  el("message-input").value = "";
  state.joined = false; state.historyVersion++; state.session++;
  clearTimeout(state.timer); clearTimeout(state.joinTimer);
  state.joinTimer=null;
  state.uploadController?.abort(); state.uploadController=null;
  clearPending();
  const socket = state.socket; state.socket = null; socket?.close();
  ready(false,"Disconnected");
  el("join-button").disabled = false;
  el("room-view").classList.add("hidden"); el("join-view").classList.remove("hidden");
  el("display-name").value = state.name;
  previewProfile();
  el("join-error").textContent = ""; roomError("");
  clearTimeout(fireResetTimer); setFireScene("idle");
  clearSelectedImage();
  el("display-name").focus();
}
el("join-form").addEventListener("submit", event => {
  event.preventDefault();
  const name = el("display-name").value.trim().replace(/\s+/g," ");
  if (!name || name.length>40) { el("join-error").textContent = "Enter a name between 1 and 40 characters."; return; }
  if (!hangout.beforeJoin()) return;
  if (state.socket) { const old=state.socket; state.socket=null; old.close(); }
  clearTimeout(state.joinTimer);
  state.name=name; state.joined=true; state.retry=0; state.session++;
  const session=state.session;
  el("join-error").textContent=""; roomError("");
  el("join-button").disabled=true;
  clearTimeout(fireResetTimer);
  const reducedMotion=matchMedia("(prefers-reduced-motion: reduce)").matches;
  setFireScene(reducedMotion ? "lit" : "ignite");
  if (reducedMotion) connect(session);
  else {
    fireResetTimer=setTimeout(() => setFireScene("lit"),650);
    state.joinTimer=setTimeout(() => { state.joinTimer=null; connect(session); },1200);
  }
});
el("leave-button").addEventListener("click",leave);
function clearSelectedImage() {
  if (state.image?.previewUrl) URL.revokeObjectURL(state.image.previewUrl);
  state.image=null;
  el("image-input").value="";
  el("image-preview").classList.add("hidden");
  el("image-preview-thumb").removeAttribute("src");
  el("image-preview-name").textContent="";
  updateSendState();
}
function showSelectedImage(file) {
  clearSelectedImage();
  const previewUrl=URL.createObjectURL(file);
  state.image={file,previewUrl,uploadedUrl:null};
  el("image-preview-thumb").src=previewUrl;
  el("image-preview-name").textContent=file.name;
  el("image-preview").classList.remove("hidden");
  roomError(""); updateSendState();
}
el("image-button").addEventListener("click",() => el("image-input").click());
el("remove-image").addEventListener("click",clearSelectedImage);
el("image-input").addEventListener("change",event => {
  const file=event.target.files?.[0];
  if (!file) return;
  const error = composerTools.imageError(file);
  if (error) {
    roomError(error); el("image-input").value=""; return;
  }
  showSelectedImage(file);
});
el("message-input").addEventListener("paste", event => {
  composerTools.handlePaste(event, {
    blocked: !state.ready || !!state.pending || state.uploading,
    error: roomError, select: showSelectedImage,
  });
});
el("message-form").addEventListener("submit",async event => {
  event.preventDefault();
  const input=el("message-input"), body=input.value.trim();
  if ((!body && !state.image) || !state.ready || state.pending || state.uploading ||
      state.socket?.readyState!==WebSocket.OPEN) return;
  const session=state.session;
  const selectedImage=state.image;
  state.uploading=true; updateSendState(); roomError("");
  let imageUrl=selectedImage?.uploadedUrl || null;
  try {
    if (selectedImage && !imageUrl) {
      el("send-label").textContent="Uploading…";
      const controller=new AbortController();
      state.uploadController=controller;
      const response=await fetch(hangout.scoped("/api/uploads"),{
        method:"POST", headers:{"Content-Type":selectedImage.file.type},
        body:selectedImage.file, signal:controller.signal,
      });
      if (!response.ok) {
        let detail="Image upload failed.";
        try { detail=(await response.json()).detail || detail; } catch {}
        throw new Error(detail);
      }
      imageUrl=(await response.json()).image_url;
      if (session!==state.session || selectedImage!==state.image) return;
      selectedImage.uploadedUrl=imageUrl;
    }
    if (session!==state.session) return;
    if (!state.ready || state.socket?.readyState!==WebSocket.OPEN) {
      state.uploadController=null;
      clearPending();
      roomError("Connection lost before sending. Your draft is kept; try again when damnchat reconnects.");
      return;
    }
    state.uploadController=null;
    state.uploading=false;
    const replyToId = state.reply?.id || null;
    state.pending={body,draft:input.value,imageUrl,replyToId};
    el("send-label").textContent="Sending…"; updateSendState();
    state.socket.send(JSON.stringify({type:"message",body,image_url:imageUrl,reply_to_id:replyToId}));
  }
  catch (error) {
    if (session!==state.session) return;
    state.uploadController=null;
    clearPending(); roomError(error.message || "Message could not be sent. Your draft is kept."); return;
  }
  state.pendingTimer=setTimeout(() => {
    if (!state.pending) return;
    clearPending(); roomError("No confirmation received. Your draft is kept; check the history before retrying.");
  },10000);
});
el("message-input").addEventListener("keydown",event => {
  if (event.key==="Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault(); el("message-form").requestSubmit();
  }
});

const dvdMotion = { x: 30, y: 30, vx: 62, vy: 48, last: 0, color: 0 };
const dvdColors = ["#78fff1", "#d8ff4f", "#ff5fcf", "#9d7cff", "#ff9c46"];
const dvdReducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
function animateDvd(time) {
  const saver=el("dvd-saver"), viewport=el("message-scroll");
  if (!dvdReducedMotion && !el("room-view").classList.contains("hidden") && viewport.clientWidth && viewport.clientHeight) {
    const dt=Math.min((time-dvdMotion.last)/1000,.04) || 0;
    const maxX=Math.max(0,viewport.clientWidth-saver.offsetWidth-18);
    const maxY=Math.max(0,viewport.clientHeight-saver.offsetHeight-18);
    dvdMotion.x+=dvdMotion.vx*dt; dvdMotion.y+=dvdMotion.vy*dt;
    let bounced=false;
    if (dvdMotion.x<=9 || dvdMotion.x>=maxX) { dvdMotion.vx*=-1; dvdMotion.x=Math.max(9,Math.min(maxX,dvdMotion.x)); bounced=true; }
    if (dvdMotion.y<=9 || dvdMotion.y>=maxY) { dvdMotion.vy*=-1; dvdMotion.y=Math.max(9,Math.min(maxY,dvdMotion.y)); bounced=true; }
    if (bounced) {
      dvdMotion.color=(dvdMotion.color+1)%dvdColors.length;
      saver.style.setProperty("--dvd-color",dvdColors[dvdMotion.color]);
    }
    saver.style.transform=`translate3d(${dvdMotion.x}px,${viewport.scrollTop+dvdMotion.y}px,0)`;
  }
  dvdMotion.last=time;
  requestAnimationFrame(animateDvd);
}
requestAnimationFrame(animateDvd);
async function loadOlder() {
  if (!state.messages.size || !state.hasMore || el("load-older").disabled) return false;
  const version=state.historyVersion;
  const first=Math.min(...state.messages.keys());
  const scroll=el("message-scroll"), height=scroll.scrollHeight, top=scroll.scrollTop;
  el("load-older").disabled=true;
  try {
    const response=await fetch(hangout.scoped("/api/messages?before_id="+first+"&limit=100"));
    if (!response.ok) throw new Error("History could not be loaded. Please try again.");
    const data=await response.json();
    if (version!==state.historyVersion || !state.joined) return;
    data.messages.forEach(m => state.messages.set(m.id,m));
    state.hasMore=data.has_more; renderMessages();
    scroll.scrollTop=top+scroll.scrollHeight-height;
    return true;
  } catch (error) { if (version===state.historyVersion) roomError(error.message); return false; }
  finally { el("load-older").disabled=false; }
}
el("load-older").addEventListener("click",loadOlder);
