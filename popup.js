/**
 * popup.js — Main controller for Web to EPUB Chrome Extension
 * Handles UI, page detection, content extraction, image fetching, and EPUB download.
 */

'use strict';

// ── DOM refs ──────────────────────────────────────────────────────────────────
const titleInput    = document.getElementById('title');
const authorInput   = document.getElementById('author');
const coverUrlInput = document.getElementById('coverUrl');
const coverFileInput= document.getElementById('coverFile');
const convertBtn    = document.getElementById('convertBtn');
const progressArea  = document.getElementById('progressArea');
const progressBar   = document.getElementById('progressBar');
const progressLabel = document.getElementById('progressLabel');
const errorArea     = document.getElementById('errorArea');
const errorMsg      = document.getElementById('errorMsg');
const pageDot       = document.getElementById('pageDot');
const pageLabel     = document.getElementById('pageLabel');
const urlPreview    = document.getElementById('urlPreview');
const uploadPreview = document.getElementById('uploadPreview');
const uploadPreviewImg = document.getElementById('uploadPreviewImg');
const uploadArea    = document.getElementById('uploadArea');
const wikiOptions   = document.getElementById('wikiOptions');

// ── State ────────────────────────────────────────────────────────────────────
let currentTab = null;
let coverFileData   = null; // { data: Uint8Array, mime: string }
let coverUrlData    = null; // { data: Uint8Array, mime: string }
let activeTab       = 'url'; // 'url' | 'upload'

// ── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  // Get the active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab;

  // Pre-fill title
  if (tab.title) {
    titleInput.value = tab.title
      .replace(/ - Wikipedia$/, '')
      .replace(/ \| .*$/, '')
      .trim();
  }

  // Detect page type
  const url = tab.url || '';
  const isWiki = url.includes('wikipedia.org') || url.includes('wikimedia.org');

  if (isWiki) {
    pageDot.className  = 'page-badge-dot wiki';
    pageLabel.textContent = 'Wikipedia article';
    wikiOptions.style.display = 'block';
  } else if (url.includes('medium.com') || url.includes('substack.com') ||
             url.includes('/blog/') || url.includes('/post/') || url.includes('/article/')) {
    pageDot.className  = 'page-badge-dot blog';
    pageLabel.textContent = 'Blog / Article page';
  } else {
    pageDot.className  = 'page-badge-dot generic';
    const domain = new URL(url).hostname.replace('www.', '');
    pageLabel.textContent = domain;
  }
}

// ── Tab switching ─────────────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + tab).classList.add('active');
    activeTab = tab;
  });
});

// ── Cover URL preview ─────────────────────────────────────────────────────────
let urlDebounce = null;
coverUrlInput.addEventListener('input', () => {
  clearTimeout(urlDebounce);
  urlDebounce = setTimeout(async () => {
    const url = coverUrlInput.value.trim();
    if (!url) {
      urlPreview.innerHTML = '<span class="preview-placeholder">Preview will appear here</span>';
      coverUrlData = null;
      return;
    }
    urlPreview.innerHTML = '<span class="preview-placeholder">Loading...</span>';
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error('Could not load image');
      const blob = await resp.blob();
      const mime = blob.type || 'image/jpeg';
      const ab   = await blob.arrayBuffer();
      coverUrlData = { data: new Uint8Array(ab), mime };
      const objUrl = URL.createObjectURL(blob);
      urlPreview.innerHTML = `<img src="${objUrl}" alt="Cover preview" style="width:100%;height:100%;object-fit:cover;"/>`;
    } catch(e) {
      urlPreview.innerHTML = '<span class="preview-placeholder" style="color:#e05c5c;">Could not load image</span>';
      coverUrlData = null;
    }
  }, 600);
});

// ── Cover file upload ────────────────────────────────────────────────────────
coverFileInput.addEventListener('change', () => {
  const file = coverFileInput.files[0];
  if (!file) return;
  loadFileAsUint8Array(file).then(data => {
    coverFileData = { data, mime: file.type || 'image/jpeg' };
    const objUrl  = URL.createObjectURL(file);
    uploadPreviewImg.src = objUrl;
    uploadPreview.style.display = 'flex';
    uploadArea.style.display    = 'none';
  });
});

