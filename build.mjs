#!/usr/bin/env node
/**
 * Builds the generated parts of the site from the article files in blogs/.
 *
 * Usage (from the project root):  node build.mjs
 * Optional env vars:
 *   SITE_URL=https://example.com   override the site URL
 *   CLEAN_URLS=0                   link to .html files (for local file/http.server preview)
 *
 * Outputs (each is only rewritten when its content changes):
 *   sitemap.xml      all indexable pages
 *   blogs/index.html archive page listing every article, newest first
 *   feed.xml         RSS 2.0 feed of the newest articles
 *   index.html       the "Latest articles" block between the
 *                    <!-- LATEST:START --> and <!-- LATEST:END --> markers
 *                    (markers are inserted on the first run) and an RSS <link>
 *
 * Each article is read for: <h1> (title), meta description, and
 * article:published_time (falls back to JSON-LD datePublished, then the first
 * <time datetime>, then git/file date). Pages marked noindex are skipped.
 * Needs Node 18+ and no packages.
 */
import { execFile } from "node:child_process";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const ROOT = dirname(fileURLToPath(import.meta.url));

const CONFIG = {
  siteUrl: (process.env.SITE_URL || "https://aixplain.pages.dev").replace(/\/+$/, ""),
  siteName: "aixplain",
  siteDescription:
    "Short, plain-language articles on whatever is trending in tech, culture, money, and the internet.",
  author: "xclnt-sensai",
  blogDir: "blogs",
  staticPages: ["index.html", "terms.html", "privacy.html"],
  homeCount: 5, // articles shown on the home page
  feedCount: 20, // articles in feed.xml
  cleanUrls: process.env.CLEAN_URLS !== "0", // Cloudflare Pages serves /page for page.html
};

const BLOG_INDEX = `${CONFIG.blogDir}/index.html`;

/* ---------- small helpers ---------- */

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

const NAMED = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", mdash: "—", ndash: "–", hellip: "…",
};
const decode = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try {
        return String.fromCodePoint(n);
      } catch {
        return m;
      }
    }
    return NAMED[e.toLowerCase()] ?? m;
  });

