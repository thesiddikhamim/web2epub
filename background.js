/**
 * Background Service Worker
 * Acts as an image-fetch proxy for the popup.
 * Because it runs in the extension context (with <all_urls> host permission),
 * it can fetch cross-origin images that the popup context cannot.
 */

chrome.runtime.onInstalled.addListener(() => {
  console.log('Web to EPUB Converter installed.');
});

/**
 * Message handler: { action: 'fetchImage', url: string }
 * Returns: { ok: true, b64: string, mime: string }
 *       or { ok: false, error: string }
 */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action !== 'fetchImage') return false;

  const url = msg.url;
  const referer = msg.referer || '';

  (async () => {
    // Try with and without Referer (some servers accept either)
    const attempts = [
      { headers: { 'Accept': 'image/*,*/*;q=0.8', 'Referer': referer } },
      { headers: { 'Accept': 'image/*,*/*;q=0.8' } },
    ];

    for (const opts of attempts) {
      try {
        const resp = await fetch(url, { method: 'GET', ...opts });
        if (!resp.ok) continue;

        const blob = await resp.blob();
        if (!blob || blob.size === 0) continue;

        const mime = (blob.type || 'image/jpeg').split(';')[0].trim();

        // Convert to base64 via ArrayBuffer
        const ab    = await blob.arrayBuffer();
        const bytes = new Uint8Array(ab);
        let b64 = '';
        // Chunk-encode to avoid call-stack limits on large images
        const CHUNK = 8192;
        for (let i = 0; i < bytes.length; i += CHUNK) {
          b64 += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
        }
        b64 = btoa(b64);

        sendResponse({ ok: true, b64, mime });
        return;
      } catch (e) {
        // Try next strategy
      }
    }

    sendResponse({ ok: false, error: 'all fetch strategies failed' });
  })();

  return true; // keep message channel open for async response
});
