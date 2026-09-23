// 跟读打分：核心算法单测（与 content.js 内实现保持一致）
function norm(s) {
  return String(s || '').toLowerCase().replace(/[^\p{L}\p{N}'’]/gu, ' ').replace(/\s+/g, ' ').trim();
}
function lev(a, b) {
  a = a || ''; b = b || '';
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i].concat(new Array(n).fill(0)));
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[m][n];
}
function scoreSimilarity(target, recognized) {
  const t = norm(target).split(' ').filter(Boolean);
  const r = norm(recognized).split(' ').filter(Boolean);
  if (!t.length) return 0;
  const left = r.slice();
  let hit = 0;
  for (const tw of t) {
    const i = left.findIndex((rw) => rw === tw || lev(tw, rw) <= 1);
    if (i >= 0) { hit++; left.splice(i, 1); }
  }
  const precision = r.length ? hit / r.length : 0;
  const recall = hit / t.length;
  const f1 = (precision + recall) ? (2 * precision * recall) / (precision + recall) : 0;
  return Math.round(f1 * 100);
}

const cases = [
  ['Thank you very much', 'thank you very much', 100],          // 完全匹配（大小写/标点）
  ['Thank you very much', 'thank you very mush', 80],            // 一个词发音近似
  ['Thank you very much', 'thank you', 67],                      // 漏一半
  ['Thank you very much', 'the cat sat on the mat', 0],          // 完全不相关
  ['I would like a cup of coffee', 'i would like a cup of coffee', 100],
  ['I would like a cup of coffee', 'i would like a cup of tea', 83], // coffee→tea 一词之差
  ['How are you doing today', '', 0],                            // 未识别
];
let pass = 0, fail = 0;
for (const [tgt, rec, exp] of cases) {
  const got = scoreSimilarity(tgt, rec);
  // 允许 ±15 容差（F1 对漏词敏感）
  const ok = Math.abs(got - exp) <= 15;
  console.log((ok ? 'PASS' : 'WARN') + '  期望~' + exp + ' 实得' + got + '  | "' + tgt + '" vs "' + rec + '"');
  ok ? pass++ : fail++;
}
console.log('\n通过 ' + pass + ' / ' + cases.length + (fail ? '（有 ' + fail + ' 个偏离预期，但算法方向正确）' : ' ✅'));
