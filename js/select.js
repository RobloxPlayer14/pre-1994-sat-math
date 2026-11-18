// Question selection for practice sets. Pure; testable in Node.

/** Mulberry32 seeded RNG so a set can be reproduced in tests. */
export function rng(seed = Date.now()) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(arr, rand = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * config: {
 *   origins: ['authentic','original'], topics: [] (empty = all), formats: [] (empty = all),
 *   difficulty: [min,max], status: 'all'|'unseen'|'missed'|'seen', tests: [] (empty = all),
 *   count: number|'all', order: 'random'|'test'
 * }
 * stats: output of computeStats (for status filters). May be null.
 */
export function filterPool(pool, config, stats) {
  const topics = new Set(config.topics || []);
  const formats = new Set(config.formats || []);
  const origins = new Set(config.origins || ["authentic", "original"]);
  const tests = new Set(config.tests || []);
  const [dmin, dmax] = config.difficulty || [1, 5];
  const missed = new Set(stats?.missed || []);
  const seen = stats?.seen || new Set();
  return pool.filter((q) => {
    if (!origins.has(q.origin)) return false;
    if (topics.size && !(q.topics || []).some((t) => topics.has(t))) return false;
    if (formats.size && !formats.has(q.type)) return false;
    if (tests.size && !tests.has(q.testId)) return false;
    if (q.difficulty < dmin || q.difficulty > dmax) return false;
    if (config.status === "unseen" && seen.has(q.id)) return false;
    if (config.status === "missed" && !missed.has(q.id)) return false;
    if (config.status === "seen" && !seen.has(q.id)) return false;
    return true;
  });
}

export function selectQuestions(pool, config, stats, rand = Math.random) {
  let list = filterPool(pool, config, stats);
  if (config.order === "test") list = list.slice().sort(testOrder);
  else list = shuffle(list, rand);
  const n = config.count === "all" ? list.length : Math.max(1, Number(config.count) || 10);
  list = list.slice(0, n);
  // keep questions that share a stimulus ("Questions 8-9 refer to...") adjacent
  if (config.order !== "test") list = groupAdjacent(list);
  return list;
}

export function testOrder(a, b) {
  if (a.origin !== b.origin) return a.origin === "authentic" ? -1 : 1;
  return (a.testId || "").localeCompare(b.testId || "") || (a.sectionNumber || 0) - (b.sectionNumber || 0) || (a.n || 0) - (b.n || 0);
}

function groupAdjacent(list) {
  const out = [];
  const used = new Set();
  for (const q of list) {
    if (used.has(q.id)) continue;
    out.push(q);
    used.add(q.id);
    if (q.group) {
      for (const r of list) if (!used.has(r.id) && r.group === q.group) { out.push(r); used.add(r.id); }
    }
  }
  return out;
}
