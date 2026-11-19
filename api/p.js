// 게시판 글 공유 링크: 카톡 등 미리보기용 제목·요약·사진을 담고, 사람이 열면 앱의 그 글로 이동
const SUPA_URL = process.env.SUPABASE_URL || 'https://fboqjlzgyfewgsoxclxy.supabase.co';
const SUPA_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZib3FqbHpneWZld2dzb3hjbHh5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc3ODQ4MzIsImV4cCI6MjA5MzM2MDgzMn0.x4ima7dIQRP6q9nmCyWi0DIOOA3ZmSorjX-gE3lthiU'; // 공개용 anon 키 (index.html과 동일)
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

module.exports = async (req, res) => {
  const k = String(req.query.k || '');
  const proto = req.headers['x-forwarded-proto'] || 'https', host = req.headers['x-forwarded-host'] || req.headers.host;
  const origin = `${proto}://${host}`;
  const target = /^(news|info)_\d+$/.test(k) ? `/?post=${encodeURIComponent(k)}` : '/';
  let title = 'ATTACK FC', desc = 'ATTACK FC 게시판', img = `${origin}/emblem_v4.png`;
  if (target !== '/') {
    try {
      const r = await fetch(`${SUPA_URL}/rest/v1/lineup_store?select=data&key=eq.${encodeURIComponent(k)}`, { headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` } });
      const d = ((await r.json()) || [])[0];
      if (d && d.data && d.data.title) {
        title = `${d.data.title} | ATTACK FC`;
        desc = String(d.data.body || '').replace(/\s+/g, ' ').trim().slice(0, 110) || desc;
        if (/^https?:\/\//.test(d.data.photo || '')) img = d.data.photo;
      }
    } catch (e) {}
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=3600');
  res.end(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta property="og:type" content="article"><meta property="og:site_name" content="ATTACK FC">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(img)}"><meta property="og:url" content="${esc(origin + '/api/p?k=' + encodeURIComponent(k))}">
<meta name="twitter:card" content="summary_large_image">
<meta http-equiv="refresh" content="0;url=${esc(target)}">
</head><body><script>location.replace(${JSON.stringify(target)})</script><a href="${esc(target)}">ATTACK FC에서 보기</a></body></html>`);
};