// Drag & drop support on upload area
uploadArea.addEventListener('dragover', e => {
  e.preventDefault();
  uploadArea.style.borderColor = 'var(--accent)';
});
uploadArea.addEventListener('dragleave', () => {
  uploadArea.style.borderColor = '';
});
uploadArea.addEventListener('drop', e => {
  e.preventDefault();
  uploadArea.style.borderColor = '';
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) {
    coverFileInput.files = e.dataTransfer.files;
    coverFileInput.dispatchEvent(new Event('change'));
  }
});

// ── Convert button ────────────────────────────────────────────────────────────
convertBtn.addEventListener('click', async () => {
  hideError();
  const title  = titleInput.value.trim() || 'Untitled';
  const author = authorInput.value.trim() || 'Unknown';

  // Get cover data from whichever tab is active
  let coverData = null;
  let coverMime = 'image/jpeg';
  if (activeTab === 'url' && coverUrlData) {
    coverData = coverUrlData.data;
    coverMime = coverUrlData.mime;
  } else if (activeTab === 'upload' && coverFileData) {
    coverData = coverFileData.data;
    coverMime = coverFileData.mime;
  }

  // Wikipedia options
  const includeRefs    = document.getElementById('includeRefs')?.checked    ?? true;
  const includeInfobox = document.getElementById('includeInfobox')?.checked ?? true;
  const includeToc     = document.getElementById('includeToc')?.checked     ?? true;

  setConverting(true);
  setProgress(5, 'Extracting page content...');

  try {
    // ── Step 1: inject extractor file into tab, then call the exposed global ──
    // Two separate executeScript calls avoids new Function() / eval (CSP violation).
    await chrome.scripting.executeScript({
      target: { tabId: currentTab.id },
      files: ['content-extractor.js'],
    });

    const [extractResult] = await chrome.scripting.executeScript({
      target: { tabId: currentTab.id },
      func: (opts) => window._epubExtract(opts),
      args: [{ includeRefs, includeInfobox, includeToc }],
    });

    if (chrome.runtime.lastError) {
      throw new Error(chrome.runtime.lastError.message);
    }
    if (!extractResult || !extractResult.result) {
      throw new Error('Could not extract page content. Try refreshing the page.');
    }

    const extracted = extractResult.result;
    setProgress(20, `Found ${extracted.images.length} images — fetching...`);

    // ── Step 2: fetch images ───────────────────────────────────────────────
    const fetchedImages = await fetchImages(
      extracted.images,
      extracted.url,
      currentTab.id,
      (done, total, tier) => {
        const pct = 20 + Math.round((done / Math.max(total, 1)) * 55);
        setProgress(pct, `Fetching images… ${done}/${total} (tier ${tier})`);
      }
    );

    const totalFound   = extracted.images.length;
    const totalFetched = fetchedImages.length;
    const skipped      = totalFound - totalFetched;
    const fetchSummary = skipped > 0
      ? `Fetched ${totalFetched}/${totalFound} images (${skipped} unreachable)`
      : `Fetched all ${totalFetched} images`;
    setProgress(78, `Building EPUB… ${fetchSummary}`);

    // ── Step 3: build EPUB ────────────────────────────────────────────────
    const blob = await EpubBuilder.build({
      title,
      author,
      language:    extracted.language || 'en',
      pageUrl:     extracted.url,
      contentHtml: extracted.html,
      images:      fetchedImages,
      coverData,
      coverMime,
      isWiki:      extracted.isWiki,
    });

    setProgress(95, 'Preparing download...');

    // ── Step 4: download ──────────────────────────────────────────────────
    const safeTitle = title.replace(/[^a-z0-9\-_. ]/gi, '_').replace(/\s+/g, '_');
    const filename  = safeTitle.substring(0, 60) + '.epub';

    const blobUrl = URL.createObjectURL(blob);
    await chrome.downloads.download({
      url:      blobUrl,
      filename: filename,
      saveAs:   false,
    });

    setProgress(100, 'Done! EPUB saved ✓');
    convertBtn.classList.add('success');
    convertBtn.querySelector('.btn-text').textContent = '✓ EPUB Downloaded!';
    convertBtn.disabled = false;

    setTimeout(() => {
      setConverting(false);
      convertBtn.classList.remove('success');
      convertBtn.querySelector('.btn-text').textContent = 'Convert to EPUB';
    }, 3000);

  } catch (err) {
    console.error('[EPUB Converter]', err);
    setConverting(false);
    showError(err.message || 'An unexpected error occurred.');
  }
});

