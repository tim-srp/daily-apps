/* 投放参谋 · 本地指标计算（浏览器 & Node 通用，无依赖） */
(function (root) {
  const FIELDS = {
    date: ['日期', '时间', '日期时间', 'day', 'date', 'reportingstarts', '统计日期', 'stat_date'],
    campaign: ['计划名称', '广告计划', '计划', '广告计划名称', '广告组名称', '广告名称', '推广计划', '单元名称', 'campaignname', 'campaign', 'adsetname', 'adname', 'adgroup', '广告'],
    spend: ['消耗', '花费', '总花费', '消耗元', '花费元', '总消耗', '整体消耗', 'amountspent', 'amountspentusd', 'spend', 'cost', '费用'],
    impressions: ['展示数', '展示', '展示次数', '曝光', '曝光量', '曝光次数', 'impressions', 'impr', 'impr.'],
    clicks: ['点击数', '点击', '点击次数', '点击量', 'linkclicks', 'clicks', 'clicksall', '链接点击量'],
    conversions: ['转化数', '转化', '目标转化量', '转化量', '下单量', '成交订单数', '支付订单数', '整体成交订单数', 'purchases', 'conversions', 'results', '购买次数'],
    revenue: ['成交金额', '支付gmv', '整体成交金额', '直接成交金额', '下单金额', '支付金额', '转化价值', '销售额', 'gmv', 'purchasesconversionvalue', 'purchaseconversionvalue', 'conversionvalue', 'conv.value', 'convvalue', 'totalconvvalue', 'revenue'],
  };
  const LABEL = { date: '日期', campaign: '计划/广告', spend: '消耗', impressions: '展示', clicks: '点击', conversions: '转化', revenue: '成交金额' };
  const norm = s => String(s || '').toLowerCase().replace(/[\s_\-()（）【】\[\]:：%¥$]/g, '').replace(/\(.*?\)/g, '');
  function parseCSV(text) {
    text = text.replace(/^\uFEFF/, '');
    const first = text.split(/\r?\n/)[0] || '';
    const sep = (first.match(/\t/g) || []).length > (first.match(/,/g) || []).length ? '\t' : ',';
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
      else if (c === '"') q = true;
      else if (c === sep) { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(r => r.some(x => String(x).trim() !== ''));
  }
  function guessMap(headers) {
    const map = {}; const used = new Set();
    for (const f of Object.keys(FIELDS)) {
      const al = FIELDS[f].map(norm);
      let idx = headers.findIndex((h, i) => !used.has(i) && al.includes(norm(h)));
      if (idx < 0) idx = headers.findIndex((h, i) => !used.has(i) && al.some(a => a.length > 3 && norm(h).startsWith(a)));
      if (idx >= 0) { map[f] = idx; used.add(idx); }
    }
    return map;
  }
  const num = v => { if (v == null) return 0; const s = String(v).replace(/[,¥$€￥%\s]/g, ''); const n = parseFloat(s); return isFinite(n) ? n : 0; };
  function normDate(v) {
    if (typeof v === 'number' && v > 20000 && v < 80000) { const d = new Date(Date.UTC(1899, 11, 30) + v * 864e5); return d.toISOString().slice(0, 10); }
    const s = String(v || '').trim(); const m = s.match(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
    return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : s;
  }
  const ratios = t => ({
    ...t,
    ctr: t.impressions ? t.clicks / t.impressions * 100 : 0, cvr: t.clicks ? t.conversions / t.clicks * 100 : 0,
    cpc: t.clicks ? t.spend / t.clicks : 0, cpm: t.impressions ? t.spend / t.impressions * 1000 : 0,
    cpa: t.conversions ? t.spend / t.conversions : 0, roas: t.spend ? t.revenue / t.spend : 0,
  });
  const zero = () => ({ spend: 0, impressions: 0, clicks: 0, conversions: 0, revenue: 0 });
  const add = (a, r) => { for (const k in a) a[k] += r[k] || 0; return a; };
  function median(a) { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
  function analyze(rows, map) {
    const recs = rows.map(r => ({
      date: map.date != null ? normDate(r[map.date]) : '', campaign: map.campaign != null ? String(r[map.campaign] || '未命名').trim() : '全部',
      spend: num(r[map.spend]), impressions: num(r[map.impressions]), clicks: num(r[map.clicks]), conversions: num(r[map.conversions]), revenue: map.revenue != null ? num(r[map.revenue]) : 0,
    })).filter(r => r.spend || r.impressions || r.clicks);
    const totals = ratios(recs.reduce(add, zero()));
    const byDay = {}, byCamp = {};
    for (const r of recs) { add(byDay[r.date] ||= zero(), r); add(byCamp[r.campaign] ||= zero(), r); }
    const days = Object.keys(byDay).sort().map(d => ({ date: d, ...ratios(byDay[d]) }));
    const camps = Object.entries(byCamp).map(([name, t]) => ({ name, ...ratios(t) })).sort((a, b) => b.spend - a.spend);
    // 近7天 vs 前7天
    let wow = null;
    if (days.length >= 14) {
      const sum = arr => ratios(arr.reduce(add, zero()));
      const strip = d => ({ spend: d.spend, impressions: d.impressions, clicks: d.clicks, conversions: d.conversions, revenue: d.revenue });
      const a = sum(days.slice(-7).map(strip)), b = sum(days.slice(-14, -7).map(strip));
      const pc = (x, y) => y ? (x - y) / y * 100 : 0;
      wow = { 消耗: pc(a.spend, b.spend), 转化: pc(a.conversions, b.conversions), CTR: pc(a.ctr, b.ctr), CVR: pc(a.cvr, b.cvr), CPA: pc(a.cpa, b.cpa), CPM: pc(a.cpm, b.cpm), ROAS: pc(a.roas, b.roas) };
    }
    // 异常检测：与前 7 天中位数比较，鲁棒 z（MAD）且相对变化 > 25%
    const anomalies = [];
    const check = (series, label, key, scope) => {
      for (let i = 7; i < series.length; i++) {
        const win = series.slice(i - 7, i).map(d => d[key]); const med = median(win);
        const mad = median(win.map(x => Math.abs(x - med))) * 1.4826 || med * 0.05 || 1e-9;
        const v = series[i][key]; const z = (v - med) / mad; const rel = med ? (v - med) / med : 0;
        if (Math.abs(z) > 3 && Math.abs(rel) > 0.25 && series[i].impressions > 0)
          anomalies.push({ date: series[i].date, scope, metric: label, value: v, baseline: med, z: +z.toFixed(1), change: +(rel * 100).toFixed(1),
            desc: `${scope} ${series[i].date} ${label} ${fmt(v, key)}，较前7天中位数 ${fmt(med, key)} ${rel > 0 ? '上升' : '下降'} ${Math.abs(rel * 100).toFixed(0)}%` });
      }
    };
    const M = [['CPA', 'cpa'], ['CTR', 'ctr'], ['CVR', 'cvr'], ['CPM', 'cpm'], ['ROAS', 'roas']];
    M.forEach(([l, k]) => check(days, l, k, '账户'));
    for (const c of camps.slice(0, 8)) {
      const s = {}; recs.filter(r => r.campaign === c.name).forEach(r => add(s[r.date] ||= zero(), r));
      const ser = Object.keys(s).sort().map(d => ({ date: d, ...ratios(s[d]) }));
      M.forEach(([l, k]) => check(ser, l, k, `「${c.name}」`));
      if (ser.length >= 14) {
        const f7 = ratios(ser.slice(0, 7).reduce(add, zero())), l7 = ratios(ser.slice(-7).reduce(add, zero()));
        c.ctrTrend = f7.ctr ? (l7.ctr - f7.ctr) / f7.ctr * 100 : 0;
        if (c.ctrTrend < -25) anomalies.push({ date: ser[ser.length - 1].date, scope: `「${c.name}」`, metric: 'CTR趋势', change: +c.ctrTrend.toFixed(1), z: null,
          desc: `「${c.name}」近7天 CTR 较首7天下降 ${Math.abs(c.ctrTrend).toFixed(0)}%，疑似素材疲劳` });
      }
    }
    anomalies.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
    return { records: recs.length, totals, days, camps, wow, anomalies, hasRevenue: map.revenue != null };
  }
  function fmt(v, k) {
    if (k === 'ctr' || k === 'cvr') return v.toFixed(2) + '%';
    if (k === 'roas') return v.toFixed(2);
    return v >= 1000 ? Math.round(v).toLocaleString() : v.toFixed(2);
  }
  // 两比例检验样本量（每组），alpha 双侧
  function sampleSize(p1, mdeRel, alpha = 0.05, power = 0.8) {
    const p2 = p1 * (1 + mdeRel), pb = (p1 + p2) / 2;
    const za = { 0.1: 1.6449, 0.05: 1.96, 0.01: 2.5758 }[alpha] || 1.96, zb = { 0.8: 0.8416, 0.9: 1.2816 }[power] || 0.8416;
    return Math.ceil(Math.pow(za * Math.sqrt(2 * pb * (1 - pb)) + zb * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2)), 2) / Math.pow(p2 - p1, 2));
  }
  const api = { FIELDS, LABEL, parseCSV, guessMap, analyze, sampleSize, num, normDate, fmt, ratios };
  if (typeof module !== 'undefined') module.exports = api; else root.Metrics = api;
})(this);
