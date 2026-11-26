const root = document.documentElement;
const $ = (id) => document.getElementById(id);
const media = matchMedia("(prefers-color-scheme: dark)");

/* Theme toggle */
const toggle = $("theme-toggle");
const isDark = () =>
  root.dataset.theme ? root.dataset.theme === "dark" : media.matches;

function syncToggle() {
  const dark = isDark();
  $("icon-sun").toggleAttribute("hidden", dark);
  $("icon-moon").toggleAttribute("hidden", !dark);
  toggle.setAttribute("aria-pressed", String(dark));
  toggle.setAttribute(
    "aria-label",
    dark ? "Switch to light theme" : "Switch to dark theme",
  );
}
toggle.addEventListener("click", () => {
  const next = isDark() ? "light" : "dark";
  root.dataset.theme = next;
  try {
    localStorage.setItem("theme", next);
  } catch {
    /* ignore */
  }
  syncToggle();
});
media.addEventListener("change", syncToggle);
syncToggle();

/* Table of contents from headings */
const headings = [...document.querySelectorAll("article h2, article h3")];
const used = new Set();
const slug = (text) =>
  text
  .toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, "-")
  .replace(/^-+|-+$/g, "") || "section";
const toc = $("toc");
for (const h of headings) {
  if (!h.id) {
    let id = slug(h.textContent),
      n = 2;
    while (used.has(id) || document.getElementById(id))
      id = `${slug(h.textContent)}-${n++}`;
    h.id = id;
  }
  used.add(h.id);
  const li = document.createElement("li");
  li.dataset.level = h.tagName.slice(1);
  const a = document.createElement("a");
  a.href = `#${h.id}`;
  a.textContent = h.textContent;
  li.append(a);
  toc.append(li);
}

/* Bottom sheet */
const sheet = $("sheet");
$("btn-toc").addEventListener("click", () => {
  sheet.showModal();
  toc
    .querySelector('[aria-current="true"]')
    ?.scrollIntoView({ block: "nearest" });
});
$("sheet-close").addEventListener("click", () => sheet.close());
sheet.addEventListener("click", (e) => {
  if (e.target === sheet) sheet.close();
});
toc.addEventListener("click", (e) => {
  const link = e.target.closest("a");
  if (!link) return;
  e.preventDefault();
  const target = document.getElementById(link.hash.slice(1));
  sheet.close();
  if (!target) return;
  pinned = target.id;
  setActive(pinned);
  target.scrollIntoView();
  target.tabIndex = -1;
  target.focus({ preventScroll: true });
  try {
    history.replaceState(null, "", link.hash);
  } catch {
    /* ignore */
  }
});

/* Highlight current section */
const links = new Map(
  [...toc.querySelectorAll("a")].map((a) => [a.hash.slice(1), a]),
);
let pinned = null;
let ticking = false;

function setActive(id) {
  links.forEach((a) => a.removeAttribute("aria-current"));
  links.get(id)?.setAttribute("aria-current", "true");
}

function updateActive() {
  ticking = false;
  if (pinned) {
    setActive(pinned);
    return;
  }
  const atEnd =
    window.innerHeight + window.scrollY >=
    document.documentElement.scrollHeight - 4;
  let current = null;
  if (atEnd) {
    current = headings.at(-1);
  } else {
    for (const h of headings) {
      if (h.getBoundingClientRect().top <= window.innerHeight * 0.25)
        current = h;
      else break;
    }
  }
  setActive(current?.id);
}
addEventListener(
  "scroll",
  () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(updateActive);
    }
  }, { passive: true },
);
addEventListener("resize", updateActive);
for (const type of ["wheel", "touchstart", "keydown"]) {
  addEventListener(
    type,
    () => {
      pinned = null;
    }, { passive: true },
  );
}
updateActive();

/* Back to top */
$("btn-top").addEventListener("click", () => window.scrollTo({ top: 0 }));

/* Share */
const toast = $("toast");
let timer;

function say(message) {
  toast.textContent = message;
  toast.dataset.show = "";
  clearTimeout(timer);
  timer = setTimeout(() => delete toast.dataset.show, 2200);
}
$("btn-share").addEventListener("click", async () => {
  const data = {
    title: document.title,
    text: document.querySelector('meta[name="description"]').content,
    url: location.href,
  };
  try {
    if (navigator.share) {
      await navigator.share(data);
      return;
    }
  } catch (err) {
    if (err.name === "AbortError") return;
  }
  try {
    await navigator.clipboard.writeText(location.href);
    say("Link copied");
  } catch {
    say("Copy the link from your browser’s address bar");
  }
});
document.getElementById("current-year").textContent = new Date().getFullYear();