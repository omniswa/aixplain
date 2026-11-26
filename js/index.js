const root = document.documentElement;
const $ = (id) => document.getElementById(id);
const media = matchMedia("(prefers-color-scheme: dark)");
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

$("current-year").textContent = new Date().getFullYear();
