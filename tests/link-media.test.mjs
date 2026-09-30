import test from "node:test";
import assert from "node:assert/strict";
import "../app/static/link-media.js";
const media = globalThis.linkMedia;
const spotifyId = "0Lr4kGOYn9l83EjuK6cZFQ";

test("Spotify songs, collections and podcasts use official Spotify embeds", () => {
  for (const entity of ["track","album","playlist","artist","show","episode"]) {
    for (const prefix of ["","intl-en/","embed/"]) {
      const result = media.classify(`https://open.spotify.com/${prefix}${entity}/${spotifyId}?si=tracking`);
      assert.equal(result.type,"music");
      assert.equal(result.kind,"embed");
      assert.equal(result.player,`https://open.spotify.com/embed/${entity}/${spotifyId}`);
      assert.equal(result.height,["track","episode"].includes(entity) ? 152 : 352);
    }
  }
});
test("audio files never get video players, including Ogg audio", () => {
  for (const ext of ["mp3","m4a","m4b","wav","oga","ogg","opus","aac","flac"]) {
    const result = media.classify(`https://example.com/song.${ext}?signature=public`);
    assert.equal(result.type,"audio");
    assert.equal(result.kind,"direct");
    assert.equal(media.video(result.source),null);
  }
});
test("recognized video URLs preserve supported video providers", () => {
  for (const [url,provider] of [
    ["https://youtu.be/abcdefghijk","YouTube"],
    ["https://www.youtube.com/watch?v=abcdefghijk","YouTube"],
    ["https://youtube.com/shorts/abcdefghijk","YouTube"],
    ["https://vimeo.com/12345678","Vimeo"],
    ["https://www.instagram.com/reel/Example123/","Instagram"],
    ["https://www.tiktok.com/@someone/video/123456789012345","TikTok"],
    ["https://dai.ly/x123456","Dailymotion"],
    ["https://streamable.com/abc123","Streamable"],
    ["https://www.pexels.com/video/example-12345/","Pexels"],
    ["https://xhamster.com/videos/example-xh1Nq9a","xHamster"],
    ["https://example.com/file.MP4?key=public","Video"],
    ["https://example.com/file.webm","Video"],
    ["https://example.com/file.ogv","Video"],
  ]) {
    const result = media.classify(url);
    assert.equal(result?.type,"video",url);
    assert.equal(result.provider,provider);
  }
});
test("Drive files and Instagram posts are not assumed to be videos", () => {
  assert.equal(media.classify("https://drive.google.com/file/d/abcdefghijk/preview").type,"file");
  assert.equal(media.classify("https://www.instagram.com/p/Example123/").type,"post");
});
test("direct raster image links use images", () => {
  for (const ext of ["png","jpg","jpeg","webp","gif","avif"]) assert.equal(media.classify(`https://example.com/image.${ext}`).type,"image");
});
test("unknown pages, short links, misleading domains and unsafe URLs are not video guesses", () => {
  for (const url of ["https://example.com/article","https://example.com/?file=song.mp3","https://spotify.link/short",
    "https://spoti.fi/short","https://open.spotify.com/track/bad","https://open.spotify.com.evil.test/track/"+spotifyId,
    "https://youtube.com.evil.test/watch?v=abcdefghijk","javascript:alert(1)","file:///song.mp3","https://user:secret@example.com/a.mp4"]) {
    assert.equal(media.classify(url),null,url);
  }
});
test("messages find the first supported media and clean trailing punctuation", () => {
  assert.equal(media.first(`Read https://example.com/article then listen https://open.spotify.com/track/${spotifyId}).`).type,"music");
  assert.equal(media.first("Song https://example.com/a.mp3 then https://youtu.be/abcdefghijk").type,"audio");
  assert.equal(media.first("Only a website https://example.com/"),null);
});
