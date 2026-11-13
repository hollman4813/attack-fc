// 팀 유튜브 채널의 최근 영상 목록 (공개 RSS 피드). 제목·영상 ID·게시일만 돌려줍니다.
const HANDLE = 'ch.attack4905';
// 메인에 보여줄 재생목록: 이름으로 찾고, 재생목록 ID(PL...)를 알면 PLAYLIST_ID 에 넣는 게 가장 확실합니다.
const PLAYLIST_NAME = 'ATTACK FC 2025ing';
const PLAYLIST_ID = process.env.YT_PLAYLIST_ID || 'PLYNW_qDTSA36dU3n9bd-lKPXKlyqn67dV';
let cache = { at: 0, data: null, channelId: null, playlistId: PLAYLIST_ID || null };

function decode(s) {
  return String(s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}
function parseFeed(xml) {
  const out = [];
  const re = /<entry>([\s\S]*?)<\/entry>/g; let m;
  while ((m = re.exec(xml))) {
    const e = m[1];
    const id = (e.match(/<yt:videoId>([^<]+)<\/yt:videoId>/) || [])[1];
    const title = (e.match(/<title>([^<]*)<\/title>/) || [])[1];
    const published = (e.match(/<published>([^<]+)<\/published>/) || [])[1];
    if (id) out.push({ id, title: decode(title), published });
  }
  return out;
}
async function playlistId() {
  if (cache.playlistId) return cache.playlistId;
  const r = await fetch(`https://www.youtube.com/@${HANDLE}/playlists`, { headers: { 'user-agent': 'Mozilla/5.0', 'accept-language': 'ko-KR,ko;q=0.9' } });
  const html = await r.text();
  const id = findPlaylist(html, PLAYLIST_NAME);
  if (!id) throw new Error('playlist not found');
  cache.playlistId = id;
  return id;
}
// 채널 재생목록 페이지에서 이름이 일치하는 재생목록의 ID를 찾는다
function findPlaylist(html, name) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`"(?:text|content|simpleText)":"${esc}"`, 'g'); let m;
  while ((m = re.exec(html))) {
    const before = html.slice(Math.max(0, m.index - 4000), m.index);
    const after = html.slice(m.index, m.index + 4000);
    const ids = [...before.matchAll(/"(?:playlistId|contentId)":"((?:PL|UU|OL)[\w-]{10,})"/g)];
    if (ids.length) return ids[ids.length - 1][1];
    const a = after.match(/"(?:playlistId|contentId)":"((?:PL|UU|OL)[\w-]{10,})"/);
    if (a) return a[1];
  }
  return null;
}
async function channelId() {
  if (cache.channelId) return cache.channelId;
  const r = await fetch(`https://www.youtube.com/@${HANDLE}`, { headers: { 'user-agent': 'Mozilla/5.0', 'accept-language': 'ko-KR,ko;q=0.9' } });
  const html = await r.text();
  const m = html.match(/"channelId":"(UC[\w-]{22})"/) || html.match(/channel\/(UC[\w-]{22})/);
  if (!m) throw new Error('channel not found');
  cache.channelId = m[1];
  return cache.channelId;
}
module.exports = async (req, res) => {
  try {
    if (!cache.data || Date.now() - cache.at > 15 * 60 * 1000) {
      let feed;
      try { feed = `https://www.youtube.com/feeds/videos.xml?playlist_id=${await playlistId()}`; }
      catch (e) { feed = `https://www.youtube.com/feeds/videos.xml?channel_id=${await channelId()}`; }
      const r = await fetch(feed);
      if (!r.ok) throw new Error('feed ' + r.status);
      cache = { ...cache, at: Date.now(), data: parseFeed(await r.text()).slice(0, 6) };
    }
    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=3600');
    res.status(200).json({ channel: cache.playlistId ? `https://www.youtube.com/playlist?list=${cache.playlistId}` : `https://www.youtube.com/@${HANDLE}`, videos: cache.data });
  } catch (e) {
    res.status(200).json({ channel: `https://www.youtube.com/@${HANDLE}`, videos: [], error: String(e.message || e) });
  }
};
module.exports.parseFeed = parseFeed;
module.exports.findPlaylist = findPlaylist;
