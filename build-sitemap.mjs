#!/usr/bin/env node
/**
 * Generates sitemap.xml from the HTML files in the project.
 *
 * Usage (from the project root):  node build-sitemap.mjs
 * Optional:                       SITE_URL=https://example.com node build-sitemap.mjs
 *
 * - Scans blogs/ recursively for .html files.
 * - Adds the home page and any pages listed in STATIC_PAGES.
 * - Uses each page's <link rel="canonical"> as its URL when present,
 *   so the sitemap always matches what the page tells search engines.
 * - Skips pages marked noindex.
 * - Needs Node 18+ and no packages.
 */
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const SITE_URL = (process.env.SITE_URL || "https://aixplain.pages.dev").replace(/\/+$/, "");
const BLOG_DIR = "blogs";
const STATIC_PAGES = ["index.html", "privacy.html", "terms.html"];
const OUTPUT = "sitemap.xml";

/* Fallback URL when a page has no canonical tag:
   index.html -> /, blogs/index.html -> /blogs/, other pages -> path without .html */
function urlFromPath(file) {
  const path = file.split(sep).join("/");
  if (path === "index.html") return `${SITE_URL}/`;
  if (path.endsWith("/index.html")) return `${SITE_URL}/${path.slice(0, -"index.html".length)}`;
  return `${SITE_URL}/${path.replace(/\.html$/, "")}`;
}

function getCanonical(html) {
  const tag = html.match(/<link\b[^>]*\brel=["']canonical["'][^>]*>/i)?.[0];
  return tag?.match(/\bhref=["']([^"']+)["']/i)?.[1] ?? null;
}

const isNoindex = (html) =>
  /<meta\b[^>]*\bname=["']robots["'][^>]*\bcontent=["'][^"']*noindex/i.test(html);

/* Best available date, as YYYY-MM-DD */
function getLastmod(html, mtime) {
  const patterns = [
    /<meta\b[^>]*\bproperty=["']article:modified_time["'][^>]*\bcontent=["']([^"']+)["']/i,
    /"dateModified"\s*:\s*"([^"]+)"/,
    /<time\b[^>]*\bdatetime=["']([^"']+)["']/i,
  ];
  for (const re of patterns) {
    const value = html.match(re)?.[1];
    const date = value && new Date(value);
    if (date && !Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  }
  return mtime.toISOString().slice(0, 10);
}

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return;
    throw err;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile() && entry.name.endsWith(".html")) yield full;
  }
}

const escapeXml = (s) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);

async function readPage(absPath) {
  const [html, info] = await Promise.all([readFile(absPath, "utf8"), stat(absPath)]);
  if (!html.trim() || isNoindex(html)) return null;
  const rel = relative(ROOT, absPath);
  return {
    loc: getCanonical(html) || urlFromPath(rel),
    lastmod: getLastmod(html, info.mtime),
    isHome: rel === "index.html",
  };
}

async function main() {
  const files = new Set();
  for (const name of STATIC_PAGES) {
    const abs = join(ROOT, name);
    try {
      await stat(abs);
      files.add(abs);
    } catch {
      console.warn(`Skipped missing static page: ${name}`);
    }
  }
  for await (const abs of walk(join(ROOT, BLOG_DIR))) files.add(abs);

  const pages = (await Promise.all([...files].map(readPage))).filter(Boolean);

  // De-duplicate by URL, newest first; the home page always leads.
  const unique = [...new Map(pages.map((p) => [p.loc, p])).values()].sort(
    (a, b) => Number(b.isHome) - Number(a.isHome) || b.lastmod.localeCompare(a.lastmod),
  );

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...unique.map(
      (p) => `  <url>\n    <loc>${escapeXml(p.loc)}</loc>\n    <lastmod>${p.lastmod}</lastmod>\n  </url>`,
    ),
    "</urlset>",
    "",
  ].join("\n");

  await writeFile(join(ROOT, OUTPUT), xml, "utf8");
  console.log(`Wrote ${OUTPUT} with ${unique.length} URL${unique.length === 1 ? "" : "s"}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});