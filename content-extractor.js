/**
 * Content Extractor - injected into the active tab.
 * Extracts page content, finds all image URLs, and returns structured data.
 * Handles Wikipedia specially (infoboxes, citations, references).
 */
function extractPageContent(options) {
  options = options || {};
  const includeRefs    = options.includeRefs    !== false;
  const includeInfobox = options.includeInfobox !== false;
  const includeToc     = options.includeToc     !== false;

  const url      = window.location.href;
  const hostname = window.location.hostname;
  const isWiki   = hostname.includes('wikipedia.org') || hostname.includes('wikimedia.org');

  const result = {
    title:     document.title.replace(/ - Wikipedia$/, '').replace(/ \| .*$/, '').trim(),
    url:       url,
    isWiki:    isWiki,
    language:  document.documentElement.lang || 'en',
    html:      '',
    images:    [],  // [{originalSrc, localPath, mimeType}]
  };

  // ── Extract DOM ──────────────────────────────────────────────────────────────
  let container;
  if (isWiki) {
    container = extractWikipedia(includeRefs, includeInfobox, includeToc);
  } else {
    container = extractGeneric();
  }

  // ── Process images ───────────────────────────────────────────────────────────
  let imgIndex = 0;
  const seenSrcs = new Set();

  container.querySelectorAll('img').forEach(img => {
    // Try data-src (lazy loaded), then src
    let src = img.getAttribute('data-src') || img.getAttribute('src') || '';
    src = src.trim();

    if (!src || src.startsWith('data:') || src.length < 10) {
      img.remove();
      return;
    }

    // Make absolute
    src = makeAbsolute(src);

    // Skip tiny tracker pixels, SVG icons, etc.
    const w = parseInt(img.getAttribute('width') || '999');
    const h = parseInt(img.getAttribute('height') || '999');
    if ((w !== 999 && w < 20) || (h !== 999 && h < 20)) {
      img.remove();
      return;
    }

    // Skip duplicate images
    if (seenSrcs.has(src)) {
      // Still update the src to point to the already-recorded local path
      const existing = result.images.find(i => i.originalSrc === src);
      if (existing) {
        img.setAttribute('src', existing.localPath);
        img.removeAttribute('srcset');
        img.removeAttribute('data-src');
      } else {
        img.remove();
      }
      return;
    }
    seenSrcs.add(src);

    // For Wikipedia, try to get the full resolution image
    let fetchSrc = src;
    if (isWiki) {
      fetchSrc = getWikiFullImageUrl(src);
    }

    const ext      = getImageExt(fetchSrc);
    const mime     = extToMime(ext);
    const localPath = `images/img_${imgIndex}.${ext}`;
    imgIndex++;

    result.images.push({ originalSrc: fetchSrc, localPath, mimeType: mime });

    img.setAttribute('src', localPath);
    img.removeAttribute('srcset');
    img.removeAttribute('data-src');
    img.removeAttribute('data-file-width');
    img.removeAttribute('data-file-height');
    img.removeAttribute('loading');
    img.style.maxWidth = '100%';
    img.style.height   = 'auto';
  });

  // ── Clean up remaining attributes ────────────────────────────────────────────
  container.querySelectorAll('[srcset]').forEach(el => el.removeAttribute('srcset'));
  container.querySelectorAll('script, style, iframe, form, input, button').forEach(el => el.remove());
  container.querySelectorAll('[onclick],[onload],[onerror]').forEach(el => {
    el.removeAttribute('onclick');
    el.removeAttribute('onload');
    el.removeAttribute('onerror');
  });

  result.html = container.innerHTML;
  return result;
}

