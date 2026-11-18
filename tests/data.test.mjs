// Validates every data file the site ships: answer keys, regions, topics, scoring tables.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { math } from "../js/format.js";

const read = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), "utf8"));
const topics = read("data/topics.json");
const topicIds = new Set(topics.areas.flatMap((a) => a.topics.map((t) => t.id)));
const catalog = read("data/catalog.json");
const LETTERS = { mc5: "ABCDE", qc4: "ABCD" };
// form feed / tab etc. appear when "\frac" or "\times" lose their backslash escaping
const CONTROL = /[\u0000-\u0008\u000b-\u001f]/;

test("catalog lists every test file and fingerprints are unique", () => {
  const files = readdirSync(new URL("../data/tests/", import.meta.url)).filter((f) => f.endsWith(".json"));
  assert.equal(catalog.tests.length, files.length, "catalog out of date — run pipeline/build_catalog.py");
  const shas = new Set(catalog.tests.map((t) => t.sha256));
  assert.equal(shas.size, catalog.tests.length);
});

for (const entry of catalog.tests) {
  test(`test form ${entry.id} is complete and consistent`, () => {
    const t = read(`data/${entry.file}`);
    assert.equal(t.id, entry.id);
    assert.equal(t.pdf.sha256, entry.sha256);
    assert.match(t.pdf.sha256, /^[0-9a-f]{64}$/);
    const ids = new Set();
    for (const s of t.sections) {
      const qs = t.questions.filter((q) => q.section === s.id);
      assert.equal(qs.length, s.count, `${s.id} has ${qs.length} questions, expected ${s.count}`);
      assert.deepEqual(qs.map((q) => q.n).sort((a, b) => a - b), Array.from({ length: s.count }, (_, i) => i + 1));
    }
    for (const q of t.questions) {
      assert.ok(!ids.has(q.id), `duplicate id ${q.id}`);
      ids.add(q.id);
      assert.ok(LETTERS[q.type], `${q.id} bad type`);
      assert.ok(LETTERS[q.type].includes(q.answer), `${q.id} answer ${q.answer} invalid for ${q.type}`);
      assert.ok(q.topics?.length, `${q.id} has no topic`);
      for (const tp of q.topics) assert.ok(topicIds.has(tp), `${q.id} unknown topic ${tp}`);
      assert.ok(q.difficulty >= 1 && q.difficulty <= 5, `${q.id} difficulty`);
      assert.ok(q.regions?.length, `${q.id} has no regions`);
      for (const r of q.regions) {
        assert.ok(r.page >= 1 && r.page <= t.pdf.pageCount, `${q.id} page`);
        const [x0, y0, x1, y1] = r.box;
        assert.ok(0 <= x0 && x0 < x1 && x1 <= 1 && 0 <= y0 && y0 < y1 && y1 <= 1, `${q.id} box ${r.box}`);
        assert.ok(y1 - y0 > 0.015 && x1 - x0 > 0.1, `${q.id} region suspiciously small`);
      }
      if (q.group) assert.ok(t.groups?.[q.group], `${q.id} missing group ${q.group}`);
      assert.ok(q.explanation && q.explanation.length > 30, `${q.id} has no explanation`);
      assert.doesNotMatch(q.explanation, CONTROL, `${q.id} explanation contains a control character (bad escape?)`);
      assert.doesNotThrow(() => math(q.explanation));
      assert.ok(!(q.flags || []).includes("topic-auto"), `${q.id} topic was never reviewed by hand`);
    }
    const table = t.scoring?.rawToScaled;
    assert.ok(table, "no conversion table");
    const keys = Object.keys(table).map(Number).sort((a, b) => a - b);
    assert.equal(keys[keys.length - 1], t.questions.length, "table should reach the maximum raw score");
    for (let i = 1; i < keys.length; i++) {
      assert.equal(keys[i], keys[i - 1] + 1, `gap in table at ${keys[i]}`);
      assert.ok(table[keys[i]] >= table[keys[i - 1]], `table not monotonic at ${keys[i]}`);
    }
    assert.equal(table[keys[keys.length - 1]], 800);
    assert.ok(Object.values(table).every((v) => v >= 200 && v <= 800 && v % 10 === 0));
  });
}

test("original practice questions are well formed and clearly marked", () => {
  const o = read("data/original.json");
  assert.match(o.notice, /NOT actual SAT questions/);
  const ids = new Set();
  for (const q of o.questions) {
    assert.match(q.id, /^orig-\d{3}$/);
    assert.ok(!ids.has(q.id));
    ids.add(q.id);
    assert.ok(LETTERS[q.type].includes(q.answer), q.id);
    if (q.type === "mc5") assert.equal(q.choices.length, 5, q.id);
    if (q.type === "qc4") assert.ok(q.qc?.a && q.qc?.b, q.id);
    else assert.ok(q.stem, q.id);
    for (const tp of q.topics) assert.ok(topicIds.has(tp), `${q.id} ${tp}`);
    assert.ok(q.explanation?.length > 30, `${q.id} explanation`);
    for (const s of [q.stem, q.explanation, ...(q.choices || []), q.qc?.a, q.qc?.b, q.qc?.info]) {
      if (s) assert.doesNotMatch(s, CONTROL, `${q.id} contains a control character`);
    }
  }
});
