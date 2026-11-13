// 팀 유튜브 재생목록의 최근 영상 목록. 제목·영상 ID·게시 시점만 돌려줍니다.
// 순서: ① YouTube Data API (환경변수 YT_API_KEY 가 있을 때) ② RSS 피드 ③ 재생목록 페이지
const HANDLE = 'ch.attack4905';
const PLAYLIST_ID = process.env.YT_PLAYLIST_ID || 'PLYNW_qDTSA36dU3n9bd-lKPXKlyqn67dV';
const UA = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', 'accept-language': 'ko-KR,ko;q=0.9' };
let cache = { at: 0, data: null };

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
// "3주 전", "2 weeks ago" 같은 글을 대략의 초로
function agoSec(t) {
  t = String(t || '');
  const n = parseInt((t.match(/(\d+)/) || [])[1] || '1', 10);
  const units = [[/초|second/, 1], [/분|minute/, 60], [/시간|hour/, 3600], [/일|day/, 86400], [/주|week/, 604800], [/개월|달|month/, 2592000], [/년|year/, 31536000]];
  for (const [re, s] of units) if (re.test(t)) return n * s;
  return null;
}
function unjson(s) { try { return JSON.parse('"' + s + '"'); } catch (e) { return s; } }
// 재생목록 페이지(ytInitialData)에서 영상 목록을 뽑는다
function parsePlaylistPage(html) {
  const out = []; const seen = new Set();
  const re = /"playlistVideoRenderer":\{"videoId":"([\w-]{11})"/g; let m;
  while ((m = re.exec(html))) {
    const id = m[1]; if (seen.has(id)) continue; seen.add(id);
    const chunk = html.slice(m.index, m.index + 6000);
    const title = (chunk.match(/"title":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"/) || chunk.match(/"title":\{"simpleText":"((?:[^"\\]|\\.)*)"/) || [])[1];
    const info = (chunk.match(/"videoInfo":\{"runs":\[(.*?)\]\}/) || [])[1] || '';
    const texts = [...info.matchAll(/"text":"((?:[^"\\]|\\.)*)"/g)].map(x => unjson(x[1]));
    const ago = texts.reverse().find(x => agoSec(x) != null && /전|ago/.test(x)) || '';
    const s = agoSec(ago);
    out.push({ id, title: unjson(title || ''), published: s != null ? new Date(Date.now() - s * 1000).toISOString() : null });
  }
  return out;
}
async function viaApi() {
  const key = process.env.YT_API_KEY; if (!key) throw new Error('no key');
  const r = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&maxResults=50&playlistId=${PLAYLIST_ID}&key=${key}`);
  if (!r.ok) throw new Error('api ' + r.status);
  const d = await r.json();
  return (d.items || []).map(it => ({ id: it.contentDetails.videoId, title: it.snippet.title, published: it.contentDetails.videoPublishedAt || it.snippet.publishedAt }))
    .filter(v => v.title !== 'Private video' && v.title !== 'Deleted video');
}
async function viaFeed() {
  const r = await fetch(`https://www.youtube.com/feeds/videos.xml?playlist_id=${PLAYLIST_ID}`, { headers: UA });
  if (!r.ok) throw new Error('feed ' + r.status);
  const v = parseFeed(await r.text()); if (!v.length) throw new Error('feed empty'); return v;
}
async function viaPage() {
  const r = await fetch(`https://www.youtube.com/playlist?list=${PLAYLIST_ID}&hl=ko&gl=KR`, { headers: UA });
  if (!r.ok) throw new Error('page ' + r.status);
  const v = parsePlaylistPage(await r.text()); if (!v.length) throw new Error('page empty'); return v;
}
module.exports = async (req, res) => {
  const errors = [];
  try {
    if (!cache.data || Date.now() - cache.at > 15 * 60 * 1000) {
      let v = null;
      for (const f of [viaApi, viaFeed, viaPage]) { try { v = await f(); break; } catch (e) { errors.push(String(e.message || e)); } }
      if (!v) throw new Error(errors.join(' / '));
      v.sort((a, b) => (b.published ? Date.parse(b.published) : 0) - (a.published ? Date.parse(a.published) : 0));
      cache = { at: Date.now(), data: v.slice(0, 6) };
    }
    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=3600');
    res.status(200).json({ channel: `https://www.youtube.com/playlist?list=${PLAYLIST_ID}`, videos: cache.data });
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ channel: `https://www.youtube.com/playlist?list=${PLAYLIST_ID}`, videos: [], error: String(e.message || e) });
  }
};
module.exports.parseFeed = parseFeed;
module.exports.parsePlaylistPage = parsePlaylistPage;
