/* Resize the existing player, preserving playback and the chat draft. */
globalThis.watchLayout = {
  share: 64, theater: false,
  bounds(width) {
    if (width < 761) return {min:42,max:78}; // The divider is hidden in the stacked phone layout.
    return {min: Math.max(42,320 / width * 100), max: Math.min(78,(width - 310) / width * 100)};
  },
  init(el,resizeComposer) {
    this.el = el; this.resizeComposer = resizeComposer;
    const divider = el("watch-divider"), conversation = divider.parentElement;
    this.conversation = conversation;
    el("watch-theater").addEventListener("click", () => {
      this.theater = !this.theater;
      this.share = this.theater ? 76 : 60;
      this.render();
    });
    const resize = x => {
      const rect = conversation.getBoundingClientRect();
      const {min,max} = this.bounds(rect.width);
      this.share = Math.min(max,Math.max(min,(x - rect.left) / rect.width * 100));
      this.theater = this.share >= 72; this.render();
    };
    divider.addEventListener("pointerdown", event => {
      if (event.button !== 0) return;
      event.preventDefault(); divider.focus();
      divider.setPointerCapture(event.pointerId);
      conversation.classList.add("is-resizing");
      resize(event.clientX);
    });
    divider.addEventListener("pointermove", event => {
      if (divider.hasPointerCapture(event.pointerId)) resize(event.clientX);
    });
    const finish = () => conversation.classList.remove("is-resizing");
    divider.addEventListener("pointerup", event => {
      if (divider.hasPointerCapture(event.pointerId)) divider.releasePointerCapture(event.pointerId);
      finish();
    });
    divider.addEventListener("pointercancel",finish);
    divider.addEventListener("lostpointercapture",finish);
    divider.addEventListener("keydown", event => {
      if (!["ArrowLeft","ArrowRight","Home","End"].includes(event.key)) return;
      event.preventDefault();
      const {min,max} = this.bounds(conversation.clientWidth);
      const current = Math.min(max,Math.max(min,this.share));
      this.share = event.key === "Home" ? min : event.key === "End" ? max :
        Math.min(max,Math.max(min,current + (event.key === "ArrowRight" ? 3 : -3)));
      this.theater = this.share >= 72; this.render();
    });
    new ResizeObserver(() => this.render()).observe(conversation);
    new MutationObserver(() => this.render()).observe(el("room-view"),{attributes:true,attributeFilter:["class"]});
    this.render();
  },
  render() {
    const width = this.conversation.clientWidth;
    if (!width) return;
    const {min,max} = this.bounds(width);
    const share = Math.min(max,Math.max(min,this.share));
    this.conversation.style.setProperty("--watch-share",share + "%");
    const room = this.el("room-view");
    if (room.classList.contains("is-theater") !== this.theater) room.classList.toggle("is-theater",this.theater);
    this.el("message-input").placeholder = room.classList.contains("is-watching") ? "Send a message…" : "Type a message or share a link…";
    this.resizeComposer?.();
    const button = this.el("watch-theater");
    button.setAttribute("aria-pressed",String(this.theater));
    button.textContent = this.theater ? "⊞ Balanced view" : "⛶ Theater view";
    const divider = this.el("watch-divider");
    divider.setAttribute("aria-valuemin",String(Math.ceil(min)));
    divider.setAttribute("aria-valuemax",String(Math.floor(max)));
    divider.setAttribute("aria-valuenow",String(Math.round(share)));
    divider.setAttribute("aria-valuetext",`${Math.round(share)} percent video, ${Math.round(100-share)} percent chat`);
  },
};
