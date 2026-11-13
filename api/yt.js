// 팀 유튜브 채널의 최근 영상 목록 (공개 RSS 피드). 제목·영상 ID·게시일만 돌려줍니다.
const HANDLE = 'ch.attack4905';
let cache = { at: 0, data: null, channelId: null };

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
      const id = await channelId();
      const r = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${id}`);
      if (!r.ok) throw new Error('feed ' + r.status);
      cache = { ...cache, at: Date.now(), data: parseFeed(await r.text()).slice(0, 6) };
    }
    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=3600');
    res.status(200).json({ channel: `https://www.youtube.com/@${HANDLE}`, videos: cache.data });
  } catch (e) {
    res.status(200).json({ channel: `https://www.youtube.com/@${HANDLE}`, videos: [], error: String(e.message || e) });
  }
};
module.exports.parseFeed = parseFeed;
