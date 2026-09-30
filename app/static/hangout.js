/* Room invites and synchronized playback; no video is fetched by the chat server. */
window.hangout = {
  room: "main", mode: "public", sessionId: null, watch: null, player: null,
  playerKind: null, playerReady: false, generation: 0, clockOffset: 0, suppressUntil: 0,
  lastPublish: 0, publishTimer: null, youtubePromise: null,
  partyNextAt:0, partyPending:false,
  scoped(path) {
    const url = new URL(path, location.origin);
    if (this.room !== "main") url.searchParams.set("room", this.room);
    return url.pathname + url.search;
  },
  init(config) {
    this.config = config;
    for (const id of ["party-open", "party-watch-open"]) config.el(id).addEventListener("click", () => this.openParty());
    config.el("create-room").addEventListener("click", () => { config.leave(); this.selectMode("private"); config.el("display-name").focus(); });
    config.el("party-form").addEventListener("submit", event => {
      event.preventDefault();
      if (this.room === "main" || this.partyPending || this.partyNextAt > Date.now()+this.clockOffset || !config.el("party-consent").checked) return;
      this.partyPending = this.send({type:"party_share",note:config.el("party-note").value.trim()});
      config.el("party-feedback").textContent = this.partyPending ? "Posting your invitation…" : "You're disconnected. Reconnect and try again.";
      this.updateParty();
    });
    setInterval(() => { this.updateParty(); this.expireCards(); },1000);
    const q = new URL(location.href).searchParams.get("room");
    if (q && /^[0-9a-f]{32}$/.test(q)) { this.room = q; this.mode = "invite"; }
    else if (q) { this.invalidInvite = true; config.el("join-error").textContent = "That invite is incomplete. Choose the public lounge or create a room."; }
    config.el("public-room").addEventListener("click", () => this.selectMode("public"));
    config.el("private-room").addEventListener("click", () => this.selectMode("private"));
    config.el("shuffle-name").addEventListener("click", () => {
      const first = ["Midnight", "Cosmic", "Sleepy", "Disco", "Velvet", "Neon", "Pocket", "Wild"];
      const last = ["Ghost", "Mango", "Otter", "Comet", "Panda", "Fox", "Goblin", "Waffle"];
      const values = crypto.getRandomValues(new Uint32Array(2));
      config.el("display-name").value = first[values[0] % first.length] + last[values[1] % last.length];
      config.el("display-name").dispatchEvent(new Event("input"));
    });
    config.el("invite-open").addEventListener("click", () => {
      config.el("invite-link").value = location.origin + (this.room === "main" ? "/" : "/?room=" + this.room);
      config.el("invite-description").textContent = this.room === "main" ? "Bring a friend to the public lounge." : "Anyone with this link can join this room and read its history. Share it with your people.";
      config.el("invite-status").textContent = "";
      config.el("invite-dialog").showModal();
    });
    config.el("invite-copy").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(config.el("invite-link").value); config.el("invite-status").textContent = "Link copied. Send it to your people."; }
      catch { config.el("invite-link").select(); config.el("invite-status").textContent = "Select and copy the link above."; }
    });
    config.el("watch-open").addEventListener("click", () => {
      if (this.watch) this.showWatch();
      else { config.el("watch-error").textContent = ""; config.el("watch-dialog").showModal(); }
    });
    config.el("watch-form").addEventListener("submit", event => {
      event.preventDefault();
      this.startFromUrl(config.el("watch-url").value);
    });
    config.el("watch-hide").addEventListener("click", () => {
      config.el("watch-panel").classList.add("hidden"); config.el("room-view").classList.remove("is-watching");
    });
    config.el("watch-resync").addEventListener("click", () => {
      if (!this.playerReady) this.startPlayer(); else this.applyRemote(true);
    });
    config.el("watch-claim").addEventListener("click", () => this.send({type:"watch", action:"claim"}));
    config.el("watch-stop").addEventListener("click", () => this.send({type:"watch", action:"stop"}));
    this.selectMode(this.mode, false);
    setInterval(() => {
      if (!this.watch || !this.playerReady || !config.state().ready) return;
      if (this.isHost()) {
        const local = this.readPlayer();
        if (local.playing && Date.now() - this.lastPublish > 10000) this.publish();
        else if (local.playing !== this.watch.playing || Math.abs(local.position - this.targetTime()) > 2) this.publish();
      } else this.applyRemote();
    }, 2000);
  },
  selectMode(mode, clear = true) {
    const el = this.config.el;
    this.mode = mode;
    if (clear) { this.invalidInvite = false; this.room = "main"; el("join-error").textContent = ""; history.replaceState(null,"",location.pathname); }
    el("public-room").setAttribute("aria-pressed", String(mode === "public"));
    el("private-room").setAttribute("aria-pressed", String(mode === "private"));
    el("room-picker").classList.toggle("hidden", mode === "invite");
    el("invite-notice").classList.toggle("hidden", mode !== "invite");
    el("join-label").textContent = mode === "public" ? "Enter the lounge" : mode === "private" ? "Create your hangout" : "Join your friends";
  },
  beforeJoin() {
    if (this.invalidInvite) return false;
    if (this.mode === "private" && this.room === "main") {
      this.room = this.config.makeId().replaceAll("-", "");
      history.replaceState(null, "", "/?room=" + this.room);
    }
    const el = this.config.el, privateRoom = this.room !== "main";
    el("watch-open").classList.toggle("hidden", !privateRoom);
    el("create-room").classList.toggle("hidden", privateRoom);
    el("lounge-back").classList.toggle("hidden", !privateRoom);
    el("party-open").classList.toggle("hidden", !privateRoom);
    el("banner-tag").classList.toggle("hidden", privateRoom);
    el("banner-copy").textContent = privateRoom ? "A room for your people. Want some new company?" : "Find your people. Follow an invite, or start your own room.";
    el("room-heading").textContent = privateRoom ? "Your hangout" : "The public lounge";
    el("room-subtitle").textContent = privateRoom ? "Your people. Your kind of chaos." : "Meet whoever's here.";
    el("sidebar-room").textContent = privateRoom ? "Your hangout" : "The public lounge";
    el("sidebar-room-detail").textContent = privateRoom ? "Invite your people" : "Everyone's here";
    return true;
  },
  send(payload) {
    const state = this.config.state();
    if (!state.ready || state.socket?.readyState !== WebSocket.OPEN) {
      this.config.el("watch-status").textContent = "Reconnecting to the room…"; return false;
    }
    state.socket.send(JSON.stringify(payload)); return true;
  },
  startFromUrl(value) {
    if (this.room === "main") return;
    const details = this.config.videoDetails(value.trim());
    let video;
    if (details?.provider === "YouTube") video = {kind:"youtube", id:new URL(details.player).pathname.split("/").pop()};
    else if (details?.kind === "direct") {
      const url = new URL(details.player);
      if (url.protocol === "https:" && /\.(mp4|webm|ogv)$/i.test(url.pathname)) video = {kind:"direct", url:url.href};
    }
    if (!video) { this.config.el("watch-error").textContent = "Use a YouTube link or a direct HTTPS MP4 / WebM file."; return; }
    this.config.el("watch-error").textContent = "Starting your watch party…";
    this.send({type:"watch", action:"start", video});
  },
  isHost() { return this.watch?.host_id === this.sessionId; },
  showWatch() {
    this.config.el("watch-panel").classList.remove("hidden");
    this.config.el("room-view").classList.add("is-watching");
  },
  receive(watch, serverTime) {
    if (this.room === "main") watch = null;
    const changed = watch?.id !== this.watch?.id;
    if (Number.isFinite(serverTime)) this.clockOffset = serverTime - Date.now();
    this.watch = watch;
    const el = this.config.el;
    if (!watch) {
      this.destroyPlayer(); el("watch-panel").classList.add("hidden"); el("room-view").classList.remove("is-watching");
      el("watch-open").classList.remove("is-live"); return;
    }
    el("watch-dialog").close();
    el("watch-open").classList.add("is-live");
    el("watch-host").textContent = this.isHost() ? "You're hosting" : `${watch.host_name} is hosting`;
    el("watch-claim").classList.toggle("hidden", watch.host_online || this.isHost());
    el("watch-stop").classList.toggle("hidden", !this.isHost());
    if (changed) {
      this.destroyPlayer(); this.showWatch();
      el("watch-status").textContent = this.isHost() ? "Press play to start the room." : "Join the player to watch in sync with the host.";
      const button = document.createElement("button"); button.type = "button"; button.textContent = "▶ Join the watch party";
      button.addEventListener("click", () => this.startPlayer()); el("watch-stage").replaceChildren(button);
      if (this.isHost()) this.startPlayer();
    } else if (this.playerReady && !this.isHost()) this.applyRemote();
    if (!watch.host_online) el("watch-status").textContent = "The host left. Become host to keep the party going.";
  },
  destroyPlayer() {
    this.generation++; clearTimeout(this.publishTimer); clearTimeout(this.loadTimer);
    if (this.playerKind === "youtube") this.player?.destroy?.();
    else if (this.player) { this.player.pause(); this.player.removeAttribute("src"); this.player.load(); }
    this.player = null; this.playerReady = false; this.playerKind = null;
    this.config.el("watch-stage").replaceChildren();
  },
  loadYouTube() {
    if (window.YT?.Player) return Promise.resolve();
    if (!this.youtubePromise) this.youtubePromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.youtubePromise = null; reject(Error("YouTube could not load. Check your connection and tap Resync.")); }, 15000);
      window.onYouTubeIframeAPIReady = () => { clearTimeout(timer); resolve(); };
      const script = document.createElement("script"); script.src = "https://www.youtube.com/iframe_api";
      script.onerror = () => { clearTimeout(timer); this.youtubePromise = null; reject(Error("YouTube could not load. Tap Resync to try again.")); };
      document.head.append(script);
    });
    return this.youtubePromise;
  },
  async startPlayer() {
    if (!this.watch) return;
    this.destroyPlayer(); const generation = this.generation, video = this.watch.video;
    const el = this.config.el;
    el("watch-status").textContent = "Loading the player…";
    this.loadTimer = setTimeout(() => {
      if (generation === this.generation && !this.playerReady) el("watch-status").textContent = "The video provider hasn't loaded. Tap Resync to retry, or end the party and try another link.";
    }, 20000);
    try {
      if (video.kind === "youtube") {
        await this.loadYouTube();
        if (generation !== this.generation || !this.watch) return;
        const mount = document.createElement("div"); el("watch-stage").replaceChildren(mount);
        this.playerKind = "youtube";
        this.player = new YT.Player(mount, {
          host:"https://www.youtube-nocookie.com", width:"100%", height:"100%", videoId:video.id,
          playerVars:{playsinline:1, origin:location.origin, rel:0},
          events:{
            onReady:() => { if (generation === this.generation) { this.playerReady = true; this.applyRemote(true); } },
            onStateChange:(event) => { if (generation === this.generation && [0,1,2].includes(event.data)) this.queuePublish(); },
            onError:() => { el("watch-status").textContent = "YouTube won't play this video here. The host can try a different video."; },
          },
        });
      } else {
        const player = document.createElement("video"); player.controls = true; player.playsInline = true; player.preload = "metadata";
        this.playerKind = "direct"; this.player = player; el("watch-stage").replaceChildren(player);
        player.addEventListener("loadedmetadata", () => { if (generation === this.generation) { this.playerReady = true; this.applyRemote(true); } });
        for (const event of ["play", "pause", "seeked", "ended"]) player.addEventListener(event, () => { if (generation === this.generation) this.queuePublish(); });
        player.addEventListener("error", () => { el("watch-status").textContent = "This video can't play here. Try another direct video link."; });
        player.src = video.url;
      }
    } catch (error) { el("watch-status").textContent = error.message; }
  },
  targetTime() {
    if (!this.watch) return 0;
    return Math.min(86400, this.watch.position + (this.watch.playing ? Math.max(0, Date.now()+this.clockOffset-this.watch.updated_at)/1000 : 0));
  },
  readPlayer() {
    if (this.playerKind === "youtube") {
      const playback = this.player?.getPlayerState?.();
      return {position:this.player?.getCurrentTime?.() || 0, playing:playback === 1 || (playback === 3 && !!this.watch?.playing)};
    }
    return {position:this.player?.currentTime || 0, playing:!!this.player && !this.player.paused && !this.player.ended};
  },
  applyRemote(force = false) {
    if (!this.watch || !this.playerReady || (this.isHost() && !force)) return;
    const target = this.targetTime(), local = this.readPlayer();
    this.suppressUntil = Date.now() + 700;
    if (this.playerKind === "youtube") {
      if (force || Math.abs(local.position-target)>2.5) this.player.seekTo(target, true);
      if (this.watch.playing && (!local.playing || force)) this.player.playVideo();
      else if (!this.watch.playing && local.playing) this.player.pauseVideo();
    } else {
      if (force || Math.abs(local.position-target)>2.5) this.player.currentTime = Math.min(target, Number.isFinite(this.player.duration) ? this.player.duration : target);
      if (this.watch.playing && (!local.playing || force)) this.player.play().catch(() => { this.config.el("watch-status").textContent = "Tap play once to enable playback on this device."; });
      else if (!this.watch.playing && local.playing) this.player.pause();
    }
    this.config.el("watch-status").textContent = this.isHost() ? "Your play, pause and seeking control the room." : `Following ${this.watch.host_name}. Tap Resync if playback drifts.`;
  },
  queuePublish() {
    if (!this.isHost() || !this.playerReady || Date.now() < this.suppressUntil) return;
    clearTimeout(this.publishTimer); this.publishTimer = setTimeout(() => this.publish(), 220);
  },
  publish() {
    if (!this.isHost() || !this.playerReady) return;
    const local = this.readPlayer();
    if (this.send({type:"watch", action:"sync", position:Math.min(86400,local.position), playing:local.playing})) this.lastPublish = Date.now();
  },
  leave() {
    this.partyPending = false; this.partyNextAt = 0; this.config.el("party-dialog").close();
    this.watch = null; this.destroyPlayer(); this.sessionId = null;
    this.config.el("watch-panel").classList.add("hidden"); this.config.el("room-view").classList.remove("is-watching");
  },
  partyState(payload) {
    this.partyPending = false;
    if (Number.isFinite(payload.server_time)) this.clockOffset = payload.server_time - Date.now();
    if (Number.isFinite(payload.next_at)) this.partyNextAt = payload.next_at;
    this.config.el("party-feedback").textContent = payload.type === "party_shared" ? "Invitation posted. People in the lounge can now join this room." : payload.message || "";
    this.updateParty();
  },
  updateParty() {
    if (!this.config) return;
    const seconds = Math.max(0,Math.ceil((this.partyNextAt-Date.now()-this.clockOffset)/1000));
    const countdown = `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,"0")}`;
    const el = this.config.el;
    el("party-submit").disabled = this.partyPending || !!seconds || !this.config.state().ready;
    el("party-countdown").textContent = seconds ? `This room can invite again in ${countdown}.` : "Ready when you are. No automatic posts.";
    for (const id of ["party-open","party-watch-open"]) el(id).textContent = seconds ? `Next invite · ${countdown}` : "Invite the lounge ↗";
  },
  openParty() {
    if (this.room === "main") return;
    const el = this.config.el;
    el("party-consent").checked = false;
    el("party-feedback").textContent = "";
    el("party-preview").replaceChildren(this.partyVisual(this.watch?.video));
    if (!el("party-note").value) el("party-note").value = this.watch ? "Join us to watch this together." : "Come hang out. There's a seat for you.";
    this.updateParty(); el("party-dialog").showModal();
  },
  partyVisual(video) {
    const visual = document.createElement("div"); visual.className = "party-visual";
    const symbol = document.createElement("span"); symbol.textContent = video ? "▶" : "✳"; visual.append(symbol);
    if (video?.kind === "youtube" && typeof video.id === "string" && /^[A-Za-z0-9_-]{11}$/.test(video.id)) {
      const image = document.createElement("img"); image.src = `https://i.ytimg.com/vi/${video.id}/mqdefault.jpg`;
      image.alt = "Shared YouTube video thumbnail"; image.loading = "lazy"; image.referrerPolicy = "no-referrer";
      image.addEventListener("error", () => image.remove(), {once:true}); visual.prepend(image);
    }
    return visual;
  },
  partyCard(message) {
    const party = message.party;
    if (!party || !/^[0-9a-f]{32}$/.test(party.room_id) || !Number.isFinite(party.expires_at)) return null;
    const card = document.createElement("div"); card.className = "party-card";
    card.append(this.partyVisual(party.video));
    const copy = document.createElement("div"); copy.className = "party-card-copy";
    const tag = document.createElement("span"); tag.className = "party-tag"; tag.textContent = party.video ? "WATCH ROOM INVITATION" : "ROOM INVITATION";
    const title = document.createElement("strong"); title.textContent = message.body;
    const hint = document.createElement("small"); hint.textContent = party.video ? "Video at time of sharing · join for the current session" : "A smaller room. A new conversation.";
    const join = document.createElement("a"); join.className = "party-join"; join.href = "/?room="+party.room_id;
    join.textContent = party.video ? "Join to watch together ↗" : "Join the hangout ↗";
    join.dataset.expires = String(party.expires_at); join.dataset.partyLink = "true";
    copy.append(tag,title,hint,join); card.append(copy);
    return card;
  },
  expireCards() {
    for (const link of document.querySelectorAll('[data-party-link="true"]')) {
      if (Number(link.dataset.expires) > Date.now()+this.clockOffset) continue;
      link.removeAttribute("href"); link.setAttribute("aria-disabled","true"); link.textContent = "Invitation expired"; delete link.dataset.partyLink;
    }
  },
};
