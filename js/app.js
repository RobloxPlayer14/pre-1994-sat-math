// Entry point: loads the bank, restores booklets, routes between views.
import { loadBank } from "./data.js";
import { initBooklets } from "./booklets.js";
import * as home from "./views/home.js";
import * as practice from "./views/practice.js";
import * as session from "./views/session.js";
import * as results from "./views/results.js";
import * as exams from "./views/exams.js";
import * as progress from "./views/progress.js";
import * as questions from "./views/questions.js";
import * as booklets from "./views/booklets.js";
import * as info from "./views/info.js";
import { esc } from "./ui.js";

const main = document.getElementById("main");
const titles = { "": "Home", practice: "Practice", session: "Session", results: "Results", exams: "Exams", progress: "Progress", questions: "Question bank", q: "Question", booklets: "Booklets", settings: "Settings", about: "About" };

function parse() {
  const raw = location.hash.replace(/^#\/?/, "");
  const [path, query = ""] = raw.split("?");
  const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
  return { name: parts[0] || "", arg: parts[1] || null, params: Object.fromEntries(new URLSearchParams(query)) };
}

function route() {
  session.teardown();
  const { name, arg, params } = parse();
  // fresh container per view so listeners never leak between pages
  const view = document.createElement("div");
  view.className = "view";
  main.replaceChildren(view);
  document.querySelectorAll(".nav-link").forEach((a) => a.classList.toggle("active", a.dataset.nav === (name === "q" ? "questions" : name === "results" || name === "session" ? "" : name)));
  document.getElementById("nav").classList.remove("open");
  document.title = `${titles[name] || "Pre-1994 SAT"} · Pre-1994 SAT Mathematics`;
  try {
    switch (name) {
      case "": home.render(view); break;
      case "practice": practice.render(view, { ...params, topic: arg || params.topic }); break;
      case "session": session.render(view); break;
      case "results": results.render(view, arg); break;
      case "exams": exams.render(view); break;
      case "progress": progress.render(view); break;
      case "questions": questions.render(view, params); break;
      case "q": questions.renderSingle(view, arg); break;
      case "booklets": booklets.render(view); break;
      case "settings": info.renderSettings(view); break;
      case "about": info.renderAbout(view); break;
      default: view.innerHTML = `<div class="empty"><strong>Page not found.</strong><a href="#/">Go home</a></div>`;
    }
  } catch (err) {
    console.error(err);
    view.innerHTML = `<div class="notice bad"><p><strong>Something went wrong.</strong> ${esc(err.message || err)}</p></div>`;
  }
  if (name !== "session") window.scrollTo(0, 0);
}

async function boot() {
  info.applyTheme();
  document.getElementById("nav-toggle").addEventListener("click", () => document.getElementById("nav").classList.toggle("open"));
  try {
    await Promise.all([loadBank(), initBooklets()]);
  } catch (err) {
    console.error(err);
    main.innerHTML = `<div class="notice bad"><p><strong>The question bank could not be loaded.</strong> ${esc(err.message || err)}</p><p>If you opened this file directly from disk, serve the folder over HTTP instead (see README).</p></div>`;
    return;
  }
  window.addEventListener("hashchange", route);
  route();
}

boot();
