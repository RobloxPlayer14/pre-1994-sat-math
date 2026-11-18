// Loads the question bank: catalog of authentic test forms + original practice set.
// Authentic entries carry only metadata (answer key, topic tags, page regions, and
// explanations written for this site). The question images come from the student's
// own copy of the booklet, rendered locally (see booklets.js).

let bank = null;

export async function loadBank() {
  if (bank) return bank;
  const [topics, catalog, original] = await Promise.all([
    getJSON("data/topics.json"),
    getJSON("data/catalog.json"),
    getJSON("data/original.json"),
  ]);
  const tests = await Promise.all(catalog.tests.map((t) => getJSON(`data/${t.file}`)));

  const topicNames = {};
  const topicArea = {};
  for (const area of topics.areas) for (const t of area.topics) {
    topicNames[t.id] = t.name;
    topicArea[t.id] = area.id;
  }

  const questions = [];
  const index = new Map();
  const groups = new Map();

  for (const test of tests) {
    for (const [gid, g] of Object.entries(test.groups || {})) groups.set(gid, { ...g, id: gid, testId: test.id });
    for (const q of test.questions) {
      const section = test.sections.find((s) => s.id === q.section);
      const item = {
        ...q,
        origin: "authentic",
        testId: test.id,
        sectionNumber: section?.number,
        area: topicArea[q.topics?.[0]] || null,
        label: `Form ${test.formCode} · Section ${section?.number} · Q${q.n}`,
        shortLabel: `${test.formCode} §${section?.number} #${q.n}`,
        sha256: test.pdf.sha256,
      };
      questions.push(item);
      index.set(item.id, item);
    }
  }
  for (const q of original.questions) {
    const item = {
      ...q,
      origin: "original",
      testId: null,
      area: topicArea[q.topics?.[0]] || null,
      label: `Original practice · ${q.id.replace(/^orig-/, "#")}`,
      shortLabel: q.id.replace(/^orig-/, "Original #"),
    };
    questions.push(item);
    index.set(item.id, item);
  }

  // One full test's composition, used for score projection.
  const blueprint = tests[0]?.questions.map((q) => ({ type: q.type, difficulty: q.difficulty })) || [];

  bank = { topics, topicNames, topicArea, catalog, tests, testById: new Map(tests.map((t) => [t.id, t])), questions, index, groups, original, blueprint };
  return bank;
}

export function getBank() {
  return bank;
}

async function getJSON(url) {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`Could not load ${url} (${res.status})`);
  return res.json();
}
