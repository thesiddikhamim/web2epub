/**
 * EPUB 3.0 Builder
 * Constructs a standards-compliant EPUB 3.0 file with EPUB 2 fallback (NCX).
 * Uses JSZip (must be loaded before this script).
 */

const EpubBuilder = (() => {

  // ── CSS Injected into EPUB Content ─────────────────────────────────────────
  const EPUB_CSS = `
    @charset "UTF-8";
    body {
      font-family: Georgia, "Times New Roman", serif;
      font-size: 1em;
      line-height: 1.7;
      color: #1a1a1a;
      margin: 1.5em;
      padding: 0;
    }
    h1, h2, h3, h4, h5, h6 {
      font-family: Georgia, serif;
      line-height: 1.3;
      margin: 1.2em 0 0.5em;
      color: #111;
    }
    h1 { font-size: 1.9em; border-bottom: 2px solid #ddd; padding-bottom: 0.3em; margin-top: 0; }
    h2 { font-size: 1.4em; border-bottom: 1px solid #eee; padding-bottom: 0.2em; }
    h3 { font-size: 1.15em; }
    p  { margin: 0.7em 0; text-align: justify; }
    a  { color: #2563eb; text-decoration: none; }
    img {
      max-width: 100%;
      height: auto;
      display: block;
      margin: 1em auto;
    }
    figure {
      text-align: center;
      margin: 1.5em auto;
    }
    figcaption {
      font-size: 0.85em;
      color: #555;
      margin-top: 0.4em;
      font-style: italic;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      margin: 1em 0;
      font-size: 0.88em;
    }
    th {
      background: #f5f5f0;
      border: 1px solid #ccc;
      padding: 6px 10px;
      text-align: left;
    }
    td {
      border: 1px solid #ddd;
      padding: 5px 10px;
      vertical-align: top;
    }
    blockquote {
      margin: 1em 2em;
      padding: 0.5em 1em;
      border-left: 3px solid #ccc;
      color: #444;
      font-style: italic;
    }
    code, pre {
      font-family: "Courier New", monospace;
      font-size: 0.88em;
      background: #f8f8f8;
      border: 1px solid #e8e8e8;
      border-radius: 3px;
    }
    pre  { padding: 1em; overflow-x: auto; white-space: pre-wrap; }
    code { padding: 0.1em 0.3em; }
    ul, ol { margin: 0.7em 0; padding-left: 2em; }
    li { margin: 0.3em 0; }
    sup  { font-size: 0.75em; vertical-align: super; }
    sub  { font-size: 0.75em; vertical-align: sub; }
    hr   { border: none; border-top: 1px solid #ddd; margin: 1.5em 0; }
    /* Infobox / sidebar tables */
    .infobox, .infobox_v2 {
      float: right;
      clear: right;
      margin: 0 0 1em 1.5em;
      padding: 0.5em;
      background: #f8f8f8;
      border: 1px solid #ccc;
      font-size: 0.85em;
      max-width: 260px;
    }
    .infobox th { background: #e8e8e8; text-align: center; }
    /* Reference list */
    .references, ol.references {
      font-size: 0.85em;
      padding-left: 1.5em;
    }
    .references li { margin: 0.4em 0; }
    /* Thumb images */
    .thumb { text-align: center; margin: 1em auto; clear: both; }
    .thumbcaption { font-size: 0.82em; color: #555; text-align: center; margin-top: 4px; font-style: italic; }
    /* Hatnotes */
    .hatnote { font-style: italic; color: #555; border-left: 3px solid #e0e0d0; padding-left: 0.8em; margin: 0.5em 0; }
    /* TOC */
    #toc, .toc { background: #f8f8f0; border: 1px solid #ddd; padding: 1em 1.5em; margin: 1em 0; display: inline-block; }
    .toctitle  { font-weight: bold; margin-bottom: 0.5em; }
    /* Cover page */
    .cover-page { text-align: center; padding: 3em 1em; }
    .cover-page img { max-height: 60vh; margin: 0 auto; }
    .cover-page h1  { font-size: 2.2em; margin-top: 1em; }
    .cover-page .author { font-size: 1.2em; color: #555; margin-top: 0.5em; font-style: italic; }
  `;

  // ── Public API ──────────────────────────────────────────────────────────────
  async function build(options) {
    /**
     * options: {
     *   title: string,
     *   author: string,
     *   language: string,
     *   pageUrl: string,
     *   contentHtml: string,
     *   images: [{localPath, mimeType, data: Uint8Array}],
     *   coverData: Uint8Array | null,
     *   coverMime: string | null,
     *   isWiki: boolean,
     * }
     */
    const {
      title    = 'Untitled',
      author   = 'Unknown',
      language = 'en',
      pageUrl  = '',
      contentHtml = '',
      images   = [],
      coverData = null,
      coverMime = 'image/jpeg',
      isWiki = false,
    } = options;

    const zip = new JSZip();
    const uid = 'epub-' + Date.now();
    const now = new Date().toISOString().split('.')[0] + 'Z';

    // ── mimetype (MUST be first and uncompressed) ──
    zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });

    // ── META-INF/container.xml ──
    zip.file('META-INF/container.xml', xmlDecl() + `
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf"
              media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`);

    // ── OEBPS/style.css ──
    zip.file('OEBPS/style.css', EPUB_CSS);

    // ── Images ──
    for (const img of images) {
      if (img.data && img.data.byteLength > 0) {
        zip.file('OEBPS/' + img.localPath, img.data);
      }
    }

    // ── Cover image ──
    let hasCover = false;
    if (coverData && coverData.byteLength > 0) {
      hasCover = true;
      const coverExt  = mimeToExt(coverMime);
      zip.file('OEBPS/images/cover.' + coverExt, coverData);
    }

    // ── content.xhtml ──
    const validPaths = images.map(img => img.localPath);
    const sanitizedHtml = sanitizeForXhtml(contentHtml, validPaths);
    const contentXhtml = buildContentPage(title, author, sanitizedHtml, pageUrl, isWiki);
    zip.file('OEBPS/content.xhtml', contentXhtml);

    // ── cover.xhtml (if cover exists) ──
    if (hasCover) {
      const coverExt = mimeToExt(coverMime);
      zip.file('OEBPS/cover.xhtml', buildCoverPage(title, author, coverExt, coverMime));
    }

    // ── nav.xhtml (EPUB 3 navigation) ──
    zip.file('OEBPS/nav.xhtml', buildNav(title, hasCover));

    // ── toc.ncx (EPUB 2 compatibility) ──
    zip.file('OEBPS/toc.ncx', buildNcx(uid, title, author, hasCover));

    // ── content.opf (package document) ──
    zip.file('OEBPS/content.opf',
      buildOpf(uid, title, author, language, now, images, hasCover, coverMime));

    // ── Generate blob ──
    const blob = await zip.generateAsync({
      type: 'blob',
      mimeType: 'application/epub+zip',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });

    return blob;
  }

  // ── Page builders ────────────────────────────────────────────────────────────

  function buildContentPage(title, author, html, pageUrl, isWiki) {
    const source = pageUrl
      ? `<p style="font-size:0.78em;color:#888;margin-top:0.3em;">Source: <a href="${escXml(pageUrl)}">${escXml(pageUrl)}</a></p>`
      : '';
    return xmlDecl() + `
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en" lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>${escXml(title)}</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
  <div id="epub-content">
    ${html}
  </div>
  ${source}
</body>
</html>`;
  }

  function buildCoverPage(title, author, coverExt, coverMime) {
    return xmlDecl() + `
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en" lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>Cover</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
  <div class="cover-page">
    <img src="images/cover.${coverExt}" alt="Cover" style="max-width:100%;max-height:70vh;"/>
    <h1>${escXml(title)}</h1>
    <p class="author">${escXml(author)}</p>
  </div>
</body>
</html>`;
  }

  function buildNav(title, hasCover) {
    const coverEntry = hasCover
      ? `<li><a href="cover.xhtml">Cover</a></li>`
      : '';
    return xmlDecl() + `
<html xmlns="http://www.w3.org/1999/xhtml"
      xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en" lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>Navigation</title>
</head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>Contents</h1>
    <ol>
      ${coverEntry}
      <li><a href="content.xhtml">${escXml(title)}</a></li>
    </ol>
  </nav>
  <nav epub:type="landmarks">
    <ol>
      <li><a epub:type="bodymatter" href="content.xhtml">Start of Content</a></li>
    </ol>
  </nav>
</body>
</html>`;
  }

  function buildNcx(uid, title, author, hasCover) {
    let playOrder = 1;
    const coverPoint = hasCover ? `
    <navPoint id="cover" playOrder="${playOrder++}">
      <navLabel><text>Cover</text></navLabel>
      <content src="cover.xhtml"/>
    </navPoint>` : '';

    return xmlDecl() + `
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${escXml(uid)}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${escXml(title)}</text></docTitle>
  <docAuthor><text>${escXml(author)}</text></docAuthor>
  <navMap>
    ${coverPoint}
    <navPoint id="content" playOrder="${playOrder}">
      <navLabel><text>${escXml(title)}</text></navLabel>
      <content src="content.xhtml"/>
    </navPoint>
  </navMap>
</ncx>`;
  }

  function buildOpf(uid, title, author, language, modified, images, hasCover, coverMime) {
    const coverExt = mimeToExt(coverMime);

    // Check if any content references SVG images (need properties="svg" on content item)
    const hasSvgImages = images.some(img => img.mimeType === 'image/svg+xml' && img.data && img.data.byteLength > 0);

    // Manifest items for images
    const imgManifest = images.map((img, i) => {
      const svgProp = img.mimeType === 'image/svg+xml' ? ' properties="svg"' : '';
      return `    <item id="img${i}" href="${escXml(img.localPath)}" media-type="${escXml(img.mimeType)}"${svgProp}/>`;
    }).join('\n');

    const coverManifest = hasCover
      ? `    <item id="cover-img" href="images/cover.${coverExt}" media-type="${escXml(coverMime)}" properties="cover-image"/>
    <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>`
      : '';

    const coverSpine = hasCover
      ? `    <itemref idref="cover" linear="yes"/>`
      : '';

    // content item needs properties="svg" if it embeds SVG images
    const contentProps = hasSvgImages ? ' properties="svg"' : '';

    return xmlDecl() + `
<package xmlns="http://www.idpf.org/2007/opf"
         version="3.0"
         unique-identifier="bookid"
         xml:lang="${escXml(language)}">

  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/">
    <dc:identifier id="bookid">${escXml(uid)}</dc:identifier>
    <dc:title>${escXml(title)}</dc:title>
    <dc:creator>${escXml(author)}</dc:creator>
    <dc:language>${escXml(language)}</dc:language>
    <dc:date>${modified.split('T')[0]}</dc:date>
    <meta property="dcterms:modified">${modified}</meta>
    ${hasCover ? '<meta name="cover" content="cover-img"/>' : ''}
  </metadata>

  <manifest>
    <item id="ncx"     href="toc.ncx"      media-type="application/x-dtbncx+xml"/>
    <item id="nav"     href="nav.xhtml"    media-type="application/xhtml+xml" properties="nav"/>
    <item id="css"     href="style.css"    media-type="text/css"/>
    <item id="content" href="content.xhtml" media-type="application/xhtml+xml"${contentProps}/>
    ${coverManifest}
${imgManifest}
  </manifest>

  <spine toc="ncx">
    ${coverSpine}
    <itemref idref="nav" linear="yes"/>
    <itemref idref="content" linear="yes"/>
  </spine>

</package>`;
  }

  // ── Utilities ────────────────────────────────────────────────────────────────
  function xmlDecl() {
    return '<?xml version="1.0" encoding="UTF-8"?>\n';
  }

  function escXml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')
      .replace(/\u00A0/g, '&#160;'); // Also escape non-breaking space characters
  }

  /**
   * Sanitize arbitrary HTML into well-formed XHTML suitable for embedding in an
   * EPUB .xhtml document.  Uses the browser's DOMParser/XMLSerializer pipeline:
   *  1. Parse as text/html  → fixes unclosed tags, normalises structure.
   *  2. Serialize as application/xhtml+xml → produces well-formed XML.
   *  3. Extract only the <body> inner content (drop the full document wrapper).
   * Falls back to a lightweight regex pass if serialisation fails.
   */
  /**
   * Sanitize arbitrary HTML into well-formed XHTML suitable for embedding in an
   * EPUB .xhtml document.  Uses a robust multi-pass approach:
   *  1. Pre-process text to replace common named entities (&nbsp;) with numeric ones.
   *  2. Parse as text/html (lenient) to fix unclosed tags and structure.
   *  3. Import the corrected nodes into a fresh application/xhtml+xml document.
   *  4. Serialize back to a string ensuring XML-compliant entities.
   */
  function sanitizeForXhtml(html, validImagePaths = null) {
    // 1. Resolve named entities that XML doesn't know (&nbsp; -> &#160;)
    // We only replace the most common one, but also do a general numeric pass.
    html = (html || '')
      .replace(/&nbsp;/g, '&#160;')
      .replace(/&copy;/g, '&#169;')
      .replace(/&reg;/g, '&#174;')
      .replace(/&trade;/g, '&#8482;')
      .replace(/&mdash;/g, '&#8212;')
      .replace(/&ndash;/g, '&#8211;')
      .replace(/&bull;/g, '&#8226;');

    try {
      const parser = new DOMParser();
      // Lenient HTML5 parse
      const doc = parser.parseFromString(
        `<!DOCTYPE html><html><head><meta charset="UTF-8"/></head><body>${html}</body></html>`,
        'text/html'
      );

      // Remove script/style nodes
      doc.querySelectorAll('script, style, link[rel="stylesheet"]').forEach(el => el.remove());

      // Remove event handler attributes
      doc.querySelectorAll('*').forEach(el => {
        [...el.attributes].forEach(attr => {
          if (attr.name.startsWith('on')) el.removeAttribute(attr.name);
        });
      });

      // Fix broken image tags (referential integrity check for Play Books)
      if (validImagePaths && Array.isArray(validImagePaths)) {
        doc.querySelectorAll('img').forEach(img => {
          const src = img.getAttribute('src');
          if (src && src.startsWith('images/') && !validImagePaths.includes(src)) {
            img.remove();
          }
        });
      }

      // Create a fresh XHTML document
      const xhtmlDoc = parser.parseFromString(
        '<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head></head><body></body></html>',
        'application/xhtml+xml'
      );

      // Import cleaned nodes from HTML doc to XHTML doc (safely transfers content characters)
      const body = xhtmlDoc.body;
      [...doc.body.childNodes].forEach(node => {
        try { body.appendChild(xhtmlDoc.importNode(node, true)); } catch(e) {}
      });

      const serializer = new XMLSerializer();
      const output = serializer.serializeToString(body);

      // Strip <body> wrapper and return
      return output
        .replace(/^<body[^>]*>/, '')
        .replace(/<\/body>$/, '');

    } catch (e) {
      console.error('[sanitize] Parser failed, using fallback.', e);
      return basicXhtmlFallback(html);
    }
  }

  /**
   * Lightweight fallback: fix common XHTML-breaking issues.
   */
  function basicXhtmlFallback(html) {
    return (html || '')
      // Fix unescaped & that are not entities
      .replace(/&(?![a-zA-Z#][a-zA-Z0-9]*;)/g, '&amp;')
      // Fix the most common missing-entity culprit
      .replace(/&nbsp;/g, '&#160;')
      // Self-close void elements
      .replace(/<(br|hr|img|input|meta|link|area|base|col|embed|param|source|track|wbr)(\s[^>]*)?>(?!\/)/gi,
               '<$1$2/>')
      .replace(/<\/(br|hr|img|input|meta|link|area|base|col|embed|param|source|track|wbr)>/gi, '');
  }

  function mimeToExt(mime) {
    const map = {
      'image/jpeg': 'jpg',
      'image/png':  'png',
      'image/gif':  'gif',
      'image/webp': 'webp',
      'image/svg+xml': 'svg',
    };
    return map[mime] || 'jpg';
  }

  return { build };
})();
