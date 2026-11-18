// Tiny math mini-markup used for original questions and explanations.
//   Plain text, with math inside $...$.  Blank line = new paragraph, **bold**.
//   Math mode: x^2  x^{10}  a_1  \frac{a}{b}  \sqrt{x}  \pi \times \cdot \le \ge \ne \angle \deg
//   Single letters are set in italics, hyphens become minus signs.

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

const SYMBOLS = {
  pi: "π", times: "×", cdot: "·", le: "≤", ge: "≥", ne: "≠", angle: "∠", deg: "°",
  approx: "≈", pm: "±", div: "÷", perp: "⊥", parallel: "∥", triangle: "△", infty: "∞",
  lt: "&lt;", gt: "&gt;", arc: "⌒", degree: "°", ldots: "…", circ: "°", sqrtsym: "√",
};

/** Render a whole block of mini-markup to HTML. */
export function renderRich(src) {
  if (src == null) return "";
  const paras = String(src).trim().split(/\n\s*\n/);
  return paras.map((p) => `<p>${renderInline(p).replace(/\n/g, "<br>")}</p>`).join("");
}

/** Render inline mini-markup (no paragraphs). */
export function renderInline(src) {
  // "\$" is a literal dollar sign (money), not a math delimiter
  return renderInlineRaw(String(src ?? "").replace(/\\\$/g, "\u0001")).replace(/\u0001/g, "$");
}

function renderInlineRaw(s) {
  let out = "";
  let i = 0;
  while (i < s.length) {
    const j = s.indexOf("$", i);
    if (j === -1) { out += text(s.slice(i)); break; }
    out += text(s.slice(i, j));
    const k = s.indexOf("$", j + 1);
    if (k === -1) { out += text(s.slice(j)); break; }
    out += `<span class="m">${math(s.slice(j + 1, k))}</span>`;
    i = k + 1;
  }
  return out;
}

function text(t) {
  return escapeHtml(t).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

/** Parse math mode with a small recursive-descent reader. */
export function math(src) {
  let pos = 0;
  const s = src;

  function readGroup() {
    // returns raw string of a {...} group or a single token
    while (s[pos] === " ") pos++;
    if (s[pos] === "{") {
      let depth = 1, start = ++pos;
      while (pos < s.length && depth) {
        if (s[pos] === "{") depth++;
        else if (s[pos] === "}") depth--;
        pos++;
      }
      return s.slice(start, pos - 1);
    }
    if (s[pos] === "\\") {
      const m = /^\\[a-zA-Z]+/.exec(s.slice(pos));
      if (m) { pos += m[0].length; return m[0]; }
    }
    return s[pos++] ?? "";
  }

  function parse(stopAt) {
    let out = "";
    while (pos < s.length) {
      const c = s[pos];
      if (stopAt && c === stopAt) break;
      if (c === "\\") {
        const m = /^\\([a-zA-Z]+)/.exec(s.slice(pos));
        if (!m) { out += escapeHtml(s[pos + 1] ?? ""); pos += 2; continue; }
        pos += m[0].length;
        const name = m[1];
        if (name === "frac") {
          const a = readGroup(), b = readGroup();
          out += `<span class="frac"><span class="num">${math(a)}</span><span class="den">${math(b)}</span></span>`;
        } else if (name === "sqrt") {
          const a = readGroup();
          out += `<span class="sqrt"><span class="rad">√</span><span class="radicand">${math(a)}</span></span>`;
        } else if (name === "text") {
          out += escapeHtml(readGroup());
        } else if (name === "overline") {
          out += `<span class="ov">${math(readGroup())}</span>`;
        } else if (name === "box") {
          out += `<span class="boxed">${math(readGroup())}</span>`;
        } else if (SYMBOLS[name]) {
          out += SYMBOLS[name];
        } else {
          out += escapeHtml(name);
        }
        continue;
      }
      if (c === "^" || c === "_") {
        pos++;
        const g = readGroup();
        const tag = c === "^" ? "sup" : "sub";
        out += `<${tag}>${math(g)}</${tag}>`;
        continue;
      }
      if (/[a-zA-Z]/.test(c)) {
        // italicise single-letter variables; keep words (e.g. "cm", "max") upright
        const m = /^[a-zA-Z]+/.exec(s.slice(pos))[0];
        pos += m.length;
        out += m.length === 1 ? `<i>${m}</i>` : escapeHtml(m);
        continue;
      }
      if (c === "-") { out += "−"; pos++; continue; }
      if (c === "*") { out += "×"; pos++; continue; }
      if (c === "<" || c === ">" || c === "&") { out += escapeHtml(c); pos++; continue; }
      if (c === " ") { out += " "; pos++; continue; }
      out += escapeHtml(c);
      pos++;
    }
    return out;
  }
  return parse(null);
}
