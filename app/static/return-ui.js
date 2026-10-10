/* Personal room bookmarks and chat navigation. Nothing here uploads browser data. */
globalThis.returnUI = {
  key: "damnchat_saved_rooms_v1", saved: [], unread: [], filter: "all", storageOK: true,
  parseSaved(raw) {
    try {
      const entries = JSON.parse(raw), seen = new Set();
      return Array.isArray(entries) ? entries.filter(item => {
        if (!item || typeof item.id !== "string" || !/^[0-9a-f]{32}$/.test(item.id) || seen.has(item.id) ||
            typeof item.label !== "string" || !item.label.trim() || item.label.length > 40) return false;
        seen.add(item.id); return true;
      }).slice(0,12).map(({id,label}) => ({id,label:label.trim()})) : [];
    } catch { return []; }
  },
  matches(message, query, filter) {
    const body = typeof message.body === "string" ? message.body : "";
    const media = globalThis.linkMedia?.first(body);
    if (filter === "links" && !/https?:\/\//i.test(body)) return false;
    if (filter === "photos" && !message.image_url && media?.type !== "image") return false;
    if (filter === "music" && !["audio","music"].includes(media?.type)) return false;
    if (filter === "videos" && media?.type !== "video") return false;
    if (filter === "invites" && !message.party) return false;
    return `${message.name || ""} ${body}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  },
  init(config) {
    this.config = config; this.baseTitle = document.title;
    const el = config.el;
    this.readSaved();
    for (const id of ["saved-open","rooms-open"]) el(id).addEventListener("click", () => this.openSaved());
    el("save-room").addEventListener("click", () => this.openSaved(true));
    el("save-room-form").addEventListener("submit", event => {
      event.preventDefault();
      const id = config.room(), label = el("saved-room-label").value.trim();
      if (id === "main" || !/^[0-9a-f]{32}$/.test(id) || !label || label.length > 40) return;
      this.readSaved();
      if (this.saved.length >= 12 && !this.saved.some(item => item.id === id)) {
        el("saved-feedback").textContent = "You can keep 12 rooms. Remove one before saving another."; return;
      }
      const entries = [{id,label}, ...this.saved.filter(item => item.id !== id)];
      if (this.writeSaved(entries)) el("saved-feedback").textContent = "Saved on this device. Find it here next time.";
    });
    el("search-open").addEventListener("click", () => this.openSearch());
    el("search-query").addEventListener("input", () => this.renderSearch());
    for (const button of document.querySelectorAll('[data-search-filter]')) button.addEventListener("click", () => {
      this.filter = button.dataset.searchFilter; this.renderSearch();
    });
    el("search-older").addEventListener("click", async () => {
      el("search-older").disabled = true;
      el("search-feedback").textContent = "Loading earlier messages…";
      const success = await config.loadOlder();
      el("search-feedback").textContent = success === false ? "Couldn't load earlier messages. Check the connection and try again." : "";
      el("search-older").disabled = false; this.renderSearch();
    });
    document.addEventListener("visibilitychange", () => this.readIfVisible());
    el("message-scroll").addEventListener("scroll", () => this.readIfVisible());
    el("search-dialog").addEventListener("close", () => this.readIfVisible());
    window.addEventListener("storage", event => { if (event.key === this.key || event.key === null) this.readSaved(); });
    document.addEventListener("keydown", event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k" && config.state().joined && !document.querySelector("dialog[open]")) {
        event.preventDefault(); this.openSearch();
      }
    });
  },
  readSaved() {
    try { this.saved = this.parseSaved(localStorage.getItem(this.key)); this.storageOK = true; }
    catch { this.saved = []; this.storageOK = false; }
    this.renderSaved();
  },
  writeSaved(entries) {
    try { localStorage.setItem(this.key,JSON.stringify(entries)); this.saved = entries; this.renderSaved(); return true; }
    catch { this.config.el("saved-feedback").textContent = "Your browser blocked saving. Copy your invite link instead."; return false; }
  },
  openSaved(focusName = false) {
    this.readSaved();
    const el = this.config.el, id = this.config.room();
    const canSave = this.config.state().joined && id !== "main";
    el("save-room-form").classList.toggle("hidden",!canSave);
    el("saved-room-label").value = this.saved.find(item => item.id === id)?.label || "";
    el("saved-feedback").textContent = this.storageOK ? "" : "Browser storage is unavailable. Copy an invite link to keep it.";
    el("saved-dialog").showModal();
    if (focusName && canSave) el("saved-room-label").focus();
  },
  renderSaved() {
    if (!this.config) return;
    const el = this.config.el;
    el("saved-rooms-list").replaceChildren(); el("return-rooms-list").replaceChildren();
    el("return-rooms").classList.toggle("hidden",!this.saved.length);
    el("saved-empty").classList.toggle("hidden",!!this.saved.length);
    for (const [index,item] of this.saved.entries()) {
      const row = document.createElement("div"); row.className = "saved-room-row";
      const link = document.createElement("a"); link.href = "/?room="+item.id;
      const icon = document.createElement("span"); icon.className = "saved-room-icon"; icon.textContent = "#";
      const label = document.createElement("strong"); label.textContent = item.label;
      const arrow = document.createElement("span"); arrow.textContent = "↗"; arrow.setAttribute("aria-hidden","true");
      link.append(icon,label,arrow);
      const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "Remove";
      remove.setAttribute("aria-label", "Remove saved room " + item.label);
      remove.addEventListener("click", () => {
        this.readSaved();
        if (this.writeSaved(this.saved.filter(entry => entry.id !== item.id))) el("saved-feedback").textContent = "Removed from this device only. The room and its messages are unchanged.";
      });
      row.append(link,remove); el("saved-rooms-list").append(row);
      if (index < 3) el("return-rooms-list").append(link.cloneNode(true));
    }
    const saved = this.saved.find(item => item.id === this.config.room());
    el("save-room").textContent = saved ? "★ Saved room" : "☆ Save room";
    if (this.config.state().joined && this.config.room() !== "main") {
      el("room-heading").textContent = saved?.label || "Your hangout";
      el("sidebar-room").textContent = saved?.label || "Your hangout";
      el("room-heading").title = saved ? "Your personal room label, saved on this device" : "";
    }
  },
  connected() {
    this.unread = []; this.paintUnread(); this.renderSaved();
    this.config.el("save-room").classList.toggle("hidden",this.config.room() === "main");
    this.renderSearch();
  },
  openSearch() {
    if (!this.config.state().joined) return;
    this.config.el("search-feedback").textContent = "";
    this.renderSearch(); this.config.el("search-dialog").showModal(); this.config.el("search-query").focus();
    this.config.el("search-query").select();
  },
  renderSearch() {
    if (!this.config) return;
    const el = this.config.el, state = this.config.state();
    const all = [...state.messages.values()].sort((a,b) => b.id-a.id);
    const matches = all.filter(message => this.matches(message,el("search-query").value,this.filter));
    el("search-count").textContent = `${matches.length} match${matches.length === 1 ? "" : "es"} in ${all.length} loaded messages${matches.length > 50 ? " · showing newest 50" : ""}`;
    el("search-older").classList.toggle("hidden",!state.hasMore);
    document.querySelectorAll('[data-search-filter]').forEach(button => button.setAttribute("aria-pressed",String(button.dataset.searchFilter === this.filter)));
    const list = el("search-results"); list.replaceChildren();
    for (const message of matches.slice(0,50)) {
      const button = document.createElement("button"); button.type = "button"; button.className = "search-result";
      const meta = document.createElement("span"); meta.textContent = `${message.name} · ${new Date(message.created_at).toLocaleString([], {month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"})}`;
      const body = document.createElement("strong"); body.textContent = message.body || (message.image_url ? "Shared a photo" : "Message");
      const media = globalThis.linkMedia?.first(message.body || "");
      const type = document.createElement("small"); type.textContent = message.party ? "ROOM INVITATION ↗" :
        message.image_url || media?.type === "image" ? "PHOTO ↗" :
        ["audio","music"].includes(media?.type) ? "MUSIC & AUDIO ↗" : media?.type === "video" ? "VIDEO ↗" : "JUMP TO MESSAGE ↗";
      button.append(meta,body,type); button.addEventListener("click", () => { el("search-dialog").close(); this.jump(message.id); }); list.append(button);
    }
    el("search-empty").classList.toggle("hidden",!!matches.length);
  },
  jump(id) {
    const node = this.config.state().nodes.get(id);
    if (!node?.isConnected) { this.config.error("That message isn't loaded yet. Use Load earlier messages, then try the reply again."); return; }
    node.tabIndex = -1; node.focus({preventScroll:true});
    node.scrollIntoView({block:"center",behavior:matchMedia('(prefers-reduced-motion: reduce)').matches ? "instant" : "smooth"});
    node.classList.remove("message-spotlight"); void node.offsetWidth; node.classList.add("message-spotlight");
    setTimeout(() => node.classList.remove("message-spotlight"),2200);
  },
  receive(id, mine, nearBottom) {
    if (!mine && (document.hidden || !nearBottom || document.querySelector("dialog[open]")) && !this.unread.includes(id)) this.unread.push(id);
    this.paintUnread();
  },
  readIfVisible() {
    if (!this.config || document.hidden || document.querySelector("dialog[open]")) return;
    const scroll = this.config.el("message-scroll");
    if (scroll.scrollHeight-scroll.scrollTop-scroll.clientHeight < 75) { this.unread = []; this.paintUnread(); }
  },
  paintUnread() {
    if (!this.config) return;
    const count = this.unread.length;
    document.title = count ? `(${count > 99 ? "99+" : count}) New messages · damnchat` : this.baseTitle;
    this.config.el("new-message-label").textContent = count ? `${count} new message${count === 1 ? "" : "s"} ↓` : "Back to latest ↓";
    if (count) this.config.el("new-messages").classList.remove("hidden");
  },
  reset() {
    this.unread = []; this.paintUnread(); this.filter = "all";
    this.config.el("search-query").value = "";
    this.config.el("search-results").replaceChildren();
    for (const id of ["search-dialog","saved-dialog"]) this.config.el(id).close();
  },
};