// ── Image fetching pipeline ───────────────────────────────────────────────────
//
// Three-tier strategy — each tier is tried; the next is used only for images
// that failed in the previous tier.
//
// TIER 1 — Tab injection (best)
//   The fetch runs inside the real web page, so the browser sends:
//     • Referer: https://the-page.com  (servers check this!)
//     • All page cookies              (auth-gated images)
//     • No CORS preflight from extension context
//
// TIER 2 — Background service-worker proxy
//   Extension has <all_urls> host permission → can bypass many CORS blocks.
//   Used for images that the page context can't reach (cross-origin CDNs).
//
// TIER 3 — Direct popup fetch (last resort)
//   Same as before but kept as a final safety net.

const IMAGE_MAX_PX   = 1200;
const IMAGE_QUALITY  = 0.85;
const PNG_SIZE_LIMIT = 300 * 1024;  // keep as PNG below 300 KB

// ── Main entry point called from the convert button handler ─────────────────

async function fetchImages(imageList, pageUrl, tabId, onProgress) {
  if (!imageList.length) return [];

  const total   = imageList.length;
  let   done    = 0;

  // Index images by localPath so we can look them up after each tier
  const byPath = Object.fromEntries(imageList.map(img => [img.localPath, img]));

  // Results accumulator: localPath → { data: Uint8Array, mimeType }
  const got = {};

  // ── TIER 1: fetch from within the page tab ──────────────────────────────
  const needAfterTier1 = [];
  try {
    // content-extractor.js is already injected at this point; just call the global
    const batchSize = 5;   // process N images per executeScript call
    for (let i = 0; i < imageList.length; i += batchSize) {
      const batch = imageList.slice(i, i + batchSize);
      try {
        const [res] = await chrome.scripting.executeScript({
          target: { tabId },
          func: (imgs, px) => window._epubFetchImages(imgs, px),
          args:  [batch, IMAGE_MAX_PX],
        });
        for (const item of (res?.result || [])) {
          if (item.b64) {
            got[item.localPath] = {
              data:     b64ToUint8Array(item.b64),
              mimeType: item.mime,
            };
          }
        }
      } catch (_) {}

      done += batch.length;
      onProgress(done, total, 1);
    }
  } catch (_) {}

  // Collect everything that tier 1 missed
  for (const img of imageList) {
    if (!got[img.localPath]) needAfterTier1.push(img);
  }

  // ── TIER 2: background service-worker proxy ─────────────────────────────
  const needAfterTier2 = [];
  for (const img of needAfterTier1) {
    try {
      const resp = await chrome.runtime.sendMessage({
        action:  'fetchImage',
        url:     img.originalSrc,
        referer: pageUrl,
      });
      if (resp?.ok && resp.b64) {
        got[img.localPath] = {
          data:     b64ToUint8Array(resp.b64),
          mimeType: resp.mime,
        };
        done++;
        onProgress(done, total, 2);
        continue;
      }
    } catch (_) {}
    needAfterTier2.push(img);
  }

  // ── TIER 3: direct popup fetch (last resort) ────────────────────────────
  for (const img of needAfterTier2) {
    const result = await fetchDirect(img);
    if (result.data && result.data.byteLength > 0) {
      got[img.localPath] = { data: result.data, mimeType: result.mimeType };
    }
    done++;
    onProgress(done, total, 3);
  }

  // Rebuild list in original order, excluding images that failed everywhere
  return imageList
    .filter(img => got[img.localPath])
    .map(img => ({ ...img, ...got[img.localPath] }));
}

