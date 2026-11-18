// Settings (data management) and About (sources, authenticity policy, scoring).
import { getBank } from "../data.js";
import * as store from "../store.js";
import { listBooklets } from "../booklets.js";
import { esc, $, plural, download, toast, confirmDialog } from "../ui.js";

export function renderSettings(app) {
  const st = store.getState();
  const theme = localStorage.getItem("sat94.theme") || "auto";
  app.innerHTML = `
    <div class="page-heading"><p class="eyebrow">Settings</p><h1>Your data.</h1>
      <p>Progress lives in this browser's local storage and booklets in its IndexedDB. Nothing is sent to a server — there is no server.</p></div>
    <div class="panel"><p class="eyebrow" style="margin-bottom:10px">Appearance</p>
      <div class="seg" role="group">${[["auto", "Match system"], ["light", "Light"], ["dark", "Dark"]].map(([v, l]) => `<button data-theme="${v}" aria-pressed="${theme === v}">${l}</button>`).join("")}</div></div>
    <div class="panel"><p class="eyebrow" style="margin-bottom:10px">Back up or move your progress</p>
      <p class="sans small muted" style="margin:0 0 14px">${plural(st.attempts.length, "answer")} and ${plural(Object.values(st.sessions).filter((s) => s.finishedAt).length, "finished session")} recorded. Export a file, then import it on another device or browser (imports are merged; nothing is duplicated).</p>
      <div class="row"><button class="btn primary" data-act="export">Export progress</button>
        <label class="btn">Import progress<input type="file" id="import" accept="application/json,.json" class="sr-only"></label></div></div>
    <div class="panel"><p class="eyebrow" style="margin-bottom:10px">Start over</p>
      <p class="sans small muted" style="margin:0 0 14px">Erase all answers and sessions from this browser. Loaded booklets (${listBooklets().length}) are kept — remove them on the <a href="#/booklets">Booklets</a> page.</p>
      <button class="btn danger" data-act="reset">Erase progress</button></div>`;
  app.onclick = async (e) => {
    const th = e.target.closest("[data-theme]");
    if (th) {
      const v = th.dataset.theme;
      localStorage.setItem("sat94.theme", v);
      applyTheme();
      for (const b of app.querySelectorAll("[data-theme]")) b.setAttribute("aria-pressed", String(b === th));
      return;
    }
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "export") download(`sat-math-progress-${new Date().toISOString().slice(0, 10)}.json`, store.exportData());
    if (act === "reset") {
      if (await confirmDialog("Erase all progress?", "This deletes every recorded answer and session in this browser. It cannot be undone unless you exported a backup.", "Erase")) {
        store.resetAll();
        toast("Progress erased.");
        renderSettings(app);
      }
    }
  };
  $("#import", app).onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      store.importData(await f.text(), { merge: true });
      toast("Progress imported.");
      renderSettings(app);
    } catch (err) {
      toast(esc(err.message || String(err)));
    }
  };
}

export function applyTheme() {
  const v = localStorage.getItem("sat94.theme") || "auto";
  if (v === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", v);
}

export function renderAbout(app) {
  const bank = getBank();
  const auth = bank.questions.filter((q) => q.origin === "authentic");
  const flagged = auth.filter((q) => q.flags?.length);
  app.innerHTML = `
    <div class="page-heading"><p class="eyebrow">About</p><h1>Authentic, sourced, honest.</h1>
      <p>How the question bank is built, where it comes from, and how scores are calculated.</p></div>
    <div class="prose">
      <h2>What is here</h2>
      <p>The bank holds <strong>${auth.length} authentic mathematics questions</strong> from ${plural(bank.tests.length, "released Scholastic Aptitude Test form")} (${bank.tests.map((t) => `Form ${esc(t.formCode)}`).join(", ")}), plus <strong>${bank.questions.length - auth.length} original practice questions</strong> written for this site in the same style. Original questions are always labelled <em>Original practice</em> and are never presented as SAT questions.</p>
      <h2>Why you load your own booklet</h2>
      <p>The released tests are copyrighted by the College Board and Educational Testing Service. Rather than republishing their printed pages, the site publishes only:</p>
      <ul>
        <li>the <strong>answer key</strong> for each form, transcribed from the key printed in the booklet;</li>
        <li><strong>topic tags</strong> and an <strong>estimated difficulty</strong> for every question;</li>
        <li><strong>explanations written for this site</strong>;</li>
        <li>the <strong>raw-to-scaled score conversion table</strong> printed for each form;</li>
        <li>a <strong>page map</strong>: where each question, figure and shared stem sits on each booklet page.</li>
      </ul>
      <p>When you load your PDF scan, the page map is used to crop each question directly from your copy with PDF.js, inside your browser. There is no OCR transcription, so there are no transcription errors: you see exactly what was printed.</p>
      <h2>Verification</h2>
      <p>Every answer comes from the official key printed with the test. Each question was also solved independently while writing its explanation; any disagreement between the key and the worked solution is flagged on the question for review rather than silently changed. ${flagged.length ? `Currently ${plural(flagged.length, "question is", "questions are")} flagged.` : "No questions are currently flagged."}</p>
      <h2>Difficulty</h2>
      <p>ETS arranged the questions in each group (for example, the 25 regular questions of Section 3, or the 20 quantitative comparisons of Section 5) roughly from easiest to hardest. Difficulty 1–5 is estimated from that position, so it reflects how the test makers ranked the questions rather than anyone's guess.</p>
      <h2>Scoring</h2>
      <p>Pre-1994 SATs used <strong>formula scoring</strong>. For mathematics: one point per correct answer, minus ¼ point for each wrong answer to a five-choice question and ⅓ point for each wrong answer to a four-choice quantitative comparison; omitted questions count zero. The total is rounded to the nearest whole number and converted to the 200–800 scale with the conversion table printed for that test form. Exam simulations use exactly this procedure. Single-section simulations and the projected score on the Progress page are labelled as estimates.</p>
      <h2>Test format (1980s)</h2>
      <p>Each SAT contained two 30-minute mathematics sections: one of 25 regular multiple-choice questions, and one of 35 questions — 7 regular, 20 quantitative comparisons, and 8 regular. Calculators were not permitted. Each section began with a box of reference information (area of a circle, triangle facts, symbol definitions), which the exam simulation shows from your booklet.</p>
      <h2>Privacy</h2>
      <p>The site is a static web page. Your answers are stored in your browser's local storage; your booklets in its IndexedDB. Nothing is sent anywhere. Use <a href="#/settings">Settings</a> to export a backup.</p>
      <h2>Adding more tests</h2>
      <p>The repository includes an offline pipeline (<code>pipeline/</code>) that OCRs a new booklet scan locally, finds every math question and figure, reads the printed answer key and conversion table, and writes a draft test file plus overlay images for checking. See the README.</p>
    </div>`;
}
