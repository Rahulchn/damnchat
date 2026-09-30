/* Pure, testable URL classification. Unknown pages are links, never guessed videos. */
globalThis.linkMedia = {
  url(value) {
    try {
      const url = new URL(value.replace(/[),.!?;:\]}]+$/, ""));
      return ["http:","https:"].includes(url.protocol) && !url.username && !url.password ? url : null;
    } catch { return null; }
  },
  classify(value) {
    const url = this.url(value);
    if (!url) return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host === "open.spotify.com") {
      const match = url.pathname.match(/^\/(?:intl-[a-z-]+\/)?(?:embed\/)?(track|album|playlist|artist|show|episode)\/([A-Za-z0-9]{22})\/?$/i);
      if (match) {
        const entity = match[1].toLowerCase(), id = match[2];
        return {type:"music", kind:"embed", provider:"Spotify", title:`Spotify ${entity}`,
          source:`https://open.spotify.com/${entity}/${id}`, player:`https://open.spotify.com/embed/${entity}/${id}`,
          height:["track","episode"].includes(entity) ? 152 : 352};
      }
      return null;
    }
    if (/\.(mp3|m4a|m4b|wav|oga|ogg|opus|aac|flac)$/i.test(url.pathname)) {
      return {type:"audio",kind:"direct",provider:"Audio",title:"Shared audio",source:url.href,player:url.href};
    }
    if (/\.(png|jpe?g|webp|gif|avif)$/i.test(url.pathname)) {
      return {type:"image",kind:"image",provider:"Image",title:"Shared image",source:url.href,player:url.href};
    }
    const video = this.video(value);
    if (!video) return null;
    const type = video.provider === "Google Drive" ? "file" :
      video.provider === "Instagram" && /^\/p\//.test(url.pathname) ? "post" : "video";
    return {...video,type};
  },
  first(text) {
    for (const match of text.matchAll(/https?:\/\/[^\s<>"']+/gi)) {
      const media = this.classify(match[0]);
      if (media) return media;
    }
    return null;
  },
  video(value) {
    const url = this.url(value);
    if (!url) return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    let videoId = "";
    if (host === "youtu.be") videoId = url.pathname.split("/").filter(Boolean)[0] || "";
    else if (["youtube.com","m.youtube.com","music.youtube.com","youtube-nocookie.com"].includes(host)) {
      if (url.pathname === "/watch") videoId = url.searchParams.get("v") || "";
      else {
        const parts = url.pathname.split("/").filter(Boolean);
        if (["shorts","embed","live"].includes(parts[0])) videoId = parts[1] || "";
      }
    }
    if (/^[A-Za-z0-9_-]{11}$/.test(videoId)) return {kind:"embed",provider:"YouTube",title:"YouTube video",source:url.href,player:`https://www.youtube-nocookie.com/embed/${videoId}`};
    if (host === "drive.google.com") {
      const driveId = url.pathname.match(/^\/file\/d\/([A-Za-z0-9_-]{10,})/)?.[1] || url.searchParams.get("id") || "";
      if (/^[A-Za-z0-9_-]{10,}$/.test(driveId)) {
        const resourceKey = url.searchParams.get("resourcekey");
        return {kind:"embed",provider:"Google Drive",title:"Google Drive file preview",source:url.href,
          player:`https://drive.google.com/file/d/${driveId}/preview${resourceKey ? `?resourcekey=${encodeURIComponent(resourceKey)}` : ""}`};
      }
    }
    if (host === "vimeo.com" || host === "player.vimeo.com") {
      const id = [...url.pathname.split("/").filter(Boolean)].reverse().find(part => /^\d+$/.test(part));
      if (id) return {kind:"embed",provider:"Vimeo",title:"Vimeo video",source:url.href,player:`https://player.vimeo.com/video/${id}`};
    }
    if (host === "instagram.com") {
      const match = url.pathname.match(/^\/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/);
      if (match) return {kind:"embed",provider:"Instagram",title:"Instagram post or Reel",source:url.href,player:`https://www.instagram.com/p/${match[1]}/embed/`,vertical:true};
    }
    if (["tiktok.com","m.tiktok.com"].includes(host)) {
      const match = url.pathname.match(/\/video\/(\d{10,24})/);
      if (match) return {kind:"embed",provider:"TikTok",title:"TikTok video",source:url.href,player:`https://www.tiktok.com/player/v1/${match[1]}?autoplay=0`,vertical:true};
    }
    if (["dailymotion.com","dai.ly"].includes(host)) {
      const parts = url.pathname.split("/").filter(Boolean), id = host === "dai.ly" ? parts[0] : parts[0] === "video" ? parts[1] : "";
      if (/^[A-Za-z0-9]+$/.test(id || "")) return {kind:"embed",provider:"Dailymotion",title:"Dailymotion video",source:url.href,player:`https://geo.dailymotion.com/player.html?video=${id}`};
    }
    if (host === "streamable.com") {
      const id = url.pathname.split("/").filter(Boolean).pop() || "";
      if (/^[A-Za-z0-9]+$/.test(id)) return {kind:"embed",provider:"Streamable",title:"Streamable video",source:url.href,player:`https://streamable.com/e/${id}`};
    }
    if (host === "pexels.com") {
      const match = url.pathname.match(/^\/video\/(?:[^/]*-)?(\d+)\/?$/);
      if (match) return {kind:"direct",provider:"Pexels",title:"Pexels video",source:url.origin+url.pathname,player:`https://www.pexels.com/download/video/${match[1]}/`};
    }
    if (["xhamster.com","xhamster46.desi"].includes(host)) {
      const match = url.pathname.match(/^\/videos\/[^/]*-([A-Za-z0-9]{6,20})\/?$/);
      if (match) return {kind:"embed",provider:"xHamster",title:"Shared video",source:url.origin+url.pathname,player:`${url.origin}/embed/${match[1]}`,
        alternatePlayer:host === "xhamster.com" ? null : `https://xhamster.com/embed/${match[1]}`};
    }
    if (/\.(mp4|webm|ogv)$/i.test(url.pathname)) return {kind:"direct",provider:"Video",title:"Shared video",source:url.href,player:url.href};
    return null;
  },
};