// ── Tier 3 helper: direct fetch + canvas compress from popup context ────────

async function fetchDirect(img) {
  const urls = [
    img.originalSrc,
    img.originalSrc + (img.originalSrc.includes('?') ? '&' : '?') + '_t=' + Date.now(),
  ];
  let blob = null;
  for (const url of urls) {
    try {
      const r = await fetch(url, { headers: { Accept: 'image/*,*/*;q=0.8' } });
      if (r.ok) { blob = await r.blob(); if (blob?.size > 0) break; }
    } catch (_) {}
    blob = null;
  }
  if (!blob || blob.size === 0) return { ...img, data: new Uint8Array(0) };

  const mime = (blob.type || img.mimeType).split(';')[0].trim();
  if (mime === 'image/svg+xml') {
    const ab = await blob.arrayBuffer();
    return { ...img, data: new Uint8Array(ab), mimeType: mime };
  }
  try {
    const { data, outMime } = await compressImage(blob, mime);
    return { ...img, data, mimeType: outMime };
  } catch (_) {
    const ab = await blob.arrayBuffer();
    return { ...img, data: new Uint8Array(ab), mimeType: mime };
  }
}

// ── Canvas compression (used by tier 3) ─────────────────────────────────────

function compressImage(blob, mime) {
  return new Promise((resolve, reject) => {
    const img    = new Image();
    const objUrl = URL.createObjectURL(blob);

    img.onload = () => {
      URL.revokeObjectURL(objUrl);
      let w = img.naturalWidth || img.width || 0;
      let h = img.naturalHeight || img.height || 0;
      if (!w || !h) { reject(new Error('zero-size')); return; }

      const longest = Math.max(w, h);
      if (longest > IMAGE_MAX_PX) {
        const ratio = IMAGE_MAX_PX / longest;
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);
      }

      const keepPng = mime === 'image/png' && blob.size < PNG_SIZE_LIMIT;
      const outMime = keepPng ? 'image/png' : 'image/jpeg';

      const canvas = document.createElement('canvas');
      canvas.width  = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!keepPng) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); }
      ctx.drawImage(img, 0, 0, w, h);

      canvas.toBlob(out => {
        if (!out || out.size === 0) { reject(new Error('toBlob empty')); return; }
        out.arrayBuffer().then(ab => resolve({ data: new Uint8Array(ab), outMime })).catch(reject);
      }, outMime, keepPng ? undefined : IMAGE_QUALITY);
    };

    img.onerror = () => { URL.revokeObjectURL(objUrl); reject(new Error('decode failed')); };
    img.crossOrigin = 'anonymous';
    img.src = objUrl;
  });
}

// ── Utility: decode base64 string → Uint8Array ───────────────────────────────

function b64ToUint8Array(b64) {
  const bin    = atob(b64);
  const bytes  = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}





// ── UI helpers ─────────────────────────────────────────────────────────────────
function setConverting(converting) {
  convertBtn.disabled = converting;
  progressArea.style.display = converting ? 'block' : 'none';
  if (!converting) {
    progressBar.style.width = '0%';
  }
}

function setProgress(pct, label) {
  progressBar.style.width = pct + '%';
  progressLabel.textContent = label;
}

function showError(msg) {
  errorArea.style.display = 'flex';
  errorMsg.textContent    = msg;
}

function hideError() {
  errorArea.style.display = 'none';
  errorMsg.textContent    = '';
}

// ── Utility ────────────────────────────────────────────────────────────────────
function loadFileAsUint8Array(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(new Uint8Array(reader.result));
    reader.onerror = () => reject(new Error('File read failed'));
    reader.readAsArrayBuffer(file);
  });
}

// ── Boot ───────────────────────────────────────────────────────────────────────
init().catch(err => {
  console.error('[EPUB Converter] Init error:', err);
  showError('Could not initialize. Please try again.');
});
