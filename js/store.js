// Progress persistence (localStorage). Everything stays in this browser;
// Settings → Export lets the student move it between devices.

const KEY = "sat94.progress.v1";
const MAX_SESSIONS = 300;

const blank = () => ({
  version: 1,
  createdAt: Date.now(),
  attempts: [], // { q, c, ok, t, at, s, m }
  sessions: {}, // id -> session
  active: null, // id of the unfinished session, if any
  settings: { feedback: "immediate", sound: false },
});

let state = null;
const listeners = new Set();

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return blank();
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== 1) return blank();
    return { ...blank(), ...parsed, settings: { ...blank().settings, ...(parsed.settings || {}) } };
  } catch {
    return blank();
  }
}

function write() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (err) {
    console.warn("Could not save progress", err);
  }
  listeners.forEach((fn) => fn(state));
}

export function getState() {
  if (!state) state = read();
  return state;
}

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function newId(prefix = "s") {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function startSession(session) {
  const st = getState();
  if (st.active && st.sessions[st.active] && !st.sessions[st.active].finishedAt) {
    // abandon the previous unfinished session silently
    delete st.sessions[st.active];
  }
  st.sessions[session.id] = session;
  st.active = session.id;
  prune(st);
  write();
  return session;
}

export function activeSession() {
  const st = getState();
  const s = st.active ? st.sessions[st.active] : null;
  return s && !s.finishedAt ? s : null;
}

export function updateSession(id, mutate) {
  const st = getState();
  const s = st.sessions[id];
  if (!s) return null;
  mutate(s);
  write();
  return s;
}

/** Persist without notifying listeners (used for frequent timer ticks). */
export function saveQuietly() {
  try {
    localStorage.setItem(KEY, JSON.stringify(getState()));
  } catch {}
}

export function finishSession(id, result, attempts) {
  const st = getState();
  const s = st.sessions[id];
  if (!s) return null;
  s.finishedAt = Date.now();
  s.result = result;
  for (const a of attempts) st.attempts.push(a);
  if (st.active === id) st.active = null;
  write();
  return s;
}

export function discardSession(id) {
  const st = getState();
  delete st.sessions[id];
  if (st.active === id) st.active = null;
  write();
}

export function recordAttempt(a) {
  getState().attempts.push(a);
  write();
}

export function setSetting(key, value) {
  getState().settings[key] = value;
  write();
}

export function exportData() {
  return JSON.stringify({ app: "pre-1994-sat-math", exportedAt: new Date().toISOString(), ...getState() }, null, 1);
}

export function importData(text, { merge = true } = {}) {
  const incoming = JSON.parse(text);
  if (!incoming || incoming.version !== 1 || !Array.isArray(incoming.attempts)) {
    throw new Error("This file is not a Pre-1994 SAT progress export.");
  }
  const st = getState();
  if (!merge) {
    state = { ...blank(), ...incoming, active: null };
  } else {
    const seen = new Set(st.attempts.map((a) => `${a.q}|${a.at}`));
    for (const a of incoming.attempts) if (!seen.has(`${a.q}|${a.at}`)) st.attempts.push(a);
    for (const [id, s] of Object.entries(incoming.sessions || {})) if (!st.sessions[id] && s.finishedAt) st.sessions[id] = s;
    st.attempts.sort((a, b) => a.at - b.at);
  }
  write();
  return getState();
}

export function resetAll() {
  state = blank();
  write();
}

function prune(st) {
  const finished = Object.values(st.sessions).filter((s) => s.finishedAt).sort((a, b) => b.finishedAt - a.finishedAt);
  for (const s of finished.slice(MAX_SESSIONS)) delete st.sessions[s.id];
}
