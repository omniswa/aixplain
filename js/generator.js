(() => {
  const $ = (id) => document.getElementById(id);
  const fields = [
    "title",
    "description",
    "content",
    "siteUrl",
    "siteName",
    "author",
  ];
  const el = Object.fromEntries(fields.map((n) => [n, $(n)]));
  const CSS_PATH = "../../css/blog.css";
  const JS_PATH = "../../js/blog.js";
  const FALLBACK_BASE = "https://placeholder.invalid/";
  /* Paths appended to the base URL for og:url / canonical and og:image */
  const pagePath = (year, slug) => `blogs/${year}/${slug}`;
  const imagePath = (year, slug) => `images/${year}/${slug}.webp`;
  
  const words = (s) => (s.trim().match(/\S+/g) || []).length;
  const slugify = (s) =>
    s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/, "");
  const esc = (s) =>
    String(s).replace(
      /[&<>"']/g,
      (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c],
    );
  const validUrl = (v) => {
    try {
      return /^https?:$/.test(new URL(v).protocol);
    } catch {
      return false;
    }
  };

    /* Smart quotes */
  const OPENERS = /[\s([{\u2013\u2014\u2018\u201C]/;
  const isOpen = (before) => before === "" || OPENERS.test(before);

  // Curl quotes in a plain string. `prev` is the character just before it.
  function curl(text, prev = "") {
    let out = "";
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      const before = out ? out.at(-1) : prev;
      if (c === '"') {
        out += isOpen(before) ? "\u201C" : "\u201D";
      } else if (c === "'") {
        // Apostrophes and closing quotes are ’; '90s keeps ’
        const digitNext = /\d/.test(text[i + 1] ?? "");
        out += isOpen(before) && !digitNext ? "\u2018" : "\u2019";
      } else {
        out += c;
      }
    }
    return out;
  }

  // Curl quotes across all text nodes in a DOM tree, skipping code.
  function smartQuotes(scope) {
    const skip = "code, pre, kbd, samp, script, style, textarea";
    const block =
      "p, li, h1, h2, h3, h4, h5, h6, td, th, dt, dd, blockquote, figcaption, summary, caption";
    const walker = scope.ownerDocument.createTreeWalker(
      scope,
      NodeFilter.SHOW_TEXT,
    );
    let prev = "";
    let currentBlock = null;
    for (let node; (node = walker.nextNode()); ) {
      const parent = node.parentElement;
      const parentBlock = parent.closest(block);
      if (parentBlock !== currentBlock) {
        currentBlock = parentBlock;
        prev = "";
      }
      if (!parent.closest(skip)) node.nodeValue = curl(node.nodeValue, prev);
      prev = node.nodeValue.at(-1) ?? prev; // code still counts as context
    }
  }
  
  const rules = {
    title: (v) =>
      !v ?
      "Enter a title." :
      v.length < 10 ?
      "Use at least 10 characters." :
      v.length > 60 ?
      "Keep the title to 60 characters or fewer." :
      !slugify(v) ?
      "Add letters or numbers so a URL slug can be created." :
      "",
    description: (v) =>
      !v ?
      "Enter a meta description." :
      v.length < 50 ?
      "Use at least 50 characters." :
      v.length > 160 ?
      "Keep the description to 160 characters or fewer." :
      "",
    content: (v) =>
      !v ?
      "Write some Markdown content." :
      v.length < 100 ?
      "Write at least 100 characters of content." :
      "",
    siteUrl: (v) =>
      v && !validUrl(v) ?
      "Enter a full URL starting with http:// or https://." :
      "",
    siteName: (v) => (v ? "" : "Enter a site name."),
    author: (v) => (v ? "" : "Enter an author name."),
  };
  const val = (n) => el[n].value.trim();
  
  function check(n) {
    const msg = rules[n](val(n));
    $("err-" + n).textContent = msg;
    el[n].setAttribute("aria-invalid", String(!!msg));
    return !msg;
  }
  
  function counters() {
    const t = el.title.value.trim().length,
      d = el.description.value.trim().length;
    $("count-title").textContent = t + "/60";
    $("count-title").toggleAttribute("data-over", t > 60);
    $("count-description").textContent = d + "/160";
    $("count-description").toggleAttribute("data-over", d > 160);
    const w = words(el.content.value);
    $("count-content").textContent = w + (w === 1 ? " word" : " words");
    $("slug-out").textContent =
      (slugify(el.title.value) || "your-title") + ".html";
  }
  
  const touched = new Set();
  for (const n of fields) {
    el[n].addEventListener("input", () => {
      counters();
      if (touched.has(n)) check(n);
    });
    el[n].addEventListener("blur", () => {
      if (el[n].value || touched.has(n)) {
        touched.add(n);
        check(n);
      }
    });
  }
  
  /* Markdown -> processed HTML */
  function renderBody(md, base) {
    const origin = new URL(base).origin;
    const doc = new DOMParser().parseFromString(
      marked.parse(md, { gfm: true }),
      "text/html",
    );
    doc
      .querySelectorAll("script,style,iframe,object,embed")
      .forEach((n) => n.remove());
    doc.querySelectorAll("*").forEach((n) => [...n.attributes].forEach((a) => {
      if (
        /^on/i.test(a.name) ||
        (/^(href|src)$/i.test(a.name) && /^\s*javascript:/i.test(a.value))
      )
        n.removeAttribute(a.name);
    }), );
    doc.querySelectorAll("h1").forEach((h) => {
      const h2 = doc.createElement("h2");
      h2.innerHTML = h.innerHTML;
      h.replaceWith(h2);
    });
    
    doc.querySelectorAll("a[href]").forEach((a) => {
      try {
        const u = new URL(a.getAttribute("href"), base);
        if (/^https?:$/.test(u.protocol) && u.origin !== origin) {
          a.setAttribute("target", "_blank");
          a.setAttribute("rel", "nofollow noopener");
        }
      } catch {
        /* leave as is */
      }
    });
    
    doc.querySelectorAll("table").forEach((table, i) => {
      if (table.closest(".table-wrap")) return;
      table
        .querySelectorAll("thead th")
        .forEach((th) => th.setAttribute("scope", "col"));
      table
        .querySelectorAll("tbody th")
        .forEach((th) => th.setAttribute("scope", "row"));
      const wrap = doc.createElement("div");
      wrap.className = "table-wrap";
      wrap.setAttribute("role", "region");
      wrap.setAttribute(
        "aria-label",
        table.querySelector("caption")?.textContent.trim() ||
        "Table " + (i + 1),
      );
      wrap.tabIndex = 0;
      table.replaceWith(wrap);
      wrap.append(table);
    });
    
    doc.querySelectorAll("pre").forEach((p) => p.setAttribute("tabindex", "0"));
    doc.querySelectorAll("img").forEach((img) => {
      img.setAttribute("loading", "lazy");
      if (!img.hasAttribute("alt")) img.setAttribute("alt", "");
    });
    smartQuotes(doc.body);
    return { html: doc.body.innerHTML, wordCount: words(doc.body.textContent) };
  }
  
  const icon = (attrs, inner) =>
    `<svg width="${attrs.s}" height="${attrs.s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"${attrs.join ? ' stroke-linejoin="round"' : ""} aria-hidden="true"${attrs.id ? ` id="${attrs.id}"` : ""}${attrs.hidden ? " hidden" : ""}>${inner}</svg>`;
  
  function buildPage() {
    const title = curl(val("title")),
      description = curl(val("description"));
    const siteName = val("siteName"),
      author = val("author");
    let base = val("siteUrl");
    if (base && !base.endsWith("/")) base += "/";
    const slug = slugify(title);
    const now = new Date();
    const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const pretty = now.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    const { html, wordCount } = renderBody(
      el.content.value,
      base || FALLBACK_BASE,
    );
    const minutes = Math.max(1, Math.round(wordCount / 220));
    const year = now.getFullYear();
    const pageUrl = base ? base + pagePath(year, slug) : "";
    const image = base + imagePath(year, slug);
    const fullTitle = `${title} | ${siteName}`;
    const t = esc(title),
      d = esc(description),
      a = esc(author),
      sn = esc(siteName);
    
    const ld = {
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      headline: title,
      description,
      image,
      datePublished: iso,
      dateModified: iso,
      inLanguage: "en",
      wordCount,
      author: { "@type": "Person", name: author },
      publisher: { "@type": "Organization", name: siteName },
    };
    if (pageUrl) {
      ld.url = pageUrl;
      ld.mainEntityOfPage = pageUrl;
    }
    const ldJson = JSON.stringify(ld, null, 2)
      .replace(/</g, "\\u003c")
      .replace(/\n/g, "\n      ");
    
    return {
      slug,
      text: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1, viewport-fit=cover"
    />
    <title>${esc(fullTitle)}</title>
    <meta name="description" content="${d}" />
    <meta name="author" content="${a}" />
    <meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large" />
    <meta name="color-scheme" content="light dark" />
    <meta name="theme-color" content="#f4f7f9" media="(prefers-color-scheme: light)" />
    <meta name="theme-color" content="#0e151c" media="(prefers-color-scheme: dark)" />${
      pageUrl
        ? `
    <link rel="canonical" href="${esc(pageUrl)}" />`
        : ""
    }
    <link rel="alternate" type="application/rss+xml" title="${sn}" href="${base}feed.xml" />
    <meta property="og:type" content="article" />
    <meta property="og:site_name" content="${sn}" />
    <meta property="og:locale" content="en_US" />
    <meta property="og:title" content="${t}" />
    <meta property="og:description" content="${d}" />${
      pageUrl
        ? `
    <meta property="og:url" content="${esc(pageUrl)}" />`
        : ""
    }
    <meta property="og:image" content="${esc(image)}" />
    <meta property="og:image:type" content="image/webp" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="${t}" />
    <meta property="article:published_time" content="${iso}" />
    <meta property="article:modified_time" content="${iso}" />
    <meta property="article:author" content="${a}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${t}" />
    <meta name="twitter:image" content="${esc(image)}" />
    <link rel="stylesheet" href="${CSS_PATH}" />
    <script type="application/ld+json">
      ${ldJson}
    <\/script>
    <script>
      try {
        var t = localStorage.getItem("theme");
        if (t === "light" || t === "dark")
          document.documentElement.dataset.theme = t;
      } catch (e) {}
    <\/script>
  </head>
  <body>
    <a class="skip" href="#main">Skip to main content</a>

    <div class="wrap">
      <header class="masthead">
        <a class="brand" href="../../index.html" id="top">${sn}</a>
        <button class="icon-btn" type="button" id="theme-toggle" aria-label="Switch theme">
          ${icon({ s: 20, id: "icon-sun" }, '<circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />')}
          ${icon({ s: 20, id: "icon-moon", join: 1, hidden: 1 }, '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />')}
        </button>
      </header>
    </div>

    <main id="main" class="wrap">
      <article>
        <header>
          <h1>${t}</h1>
          <p class="deck">${d}</p>
          <div class="meta">
            <span>By ${a}</span> |
            <span>Published <time datetime="${iso}">${pretty}</time></span> |
            <span>${minutes}-minute read</span>
          </div>
        </header>

        ${html}
      </article>
    </main>

    <div class="wrap">
      <footer>
        <div>
          © <span id="current-year">${now.getFullYear()}</span> ${sn}. All rights reserved.
        </div>
        <div class="legal">
          <a href="../../privacy.html">Privacy Policy</a> |
          <a href="../../terms.html">Terms of Service</a>
        </div>
      </footer>
    </div>

    <div class="toast" id="toast" role="status" aria-live="polite"></div>

    <nav class="pill" aria-label="Quick actions">
      <button type="button" id="btn-share">
        ${icon({ s: 18, join: 1 }, '<path d="M12 15V3M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />')}
        Share
      </button>
      <button type="button" id="btn-toc" aria-haspopup="dialog">
        ${icon({ s: 18 }, '<path d="M4 6h16M4 12h10M4 18h13" />')}
        Contents
      </button>
      <button type="button" id="btn-top">
        ${icon({ s: 18, join: 1 }, '<path d="M12 19V5M5 12l7-7 7 7" />')}
        Top
      </button>
    </nav>

    <dialog class="sheet" id="sheet" aria-labelledby="sheet-title">
      <div class="sheet__head">
        <h2 class="sheet__title" id="sheet-title">On this page</h2>
        <button class="icon-btn" type="button" id="sheet-close" aria-label="Close contents">
          ${icon({ s: 18 }, '<path d="M6 6l12 12M18 6L6 18" />')}
        </button>
      </div>
      <ul class="toc" id="toc"></ul>
    </dialog>

    <script src="${JS_PATH}" type="module" defer><\/script>
  </body>
</html>
`,
    };
  }
  
  /* Actions */
  const status = $("status");
  let timer;
  
  function say(msg, isError) {
    status.textContent = msg;
    status.toggleAttribute("data-error", !!isError);
    clearTimeout(timer);
    timer = setTimeout(() => {
      status.textContent = "";
    }, 4000);
  }
  
  function validateAll() {
    let first = null;
    for (const n of fields) {
      touched.add(n);
      if (!check(n) && !first) first = el[n];
    }
    if (first) {
      first.focus();
      say("Fix the highlighted fields.", true);
      return false;
    }
    return true;
  }
  const ready = () => {
    if (window.marked) return true;
    say(
      "Markdown library failed to load. Check your connection and reload.",
      true,
    );
    return false;
  };
  
  $("form").addEventListener("submit", (e) => {
    e.preventDefault();
    if (!validateAll() || !ready()) return;
    const { slug, text } = buildPage();
    const url = URL.createObjectURL(
      new Blob([text], { type: "text/html;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = slug + ".html";
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    say("Downloaded " + slug + ".html");
  });
  
  $("btn-copy").addEventListener("click", async () => {
    if (!validateAll() || !ready()) return;
    try {
      await navigator.clipboard.writeText(buildPage().text);
      say("HTML copied");
    } catch {
      say("Copy was blocked. Use Download HTML instead.", true);
    }
  });
  
  counters();
})();