// ── Wikipedia Extractor ────────────────────────────────────────────────────────
function extractWikipedia(includeRefs, includeInfobox, includeToc) {
  const parser = document.querySelector('#mw-content-text .mw-parser-output')
    || document.querySelector('#mw-content-text')
    || document.querySelector('#content');

  if (!parser) {
    return extractGeneric();
  }

  const clone = parser.cloneNode(true);

  // ── Remove unwanted elements ──
  const removeSelectors = [
    '.mw-editsection',
    '.mw-editsection-bracket',
    '.navbox',
    '.navbox-styles',
    '.navbox-inner',
    '.mw-empty-elt',
    '.printfooter',
    '.catlinks',
    '.mw-jump-link',
    '#jump-to-nav',
    '.sister-project',
    '.noprint:not(.reference):not(sup)',
    '.ambox',     // article message boxes
    '.tmbox',
    '.cmbox',
    '.ombox',
    '.fmbox',
    '.dmbox',
    '.stub',
    '.metadata',
    '.refbegin',
    '.citation-needed',
    '.plainlinks.hlist',
    'table.wikitable caption a.new',  // red links in table captions
  ];
  removeSelectors.forEach(sel => {
    try { clone.querySelectorAll(sel).forEach(el => el.remove()); } catch(e) {}
  });

  // ── Optionally remove infobox ──
  if (!includeInfobox) {
    clone.querySelectorAll('.infobox, .infobox_v2, .sidebar').forEach(el => el.remove());
  }

  // ── Optionally remove ToC ──
  if (!includeToc) {
    clone.querySelectorAll('#toc, .toc, .mw-toc').forEach(el => el.remove());
  }

  // ── Optionally remove references ──
  if (!includeRefs) {
    // Remove the References section heading and the reference list
    clone.querySelectorAll('.references, .reflist, .refbegin, ol.references').forEach(el => el.remove());
    // Remove the "References" h2 section
    clone.querySelectorAll('h2, h3').forEach(heading => {
      const text = (heading.textContent || '').toLowerCase().trim();
      if (text === 'references' || text === 'notes' || text === 'footnotes' || text === 'citations') {
        // Remove the heading and the next sibling div/ol (the actual list)
        let next = heading.nextElementSibling;
        while (next && next.tagName !== 'H2') {
          const toRemove = next;
          next = next.nextElementSibling;
          if (toRemove.classList.contains('references') ||
              toRemove.classList.contains('reflist') ||
              toRemove.tagName === 'OL') {
            toRemove.remove();
          }
        }
        heading.remove();
      }
    });
  }

  // ── Fix links ──
  clone.querySelectorAll('a[href]').forEach(a => {
    const href = a.getAttribute('href');
    if (!href) return;
    if (href.startsWith('//')) {
      a.setAttribute('href', 'https:' + href);
    } else if (href.startsWith('/')) {
      a.setAttribute('href', 'https://en.wikipedia.org' + href);
    }
    // Remove class that adds red-link styling
    a.classList.remove('new');
  });

  // ── Style infobox for EPUB ──
  clone.querySelectorAll('.infobox, .infobox_v2').forEach(table => {
    table.setAttribute('style',
      'float:right; margin:0 0 1em 1em; border-collapse:collapse; font-size:0.85em; width:auto; max-width:260px;'
    );
  });

  // ── Fix image containers ──
  clone.querySelectorAll('.thumb').forEach(div => {
    div.setAttribute('style', 'text-align:center; margin:1em auto;');
  });
  clone.querySelectorAll('.thumbinner').forEach(div => {
    div.setAttribute('style', 'display:inline-block;');
  });
  clone.querySelectorAll('.thumbcaption').forEach(div => {
    div.setAttribute('style', 'font-size:0.85em; color:#555; text-align:center; margin-top:4px;');
  });

  // ── Style tables ──
  clone.querySelectorAll('table.wikitable').forEach(t => {
    t.setAttribute('style',
      'border-collapse:collapse; margin:1em 0; font-size:0.9em; width:100%;'
    );
  });
  clone.querySelectorAll('table.wikitable th').forEach(th => {
    th.setAttribute('style', 'background:#f0f0e8; border:1px solid #ccc; padding:5px 8px;');
  });
  clone.querySelectorAll('table.wikitable td').forEach(td => {
    td.setAttribute('style', 'border:1px solid #ccc; padding:5px 8px;');
  });

  // Wrap in a div for cleaner output
  const wrapper = document.createElement('div');
  wrapper.id = 'epub-content';
  wrapper.innerHTML = clone.innerHTML;
  return wrapper;
}

