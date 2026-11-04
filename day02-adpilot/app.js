/* 投放参谋 AdPilot — 前端 */
const $ = (s, el = document) => el.querySelector(s), $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const toast = m => { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('on'), 1800); };
const CHANNELS = ['抖音', '小红书', '微信朋友圈', '千川', '巨量', 'Meta', 'Google'];
let LIMITS = {}, MODE = 'demo';
const state = { creative: null, matrix: null, report: null, selAngles: new Set() };

/* ---------- 主题 / 导航 ---------- */
const setTheme = t => { document.documentElement.dataset.theme = t; localStorage.setItem('adpilot.theme', t); };
setTheme(localStorage.getItem('adpilot.theme') || 'dark');
$('#theme').onclick = () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
function go(tab) { $$('#nav button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab)); $$('.tab').forEach(s => s.classList.toggle('on', s.id === 'tab-' + tab)); if (tab === 'projects') renderProjects(); if (tab === 'matrix') calc(); scrollTo(0, 0); }
$$('#nav button').forEach(b => b.onclick = () => go(b.dataset.tab));

/* ---------- 项目空间（localStorage） ---------- */
const DB_KEY = 'adpilot.v1';
const db = JSON.parse(localStorage.getItem(DB_KEY) || 'null') || { clients: { '默认客户': [] }, current: '默认客户' };
const saveDB = () => { localStorage.setItem(DB_KEY, JSON.stringify(db)); $('#projCount').textContent = (db.clients[db.current] || []).length || ''; };
function renderClients() { $('#client').innerHTML = Object.keys(db.clients).map(c => `<option ${c === db.current ? 'selected' : ''}>${esc(c)}</option>`).join(''); saveDB(); }
$('#client').onchange = e => { db.current = e.target.value; saveDB(); renderProjects(); };
$('#addClient').onclick = () => { const n = prompt('客户/品牌名称'); if (n && n.trim()) { db.clients[n.trim()] ||= []; db.current = n.trim(); renderClients(); renderProjects(); } };
renderClients();
function saveItem(type, title, data, input) {
  db.clients[db.current].unshift({ id: Date.now().toString(36), type, title, created: new Date().toLocaleString('zh-CN', { hour12: false }), data, input }); saveDB(); toast('已保存到「' + db.current + '」');
}
const TYPE = { creative: '创意方案', matrix: 'A/B 实验', report: '报表解读' };
function renderProjects() {
  const items = db.clients[db.current] || [];
  $('#pj-list').innerHTML = items.length ? `<div class="pj">${items.map(it => `<div class="card pjc"><div><span class="tag">${TYPE[it.type]}</span> <b>${esc(it.title)}</b><br><small>${esc(it.created)}${it.data._demo ? ' · 演示数据' : ''}</small></div>
    <div class="acts"><button class="ghost sm" data-open="${it.id}">打开</button><button class="ghost sm" data-md="${it.id}">Markdown</button><button class="ghost sm" data-pr="${it.id}">打印/PDF</button><button class="ghost sm" data-del="${it.id}">删除</button></div></div>`).join('')}</div>`
    : `<div class="card empty">「${esc(db.current)}」还没有保存的内容。生成方案、实验或报表解读后点“保存到项目”。</div>`;
  const find = id => items.find(i => i.id === id);
  $$('[data-open]').forEach(b => b.onclick = () => openItem(find(b.dataset.open)));
  $$('[data-md]').forEach(b => b.onclick = () => download(find(b.dataset.md).title + '.md', toMD(find(b.dataset.md))));
  $$('[data-pr]').forEach(b => b.onclick = () => printItem(find(b.dataset.pr)));
  $$('[data-del]').forEach(b => b.onclick = () => { if (confirm('删除这条记录？')) { db.clients[db.current] = items.filter(i => i.id !== b.dataset.del); saveDB(); renderProjects(); } });
}
$('#pj-md').onclick = () => { const it = db.clients[db.current] || []; if (!it.length) return toast('暂无内容'); download(db.current + '-投放参谋.md', it.map(toMD).join('\n\n---\n\n')); };
function openItem(it) {
  if (it.type === 'creative') { state.creative = it.data; renderCreative(it.data); go('creative'); }
  if (it.type === 'matrix') { state.matrix = it.data; renderMatrix(it.data); go('matrix'); }
  if (it.type === 'report') { state.report = it.data; renderReportDash(it.data.stats); renderReportAI(it.data.ai); go('report'); }
}
function download(name, text, mime = 'text/markdown') { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: mime + ';charset=utf-8' })); a.download = name.replace(/[\\/:*?"<>|]/g, '_'); a.click(); }

/* ---------- SSE 调用 ---------- */
async function runAgent(task, input, box) {
  box.innerHTML = `<div class="runhd"><b>Agent 进度</b><span class="tag" id="${task}-mtag">连接中</span></div><ul class="steps"></ul><div class="live" hidden></div>`;
  const ul = $('.steps', box), live = $('.live', box);
  const step = t => { $$('li', ul).forEach(l => { l.classList.remove('cur'); $('.d', l).textContent = '✓'; }); ul.insertAdjacentHTML('beforeend', `<li class="cur"><span class="d"></span><span>${esc(t)}</span></li>`); };
  const res = await fetch('stream', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task, input }) });
  if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || ('HTTP ' + res.status)); }
  const rd = res.body.getReader(), dec = new TextDecoder(); let buf = '', result = null;
  for (;;) {
    const { value, done } = await rd.read(); if (done) break;
    buf += dec.decode(value, { stream: true }); let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const fr = buf.slice(0, i); buf = buf.slice(i + 2);
      const ev = (fr.match(/^event: (.*)$/m) || [])[1], data = JSON.parse((fr.match(/^data: (.*)$/m) || [, '{}'])[1]);
      if (ev === 'mode') { const t = $('#' + task + '-mtag'); t.textContent = data.mode === 'real' ? 'ZooWork Agent' : '演示模式'; t.className = 'tag ' + data.mode; }
      if (ev === 'step') step(data.text);
      if (ev === 'delta') { live.hidden = false; live.textContent = `已生成 ${data.chars} 字…\n` + data.tail; }
      if (ev === 'error') throw new Error(data.message);
      if (ev === 'result') result = data;
    }
  }
  $$('li', ul).forEach(l => { l.classList.remove('cur'); $('.d', l).textContent = '✓'; });
  if (!result) throw new Error('未收到结果');
  ul.insertAdjacentHTML('beforeend', `<li><span class="d">✓</span><span>完成${result.demo ? '（演示数据）' : ''}</span></li>`); live.hidden = true;
  result.data._demo = !!result.demo; return result.data;
}
const demoBanner = d => d._demo ? `<div class="banner">⚠ 演示模式：以下为示例输出（非真实 Agent 生成），结构与真实结果一致。配置 ZOOWORK_API_KEY 后自动切换为 ZooWork Agent。</div>` : '';

