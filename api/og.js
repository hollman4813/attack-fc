// 링크 미리보기: 주어진 URL의 제목/대표 이미지/사이트명과 본문 앞부분 짧은 발췌만 돌려줍니다.
// (본문 전체나 이미지를 복사해 저장하지 않습니다)
const dns = require('dns').promises;
const net = require('net');

function isPrivateIp(ip) {
  if (net.isIPv6(ip)) return /^(::1|fc|fd|fe80)/i.test(ip) || ip === '::';
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}
async function assertPublic(u) {
  if (!/^https?:$/.test(u.protocol)) throw new Error('bad protocol');
  const { address } = await dns.lookup(u.hostname);
  if (isPrivateIp(address)) throw new Error('private host');
}
function meta(html, names) {
  for (const n of names) {
    const re1 = new RegExp(`<meta[^>]+(?:property|name)=["']${n}["'][^>]*content=["']([^"']*)["']`, 'i');
    const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${n}["']`, 'i');
    const m = html.match(re1) || html.match(re2);
    if (m && m[1].trim()) return decode(m[1].trim());
  }
  return '';
}
function decode(s) {
  return s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

function excerpt(html, desc) {
  let h = html.replace(/<(script|style|noscript|svg|nav|header|footer|aside|form|figure)[\s\S]*?<\/\1>/gi, ' ');
  const art = h.match(/<article[\s\S]*?<\/article>/i) || h.match(/<div[^>]+(?:id|class)=["'][^"']*(?:article|news_?body|newsct|content_?body|dic_area|story)[^"']*["'][\s\S]{0,60000}/i);
  if (art) h = art[0];
  const strip = t => decode(t.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&#\d+;/g, ' ')).replace(/\s+/g, ' ').trim();
  const junk = /무단|재배포|저작권|copyright|기자\s*[\w.-]*@|구독|좋아요|댓글|광고|ⓒ|©/i;
  let paras = (h.match(/<p[^>]*>[\s\S]*?<\/p>/gi) || []).map(strip).filter(t => t.length >= 30 && !junk.test(t));
  if (!paras.length) {
    // 네이버 등 <p> 없이 <br>로 줄바꿈하는 본문
    paras = decode(h.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(div|p)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ')).split(/\n+/).map(t => t.replace(/\s+/g, ' ').trim()).filter(t => t.length >= 30 && !junk.test(t));
  }
  let out = '';
  for (const p of paras) { if (out.length + p.length > 420) { if (!out) out = p.slice(0, 400) + '…'; break; } out += (out ? '\n\n' : '') + p; if (out.length > 250) break; }
  return out || desc || '';
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
  try {
    let url = new URL(String(req.query.url || ''));
    let html = '';
    for (let hop = 0; hop < 4; hop++) {
      await assertPublic(url);
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 7000);
      const r = await fetch(url, { redirect: 'manual', signal: ctl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AttackFCBot/1.0)', 'Accept': 'text/html' } });
      clearTimeout(t);
      if (r.status >= 300 && r.status < 400 && r.headers.get('location')) { url = new URL(r.headers.get('location'), url); continue; }
      if (!r.ok) throw new Error('http ' + r.status);
      html = (await r.text()).slice(0, 600000);
      break;
    }
    if (!html) throw new Error('empty');
    const title = meta(html, ['og:title', 'twitter:title']) || decode((html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || '').trim();
    let image = meta(html, ['og:image', 'twitter:image']);
    if (image) { try { image = new URL(image, url).href; } catch (e) { image = ''; } }
    const site = meta(html, ['og:site_name']) || url.hostname.replace(/^www\./, '');
    const description = meta(html, ['og:description', 'twitter:description', 'description']);
    res.status(200).json({ title, image, site, description, excerpt: excerpt(html, description), url: url.href });
  } catch (e) {
    res.status(200).json({ error: String(e.message || e) });
  }
};

module.exports.excerpt = excerpt;