// ── Generic Extractor ─────────────────────────────────────────────────────────
function extractGeneric() {
  const candidates = [
    '#article-body',
    '.article-body',
    'article',
    '[role="main"]',
    'main',
    '.post-content',
    '.entry-content',
    '.post-body',
    '.article-content',
    '.blog-content',
    '.story-body',
    '.content-body',
    '.post',
    '#content',
    '.content',
    '.main-content',
  ];

  let best = null;
  let bestScore = 0;

  for (const sel of candidates) {
    const el = document.querySelector(sel);
    if (!el) continue;
    // Simple scoring: more text = better
    const textLen = (el.textContent || '').trim().length;
    if (textLen > bestScore) {
      bestScore = textLen;
      best = el;
    }
  }

  // Fallback: find the element with most text
  if (!best || bestScore < 200) {
    let maxText = 0;
    document.querySelectorAll('div, section, article').forEach(el => {
      const len = (el.textContent || '').trim().length;
      if (len > maxText && len < 500000) {
        maxText = len;
        best = el;
      }
    });
  }

  if (!best) best = document.body;

  const clone = best.cloneNode(true);

  // Remove nav/header/footer/sidebar
  ['nav', 'header', 'footer', 'aside',
   '.sidebar', '#sidebar', '.navigation', '.nav-menu',
   '.advertisement', '.ad', '.ads', '.cookie-banner',
   '.social-share', '.related-posts', '.comments',
   '#comments', '.widget', '.newsletter-signup'].forEach(sel => {
    try { clone.querySelectorAll(sel).forEach(el => el.remove()); } catch(e) {}
  });

  // Fix relative links
  clone.querySelectorAll('a[href]').forEach(a => {
    const href = a.getAttribute('href');
    if (href && href.startsWith('/')) {
      a.setAttribute('href', window.location.origin + href);
    }
  });

  const wrapper = document.createElement('div');
  wrapper.id = 'epub-content';
  wrapper.innerHTML = clone.innerHTML;
  return wrapper;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeAbsolute(src) {
  if (src.startsWith('data:'))      return src;
  if (src.startsWith('http'))       return src;
  if (src.startsWith('//'))         return 'https:' + src;
  if (src.startsWith('/'))          return window.location.origin + src;
  try {
    return new URL(src, window.location.href).href;
  } catch(e) {
    return src;
  }
}

/**
 * Rewrite Wikipedia thumbnail URLs to request a fixed max width (800px).
 * This avoids fetching multi-megabyte originals while keeping images sharp enough for e-readers.
 * Thumbnail: https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/File.jpg/300px-File.jpg
 * Capped:    https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/File.jpg/800px-File.jpg
 */
function getWikiFullImageUrl(src) {
  const MAX_WIDTH = 800;
  const thumbPattern = /^(https?:\/\/upload\.wikimedia\.org\/wikipedia\/[^/]+\/thumb\/.+?\/)(\d+)(px-[^/]+)$/;
  const match = src.match(thumbPattern);
  if (match) {
    const currentWidth = parseInt(match[2]);
    // Only upscale if current thumb is smaller; never fetch larger than MAX_WIDTH
    const targetWidth = Math.min(MAX_WIDTH, Math.max(currentWidth, MAX_WIDTH));
    return match[1] + targetWidth + match[3];
  }
  return src;
}

function getImageExt(url) {
  // Strip query string first
  const clean = url.split('?')[0].split('#')[0];
  const match = clean.match(/\.(jpe?g|png|gif|webp|svg)$/i);
  if (match) {
    const ext = match[1].toLowerCase();
    return ext === 'jpeg' ? 'jpg' : ext;
  }
  return 'jpg'; // default
}

function extToMime(ext) {
  const map = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
  };
  return map[ext] || 'image/jpeg';
}