/* ---------- 1 创意方案 ---------- */
$('#cr-ch').innerHTML = CHANNELS.map((c, i) => `<span class="chip ${i < 2 ? 'on' : ''}" data-c="${c}">${c}</span>`).join('');
$$('#cr-ch .chip').forEach(c => c.onclick = () => c.classList.toggle('on'));
$('#cr-fill').onclick = () => { const f = $('#cr-form'); Object.entries({ brand: '轻研所', product: '氨基酸洁面慕斯 150ml', points: '氨基酸表活、pH 5.5 弱酸性、按压即出绵密泡沫、首单 59 元', audience: '22-30 岁一二线通勤女性，偏敏感肌', budget: '日耗 8000 元，测试期 7 天', extra: '需要达人口播版本；避免与竞品直接对比' }).forEach(([k, v]) => f[k].value = v); };
const len = (s, unit) => unit === 'w' ? [...s].reduce((n, ch) => n + (/[\u2e80-\uffff]/.test(ch) ? 2 : 1), 0) : [...s].length;
$('#cr-form').onsubmit = async e => {
  e.preventDefault(); const f = new FormData(e.target), input = Object.fromEntries(f); input.channels = $$('#cr-ch .chip.on').map(c => c.dataset.c);
  if (!input.channels.length) return toast('请选择至少一个渠道');
  const b = $('#cr-go'); b.disabled = true; b.textContent = '生成中…';
  try { const d = await runAgent('creative', input, $('#cr-run')); d._input = input; state.creative = d; renderCreative(d); }
  catch (x) { toast('失败：' + x.message); } finally { b.disabled = false; b.textContent = '✦ 生成创意方案'; }
};
function renderCreative(d) {
  state.selAngles = new Set((d.angles || []).slice(0, 2).map(a => a.name));
  const byCh = {}; (d.copies || []).forEach(c => (byCh[c.channel] ||= []).push(c));
  $('#cr-out').innerHTML = `<div class="out">${demoBanner(d)}
  <div class="bar"><h2>✦ ${esc(d._input?.brand || '')} ${esc(d._input?.product || '')} · 创意方案</h2><div class="acts">
    <button class="ghost sm" id="cr-save">保存到项目</button><button class="ghost sm" id="cr-md">导出 Markdown</button><button class="ghost sm" id="cr-pr">打印/PDF</button><button class="primary" id="cr-ab" style="padding:7px 14px">用选中角度做 A/B →</button></div></div>
  <div class="card"><h2>洞察</h2><ul class="ins">${(d.insights || []).map(i => `<li>${esc(i)}</li>`).join('')}</ul></div>
  <div class="card"><h2>创意角度 <small class="tag">点击勾选，用于 A/B 实验</small></h2><div class="angles">${(d.angles || []).map(a => `<div class="angle ${state.selAngles.has(a.name) ? 'sel' : ''}" data-a="${esc(a.name)}"><span class="ck"></span>
    <h3>${esc(a.name)}</h3><small>${esc(a.insight)}</small><div class="hook">“${esc(a.hook)}”</div><div>${esc(a.headline)}</div><small style="margin-top:6px">💡 ${esc(a.why || '')}</small></div>`).join('')}</div></div>
  <div class="card"><h2>短视频分镜脚本</h2>${(d.scripts || []).map(s => `<div class="scr"><h4>${esc(s.title)} <span class="tag">${esc(s.angle)}</span> <span class="tag">${esc(s.duration)}</span></h4>
    <div class="tw"><table><tr><th>时间</th><th>画面</th><th>口播/字幕</th><th>拍摄提示</th></tr>${(s.shots || []).map(x => `<tr><td>${esc(x.t)}</td><td>${esc(x.visual)}</td><td>${esc(x.voice)}</td><td>${esc(x.note)}</td></tr>`).join('')}</table></div></div>`).join('')}</div>
  <div class="card"><h2>分渠道文案 <small class="tag">字数按参考上限校验，以平台后台为准</small></h2>${Object.entries(byCh).map(([ch, list]) => `<h4>${esc(ch)}</h4><div class="copies">${list.map(c => {
      const lim = (LIMITS[ch] || []).find(l => l[0] === c.field); const n = len(c.text, lim?.[2]); const over = lim && n > lim[1];
      return `<div class="cp"><div class="meta"><span>${esc(c.field)}</span><span class="cnt ${over ? 'over' : 'ok'}">${n}${lim ? '/' + lim[1] + (lim[2] === 'w' ? '（半角）' : '') : ''}${over ? ' 超限' : ''}</span></div><div class="t">${esc(c.text)}</div>
      <button class="ghost sm" style="margin-top:8px" data-copy="${esc(c.text)}">复制</button></div>`; }).join('')}</div>`).join('')}</div>
  ${(d.risks || []).length ? `<div class="card"><h2>⚖ 合规提示</h2><ul class="ins">${d.risks.map(r => `<li>${esc(r)}</li>`).join('')}</ul></div>` : ''}</div>`;
  $$('.angle').forEach(el => el.onclick = () => { const n = el.dataset.a; state.selAngles.has(n) ? state.selAngles.delete(n) : state.selAngles.add(n); el.classList.toggle('sel'); });
  $$('[data-copy]').forEach(b => b.onclick = () => { navigator.clipboard?.writeText(b.dataset.copy); toast('已复制'); });
  $('#cr-save').onclick = () => saveItem('creative', `${d._input?.brand || ''} 创意方案`, d, d._input);
  $('#cr-md').onclick = () => download('创意方案.md', toMD({ type: 'creative', title: '创意方案', data: d }));
  $('#cr-pr').onclick = () => printItem({ type: 'creative', title: `${d._input?.brand || ''} 创意方案`, data: d });
  $('#cr-ab').onclick = () => { if (!state.selAngles.size) return toast('请先勾选角度'); $('#mx-form').angles.value = [...state.selAngles].join(', '); go('matrix'); };
}

