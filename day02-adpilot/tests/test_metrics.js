const M = require('../metrics.js'), fs = require('fs'), path = require('path'), assert = require('assert');
for (const f of ['sample-qianchuan.csv', 'sample-meta.csv']) {
  const rows = M.parseCSV(fs.readFileSync(path.join(__dirname, '../samples', f), 'utf8'));
  const map = M.guessMap(rows[0]);
  assert.deepStrictEqual(Object.keys(map).sort(), ['campaign','clicks','conversions','date','impressions','revenue','spend'], f + ' mapping');
  const r = M.analyze(rows.slice(1), map), t = r.totals;
  // 独立重算
  let s = 0, i = 0, c = 0, v = 0, rev = 0; rows.slice(1).forEach(x => { s += +x[2]; i += +x[3]; c += +x[4]; v += +x[5]; rev += +x[6]; });
  const close = (a, b) => assert(Math.abs(a - b) < 1e-6 * Math.max(1, Math.abs(b)), a + ' vs ' + b);
  close(t.spend, s); close(t.ctr, c / i * 100); close(t.cvr, v / c * 100); close(t.cpc, s / c); close(t.cpm, s / i * 1000); close(t.cpa, s / v); close(t.roas, rev / s);
  assert.strictEqual(r.days.length, 28); assert.strictEqual(r.camps.length, 3); assert(r.wow);
  const fat = r.anomalies.find(a => a.metric === 'CTR趋势'); assert(fat, f + ' fatigue detected');
  const ld = r.anomalies.find(a => a.date === '2026-10-27' && /CVR|CPA/.test(a.metric)); assert(ld, f + ' landing-page anomaly on 10-27');
  console.log('✓', f, 'spend', t.spend.toFixed(2), 'ROAS', t.roas.toFixed(2), 'anomalies', r.anomalies.length, '→', r.anomalies.slice(0, 3).map(a => a.desc).join(' | '));
}
assert.strictEqual(M.guessMap(['Day', 'Campaign', 'Cost', 'Impr.', 'Clicks', 'Conversions', 'Conv. value']).revenue, 6, 'google export');
assert.strictEqual(M.guessMap(['日期', '广告名称', '花费', '曝光次数', '点击次数', '下单量', '下单金额']).spend, 2, 'tencent export');
assert.strictEqual(M.normDate('2026/1/5'), '2026-01-05'); assert.strictEqual(M.num('¥1,234.5'), 1234.5);
const n = M.sampleSize(0.02, 0.2); assert(n > 20000 && n < 23000, 'sample size ' + n); console.log('✓ sampleSize p=2% MDE=20% →', n, '/组');
console.log('✓ quoted CSV', JSON.stringify(M.parseCSV('a,b\n"x,1","he said ""hi"""\n')));