// Expose globally so popup.js can call it after file injection (no eval/new Function needed)
window._epubExtract = extractPageContent;

/**
 * _epubFetchImages — runs inside the real page tab.
 *
 * Because this code executes in the page's own context the browser
 * automatically attaches the correct Referer (the page URL) and all
 * cookies for the page's domain — exactly what image servers expect.
 *
 * For every image in `imageList` we:
 *  1. Fetch the URL with credentials ('include') so session cookies are sent.
 *  2. Resize + compress to maxPx on the longest side using Canvas.
 *  3. Return a base64-encoded data-URL so we can pass it back over
 *     Chrome's message bridge without ArrayBuffer serialisation issues.
 *
 * Returns an array of objects: { localPath, b64, mime } | { localPath, b64: null }
 */
async function _epubFetchImagesImpl(imageList, maxPx) {
  maxPx = maxPx || 1200;
  const PNG_LIMIT = 300 * 1024; // keep PNG below this size; JPEG above

  async function fetchOne(img) {
    let blob = null;

    // Strategy 1: fetch with page credentials + accept header
    try {
      const r = await fetch(img.originalSrc, {
        method: 'GET',
        credentials: 'include',
        headers: { Accept: 'image/*,*/*;q=0.8' },
      });
      if (r.ok) blob = await r.blob();
    } catch (_) {}

    // Strategy 2: fetch without custom headers (avoids CORS preflight on some CDNs)
    if (!blob || blob.size === 0) {
      try {
        const r = await fetch(img.originalSrc, { method: 'GET', credentials: 'include' });
        if (r.ok) blob = await r.blob();
      } catch (_) {}
    }

    if (!blob || blob.size === 0) return { localPath: img.localPath, b64: null, mime: img.mimeType };

    const rawMime = (blob.type || img.mimeType || 'image/jpeg').split(';')[0].trim();

    // SVG — return as-is (can't reliably canvas-render)
    if (rawMime === 'image/svg+xml') {
      const b64 = await blobToB64(blob);
      return { localPath: img.localPath, b64, mime: 'image/svg+xml' };
    }

    // Compress via canvas
    try {
      const b64mime = rawMime === 'image/png' && blob.size < PNG_LIMIT ? 'image/png' : 'image/jpeg';
      const b64 = await compressBlob(blob, maxPx, b64mime, 0.85);
      return { localPath: img.localPath, b64, mime: b64mime };
    } catch (_) {
      // Canvas failed — return raw blob
      const b64 = await blobToB64(blob);
      return { localPath: img.localPath, b64, mime: rawMime };
    }
  }

  function blobToB64(blob) {
    return new Promise((res, rej) => {
      const reader = new FileReader();
      reader.onload  = () => res(reader.result.split(',')[1]); // strip data:...;base64,
      reader.onerror = () => rej(new Error('FileReader failed'));
      reader.readAsDataURL(blob);
    });
  }

  function compressBlob(blob, maxPx, outMime, quality) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        let w = img.naturalWidth, h = img.naturalHeight;
        if (!w || !h) { rej(new Error('zero size')); return; }
        const longest = Math.max(w, h);
        if (longest > maxPx) {
          const r = maxPx / longest;
          w = Math.round(w * r);
          h = Math.round(h * r);
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (outMime !== 'image/png') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); }
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob(out => {
          if (!out || out.size === 0) { rej(new Error('toBlob empty')); return; }
          blobToB64(out).then(res).catch(rej);
        }, outMime, quality);
      };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('img load failed')); };
      img.src = url;
    });
  }

  // Process sequentially to avoid overwhelming the page
  const results = [];
  for (const img of imageList) {
    try {
      results.push(await fetchOne(img));
    } catch (_) {
      results.push({ localPath: img.localPath, b64: null, mime: img.mimeType });
    }
  }
  return results;
}
window._epubFetchImages = _epubFetchImagesImpl;