/* ---------- 2 A/B 实验矩阵 ---------- */
function calc() {
  const f = $('#mx-form'), metric = f.metric.value, base = +f.base.value / 100, mde = +f.mde.value / 100, unit = +f.unit.value, daily = +f.daily.value;
  const [alpha, power] = f.sig.value.split('|').map(Number);
  const angles = f.angles.value.split(/[,，、]/).map(s => s.trim()).filter(Boolean); const k = Math.max(2, angles.length);
  $('#mx-costlab').textContent = metric === 'CTR' ? 'CPM（元/千次展示）' : 'CPC（元/点击）';
  if (!(base > 0 && base < 1 && mde > 0)) { $('#mx-calc').innerHTML = '请填写有效的基线与提升幅度'; return null; }
  const n = Metrics.sampleSize(base, mde, alpha, power), costPer = metric === 'CTR' ? n * unit / 1000 : n * unit, total = costPer * k, days = daily ? total / daily : 0;
  const c = { metric, base, mde, alpha, power, n, k, costPer, total, days, unit, daily, angles: angles.length ? angles : ['A', 'B'] };
  $('#mx-calc').innerHTML = `每组需 <b>${n.toLocaleString()}</b> 次${metric === 'CTR' ? '展示' : '点击'}（${k} 组，检测 ${(base * 100).toFixed(2)}% → ${(base * (1 + mde) * 100).toFixed(2)}%）<br>
    每组预算约 <b>¥${Math.round(costPer).toLocaleString()}</b>，合计 <b>¥${Math.round(total).toLocaleString()}</b>，按每日 ¥${daily.toLocaleString()} 约需 <b>${days.toFixed(1)} 天</b>
    ${days > 14 ? '<br><span class="dn">⚠ 周期超过 14 天：建议提高 MDE、减少变体或增加预算</span>' : ''}`;
  return c;
}
$('#mx-form').oninput = calc;
$('#mx-form').onsubmit = async e => {
  e.preventDefault(); const c = calc(); if (!c) return; const b = $('#mx-go'); b.disabled = true; b.textContent = '生成中…';
  try {
    const ctx = state.creative ? { brand: state.creative._input?.brand, product: state.creative._input?.product, angleDetails: (state.creative.angles || []).filter(a => c.angles.includes(a.name)) } : {};
    const d = await runAgent('matrix', { angles: c.angles, metric: c.metric, baseline: c.base, mde: c.mde, perGroup: c.n, groups: c.k, estDays: +c.days.toFixed(1), ...ctx }, $('#mx-run'));
    d._calc = c; state.matrix = d; renderMatrix(d);
  } catch (x) { toast('失败：' + x.message); } finally { b.disabled = false; b.textContent = '▦ 生成实验矩阵'; }
};
function matrixRows(d) {
  const c = d._calc, vars = d.variables || [], rows = [];
  vars.forEach((v, vi) => (v.variants || []).forEach((x, i) => rows.push({ round: `第${vi + 1}轮`, variable: v.name, variant: x, share: (100 / v.variants.length).toFixed(1) + '%',
    sample: vi === 0 ? c.n : Metrics.sampleSize(c.base, c.mde, c.alpha, c.power), budget: Math.round(c.metric === 'CTR' ? c.n * c.unit / 1000 : c.n * c.unit), control: i === 0 ? '对照' : '' })));
  return rows;
}
function renderMatrix(d) {
  const c = d._calc, rows = matrixRows(d);
  $('#mx-out').innerHTML = `<div class="out">${demoBanner(d)}<div class="bar"><h2>▦ 实验矩阵</h2><div class="acts"><button class="ghost sm" id="mx-csv">导出 CSV（Excel 可打开）</button><button class="ghost sm" id="mx-save">保存到项目</button><button class="ghost sm" id="mx-pr">打印/PDF</button></div></div>
  <div class="kpis"><div class="kpi"><small>主指标</small><b>${esc(c.metric)}</b></div><div class="kpi"><small>每组样本</small><b>${c.n.toLocaleString()}</b></div><div class="kpi"><small>首轮预算</small><b>¥${Math.round(c.total).toLocaleString()}</b></div><div class="kpi"><small>预计周期</small><b>${c.days.toFixed(1)} 天</b></div><div class="kpi"><small>置信/功效</small><b>${(1 - c.alpha) * 100}% / ${c.power * 100}%</b></div></div>
  <div class="card"><h2>测试矩阵（变量 × 变体）</h2><div class="tw"><table><tr><th>轮次</th><th>变量</th><th>变体</th><th></th><th class="n">预算占比</th><th class="n">每组样本</th><th class="n">每组预算(元)</th></tr>
  ${rows.map(r => `<tr><td>${r.round}</td><td>${esc(r.variable)}</td><td>${esc(r.variant)}</td><td>${r.control ? '<span class="tag">对照</span>' : ''}</td><td class="n">${r.share}</td><td class="n">${r.sample.toLocaleString()}</td><td class="n">${r.budget.toLocaleString()}</td></tr>`).join('')}</table></div></div>
  <div class="grid2"><div class="card"><h2>假设</h2><ul class="ins">${(d.hypotheses || []).map(h => `<li>${esc(h)}</li>`).join('')}</ul><h2 style="margin-top:12px">实验设计</h2><p>${esc(d.design)}</p></div>
  <div class="card"><h2>成功指标</h2><p><b>主指标：</b>${esc(d.metrics?.primary)}</p><p><b>次指标：</b>${esc((d.metrics?.secondary || []).join('、'))}</p><p><b>护栏：</b>${esc((d.metrics?.guardrail || []).join('、'))}</p>
  <h2 style="margin-top:12px">执行注意</h2><ul class="ins">${(d.notes || []).map(h => `<li>${esc(h)}</li>`).join('')}</ul></div></div></div>`;
  $('#mx-csv').onclick = () => { const h = ['轮次', '变量', '变体', '对照', '预算占比', '每组样本', '每组预算(元)']; const q = s => `"${String(s).replace(/"/g, '""')}"`;
    download('AB实验矩阵.csv', '\uFEFF' + [h, ...rows.map(r => [r.round, r.variable, r.variant, r.control, r.share, r.sample, r.budget])].map(r => r.map(q).join(',')).join('\r\n'), 'text/csv'); };
  $('#mx-save').onclick = () => saveItem('matrix', `A/B：${c.angles.join(' vs ')}`, d);
  $('#mx-pr').onclick = () => printItem({ type: 'matrix', title: 'A/B 实验矩阵', data: d });
}