const text = (html) => decode(html.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
const posix = (p) => p.split(sep).join("/");
const indent = (s, n) => s.replace(/^(?=.)/gm, " ".repeat(n));

const toDate = (v) => {
  const d = v ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};
const ymd = (d) => d.toISOString().slice(0, 10);
const pretty = (d) =>
  d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/* ---------- reading pages ---------- */

function getMeta(html, attr, name) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    if (!new RegExp(`\\b${attr}=["']${name}["']`, "i").test(tag)) continue;
    const content = tag.match(/\bcontent=(["'])([\s\S]*?)\1/i);
    if (content) return decode(content[2]).trim();
  }
  return null;
}

function getCanonical(html) {
  const tag = html.match(/<link\b[^>]*\brel=["']canonical["'][^>]*>/i)?.[0];
  return tag?.match(/\bhref=["']([^"']+)["']/i)?.[1] ?? null;
}

const isNoindex = (html) =>
  /<meta\b[^>]*\bname=["']robots["'][^>]*\bcontent=["'][^"']*noindex/i.test(html);

function getTitle(html) {
  const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  if (h1 && text(h1)) return text(h1);
  const title = html.match(/<title>([\s\S]*?)<\/title>/i)?.[1];
  return title ? text(title).replace(/\s*\|\s*[^|]*$/, "") : "Untitled";
}

function getPublished(html) {
  return (
    toDate(getMeta(html, "property", "article:published_time")) ||
    toDate(html.match(/"datePublished"\s*:\s*"([^"]+)"/)?.[1]) ||
    toDate(html.match(/<time\b[^>]*\bdatetime=["']([^"']+)["']/i)?.[1]) ||
    null
  );
}

function getModified(html) {
  return (
    toDate(getMeta(html, "property", "article:modified_time")) ||
    toDate(html.match(/"dateModified"\s*:\s*"([^"]+)"/)?.[1]) ||
    toDate(html.match(/<time\b[^>]*\bdatetime=["']([^"']+)["']/i)?.[1]) ||
    null
  );
}

/* Last commit date of a file, else its mtime. Git beats mtime because a fresh
   checkout (CI, new clone) sets every mtime to "now". */
async function fileDate(abs) {
  try {
    const { stdout } = await run("git", ["log", "-1", "--format=%cs", "--", abs], { cwd: ROOT });
    const d = toDate(stdout.trim());
    if (d) return d;
  } catch {
    /* not a git checkout, or git missing */
  }
  return (await stat(abs)).mtime;
}

/* Fallback URL when a page has no canonical tag */
function urlFromPath(rel) {
  const path = posix(rel);
  if (path === "index.html") return `${CONFIG.siteUrl}/`;
  if (path.endsWith("/index.html")) return `${CONFIG.siteUrl}/${path.slice(0, -"index.html".length)}`;
  return `${CONFIG.siteUrl}/${path.replace(/\.html$/, "")}`;
}

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return;
    throw err;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile() && entry.name.endsWith(".html")) yield full;
  }
}

async function writeIfChanged(rel, content) {
  const abs = join(ROOT, rel);
  let current = null;
  try {
    current = await readFile(abs, "utf8");
  } catch {
    /* new file */
  }
  if (current === content) {
    console.log(`  unchanged  ${rel}`);
    return;
  }
  await writeFile(abs, content, "utf8");
  console.log(`  wrote      ${rel}`);
}

/* ---------- articles ---------- */

async function loadArticles() {
  const articles = [];
  for await (const abs of walk(join(ROOT, CONFIG.blogDir))) {
    const rel = posix(relative(ROOT, abs));
    if (rel === BLOG_INDEX) continue;
    const html = await readFile(abs, "utf8");
    if (!html.trim() || isNoindex(html)) continue;

    const loc = getCanonical(html) || urlFromPath(rel);
    let href = `/${rel}`;
    if (CONFIG.cleanUrls) {
      try {
        href = new URL(loc).pathname;
      } catch {
        href = `/${rel.replace(/\.html$/, "")}`;
      }
    }
    const published = getPublished(html) || (await fileDate(abs));
    articles.push({
      rel,
      loc,
      href,
      title: getTitle(html),
      description: getMeta(html, "name", "description") || "",
      published,
    });
  }
  // Newest first; title keeps the order stable for same-day posts.
  return articles.sort((a, b) => b.published - a.published || a.title.localeCompare(b.title));
}

function postItem(a, level) {
  return `<li>
  <h${level} class="post__title"><a href="${esc(a.href)}">${esc(a.title)}</a></h${level}>${
    a.description ? `\n  <p class="post__desc">${esc(a.description)}</p>` : ""
  }
  <p class="post__meta"><time datetime="${ymd(a.published)}">${pretty(a.published)}</time></p>
</li>`;
}

const postList = (articles, level) =>
  `<ol class="posts">\n${indent(articles.map((a) => postItem(a, level)).join("\n"), 2)}\n</ol>`;

/* ---------- blogs/index.html ---------- */

function buildBlogIndex(articles) {
  const { siteUrl, siteName, author } = CONFIG;
  const pageUrl = `${siteUrl}/${CONFIG.blogDir}/`;
  const home = CONFIG.cleanUrls ? "/" : "../index.html";
  const link = (name) => (CONFIG.cleanUrls ? `/${name}` : `../${name}.html`);
  const title = `All articles | ${siteName}`;
  const description = `Every ${siteName} article, newest first. Plain-language explanations of what's trending in tech, culture, money, and the internet.`;

  const body = articles.length
    ? postList(articles, 2)
    : `<p>No articles yet. Check back soon.</p>`;

  return `<!doctype html>
<html lang="en">

<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}" />
  <meta name="author" content="${esc(author)}" />
  <meta name="robots" content="index, follow" />
  <meta name="color-scheme" content="light dark" />
  <meta name="theme-color" content="#f4f7f9" media="(prefers-color-scheme: light)" />
  <meta name="theme-color" content="#0e151c" media="(prefers-color-scheme: dark)" />
  <link rel="canonical" href="${esc(pageUrl)}" />
  <link rel="alternate" type="application/rss+xml" title="${esc(siteName)}" href="${esc(siteUrl)}/feed.xml" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="${esc(siteName)}" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(description)}" />
  <meta property="og:url" content="${esc(pageUrl)}" />
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="${esc(title)}" />
  <link rel="stylesheet" href="../css/blog.css" />
  <link rel="stylesheet" href="../css/index.css" />
  <script>
    try {
      var t = localStorage.getItem("theme");
      if (t === "light" || t === "dark")
        document.documentElement.dataset.theme = t;
    } catch (e) {}
  </script>
</head>

<body>
  <a class="skip" href="#main">Skip to main content</a>

  <div class="wrap">
    <header class="masthead">
      <a class="brand" href="${home}">${esc(siteName)}</a>
      <button class="icon-btn" type="button" id="theme-toggle" aria-label="Switch theme">
        <svg id="icon-sun" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
        <svg id="icon-moon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" hidden>
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      </button>
    </header>
  </div>

  <main id="main" class="wrap">
    <section aria-labelledby="archive-title">
      <h1 id="archive-title">All articles</h1>
      <p class="deck">What’s been trending, explained in plain words. Newest first.</p>
${indent(body, 6)}
      <p><a href="${esc(siteUrl)}/feed.xml">Subscribe with RSS</a></p>
    </section>
  </main>

  <div class="wrap">
    <footer>
      <div>
        © <span id="current-year">${new Date().getUTCFullYear()}</span> ${esc(siteName)}. All rights reserved.
      </div>
      <div class="legal">
        <a href="${link("privacy")}">Privacy Policy</a> |
        <a href="${link("terms")}">Terms of Service</a>
      </div>
    </footer>
  </div>

  <script src="../js/index.js" type="module" defer></script>
</body>

</html>
`;
}

/* ---------- home page block ---------- */

const START = "<!-- LATEST:START -->";
const END = "<!-- LATEST:END -->";

function buildLatestBlock(articles) {
  const latest = articles.slice(0, CONFIG.homeCount);
  const inner = latest.length
    ? `${postList(latest, 3)}\n<p><a href="${CONFIG.cleanUrls ? `/${CONFIG.blogDir}/` : `${CONFIG.blogDir}/index.html`}">All articles</a></p>`
    : `<p>The first article is on its way.</p>`;
  return `${START}
<section aria-labelledby="latest-title">
  <h2 id="latest-title">Latest articles</h2>
${indent(inner, 2)}
</section>
${END}`;
}

async function updateHome(articles) {
  const abs = join(ROOT, "index.html");
  let html;
  try {
    html = await readFile(abs, "utf8");
  } catch {
    console.warn("  skipped    index.html (not found)");
    return;
  }

  const block = buildLatestBlock(articles);
  const markers = new RegExp(`[ \\t]*${START}[\\s\\S]*?${END}`);
  const anchor = '<section aria-labelledby="topics-title">';

  if (markers.test(html)) {
    html = html.replace(markers, () => indent(block, 4));
  } else if (html.includes(anchor)) {
    html = html.replace(anchor, () => `${indent(block, 4).trimStart()}\n\n    ${anchor}`);
    console.log("  inserted   LATEST markers into index.html (before the topics section)");
  } else {
    console.warn(
      `  warning    index.html has no LATEST markers and no topics section.\n             Add ${START} and ${END} where the list should go.`,
    );
  }

  if (!/type=["']application\/rss\+xml["']/i.test(html)) {
    html = html.replace(
      "</head>",
      () => `  <link rel="alternate" type="application/rss+xml" title="${esc(CONFIG.siteName)}" href="${esc(CONFIG.siteUrl)}/feed.xml" />\n</head>`,
    );
  }
  await writeIfChanged("index.html", html);
}

/* ---------- RSS ---------- */

function buildFeed(articles) {
  const { siteUrl, siteName, siteDescription, author } = CONFIG;
  const items = articles.slice(0, CONFIG.feedCount);
  const built = items[0]?.published ?? new Date(0);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">',
    "  <channel>",
    `    <title>${esc(siteName)}</title>`,
    `    <link>${esc(siteUrl)}/</link>`,
    `    <description>${esc(siteDescription)}</description>`,
    "    <language>en</language>",
    `    <lastBuildDate>${built.toUTCString()}</lastBuildDate>`,
    `    <atom:link href="${esc(siteUrl)}/feed.xml" rel="self" type="application/rss+xml" />`,
    ...items.map((a) =>
      [
        "    <item>",
        `      <title>${esc(a.title)}</title>`,
        `      <link>${esc(a.loc)}</link>`,
        `      <guid isPermaLink="true">${esc(a.loc)}</guid>`,
        `      <pubDate>${a.published.toUTCString()}</pubDate>`,
        `      <dc:creator>${esc(author)}</dc:creator>`,
        `      <description>${esc(a.description)}</description>`,
        "    </item>",
      ].join("\n"),
    ),
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");
}

/* ---------- sitemap ---------- */

async function buildSitemap(articles) {
  const files = new Set();
  for (const name of CONFIG.staticPages) {
    const abs = join(ROOT, name);
    try {
      await stat(abs);
      files.add(abs);
    } catch {
      console.warn(`  skipped    missing static page: ${name}`);
    }
  }
  for await (const abs of walk(join(ROOT, CONFIG.blogDir))) files.add(abs);

  const newest = articles[0] ? ymd(articles[0].published) : null;

  const pages = [];
  for (const abs of files) {
    const html = await readFile(abs, "utf8");
    if (!html.trim() || isNoindex(html)) continue;
    const rel = posix(relative(ROOT, abs));
    const isHome = rel === "index.html";
    const isArchive = rel === BLOG_INDEX;
    // Home and archive change whenever an article is added.
    const lastmod =
      (isHome || isArchive) && newest
        ? newest
        : ymd(getModified(html) || (await fileDate(abs)));
    pages.push({ loc: getCanonical(html) || urlFromPath(rel), lastmod, isHome });
  }

  // De-duplicate by URL; home first, then newest first.
  const unique = [...new Map(pages.map((p) => [p.loc, p])).values()].sort(
    (a, b) => Number(b.isHome) - Number(a.isHome) || b.lastmod.localeCompare(a.lastmod) || a.loc.localeCompare(b.loc),
  );

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...unique.map((p) => `  <url>\n    <loc>${esc(p.loc)}</loc>\n    <lastmod>${p.lastmod}</lastmod>\n  </url>`),
    "</urlset>",
    "",
  ].join("\n");

  await writeIfChanged("sitemap.xml", xml);
  return unique.length;
}

/* ---------- main ---------- */

async function main() {
  const articles = await loadArticles();
  console.log(`Found ${articles.length} article${articles.length === 1 ? "" : "s"}.`);

  // Order matters: the archive must exist before the sitemap scans for it.
  await writeIfChanged(BLOG_INDEX, buildBlogIndex(articles));
  await writeIfChanged("feed.xml", buildFeed(articles));
  await updateHome(articles);
  const count = await buildSitemap(articles);

  console.log(`Done. Sitemap has ${count} URL${count === 1 ? "" : "s"}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});