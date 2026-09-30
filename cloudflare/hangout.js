export const REACTIONS = new Set(["🔥", "😂", "❤️", "👀", "💀"]);
export function validRoom(value) { return value === "main" || /^[0-9a-f]{32}$/.test(value); }
export function videoSource(value) {
  if (value?.kind === "youtube" && typeof value.id === "string" && /^[A-Za-z0-9_-]{11}$/.test(value.id)) return {kind:"youtube", id:value.id};
  if (value?.kind === "direct" && typeof value.url === "string" && value.url.length <= 2048) {
    try {
      const url = new URL(value.url);
      if (url.protocol === "https:" && !url.username && !url.password && /\.(mp4|webm|ogv)$/i.test(url.pathname)) {
        return {kind:"direct", url:url.href};
      }
    } catch { /* Unsupported URL. */ }
  }
  return null;
}
export function changeWatch(current, payload, actor, hostOnline, now = Date.now()) {
  const host = current?.host_id === actor.session_id;
  if (current && !host && (hostOnline || !["claim", "start"].includes(payload.action))) throw Error("The host controls this watch party.");
  if (payload.action === "start") {
    const video = videoSource(payload.video);
    if (!video) throw Error("Use a YouTube or HTTPS MP4/WebM video link.");
    return {id:crypto.randomUUID(), video, host_id:actor.session_id, host_name:actor.name, position:0, playing:false, updated_at:now};
  }
  if (payload.action === "claim" && current) {
    const position = current.position + (current.playing ? Math.max(0, now-current.updated_at)/1000 : 0);
    return {...current, host_id:actor.session_id, host_name:actor.name, position:Math.min(position,86400), updated_at:now};
  }
  if (payload.action === "stop" && host) return null;
  if (payload.action === "sync" && host && typeof payload.playing === "boolean" &&
      Number.isFinite(payload.position) && payload.position >= 0 && payload.position <= 86400) {
    return {...current, position:payload.position, playing:payload.playing, updated_at:now};
  }
  throw Error("That watch control is unavailable.");
}