/* ---------- 3 报表解读 ---------- */
const drop = $('#rp-drop');
$('#rp-pick').onclick = () => $('#rp-file').click();
$('#rp-file').onchange = e => e.target.files[0] && loadFile(e.target.files[0]);
['dragover', 'dragenter'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('hover'); }));
['dragleave', 'drop'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove('hover'); }));
drop.addEventListener('drop', e => e.dataTransfer.files[0] && loadFile(e.dataTransfer.files[0]));
$$('[data-sample]').forEach(b => b.onclick = async () => { const t = await (await fetch('samples/' + b.dataset.sample)).text(); handleRows(Metrics.parseCSV(t), '示例数据 · ' + b.textContent, true); });
function loadXLSX() { return window.XLSX ? Promise.resolve() : new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'; s.onload = ok; s.onerror = () => no(new Error('XLSX 解析库加载失败，可另存为 CSV 再上传')); document.head.appendChild(s); }); }
async function loadFile(file) {
  try {
    if (/\.xlsx?$/i.test(file.name)) { await loadXLSX(); const wb = XLSX.read(await file.arrayBuffer()); const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' }); handleRows(rows.map(r => r.map(x => x)), file.name); }
    else { const buf = await file.arrayBuffer(); let t = new TextDecoder('utf-8').decode(buf); if (t.includes('\uFFFD')) t = new TextDecoder('gbk').decode(buf); handleRows(Metrics.parseCSV(t), file.name); }
  } catch (x) { toast(x.message); }
}
function handleRows(rows, name, sample) {
  // 跳过导出文件顶部的说明行：取前 10 行中匹配字段最多的一行作为表头
  let hi = 0, best = -1; rows.slice(0, 10).forEach((r, i) => { const n = Object.keys(Metrics.guessMap(r.map(String))).length; if (n > best) { best = n; hi = i; } });
  const headers = rows[hi].map(String), body = rows.slice(hi + 1).filter(r => !/^(合计|总计|total)/i.test(String(r[0] || '')));
  const map = Metrics.guessMap(headers); const need = ['spend', 'impressions', 'clicks', 'conversions'];
  const opts = i => `<option value="">— 无 —</option>` + headers.map((h, j) => `<option value="${j}" ${i === j ? 'selected' : ''}>${esc(h)}</option>`).join('');
  $('#rp-map').innerHTML = `<div class="card" style="margin-top:14px"><div class="bar"><h2>字段映射 <span class="tag">${esc(name)}</span> ${sample ? '<span class="tag demo">示例数据</span>' : ''}</h2>
    <small style="color:var(--mut)">已自动识别 ${Object.keys(map).length}/7 列，${body.length} 行</small></div><div class="mapg">${Object.keys(Metrics.FIELDS).map(f => `<label>${Metrics.LABEL[f]}${need.includes(f) ? ' *' : ''}<select data-f="${f}">${opts(map[f])}</select></label>`).join('')}</div>
    <button class="primary" id="rp-apply" style="padding:9px 18px">应用映射并分析</button></div>`;
  const apply = () => { const m = {}; $$('#rp-map select').forEach(s => { if (s.value !== '') m[s.dataset.f] = +s.value; });
    if (need.some(f => m[f] == null)) return toast('请映射必填字段：消耗/展示/点击/转化');
    const st = Metrics.analyze(body, m); st.source = name; st.sample = !!sample; state.report = { stats: st }; renderReportDash(st); interpret(st); };
  $('#rp-apply').onclick = apply;
  if (need.every(f => map[f] != null)) apply();
}
const F = Metrics.fmt, money = v => '¥' + (v >= 1e4 ? (v / 1e4).toFixed(2) + '万' : v.toFixed(2));
function svgChart(days, series, opts = {}) {
  const W = 640, H = 230, P = { l: 46, r: opts.right ? 46 : 12, t: 12, b: 26 }, iw = W - P.l - P.r, ih = H - P.t - P.b, n = days.length;
  const x = i => P.l + (n === 1 ? iw / 2 : i * iw / (n - 1)); let g = '';
  const axes = { l: series.filter(s => !s.right), r: series.filter(s => s.right) };
  const scale = arr => { const mx = Math.max(...arr.flatMap(s => s.data), 0) * 1.1 || 1; return { mx, y: v => P.t + ih - v / mx * ih }; };
  const L = scale(axes.l), R = axes.r.length ? scale(axes.r) : null;
  for (let k = 0; k <= 4; k++) { const yv = P.t + ih * k / 4; g += `<line x1="${P.l}" x2="${W - P.r}" y1="${yv}" y2="${yv}" stroke="var(--line)"/><text x="${P.l - 6}" y="${yv + 4}" text-anchor="end" font-size="10" fill="var(--mut)">${(L.mx * (1 - k / 4)).toFixed(L.mx < 10 ? 1 : 0)}</text>`;
    if (R) g += `<text x="${W - P.r + 6}" y="${yv + 4}" font-size="10" fill="var(--mut)">${(R.mx * (1 - k / 4)).toFixed(R.mx < 10 ? 1 : 0)}</text>`; }
  days.forEach((d, i) => { if (i % Math.ceil(n / 7) === 0) g += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" font-size="10" fill="var(--mut)">${d.date.slice(5)}</text>`; });
  for (const s of series) { const sc = s.right ? R : L;
    if (s.bar) { const bw = Math.max(2, iw / n * 0.6); s.data.forEach((v, i) => g += `<rect x="${x(i) - bw / 2}" y="${sc.y(v)}" width="${bw}" height="${P.t + ih - sc.y(v)}" rx="2" fill="${s.color}" opacity=".55"/>`); }
    else g += `<polyline fill="none" stroke="${s.color}" stroke-width="2.2" points="${s.data.map((v, i) => x(i) + ',' + sc.y(v)).join(' ')}"/>`; }
  (opts.marks || []).forEach(m => { const i = days.findIndex(d => d.date === m); if (i >= 0) g += `<circle cx="${x(i)}" cy="${P.t + 6}" r="5" fill="var(--bad)"><title>异常 ${m}</title></circle>`; });
  return `<svg viewBox="0 0 ${W} ${H}">${g}</svg><div class="lg">${series.map(s => `<span><i style="background:${s.color}"></i>${s.name}${s.right ? '（右轴）' : ''}</span>`).join('')}${opts.marks?.length ? '<span><i style="background:var(--bad);height:8px;width:8px;border-radius:50%"></i>账户级异常日</span>' : ''}</div>`;
}
function renderReportDash(st) {
  const t = st.totals, w = st.wow || {}, dl = (k, inv) => w[k] == null ? '' : `<span class="dl ${(w[k] >= 0) !== !!inv ? 'up' : 'dn'}">${w[k] >= 0 ? '▲' : '▼'} ${Math.abs(w[k]).toFixed(1)}% 环比</span>`;
  const K = [['消耗', money(t.spend), dl('消耗')], ['展示', Math.round(t.impressions).toLocaleString(), ''], ['点击', Math.round(t.clicks).toLocaleString(), ''], ['转化', Math.round(t.conversions).toLocaleString(), dl('转化')],
    ['CTR', F(t.ctr, 'ctr'), dl('CTR')], ['CVR', F(t.cvr, 'cvr'), dl('CVR')], ['CPC', '¥' + t.cpc.toFixed(2), ''], ['CPM', '¥' + t.cpm.toFixed(2), dl('CPM', 1)], ['CPA', '¥' + t.cpa.toFixed(2), dl('CPA', 1)], ['ROAS', st.hasRevenue ? t.roas.toFixed(2) : '—', dl('ROAS')]];
  const marks = st.anomalies.filter(a => a.scope === '账户').map(a => a.date);
  $('#rp-dash').innerHTML = `<div class="out">${st.sample ? '<div class="banner">示例数据：模拟 28 天投放报表，用于体验。指标为本地真实计算结果。</div>' : ''}
  <div class="bar"><h2>▲ 数据概览 <span class="tag">${esc(st.source)}</span><span class="tag">${st.days.length} 天 · ${st.camps.length} 个计划 · ${st.records} 行</span></h2></div>
  <div class="kpis">${K.map(k => `<div class="kpi"><small>${k[0]}</small><b>${k[1]}</b>${k[2]}</div>`).join('')}</div>
  <div class="charts"><div class="card chart"><h2>消耗与 ROAS</h2>${svgChart(st.days, [{ name: '消耗', data: st.days.map(d => d.spend), color: '#5b8cff', bar: 1 }, { name: 'ROAS', data: st.days.map(d => d.roas), color: '#22c55e', right: 1 }], { right: 1, marks })}</div>
  <div class="card chart"><h2>CTR / CVR 趋势（%）</h2>${svgChart(st.days, [{ name: 'CTR', data: st.days.map(d => d.ctr), color: '#8b5cf6' }, { name: 'CVR', data: st.days.map(d => d.cvr), color: '#f59e0b', right: 1 }], { right: 1, marks })}</div>
  <div class="card chart"><h2>CPA 趋势（元）</h2>${svgChart(st.days, [{ name: 'CPA', data: st.days.map(d => d.cpa), color: '#ef4444' }, { name: 'CPM', data: st.days.map(d => d.cpm), color: '#94a3b8', right: 1 }], { right: 1, marks })}</div>
  <div class="card"><h2>⚠ 异常检测 <span class="tag">${st.anomalies.length} 项</span></h2>${st.anomalies.length ? `<ul class="ins anoms">${st.anomalies.slice(0, 10).map(a => `<li><span class="tag ${Math.abs(a.change) > 50 ? 'high' : 'mid'}">${esc(a.metric)}</span> ${esc(a.desc)}</li>`).join('')}</ul><small style="color:var(--mut)">规则：较前 7 天中位数的鲁棒 z 值 |z|>3 且变化 >25%；CTR 近7天较首7天降 >25% 视为素材疲劳。</small>` : '<p>未发现显著异常</p>'}</div></div>
  <div class="card"><h2>分计划表现</h2><div class="tw"><table><tr><th>计划</th><th class="n">消耗</th><th class="n">占比</th><th class="n">CTR</th><th class="n">CVR</th><th class="n">CPM</th><th class="n">CPA</th><th class="n">ROAS</th><th class="n">CTR 趋势</th></tr>
  ${st.camps.map(c => `<tr><td>${esc(c.name)}</td><td class="n">${money(c.spend)}</td><td class="n">${(c.spend / t.spend * 100).toFixed(1)}%</td><td class="n">${F(c.ctr, 'ctr')}</td><td class="n">${F(c.cvr, 'cvr')}</td><td class="n">${c.cpm.toFixed(2)}</td>
    <td class="n ${c.cpa > t.cpa * 1.2 ? 'dn' : ''}">${c.cpa.toFixed(2)}</td><td class="n ${c.roas > t.roas ? 'up' : 'dn'}">${st.hasRevenue ? c.roas.toFixed(2) : '—'}</td><td class="n ${c.ctrTrend < -15 ? 'dn' : ''}">${c.ctrTrend != null ? c.ctrTrend.toFixed(1) + '%' : '—'}</td></tr>`).join('')}</table></div></div></div>`;
}
function summaryForAgent(st) {
  const r = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? +v.toFixed(4) : v]));
  return { source: st.source, days: st.days.length, totals: r(st.totals), wow: st.wow && r(st.wow), byCampaign: st.camps.map(r), anomalies: st.anomalies.slice(0, 12).map(a => ({ date: a.date, metric: a.metric, desc: a.desc, change: a.change })),
    daily: st.days.slice(-14).map(d => ({ date: d.date, spend: +d.spend.toFixed(2), ctr: +d.ctr.toFixed(3), cvr: +d.cvr.toFixed(3), cpa: +d.cpa.toFixed(2), roas: +d.roas.toFixed(3) })) };
}
async function interpret(st) {
  $('#rp-aiwrap').hidden = false; $('#rp-out').innerHTML = '';
  try { const d = await runAgent('report', summaryForAgent(st), $('#rp-run')); state.report.ai = d; renderReportAI(d); } catch (x) { toast('解读失败：' + x.message); }
}
function renderReportAI(d) {
  if (!d) return; $('#rp-aiwrap').hidden = false;
  $('#rp-out').innerHTML = `<div class="out">${demoBanner(d)}<div class="bar"><h2>✍ Agent 解读与优化建议</h2><div class="acts"><button class="ghost sm" id="rp-save">保存到项目</button><button class="ghost sm" id="rp-md">导出 Markdown</button><button class="ghost sm" id="rp-pr">打印/PDF 周报</button></div></div>
  <div class="card"><h2>总结</h2><p>${esc(d.summary)}</p><h2>关键发现</h2><ul class="ins">${(d.findings || []).map(f => `<li><span class="tag ${f.severity}">${esc(f.title)}</span> ${esc(f.detail)}</li>`).join('')}</ul></div>
  <div class="grid2"><div class="card"><h2>优化建议</h2><div class="sugg">${(d.suggestions || []).map(s => `<div class="sg ${s.priority}"><b>${esc(s.priority)} · ${esc(s.action)}</b><br><small>原因：${esc(s.reason)} ｜ 预期：${esc(s.impact)}</small></div>`).join('')}</div></div>
  <div class="card"><h2>下周计划</h2><div class="tw"><table><tr><th>时间</th><th>任务</th><th>负责人</th></tr>${(d.plan || []).map(p => `<tr><td>${esc(p.day)}</td><td>${esc(p.task)}</td><td>${esc(p.owner)}</td></tr>`).join('')}</table></div>
  ${(d.risks || []).length ? `<h2 style="margin-top:12px">风险</h2><ul class="ins">${d.risks.map(r => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}</div></div></div>`;
  const st = state.report.stats;
  $('#rp-save').onclick = () => saveItem('report', `报表解读 · ${st.source}`, { stats: st, ai: d, _demo: d._demo });
  $('#rp-md').onclick = () => download('报表解读.md', toMD({ type: 'report', title: '报表解读 · ' + st.source, data: { stats: st, ai: d } }));
  $('#rp-pr').onclick = () => printItem({ type: 'report', title: '投放周报 · ' + st.source, data: { stats: st, ai: d } });
}

/* ---------- 导出 Markdown / 打印 ---------- */
function toMD(it) {
  const d = it.data, L = [`# ${it.title}`, d._demo || d.ai?._demo ? '\n> ⚠ 演示数据（非真实 Agent 输出）\n' : ''];
  const tbl = (h, rows) => [`| ${h.join(' | ')} |`, `|${h.map(() => '---').join('|')}|`, ...rows.map(r => `| ${r.map(x => String(x ?? '').replace(/\|/g, '/').replace(/\n/g, ' ')).join(' | ')} |`)].join('\n');
  if (it.type === 'creative') {
    L.push('## 洞察', ...(d.insights || []).map(i => '- ' + i), '\n## 创意角度', tbl(['角度', '钩子', '标题', '依据'], (d.angles || []).map(a => [a.name, a.hook, a.headline, a.insight])));
    (d.scripts || []).forEach(s => L.push(`\n### 分镜：${s.title}`, tbl(['时间', '画面', '口播', '提示'], s.shots.map(x => [x.t, x.visual, x.voice, x.note]))));
    L.push('\n## 分渠道文案', tbl(['渠道', '字段', '文案'], (d.copies || []).map(c => [c.channel, c.field, c.text])), '\n## 合规提示', ...(d.risks || []).map(r => '- ' + r));
  } else if (it.type === 'matrix') {
    const c = d._calc; L.push(`主指标 ${c.metric}；每组样本 ${c.n}；首轮预算 ¥${Math.round(c.total)}；预计 ${c.days.toFixed(1)} 天`, '\n## 矩阵', tbl(['轮次', '变量', '变体', '对照', '占比', '样本', '预算'], matrixRows(d).map(r => Object.values(r).slice(0, 7))),
      '\n## 假设', ...(d.hypotheses || []).map(h => '- ' + h), '\n## 设计\n' + d.design);
  } else {
    const st = d.stats, t = st.totals, a = d.ai || {};
    L.push(`数据：${st.source}，${st.days.length} 天`, '\n## 核心指标', tbl(['消耗', '转化', 'CTR', 'CVR', 'CPC', 'CPM', 'CPA', 'ROAS'], [[t.spend.toFixed(2), t.conversions, F(t.ctr, 'ctr'), F(t.cvr, 'cvr'), t.cpc.toFixed(2), t.cpm.toFixed(2), t.cpa.toFixed(2), t.roas.toFixed(2)]]),
      '\n## 分计划', tbl(['计划', '消耗', 'CTR', 'CPA', 'ROAS'], st.camps.map(c => [c.name, c.spend.toFixed(2), F(c.ctr, 'ctr'), c.cpa.toFixed(2), c.roas.toFixed(2)])),
      '\n## 异常', ...st.anomalies.slice(0, 10).map(x => '- ' + x.desc), '\n## 总结\n' + (a.summary || ''), '\n## 建议', ...(a.suggestions || []).map(s => `- **${s.priority}** ${s.action}（${s.reason}；${s.impact}）`),
      '\n## 下周计划', tbl(['时间', '任务', '负责人'], (a.plan || []).map(p => [p.day, p.task, p.owner])));
  }
  return L.join('\n');
}
function printItem(it) {
  const md = toMD(it); // 简易 Markdown → HTML（表格/标题/列表）
  const html = md.split('\n\n').join('\n').split('\n').reduce((acc, l) => {
    if (/^\|/.test(l)) { if (/^\|[-|]+\|$/.test(l)) return acc; const cells = l.slice(1, -1).split(' | ').map(esc); acc.push((acc.inT ? '' : '<table border=1 cellspacing=0 cellpadding=4>') + '<tr>' + cells.map(c => `<td>${c}</td>`).join('') + '</tr>'); acc.inT = true; return acc; }
    if (acc.inT) { acc.push('</table>'); acc.inT = false; }
    acc.push(/^### /.test(l) ? `<h3>${esc(l.slice(4))}</h3>` : /^## /.test(l) ? `<h2>${esc(l.slice(3))}</h2>` : /^# /.test(l) ? `<h1>${esc(l.slice(2))}</h1>` : /^- /.test(l) ? `<li>${esc(l.slice(2)).replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')}</li>` : l ? `<p>${esc(l.replace(/^> /, ''))}</p>` : ''); return acc; }, []);
  $('#print').innerHTML = html.join('') + (html.inT ? '</table>' : '') + `<p style="color:#888;margin-top:20px">由 投放参谋 AdPilot 生成 · ${new Date().toLocaleString('zh-CN')}</p>`; window.print();
}

/* ---------- 启动 ---------- */
fetch('status').then(r => r.json()).then(s => {
  LIMITS = s.limits || {}; MODE = s.mode; const m = $('#modeBadge');
  m.className = 'mode ' + (MODE === 'real' ? 'real' : ''); m.innerHTML = MODE === 'real' ? '● 已连接 ZooWork Agent<br><small>真实生成 · 密钥仅在服务端</small>' : '◌ 演示模式<br><small>未配置 ZOOWORK_API_KEY，输出为示例数据</small>';
}).catch(() => {});
calc(); saveDB();
