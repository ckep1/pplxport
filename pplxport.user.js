// ==UserScript==
// @name         Perplexity.ai Chat Exporter
// @namespace    https://github.com/ckep1/pplxport
// @version      2.6.0
// @description  Export Perplexity.ai conversations as markdown with configurable citation styles
// @author       Chris Kephart
// @match        https://www.perplexity.ai/*
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-idle
// @license      MIT
// ==/UserScript==

(function () {
  "use strict";

  // ============================================================================
  // CONFIGURATION & CONSTANTS
  // ============================================================================

  const DEBUG = false;
  const console = DEBUG ? window.console : { log() {}, warn() {}, error() {} };

  // Style options
  const CITATION_STYLES = {
    ENDNOTES: "endnotes",
    FOOTNOTES: "footnotes",
    INLINE: "inline",
    PARENTHESIZED: "parenthesized",
    NAMED: "named",
    NONE: "none",
  };

  const CITATION_STYLE_LABELS = {
    [CITATION_STYLES.ENDNOTES]: "Endnotes",
    [CITATION_STYLES.FOOTNOTES]: "Footnotes",
    [CITATION_STYLES.INLINE]: "Inline",
    [CITATION_STYLES.PARENTHESIZED]: "Parenthesized",
    [CITATION_STYLES.NAMED]: "Named",
    [CITATION_STYLES.NONE]: "No Citations",
  };

  const CITATION_STYLE_DESCRIPTIONS = {
    [CITATION_STYLES.ENDNOTES]: "[1] in text with sources listed at the end",
    [CITATION_STYLES.FOOTNOTES]: "[^1] in text with footnote definitions at the end",
    [CITATION_STYLES.INLINE]: "[1](url) - Clean inline citations",
    [CITATION_STYLES.PARENTHESIZED]: "([1](url)) - Inline citations in parentheses",
    [CITATION_STYLES.NAMED]: "([wikipedia](url)) - Uses domain names",
    [CITATION_STYLES.NONE]: "Remove all citations from the text",
  };

  const FORMAT_STYLES = {
    FULL: "full", // Include User/Assistant tags and all dividers
    CONCISE: "concise", // Just content, minimal dividers
  };

  const FORMAT_STYLE_LABELS = {
    [FORMAT_STYLES.FULL]: "Full",
    [FORMAT_STYLES.CONCISE]: "Concise",
  };

  const EXPORT_METHODS = {
    DOWNLOAD: "download",
    CLIPBOARD: "clipboard",
  };

  const EXPORT_METHOD_LABELS = {
    [EXPORT_METHODS.DOWNLOAD]: "Download File",
    [EXPORT_METHODS.CLIPBOARD]: "Copy to Clipboard",
  };

  const EXTRACTION_METHODS = {
    DIRECT_DOM: "direct_dom",
    EXPORT: "export",
    COPY_BUTTONS: "copy_buttons",
  };


  // Global citation tracking for consistent numbering across all responses
  const globalCitations = {
    urlToNumber: new Map(), // normalized URL -> citation number
    citationRefs: new Map(), // citation number -> {href, sourceName, normalizedUrl}
    nextCitationNumber: 1,

    reset() {
      this.urlToNumber.clear();
      this.citationRefs.clear();
      this.nextCitationNumber = 1;
    },

    addCitation(url, sourceName = null) {
      const normalizedUrl = normalizeUrl(url);
      if (!this.urlToNumber.has(normalizedUrl)) {
        this.urlToNumber.set(normalizedUrl, this.nextCitationNumber);
        this.citationRefs.set(this.nextCitationNumber, {
          href: url,
          sourceName,
          normalizedUrl,
        });
        this.nextCitationNumber++;
      }
      return this.urlToNumber.get(normalizedUrl);
    },

    getCitationNumber(url) {
      const normalizedUrl = normalizeUrl(url);
      return this.urlToNumber.get(normalizedUrl);
    },
  };

  // ============================================================================
  // UTILITY FUNCTIONS
  // ============================================================================

  // Get user preferences
  function getPreferences() {
    return {
      citationStyle: GM_getValue("citationStyle", CITATION_STYLES.PARENTHESIZED),
      formatStyle: GM_getValue("formatStyle", FORMAT_STYLES.FULL),
      addExtraNewlines: GM_getValue("addExtraNewlines", true),
      exportMethod: GM_getValue("exportMethod", EXPORT_METHODS.DOWNLOAD),
      includeFrontmatter: GM_getValue("includeFrontmatter", true),
      titleAsH1: GM_getValue("titleAsH1", false),
      extractionMethod: GM_getValue("extractionMethod", EXTRACTION_METHODS.DIRECT_DOM),
    };
  }

  // Extract source name from text, handling various formats
  function extractSourceName(text) {
    if (!text) return null;

    // Clean the text
    text = text.trim();

    // If it's a pattern like "rabbit+2", "developer.mozilla+1", extract the source name
    const plusMatch = text.match(/^(.+?)\+\d+$/);
    if (plusMatch) {
      return plusMatch[1].toLowerCase();
    }

    // If it's just text without numbers, use it as is (lowercased)
    const cleanName = text.toLowerCase();
    if (cleanName.length > 0) {
      return cleanName;
    }

    return null;
  }

  // Normalize URL by removing fragments (#) to group same page citations
  function normalizeUrl(url) {
    if (!url) return null;

    try {
      const urlObj = new URL(url);
      // Remove the fragment (hash) portion
      urlObj.hash = "";
      return urlObj.toString();
    } catch (e) {
      // If URL parsing fails, just remove # manually
      return url.split("#")[0];
    }
  }

  // Extract domain name from URL for named citations
  function extractDomainName(url) {
    if (!url) return null;

    try {
      const urlObj = new URL(url);
      let domain = urlObj.hostname.toLowerCase();

      // Remove www. prefix
      domain = domain.replace(/^www\./, "");

      // Get the main domain part (before first dot for common cases)
      const parts = domain.split(".");
      if (parts.length >= 2) {
        // Handle special cases like co.uk, github.io, etc.
        if (parts[parts.length - 2].length <= 3 && parts.length > 2) {
          return parts[parts.length - 3];
        } else {
          return parts[parts.length - 2];
        }
      }

      return parts[0];
    } catch (e) {
      return null;
    }
  }

  // ============================================================================
  // DOM HELPER FUNCTIONS
  // ============================================================================

  function getThreadContainer() {
    return document.querySelector('.max-w-threadContentWidth, [class*="threadContentWidth"]') || document.querySelector("main") || document.body;
  }

  function getScrollRoot() {
    const thread = getThreadContainer();
    const candidates = [];
    let node = thread;
    while (node && node !== document.body) {
      candidates.push(node);
      node = node.parentElement;
    }
    const scrollingElement = document.scrollingElement || document.documentElement;
    candidates.push(scrollingElement);

    let best = null;
    for (const el of candidates) {
      try {
        const style = getComputedStyle(el);
        const overflowY = (style.overflowY || style.overflow || "").toLowerCase();
        const canScroll = el.scrollHeight - el.clientHeight > 50;
        const isScrollable = /auto|scroll|overlay/.test(overflowY) || el === scrollingElement;
        if (canScroll && isScrollable) {
          if (!best || el.scrollHeight > best.scrollHeight) {
            best = el;
          }
        }
      } catch (e) {
        // ignore
      }
    }
    return best || scrollingElement;
  }

  function isInViewport(el, margin = 8) {
    const rect = el.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const vw = window.innerWidth || document.documentElement.clientWidth;
    return rect.bottom > -margin && rect.top < vh + margin && rect.right > -margin && rect.left < vw + margin;
  }

  function isCodeCopyButton(btn) {
    const testId = btn.getAttribute("data-testid");
    const ariaLower = (btn.getAttribute("aria-label") || "").toLowerCase();
    if (testId === "copy-code-button" || testId === "copy-code" || (testId && testId.includes("copy-code"))) return true;
    if (ariaLower.includes("copy code")) return true;
    if (btn.closest("pre") || btn.closest("code")) return true;
    return false;
  }

  function findUserMessageRootFromElement(el) {
    let node = el;
    let depth = 0;
    while (node && node !== document.body && depth < 10) {
      if (node.querySelector && (node.querySelector("button[data-testid='copy-query-button']") || node.querySelector("button[aria-label='Copy Query']") || node.querySelector("span[data-lexical-text='true']") || node.querySelector("span.select-text"))) {
        return node;
      }
      node = node.parentElement;
      depth++;
    }
    return el.parentElement || el;
  }

  function findUserMessageRootFrom(button) {
    let node = button;
    let depth = 0;
    while (node && node !== document.body && depth < 10) {
      if (node.querySelector && (node.querySelector(".whitespace-pre-line.text-pretty.break-words") || node.querySelector("span[data-lexical-text='true']") || node.querySelector("span.select-text"))) {
        return node;
      }
      node = node.parentElement;
      depth++;
    }
    return button.parentElement || button;
  }

  function findAssistantMessageRootFrom(button) {
    let node = button;
    let depth = 0;
    while (node && node !== document.body && depth < 10) {
      // An assistant message root should contain the prose answer block
      if (node.querySelector && node.querySelector(".prose.text-pretty.dark\\:prose-invert, [class*='prose'][class*='prose-invert'], [data-testid='answer'], [data-testid='assistant']")) {
        return node;
      }
      node = node.parentElement;
      depth++;
    }
    return button.parentElement || button;
  }

  // ============================================================================
  // SCROLL & NAVIGATION HELPERS
  // ============================================================================

  async function pageDownOnce(scroller, delayMs = 90, factor = 0.9) {
    if (!scroller) scroller = getScrollRoot();
    const delta = Math.max(200, Math.floor(scroller.clientHeight * factor));
    scroller.scrollTop = Math.min(scroller.scrollTop + delta, scroller.scrollHeight);
    await new Promise((r) => setTimeout(r, delayMs));
  }

  function simulateHover(element) {
    try {
      const rect = element.getBoundingClientRect();
      const x = rect.left + Math.min(20, Math.max(2, rect.width / 3));
      const y = rect.top + Math.min(20, Math.max(2, rect.height / 3));
      const opts = { bubbles: true, clientX: x, clientY: y };
      element.dispatchEvent(new MouseEvent("mouseenter", opts));
      element.dispatchEvent(new MouseEvent("mouseover", opts));
      element.dispatchEvent(new MouseEvent("mousemove", opts));
    } catch (e) {
      // best effort
    }
  }

  async function waitForFocus(timeoutMs = 30000) {
    if (document.hasFocus()) return true;

    const startTime = Date.now();
    const overlay = document.getElementById('perplexity-focus-overlay');
    if (overlay) {
      const titleEl = overlay.querySelector("#perplexity-focus-overlay-title");
      const subtitleEl = overlay.querySelector("#perplexity-focus-overlay-subtitle");
      if (titleEl) titleEl.textContent = "Click here to continue export";
      if (subtitleEl) subtitleEl.textContent = "Export paused - page needs focus to read clipboard";
      overlay.style.display = 'flex';
    }

    while (!document.hasFocus() && (Date.now() - startTime) < timeoutMs) {
      window.focus();
      await new Promise(r => setTimeout(r, 100));
    }

    if (overlay) overlay.style.display = 'none';
    return document.hasFocus();
  }

  async function readClipboardWithRetries(maxRetries = 3, delayMs = 60) {
    let last = "";
    for (let i = 0; i < maxRetries; i++) {
      // Wait for focus before attempting clipboard read
      if (!document.hasFocus()) {
        const gotFocus = await waitForFocus(10000);
        if (!gotFocus) {
          console.warn('Lost focus during clipboard read, retrying...');
        }
      }

      try {
        const text = await navigator.clipboard.readText();
        if (text && text.trim() && text !== last) {
          return text;
        }
        last = text;
      } catch (e) {
        // keep retrying
      }
      await new Promise((r) => setTimeout(r, delayMs));
    }
    try {
      return await navigator.clipboard.readText();
    } catch {
      return "";
    }
  }

  // Click expanders like "Show more", "Read more", etc. Best-effort
  const clickedExpanders = new WeakSet();

  function findExpanders(limit = 8) {
    const candidates = [];
    const patterns = /(show more|read more|view more|see more|expand|load more|view full|show all|continue reading)/i;
    const els = document.querySelectorAll('button, a, [role="button"]');
    for (const el of els) {
      if (candidates.length >= limit) break;
      if (clickedExpanders.has(el)) continue;
      const label = (el.getAttribute("aria-label") || "").trim();
      const text = (el.textContent || "").trim();
      if (patterns.test(label) || patterns.test(text)) {
        // avoid code-block related buttons
        if (el.closest("pre, code")) continue;
        // avoid external anchors that might navigate
        if (el.tagName && el.tagName.toLowerCase() === "a") {
          const href = (el.getAttribute("href") || "").trim();
          const target = (el.getAttribute("target") || "").trim().toLowerCase();
          const isExternal = /^https?:\/\//i.test(href);
          if (isExternal || target === "_blank") continue;
        }
        candidates.push(el);
      }
    }
    return candidates;
  }

  async function clickExpandersOnce(limit = 6) {
    const expanders = findExpanders(limit);
    if (expanders.length === 0) return false;
    for (const el of expanders) {
      try {
        clickedExpanders.add(el);
        el.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
        await new Promise((r) => setTimeout(r, 50));
        el.click();
        await new Promise((r) => setTimeout(r, 150));
      } catch {}
    }
    // allow expanded content to render
    await new Promise((r) => setTimeout(r, 250));
    return true;
  }

  // ============================================================================
  // BUTTON HELPER FUNCTIONS
  // ============================================================================

  function getViewportQueryButtons() {
    const buttons = Array.from(document.querySelectorAll('button[data-testid="copy-query-button"], button[aria-label="Copy Query"]'));
    return buttons.filter((btn) => isInViewport(btn) && !btn.closest("pre,code"));
  }

  function getViewportResponseButtons() {
    // Just check for any SVG element, or multiple possible SVG classes
    const buttons = Array.from(document.querySelectorAll('button[aria-label="Copy"]')).filter((btn) => {
      return btn.querySelector("svg.tabler-icon") || btn.querySelector("svg.tabler-icon-copy") || btn.querySelector("svg");
    });
    return buttons.filter((btn) => isInViewport(btn) && !btn.closest("pre,code"));
  }

  async function clickVisibleButtonAndGetClipboard(button) {
    try {
      window.focus();
      simulateHover(button);
      await new Promise((r) => setTimeout(r, 40));
      button.focus();
      button.click();
      await new Promise((r) => setTimeout(r, 60));
      return await readClipboardWithRetries(3, 60);
    } catch (e) {
      return "";
    }
  }

  // ============================================================================
  // DEEP RESEARCH DETECTION & HELPERS
  // ============================================================================

  function isDeepResearch() {
    if (document.querySelector('[class*="search-side-content"]')) return true;
    if (document.querySelector('button[data-testid="asset-card-open-button"]')) return true;
    return false;
  }

  async function openDeepResearchPanel() {
    if (document.querySelector('[class*="search-side-content"]')) return true;
    const cardBtn = document.querySelector('button[data-testid="asset-card-open-button"]');
    if (!cardBtn) return false;
    cardBtn.click();
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 200));
      if (document.querySelector('[class*="search-side-content"]')) return true;
    }
    return false;
  }

  async function interceptExportMarkdown() {
    // Inject into page context (same sandbox issue as interceptThreadExportMarkdown)
    const commId = '__pplxport_dr_capture_' + Date.now();
    const comm = document.createElement('div');
    comm.id = commId;
    comm.style.display = 'none';
    document.body.appendChild(comm);

    const script = document.createElement('script');
    script.textContent = `(function(){
      var c=document.getElementById("${commId}");
      var oc=HTMLAnchorElement.prototype.click;
      var ou=URL.createObjectURL;
      URL.createObjectURL=function(o){
        var u=ou.call(this,o);
        if(o instanceof Blob){o.text().then(function(t){c.textContent=t;});}
        return u;
      };
      HTMLAnchorElement.prototype.click=function(){
        if(this.download&&(this.href||"").match(/^(blob|data):/)){
          if(this.href.startsWith("data:")){
            try{
              var p=this.href.split(",");var e=p[1];
              if(p[0].indexOf("base64")>-1){
                var b=Uint8Array.from(atob(e),function(x){return x.charCodeAt(0);});
                c.textContent=new TextDecoder().decode(b);
              }else{c.textContent=decodeURIComponent(e);}
            }catch(x){}
          }
          return;
        }
        return oc.call(this);
      };
      window.__pplxport_dr_cleanup=function(){
        HTMLAnchorElement.prototype.click=oc;
        URL.createObjectURL=ou;
        delete window.__pplxport_dr_cleanup;
      };
    })();`;
    document.documentElement.appendChild(script);
    script.remove();

    try {
      const exportBtn = Array.from(document.querySelectorAll('button[aria-haspopup="menu"]'))
        .find(b => b.textContent.includes('Export'));
      if (!exportBtn) throw new Error('Export button not found in side panel');
      exportBtn.focus();
      simulateClick(exportBtn);
      await new Promise(r => setTimeout(r, 500));

      const menuItem = Array.from(document.querySelectorAll('[role="menuitem"]'))
        .find(m => m.textContent.includes('Download as Markdown'));
      if (!menuItem) throw new Error('Download as Markdown menu item not found');
      simulateClick(menuItem);

      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 100));
        if (comm.textContent) break;
      }

      return comm.textContent || null;
    } finally {
      const cleanup = document.createElement('script');
      cleanup.textContent = 'if(window.__pplxport_dr_cleanup)window.__pplxport_dr_cleanup();';
      document.documentElement.appendChild(cleanup);
      cleanup.remove();
      comm.remove();
    }
  }

  // ============================================================================
  // THREAD EXPORT INTERCEPTION (regular threads, NOT deep research)
  // ============================================================================
  // Fallback extraction method: triggers the three-dot menu's "Export as Markdown"
  // on regular threads, intercepts the download, and reformats the content.
  // Used automatically as a middle fallback between DOM scan and copy buttons.

  function simulateClick(el) {
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, composed: true }));
    }
  }

  async function interceptThreadExportMarkdown() {
    // Inject interception into the PAGE context (not userscript sandbox).
    // Tampermonkey's @grant sandbox isolates prototype patches, so we inject
    // a <script> tag that patches in the page's own JS world.
    const commId = '__pplxport_capture_' + Date.now();
    const comm = document.createElement('div');
    comm.id = commId;
    comm.style.display = 'none';
    document.body.appendChild(comm);

    const script = document.createElement('script');
    script.textContent = `(function(){
      var c=document.getElementById("${commId}");
      var oc=HTMLAnchorElement.prototype.click;
      var ou=URL.createObjectURL;
      URL.createObjectURL=function(o){
        var u=ou.call(this,o);
        if(o instanceof Blob){o.text().then(function(t){c.textContent=t;});}
        return u;
      };
      HTMLAnchorElement.prototype.click=function(){
        if(this.download&&(this.href||"").match(/^(blob|data):/)){
          if(this.href.startsWith("data:")){
            try{
              var p=this.href.split(",");var e=p[1];
              if(p[0].indexOf("base64")>-1){
                var b=Uint8Array.from(atob(e),function(x){return x.charCodeAt(0);});
                c.textContent=new TextDecoder().decode(b);
              }else{c.textContent=decodeURIComponent(e);}
            }catch(x){}
          }
          return;
        }
        return oc.call(this);
      };
      window.__pplxport_cleanup=function(){
        HTMLAnchorElement.prototype.click=oc;
        URL.createObjectURL=ou;
        delete window.__pplxport_cleanup;
      };
    })();`;
    document.documentElement.appendChild(script);
    script.remove();

    try {
      // Find the "Thread actions" three-dot menu button
      let threeDotBtn = document.querySelector('button[aria-label="Thread actions"]');
      if (!threeDotBtn) {
        const menuButtons = Array.from(document.querySelectorAll('button[aria-haspopup="menu"]'));
        threeDotBtn = menuButtons.find(b => {
          if (b.textContent.includes('Export')) return false;
          if (!b.querySelector('svg')) return false;
          if (b.closest('#perplexity-export-controls')) return false;
          return true;
        });
      }

      if (!threeDotBtn) throw new Error('Thread actions menu button not found');

      threeDotBtn.focus();
      simulateClick(threeDotBtn);
      await new Promise(r => setTimeout(r, 500));

      let menuItem = Array.from(document.querySelectorAll('[role="menuitem"]'))
        .find(m => /export\s*(as\s*)?markdown/i.test(m.textContent));

      if (!menuItem) {
        menuItem = Array.from(document.querySelectorAll('[role="menuitem"]'))
          .find(m => /^export$/i.test(m.textContent.trim()));
      }

      if (!menuItem) {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        throw new Error('Export as Markdown menu item not found');
      }

      simulateClick(menuItem);
      await new Promise(r => setTimeout(r, 300));

      // If clicking "Export" opened a sub-menu, look for "Markdown" item
      if (!comm.textContent) {
        const mdItem = Array.from(document.querySelectorAll('[role="menuitem"]'))
          .find(m => /markdown/i.test(m.textContent) && !/export\s+as/i.test(m.textContent));
        if (mdItem) {
          simulateClick(mdItem);
          await new Promise(r => setTimeout(r, 300));
        }
      }

      // Wait for capture
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 100));
        if (comm.textContent) break;
      }

      return comm.textContent || null;
    } finally {
      // Restore originals in page context
      const cleanup = document.createElement('script');
      cleanup.textContent = 'if(window.__pplxport_cleanup)window.__pplxport_cleanup();';
      document.documentElement.appendChild(cleanup);
      cleanup.remove();
      comm.remove();
    }
  }

  function reformatThreadExportMarkdown(rawMd, citationStyle) {
    // Normalize line endings (blobs may use CRLF)
    let cleaned = rawMd.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // Remove the Perplexity logo <img> tag and any other HTML img tags
    cleaned = cleaned.replace(/<img[^>]*>/gi, '');

    // Remove <span style="display:none">...</span> blocks (hidden unused citations)
    cleaned = cleaned.replace(/<span\s+style\s*=\s*"display:\s*none"[^>]*>[\s\S]*?<\/span>/gi, '');

    // Remove <div align="center">...</div> dividers (the ⁂ separators)
    cleaned = cleaned.replace(/<div\s+align\s*=\s*"center"[^>]*>[\s\S]*?<\/div>/gi, '');

    // Remove any remaining HTML tags
    cleaned = cleaned.replace(/<[^>]+>/g, '');

    // Split into Q&A sections by --- horizontal rules
    const sections = cleaned.split(/\n---\n/).map(s => s.trim()).filter(s => s.length > 0);

    const conversation = [];

    for (const section of sections) {
      // Each section starts with # question heading, followed by answer body,
      // then footnotes like [^N_M]: url at the bottom

      const lines = section.split('\n');
      let questionText = '';
      const answerLines = [];
      const footnoteMap = new Map(); // "N_M" -> url

      let inFootnotes = false;

      for (const line of lines) {
        // Check for question heading
        const questionMatch = line.match(/^# (.+)$/);
        if (questionMatch && !questionText) {
          questionText = questionMatch[1].trim();
          continue;
        }

        // Check for per-answer footnote definitions: [^N_M]: url
        const footnoteMatch = line.match(/^\[\^(\d+_\d+)\]:\s*(.+)$/);
        if (footnoteMatch) {
          inFootnotes = true;
          footnoteMap.set(footnoteMatch[1], footnoteMatch[2].trim());
          continue;
        }

        // Skip blank lines that appear between footnotes
        if (inFootnotes && line.trim() === '') continue;

        // If we were in footnotes but hit a non-footnote non-blank line,
        // we're back in content (shouldn't normally happen)
        if (inFootnotes && line.trim() !== '') {
          inFootnotes = false;
        }

        // Accumulate answer body lines
        if (questionText) {
          answerLines.push(line);
        }
      }

      if (!questionText) continue;

      // Join answer lines and clean up
      let answerBody = answerLines.join('\n').trim();

      // Normalize horizontal rules within answers to ***
      answerBody = answerBody.replace(/^---$/gm, '***');

      // Collect which footnote keys are actually referenced in the visible answer body
      const referencedKeys = new Set();
      for (const m of answerBody.matchAll(/\[\^(\d+_\d+)\]/g)) {
        referencedKeys.add(m[1]);
      }

      // Register only referenced footnotes with globalCitations
      const localToGlobalMap = new Map();
      for (const [localKey, url] of footnoteMap) {
        if (!referencedKeys.has(localKey)) continue;
        const globalNum = globalCitations.addCitation(url);
        localToGlobalMap.set(localKey, globalNum);
      }

      // Replace scoped [^N_M] citations in the answer body according to citationStyle
      if (citationStyle === CITATION_STYLES.NONE) {
        answerBody = answerBody.replace(/\[\^\d+_\d+\]/g, '');
      } else {
        // Replace runs of consecutive citations like [^1_1][^1_2][^1_3]
        answerBody = answerBody.replace(/(?:\[\^\d+_\d+\])+/g, (run) => {
          const keys = Array.from(run.matchAll(/\[\^(\d+_\d+)\]/g)).map(m => m[1]);
          if (keys.length === 0) return run;

          return keys.map(localKey => {
            const globalNum = localToGlobalMap.get(localKey) || localKey;
            const url = footnoteMap.get(localKey) || '';

            switch (citationStyle) {
              case CITATION_STYLES.ENDNOTES:
                return `[${globalNum}]`;
              case CITATION_STYLES.FOOTNOTES:
                return `[^${globalNum}]`;
              case CITATION_STYLES.INLINE:
                return url ? `[${globalNum}](${url})` : `[${globalNum}]`;
              case CITATION_STYLES.PARENTHESIZED:
                return url ? `([${globalNum}](${url}))` : `([${globalNum}])`;
              case CITATION_STYLES.NAMED: {
                const domain = extractDomainName(url) || 'source';
                return url ? `([${domain}](${url}))` : `([${domain}])`;
              }
              default:
                return `[^${globalNum}]`;
            }
          }).join('');
        });
      }

      // Clean up excessive whitespace
      answerBody = answerBody.replace(/\n{3,}/g, '\n\n').trim();

      // Add to conversation
      conversation.push({ role: 'User', content: questionText });
      conversation.push({ role: 'Assistant', content: answerBody });
    }

    return conversation;
  }

  async function extractByThreadExport(citationStyle) {
    try {
      const rawMd = await interceptThreadExportMarkdown();
      if (!rawMd) {
        console.log('Thread export: failed to capture markdown');
        return [];
      }
      console.log('Thread export: captured raw markdown, reformatting...');
      const conversation = reformatThreadExportMarkdown(rawMd, citationStyle);
      console.log(`Thread export: produced ${conversation.length} items`);
      return conversation;
    } catch (e) {
      console.warn('Thread export failed:', e);
      return [];
    }
  }

  function reformatDeepResearchMarkdown(rawMd, citationStyle) {
    // Split off the References section
    const refSplitPattern = /\n---\s*\n+## References\s*\n|(?:^|\n)## References\s*\n/;
    const parts = rawMd.split(refSplitPattern);
    let body = parts[0];
    const refsBlock = parts.length > 1 ? parts[1] : '';

    // Build citation number -> URL map from references
    // Format: "N. [Title](URL) - Description..."
    const citationUrlMap = new Map(); // number string -> { url, title }
    if (refsBlock) {
      const refLines = refsBlock.split('\n');
      for (const line of refLines) {
        const match = line.match(/^(\d+)\.\s+\[([^\]]*)\]\(([^)]+)\)/);
        if (match) {
          citationUrlMap.set(match[1], { title: match[2], url: match[3] });
        }
      }
    }

    // Register all references with globalCitations for consistent numbering
    const localToGlobalMap = new Map(); // local ref number -> global citation number
    for (const [localNum, { url }] of citationUrlMap) {
      const globalNum = globalCitations.addCitation(url);
      localToGlobalMap.set(localNum, globalNum);
    }

    // Replace [^N] footnote citations according to citationStyle
    if (citationStyle === CITATION_STYLES.NONE) {
      body = body.replace(/\[\^\d+\]/g, '');
    } else {
      // Replace runs of consecutive footnote citations like [^1][^2][^3]
      body = body.replace(/(?:\[\^\d+\])+/g, (run) => {
        const nums = Array.from(run.matchAll(/\[\^(\d+)\]/g)).map(m => m[1]);
        if (nums.length === 0) return run;

        return nums.map(localNum => {
          const globalNum = localToGlobalMap.get(localNum) || localNum;
          const ref = citationUrlMap.get(localNum);
          const url = ref?.url || '';

          switch (citationStyle) {
            case CITATION_STYLES.ENDNOTES:
              return `[${globalNum}]`;
            case CITATION_STYLES.FOOTNOTES:
              return `[^${globalNum}]`;
            case CITATION_STYLES.INLINE:
              return url ? `[${globalNum}](${url})` : `[${globalNum}]`;
            case CITATION_STYLES.PARENTHESIZED:
              return url ? `([${globalNum}](${url}))` : `([${globalNum}])`;
            case CITATION_STYLES.NAMED: {
              const domain = extractDomainName(url) || 'source';
              return url ? `([${domain}](${url}))` : `([${domain}])`;
            }
            default:
              return `[^${globalNum}]`;
          }
        }).join('');
      });
    }

    // Append citation list at end for styles that need it
    if (citationStyle === CITATION_STYLES.ENDNOTES && globalCitations.citationRefs.size > 0) {
      body += '\n\n### Sources\n';
      for (const [number, { href }] of globalCitations.citationRefs) {
        body += `[${number}] ${href}\n`;
      }
    }

    if (citationStyle === CITATION_STYLES.FOOTNOTES && globalCitations.citationRefs.size > 0) {
      body += '\n\n';
      for (const [number, { href }] of globalCitations.citationRefs) {
        body += `[^${number}]: ${href}\n`;
      }
    }

    return body.trim();
  }

  async function exportDeepResearch() {
    const prefs = getPreferences();
    globalCitations.reset();

    // Open side panel if needed
    const panelOpened = await openDeepResearchPanel();
    if (!panelOpened) {
      console.warn('Failed to open deep research side panel');
      return null;
    }

    // Wait a moment for panel to fully render
    await new Promise(r => setTimeout(r, 500));

    // Get raw markdown via export interception
    const rawMd = await interceptExportMarkdown();
    if (!rawMd) {
      console.warn('Failed to capture exported markdown');
      return null;
    }

    // Reformat citations
    const content = reformatDeepResearchMarkdown(rawMd, prefs.citationStyle);

    // Build final document
    let markdown = '';

    // Extract title from first H1 in content
    const titleMatch = content.match(/^# (.+)$/m);
    const title = titleMatch ? titleMatch[1] : document.title.replace(/ - Perplexity$/, '').replace(/ \| Perplexity$/, '').trim();

    if (prefs.includeFrontmatter) {
      const timestamp = new Date().toISOString().split('T')[0];
      markdown += `---\ntitle: ${title}\ndate: ${timestamp}\nsource: ${window.location.href}\n---\n\n`;
    }

    if (prefs.titleAsH1 && !content.startsWith('# ')) {
      markdown += `# ${title}\n\n`;
    }

    markdown += content;

    return markdown.trim();
  }

  // ============================================================================
  // EXTRACTION METHODS - ALL GROUPED TOGETHER
  // ============================================================================

  // Method 1: Page-down with button clicking (most reliable)
  async function extractByPageDownClickButtons(citationStyle) {
    const conversation = [];
    const processedContent = new Set();
    const processedQueryButtons = new WeakSet();
    const processedAnswerButtons = new WeakSet();

    const scroller = getScrollRoot();
    scroller.scrollTop = 0;
    await new Promise((r) => setTimeout(r, 80));

    let stableBottomCount = 0;
    let scrollAttempt = 0;
    const maxScrollAttempts = 200;
    const scrollDelay = 90;

    while (scrollAttempt < maxScrollAttempts && stableBottomCount < 5) {
      scrollAttempt++;
      let processedSomething = false;

      // Collect visible query/response copy buttons and process in top-to-bottom order
      const qButtons = getViewportQueryButtons().map((btn) => ({ btn, role: "User" }));
      const rButtons = getViewportResponseButtons().map((btn) => ({ btn, role: "Assistant" }));
      const allButtons = [...qButtons, ...rButtons].sort((a, b) => {
        const at = a.btn.getBoundingClientRect().top;
        const bt = b.btn.getBoundingClientRect().top;
        return at - bt;
      });

      for (const item of allButtons) {
        const { btn, role } = item;
        if (role === "User") {
          if (processedQueryButtons.has(btn)) continue;
          processedQueryButtons.add(btn);
          const text = (await clickVisibleButtonAndGetClipboard(btn))?.trim();
          if (text) {
            const hash = text.substring(0, 200) + text.substring(Math.max(0, text.length - 50)) + text.length + "|U";
            if (!processedContent.has(hash)) {
              processedContent.add(hash);
              conversation.push({ role: "User", content: text });
              processedSomething = true;
            }
          }
        } else {
          if (processedAnswerButtons.has(btn)) continue;
          processedAnswerButtons.add(btn);
          const raw = (await clickVisibleButtonAndGetClipboard(btn))?.trim();
          if (raw) {
            const hash = raw.substring(0, 200) + raw.substring(Math.max(0, raw.length - 50)) + raw.length;
            if (!processedContent.has(hash)) {
              processedContent.add(hash);
              const multiCitMap = extractMultiCitationMap(btn);
              const processedMarkdown = processCopiedMarkdown(raw, citationStyle, multiCitMap);
              conversation.push({ role: "Assistant", content: processedMarkdown });
              processedSomething = true;
            }
          }
        }
      }

      // Expand any collapsed content every few steps if nothing was processed
      if (!processedSomething) {
        await clickExpandersOnce(6);
      }

      const beforeBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
      await pageDownOnce(scroller, scrollDelay, 0.9);
      const afterBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
      if (beforeBottom && afterBottom && !processedSomething) {
        stableBottomCount++;
      } else {
        stableBottomCount = 0;
      }
    }

    return conversation;
  }

  // Method 2: Single-pass DOM scan (no button clicking)
  async function extractByDomScanSinglePass(citationStyle) {
    const processedContent = new Set();
    const collected = [];

    const scroller = getScrollRoot();
    scroller.scrollTop = 0;
    await new Promise((r) => setTimeout(r, 80));

    let stableBottomCount = 0;
    let scrollAttempt = 0;
    const maxScrollAttempts = 200;
    const scrollDelay = 90;

    while (scrollAttempt < maxScrollAttempts && stableBottomCount < 5) {
      scrollAttempt++;
      const beforeCount = collected.length;

      // Collect in DOM order for this viewport/state
      const batch = collectDomMessagesInOrderOnce(citationStyle, processedContent);
      if (batch.length > 0) {
        for (const item of batch) {
          collected.push(item);
        }
      } else {
        // Try expanding collapsed sections and collect again
        const expanded = await clickExpandersOnce(8);
        if (expanded) {
          const batch2 = collectDomMessagesInOrderOnce(citationStyle, processedContent);
          if (batch2.length > 0) {
            for (const item of batch2) collected.push(item);
          }
        }
      }

      // Detect bottom
      const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
      await pageDownOnce(scroller, scrollDelay, 0.9);
      const atBottomAfter = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;

      if (atBottom && atBottomAfter && collected.length === beforeCount) {
        stableBottomCount++;
      } else {
        stableBottomCount = 0;
      }
    }

    // Do not return to top; keep scroller where it ended
    return collected;
  }

  // Annotate each citation element on a live DOM node with data-urls
  // so the URLs survive cloneNode (which strips React fiber refs)
  function annotateCitationUrls(rootEl) {
    const citations = rootEl.querySelectorAll('.citation:not(.citation-nbsp)');
    if (citations.length === 0) return;
    const fiberKey = Object.keys(citations[0]).find(k => k.startsWith('__reactFiber'));
    if (!fiberKey) return;

    let answerWebResults = null;

    for (const citEl of citations) {
      let fiber = citEl[fiberKey];
      let citationIndices = null;

      for (let i = 0; i < 35 && fiber; i++) {
        const p = fiber.memoizedProps;
        if (p?.citationGroup) {
          if (p.webResults) {
            const urls = p.webResults.map(wr => wr.url).filter(Boolean);
            if (urls.length > 0) {
              citEl.setAttribute('data-urls', urls.join('|'));
            }
            break;
          }
          if (Array.isArray(p.citationGroup.citations) && p.citationGroup.citations.every(c => typeof c === 'number')) {
            citationIndices = p.citationGroup.citations;
          } else {
            break;
          }
        }

        if (citationIndices && p?.webResults && Array.isArray(p.webResults) && p.webResults.length >= 5) {
          answerWebResults = p.webResults;
          const urls = citationIndices
            .map(idx => answerWebResults[idx - 1]?.url)
            .filter(Boolean);
          if (urls.length > 0) {
            citEl.setAttribute('data-urls', urls.join('|'));
          }
          break;
        }

        if (p?.href && !citEl.getAttribute('data-urls')) {
          citEl.setAttribute('data-urls', p.href);
        }
        fiber = fiber.return;
      }

      if (citationIndices && !citEl.getAttribute('data-urls') && answerWebResults) {
        const urls = citationIndices
          .map(idx => answerWebResults[idx - 1]?.url)
          .filter(Boolean);
        if (urls.length > 0) {
          citEl.setAttribute('data-urls', urls.join('|'));
        }
      }
    }
  }

  // Helper for Method 2: collect messages in DOM order within a pass
  function collectDomMessagesInOrderOnce(citationStyle, processedContent) {
    const results = [];
    const container = getThreadContainer();

    const assistantSelector = ".prose.text-pretty.dark\\:prose-invert, [class*='prose'][class*='prose-invert']";
    const userSelectors = ["h1[class*='group\\/query'] span.select-text", "span.select-text", ".whitespace-pre-line.text-pretty.break-words", ".group\\/query span[data-lexical-text='true']", "h1.group\\/query span[data-lexical-text='true']", "span[data-lexical-text='true']"];
    const combined = `${assistantSelector}, ${userSelectors.join(", ")}`;

    const nodes = container.querySelectorAll(combined);
    nodes.forEach((node) => {
      if (node.matches(assistantSelector)) {
        // Annotate live citation elements with their URLs before cloning
        // (cloning strips React fiber refs, but data attributes survive)
        annotateCitationUrls(node);
        const cloned = node.cloneNode(true);
        const md = htmlToMarkdown(cloned.innerHTML, citationStyle, null).trim();
        if (!md) return;
        const hash = md.substring(0, 200) + md.substring(Math.max(0, md.length - 50)) + md.length;
        if (processedContent.has(hash)) return;
        processedContent.add(hash);
        results.push({ role: "Assistant", content: md });
      } else {
        // User
        const root = findUserMessageRootFromElement(node);
        if (root.closest && (root.closest(".prose.text-pretty.dark\\:prose-invert") || root.closest("[class*='prose'][class*='prose-invert']"))) return;
        const spans = root.querySelectorAll("span[data-lexical-text='true']");
        const selectTextSpan = root.querySelector("span.select-text");
        let text = "";
        if (spans.length > 0) {
          text = Array.from(spans)
            .map((s) => (s.textContent || "").trim())
            .join(" ")
            .trim();
        } else if (selectTextSpan) {
          text = (selectTextSpan.textContent || "").trim();
        } else {
          text = (node.textContent || "").trim();
        }
        if (!text || text.length < 2) return;
        // Prefer nodes within a container that also has a copy-query button, but don't require it
        const hasCopyQueryButton = !!(root.querySelector && (root.querySelector("button[data-testid='copy-query-button']") || root.querySelector("button[aria-label='Copy Query']")));
        if (!hasCopyQueryButton && text.length < 10) return;
        const hash = text.substring(0, 200) + text.substring(Math.max(0, text.length - 50)) + text.length + "|U";
        if (processedContent.has(hash)) return;
        processedContent.add(hash);
        results.push({ role: "User", content: text });
      }
    });

    return results;
  }

  // MAIN EXTRACTION ORCHESTRATOR
  // Fallback chain based on user preference:
  //   DIRECT_DOM: DOM scan -> export -> copy buttons
  //   EXPORT:     export -> DOM scan -> copy buttons
  //   COPY_BUTTONS: copy buttons -> export -> DOM scan
  async function extractConversation(citationStyle) {
    globalCitations.reset();
    const prefs = getPreferences();

    if (prefs.extractionMethod === EXTRACTION_METHODS.DIRECT_DOM) {
      console.log("Using Direct DOM extraction (user preference)...");
      const domSingle = await extractByDomScanSinglePass(citationStyle);
      console.log(`Direct DOM found ${domSingle.length} items`);
      if (domSingle.length >= 2) return domSingle;

      console.log("Direct DOM insufficient, trying export...");
      globalCitations.reset();
      const viaExport = await extractByThreadExport(citationStyle);
      if (viaExport.length >= 2) return viaExport;

      console.log("Export insufficient, trying copy buttons...");
      globalCitations.reset();
      const viaButtons = await extractByPageDownClickButtons(citationStyle);
      if (viaButtons.length >= 2) return viaButtons;

      return [];
    }

    if (prefs.extractionMethod === EXTRACTION_METHODS.EXPORT) {
      console.log("Using Export extraction (user preference)...");
      const viaExport = await extractByThreadExport(citationStyle);
      console.log(`Export found ${viaExport.length} items`);
      if (viaExport.length >= 2) return viaExport;

      console.log("Export insufficient, trying Direct DOM...");
      globalCitations.reset();
      const domSingle = await extractByDomScanSinglePass(citationStyle);
      if (domSingle.length >= 2) return domSingle;

      console.log("Direct DOM insufficient, trying copy buttons...");
      globalCitations.reset();
      const viaButtons = await extractByPageDownClickButtons(citationStyle);
      if (viaButtons.length >= 2) return viaButtons;

      return [];
    }

    console.log("Using Copy Buttons extraction...");
    const viaButtons = await extractByPageDownClickButtons(citationStyle);
    console.log(`Copy Buttons found ${viaButtons.length} items`);
    if (viaButtons.length >= 2) return viaButtons;

    console.log("Copy Buttons insufficient, trying export...");
    globalCitations.reset();
    const viaExport = await extractByThreadExport(citationStyle);
    if (viaExport.length >= 2) return viaExport;

    console.log("Export insufficient, falling back to DOM scan...");
    globalCitations.reset();
    const domSingle = await extractByDomScanSinglePass(citationStyle);
    if (domSingle.length >= 2) return domSingle;

    return [];
  }

  // ============================================================================
  // MARKDOWN PROCESSING FUNCTIONS
  // ============================================================================

  function extractMultiCitationMapFromRoot(rootEl) {
    if (!rootEl) return null;

    const citations = rootEl.querySelectorAll('.citation');
    if (citations.length === 0) return null;

    const fiberKey = Object.keys(citations[0]).find(k => k.startsWith('__reactFiber'));
    if (!fiberKey) return null;

    const map = new Map();
    let answerWebResults = null;

    for (const citEl of citations) {
      let node = citEl[fiberKey];
      let citationIndices = null;

      for (let i = 0; i < 35 && node; i++) {
        const props = node.memoizedProps || node.pendingProps;
        if (props?.citationGroup) {
          if (props.webResults?.length > 0) {
            const urls = props.webResults.map(wr => wr.url).filter(Boolean);
            if (urls.length > 0) {
              const primaryNorm = normalizeUrl(urls[0]);
              if (!map.has(primaryNorm)) map.set(primaryNorm, urls);
              const fullText = (citEl.textContent || "").trim().toLowerCase();
              if (fullText && !map.has(fullText)) map.set(fullText, urls);
            }
            break;
          }
          if (Array.isArray(props.citationGroup.citations) && props.citationGroup.citations.every(c => typeof c === 'number')) {
            citationIndices = props.citationGroup.citations;
          } else {
            break;
          }
        }

        if (citationIndices && props?.webResults && Array.isArray(props.webResults) && props.webResults.length >= 5) {
          answerWebResults = props.webResults;
          const urls = citationIndices.map(idx => answerWebResults[idx - 1]?.url).filter(Boolean);
          if (urls.length > 0) {
            const fullText = (citEl.textContent || "").trim().toLowerCase();
            if (fullText) map.set(fullText, urls);
            const primaryNorm = normalizeUrl(urls[0]);
            if (!map.has(primaryNorm)) map.set(primaryNorm, urls);
          }
          break;
        }

        node = node.return;
      }

      if (citationIndices && answerWebResults && !map.has((citEl.textContent || "").trim().toLowerCase())) {
        const urls = citationIndices.map(idx => answerWebResults[idx - 1]?.url).filter(Boolean);
        if (urls.length > 0) {
          const fullText = (citEl.textContent || "").trim().toLowerCase();
          if (fullText) map.set(fullText, urls);
        }
      }
    }

    return map.size > 0 ? map : null;
  }

  function extractMultiCitationMap(responseButton) {
    const responseRoot = findAssistantMessageRootFrom(responseButton);
    return extractMultiCitationMapFromRoot(responseRoot);
  }

  // Process copied markdown and convert citations to desired style with global consolidation
  function processCopiedMarkdown(markdown, citationStyle, multiCitationMap = null) {
    // The copied format already has [N] citations and numbered URL references at bottom

    // Extract the numbered references section (at bottom of each response)
    const referenceMatches = markdown.match(/\[(\d+)\]\(([^)]+)\)/g) || [];
    const localReferences = new Map(); // local number -> URL

    // Also extract plain numbered references like "1 https://example.com"
    const plainRefs = markdown.match(/^\s*(\d+)\s+(https?:\/\/[^\s\n]+)/gm) || [];
    plainRefs.forEach((ref) => {
      const match = ref.match(/(\d+)\s+(https?:\/\/[^\s\n]+)/);
      if (match) {
        localReferences.set(match[1], match[2]);
      }
    });

    // Extract from [N](url) format citations
    referenceMatches.forEach((ref) => {
      const match = ref.match(/\[(\d+)\]\(([^)]+)\)/);
      if (match) {
        localReferences.set(match[1], match[2]);
      }
    });

    // Remove the plain numbered references section and [N](url) citation blocks from the main content
    let content = markdown
      .replace(/^\s*\d+\s+https?:\/\/[^\s\n]+$/gm, "") // Remove "1 https://example.com" lines
      .replace(/^\s*\[(\d+)\]\([^)]+\)$/gm, "") // Remove "[1](https://example.com)" lines
      .replace(/\n{3,}/g, "\n\n"); // Clean up extra newlines left behind

    // Create mapping from local citation numbers to global numbers
    const localToGlobalMap = new Map();

    // Build the mapping by processing all found references
    localReferences.forEach((url, localNum) => {
      const globalNum = globalCitations.addCitation(url);
      localToGlobalMap.set(localNum, globalNum);
    });

    // Normalize any inline [N](url) occurrences inside the content into [N] tokens, while capturing URLs
    content = content.replace(/\[(\d+)\]\(([^)]+)\)/g, (_m, localNum, url) => {
      if (!localReferences.has(localNum)) {
        localReferences.set(localNum, url);
        if (!localToGlobalMap.has(localNum)) {
          const globalNum = globalCitations.addCitation(url);
          localToGlobalMap.set(localNum, globalNum);
        }
      }
      return `[${localNum}]`;
    });

    // Helper builders per style for a run of local numbers
    function buildEndnotesRun(localNums) {
      return localNums
        .map((n) => {
          const g = localToGlobalMap.get(n) || n;
          return `[${g}]`;
        })
        .join("");
    }

    function buildFootnotesRun(localNums) {
      return localNums
        .map((n) => {
          const g = localToGlobalMap.get(n) || n;
          return `[^${g}]`;
        })
        .join("");
    }

    function buildInlineRun(localNums) {
      return localNums
        .map((n) => {
          const url = localReferences.get(n) || "";
          const g = localToGlobalMap.get(n) || n;
          return url ? `[${g}](${url})` : `[${g}]`;
        })
        .join("");
    }

    function buildParenthesizedRun(localNums) {
      // Render each citation in its own parentheses: ([g1](u1)) ([g2](u2)) ...
      return localNums
        .map((n) => {
          const url = localReferences.get(n) || "";
          const g = localToGlobalMap.get(n) || n;
          const core = url ? `[${g}](${url})` : `[${g}]`;
          return `(${core})`;
        })
        .join(" ");
    }

    function buildNamedRun(localNums) {
      // Render each citation in its own parentheses with domain name: ([domain1](u1)) ([domain2](u2)) ...
      return localNums
        .map((n) => {
          const url = localReferences.get(n) || "";
          const domain = extractDomainName(url) || "source";
          const core = url ? `[${domain}](${url})` : `[${domain}]`;
          return `(${core})`;
        })
        .join(" ");
    }

    // Replace runs of citation tokens like [2][4][5] or with spaces between with style-specific output
    // Don't consume trailing whitespace/newlines so we preserve layout
    content = content.replace(/(?:\s*\[\d+\])+/g, (run) => {
      const nums = Array.from(run.matchAll(/\[(\d+)\]/g)).map((m) => m[1]);
      if (nums.length === 0) return run;
      if (citationStyle === CITATION_STYLES.NONE) return ""; // Remove citations completely
      if (citationStyle === CITATION_STYLES.ENDNOTES) return buildEndnotesRun(nums);
      if (citationStyle === CITATION_STYLES.FOOTNOTES) return buildFootnotesRun(nums);
      if (citationStyle === CITATION_STYLES.INLINE) return buildInlineRun(nums);
      if (citationStyle === CITATION_STYLES.PARENTHESIZED) return buildParenthesizedRun(nums);
      if (citationStyle === CITATION_STYLES.NAMED) return buildNamedRun(nums);
      return run;
    });

    // Handle bare multi-citation text like "developer.mozilla+1" or "reddit+2" from newer clipboard
    if (multiCitationMap) {
      content = content.replace(/(?<=[.!?:,;)\]}\s]|^)([a-zA-Z][a-zA-Z0-9._-]*\+\d+)(?=[\s.,;:!?)}\]\n]|$)/gm, (match, citText) => {
        const key = citText.trim().toLowerCase();
        const mapUrls = multiCitationMap.get(key);
        if (!mapUrls || mapUrls.length === 0) return match;

        const globalNums = mapUrls.map(u => {
          const gn = globalCitations.addCitation(u);
          localReferences.set(String(gn), u);
          localToGlobalMap.set(String(gn), gn);
          return gn;
        });
        const localNums = globalNums.map(String);
        if (citationStyle === CITATION_STYLES.NONE) return "";
        if (citationStyle === CITATION_STYLES.ENDNOTES) return buildEndnotesRun(localNums);
        if (citationStyle === CITATION_STYLES.FOOTNOTES) return buildFootnotesRun(localNums);
        if (citationStyle === CITATION_STYLES.INLINE) return buildInlineRun(localNums);
        if (citationStyle === CITATION_STYLES.PARENTHESIZED) return buildParenthesizedRun(localNums);
        if (citationStyle === CITATION_STYLES.NAMED) return buildNamedRun(localNums);
        return match;
      });
    }

    // Handle named citation links: [domain](url) format from newer Perplexity clipboard
    content = content.replace(/\[([^\]\n]{1,40})\]\((https?:\/\/[^)]+)\)/g, (match, text, url) => {
      if (/^\d+$/.test(text) || /\s/.test(text) || !/^[a-zA-Z][a-zA-Z0-9._-]*(?:\+\d+)?$/.test(text)) return match;

      const companionUrls = multiCitationMap?.get(normalizeUrl(url));
      if (companionUrls && companionUrls.length > 1) {
        const globalNums = companionUrls.map(u => {
          const gn = globalCitations.addCitation(u);
          localReferences.set(String(gn), u);
          localToGlobalMap.set(String(gn), gn);
          return gn;
        });
        const localNums = globalNums.map(String);
        if (citationStyle === CITATION_STYLES.NONE) return "";
        if (citationStyle === CITATION_STYLES.ENDNOTES) return buildEndnotesRun(localNums);
        if (citationStyle === CITATION_STYLES.FOOTNOTES) return buildFootnotesRun(localNums);
        if (citationStyle === CITATION_STYLES.INLINE) return buildInlineRun(localNums);
        if (citationStyle === CITATION_STYLES.PARENTHESIZED) return buildParenthesizedRun(localNums);
        if (citationStyle === CITATION_STYLES.NAMED) return buildNamedRun(localNums);
      }

      const globalNum = globalCitations.addCitation(url);
      if (citationStyle === CITATION_STYLES.NONE) return "";
      if (citationStyle === CITATION_STYLES.ENDNOTES) return `[${globalNum}]`;
      if (citationStyle === CITATION_STYLES.FOOTNOTES) return `[^${globalNum}]`;
      if (citationStyle === CITATION_STYLES.INLINE) return `[${globalNum}](${url})`;
      if (citationStyle === CITATION_STYLES.PARENTHESIZED) return `([${globalNum}](${url}))`;
      if (citationStyle === CITATION_STYLES.NAMED) return `([${text}](${url}))`;
      return match;
    });

    // Clean up any excessive parentheses sequences that might have been created
    // Collapse 3+ to 2 and remove spaces before punctuation
    content = content.replace(/\){3,}/g, "))");
    content = content.replace(/\(\({2,}/g, "((");

    // Handle newline spacing based on user preference
    const prefs = getPreferences();
    if (prefs.addExtraNewlines) {
      content = content.replace(/\n{3,}/g, "\n\n");
    } else {
      // Compact: protect table blocks, then strip extra newlines
      const tableHolder = [];
      content = content.replace(/\n\n(\|[^\n]+\n\|[^\n]+\n(?:\|[^\n]+\n?)*)/g, (_m, table) => {
        tableHolder.push(table);
        return `\n\n%%TABLE_${tableHolder.length - 1}%%\n`;
      });
      content = content
        .replace(/\n+/g, "\n")
        .replace(/\n\s*\n/g, "\n");
      // Restore tables with required blank line before them
      tableHolder.forEach((table, i) => {
        content = content.replace(`%%TABLE_${i}%%`, `\n${table.trimEnd()}`);
      });
    }

    content = content.trim();

    return content;
  }

  // Indent continuation lines inside list items
  function indentListContinuations(text) {
    const lines = text.split("\n");
    const result = [];
    const listStack = [];
    let inCodeBlock = false;
    let lastMeaningfulLineType = "other";
    const nonContinuationLine = /^(?:\s*#{1,6}\s|\s*\||\s*%%PRESERVE|\s*%%TBL|\s*\*\*\*)/;

    for (const line of lines) {
      if (/^\s*```/.test(line)) {
        inCodeBlock = !inCodeBlock;
        result.push(line);
        lastMeaningfulLineType = "continuation";
        continue;
      }

      if (inCodeBlock) {
        result.push(line);
        continue;
      }

      if (line === "") {
        result.push(line);
        continue;
      }

      const listMatch = line.match(/^(\s*)([-*+]|\d+\.)\s+/);
      if (listMatch) {
        const sourceMarkerIndent = listMatch[1].length;
        const marker = listMatch[2];
        const sourceContentIndent = listMatch[0].length;
        const content = line.slice(sourceContentIndent);
        const markerWidth = sourceContentIndent - sourceMarkerIndent;

        while (listStack.length && sourceMarkerIndent < listStack[listStack.length - 1].sourceMarkerIndent) {
          listStack.pop();
        }
        if (listStack.length && sourceMarkerIndent === listStack[listStack.length - 1].sourceMarkerIndent) {
          listStack.pop();
        }

        const depth = listStack.length;
        const normalizedMarkerIndent = depth * 4;
        const normalizedContentIndent = normalizedMarkerIndent + markerWidth;

        listStack.push({
          sourceMarkerIndent,
          sourceContentIndent,
          markerIndent: normalizedMarkerIndent,
          contentIndent: normalizedContentIndent,
        });

        result.push(`${" ".repeat(normalizedMarkerIndent)}${marker} ${content}`);
        lastMeaningfulLineType = "list";
        continue;
      }

      if (listStack.length) {
        const currentIndent = (line.match(/^\s*/) || [""])[0].length;

        if (lastMeaningfulLineType !== "list") {
          while (listStack.length && currentIndent < listStack[listStack.length - 1].sourceContentIndent) {
            listStack.pop();
          }
          if (listStack.length && currentIndent < listStack[0].sourceContentIndent) {
            listStack.length = 0;
          }
        }

        if (listStack.length && !nonContinuationLine.test(line)) {
          const targetIndent = listStack[listStack.length - 1].contentIndent;
          result.push(currentIndent < targetIndent ? " ".repeat(targetIndent - currentIndent) + line : line);
          lastMeaningfulLineType = "continuation";
          continue;
        }
      }

      listStack.length = 0;
      result.push(line);
      lastMeaningfulLineType = "other";
    }

    return result.join("\n");
  }

  // Convert HTML content to markdown
  function htmlToMarkdown(html, citationStyle = CITATION_STYLES.PARENTHESIZED, multiCitationMap = null) {
    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = html;

    tempDiv.querySelectorAll("code").forEach((codeElem) => {
      if (codeElem.style.whiteSpace && codeElem.style.whiteSpace.includes("pre-wrap")) {
        if (codeElem.parentElement.tagName.toLowerCase() !== "pre") {
          const pre = document.createElement("pre");
          let language = "";
          const prevDiv = codeElem.closest("div.pr-lg")?.previousElementSibling;
          if (prevDiv) {
            const langDiv = prevDiv.querySelector(".text-text-200");
            if (langDiv) {
              language = langDiv.textContent.trim().toLowerCase();
              langDiv.remove();
            }
          }
          pre.dataset.language = language;
          pre.innerHTML = "<code>" + codeElem.innerHTML + "</code>";
          codeElem.parentNode.replaceChild(pre, codeElem);
        }
      }
    });

    // Process citations - updated for new structure with proper URL-based tracking
    const citations = [
      ...tempDiv.querySelectorAll("a.citation"), // Old structure
      ...tempDiv.querySelectorAll(".citation:not(a)"), // New structure (covers .citation.inline, .citation.inline-flex, etc.)
    ];

    // Use globalCitations for consistent numbering across the entire document
    const urlToNumber = new Map(); // normalized URL -> global citation number

    function registerUrl(url, sourceName) {
      const norm = normalizeUrl(url);
      if (!urlToNumber.has(norm)) {
        const num = globalCitations.addCitation(url, sourceName);
        urlToNumber.set(norm, num);
      }
      return urlToNumber.get(norm);
    }

    // First pass: register all citation URLs
    citations.forEach((citation) => {
      let href = null;
      let sourceName = null;
      let isMultiCitation = false;

      if (citation.tagName === "A" && citation.classList.contains("citation")) {
        href = citation.getAttribute("href");
      } else if (citation.classList.contains("citation") && citation.tagName !== "A") {
        const ariaLabel = citation.getAttribute("aria-label");
        if (ariaLabel) {
          sourceName = extractSourceName(ariaLabel);
        }

        if (!sourceName) {
          const numberSpan = citation.querySelector('.text-3xs, [class*="text-3xs"]');
          if (numberSpan) {
            const spanText = numberSpan.textContent;
            sourceName = extractSourceName(spanText);
            isMultiCitation = /\+\d+$/.test(spanText.trim());
          }
        }

        if (!sourceName) {
          const text = citation.textContent.trim();
          if (text) sourceName = extractSourceName(text);
        }

        const nestedAnchor = citation.querySelector("a[href]");
        href = nestedAnchor ? nestedAnchor.getAttribute("href") : null;

        if (isMultiCitation) {
          citation.setAttribute("data-is-multi-citation", "true");
        }
      }

      // Prefer data-urls attribute (set by annotateCitationUrls on live DOM before cloning)
      const dataUrls = citation.getAttribute('data-urls');
      if (dataUrls) {
        const urls = dataUrls.split('|').filter(Boolean);
        for (const u of urls) registerUrl(u, sourceName);
      } else if (href) {
        registerUrl(href, sourceName);
      } else if (isMultiCitation && multiCitationMap) {
        const fullText = (citation.textContent || "").trim().toLowerCase();
        const mapUrls = multiCitationMap.get(fullText) || (sourceName && multiCitationMap.get(sourceName));
        if (mapUrls) {
          for (const u of mapUrls) {
            registerUrl(u, sourceName);
          }
        }
      }
    });

    // Clean up citations based on style using URL-based numbering
    tempDiv.querySelectorAll(".citation").forEach((el) => {
      let href = null;
      let sourceName = null;
      let isMultiCitation = false;

      // Handle old structure (a.citation)
      if (el.tagName === "A" && el.classList.contains("citation")) {
        href = el.getAttribute("href");
      }
      // Handle new structure (span.citation with nested anchor)
      else if (el.classList.contains("citation") && el.tagName !== "A") {
        // Get source name from aria-label or nested text
        const ariaLabel = el.getAttribute("aria-label");
        if (ariaLabel) {
          sourceName = extractSourceName(ariaLabel);
        }

        if (!sourceName) {
          const numberSpan = el.querySelector('.text-3xs, [class*="text-3xs"]');
          if (numberSpan) {
            const spanText = numberSpan.textContent;
            sourceName = extractSourceName(spanText);
            isMultiCitation = /\+\d+$/.test(spanText.trim());
          }
        }

        if (!sourceName) {
          const text = el.textContent.trim();
          if (text) sourceName = extractSourceName(text);
        }

        // Get href from nested anchor
        const nestedAnchor = el.querySelector("a[href]");
        href = nestedAnchor ? nestedAnchor.getAttribute("href") : null;
      }

      // Prefer data-urls attribute (set by annotateCitationUrls before cloning)
      const elDataUrls = el.getAttribute('data-urls');
      const resolvedUrls = elDataUrls ? elDataUrls.split('|').filter(Boolean) : null;

      if (resolvedUrls && resolvedUrls.length > 0) {
        const localNums = resolvedUrls.map(u => urlToNumber.get(normalizeUrl(u))).filter(Boolean);
        if (localNums.length === 0) { el.replaceWith(""); return; }
        let citationText = "";
        if (citationStyle === CITATION_STYLES.NONE) {
          citationText = "";
        } else if (citationStyle === CITATION_STYLES.NAMED) {
          citationText = localNums.map((_n, i) => {
            const domain = extractDomainName(resolvedUrls[i]) || "source";
            return `([${domain}](${resolvedUrls[i]}))`;
          }).join(" ");
          citationText = ` ${citationText} `;
        } else if (citationStyle === CITATION_STYLES.INLINE) {
          citationText = localNums.map((n, i) => `[${n}](${resolvedUrls[i]})`).join("");
          citationText = ` ${citationText} `;
        } else if (citationStyle === CITATION_STYLES.PARENTHESIZED) {
          citationText = localNums.map((n, i) => `([${n}](${resolvedUrls[i]}))`).join(" ");
          citationText = ` ${citationText} `;
        } else if (citationStyle === CITATION_STYLES.FOOTNOTES) {
          citationText = localNums.map(n => `[^${n}]`).join("");
          citationText = ` ${citationText} `;
        } else {
          citationText = localNums.map(n => `[${n}]`).join("");
          citationText = ` ${citationText} `;
        }
        el.replaceWith(citationText);
      } else if (href) {
        const normalizedUrl = normalizeUrl(href);
        const number = urlToNumber.get(normalizedUrl);

        if (number) {
          let citationText = "";
          if (citationStyle === CITATION_STYLES.NONE) {
            citationText = "";
          } else if (citationStyle === CITATION_STYLES.INLINE) {
            citationText = ` [${number}](${href}) `;
          } else if (citationStyle === CITATION_STYLES.PARENTHESIZED) {
            citationText = ` ([${number}](${href})) `;
          } else if (citationStyle === CITATION_STYLES.NAMED && sourceName) {
            citationText = ` ([${sourceName}](${href})) `;
          } else if (citationStyle === CITATION_STYLES.FOOTNOTES) {
            citationText = ` [^${number}] `;
          } else {
            citationText = ` [${number}] `;
          }
          el.replaceWith(citationText);
        }
      } else if (isMultiCitation && multiCitationMap) {
        const elFullText = (el.textContent || "").trim().toLowerCase();
        const mapUrls = multiCitationMap.get(elFullText) || (sourceName && multiCitationMap.get(sourceName));
        if (mapUrls && mapUrls.length > 0) {
          const localNums = mapUrls.map(u => urlToNumber.get(normalizeUrl(u))).filter(Boolean);
          if (localNums.length === 0) { el.replaceWith(""); return; }
          let citationText = "";
          if (citationStyle === CITATION_STYLES.NONE) {
            citationText = "";
          } else if (citationStyle === CITATION_STYLES.NAMED) {
            citationText = localNums.map((_n, i) => {
              const domain = extractDomainName(mapUrls[i]) || "source";
              return `([${domain}](${mapUrls[i]}))`;
            }).join(" ");
            citationText = ` ${citationText} `;
          } else if (citationStyle === CITATION_STYLES.INLINE) {
            citationText = localNums.map((n, i) => `[${n}](${mapUrls[i]})`).join("");
            citationText = ` ${citationText} `;
          } else if (citationStyle === CITATION_STYLES.PARENTHESIZED) {
            citationText = localNums.map((n, i) => `([${n}](${mapUrls[i]}))`).join(" ");
            citationText = ` ${citationText} `;
          } else if (citationStyle === CITATION_STYLES.FOOTNOTES) {
            citationText = localNums.map(n => `[^${n}]`).join("");
            citationText = ` ${citationText} `;
          } else {
            citationText = localNums.map(n => `[${n}]`).join("");
            citationText = ` ${citationText} `;
          }
          el.replaceWith(citationText);
        }
      }
    });

    tempDiv.querySelectorAll("li").forEach((li) => {
      let depth = 0;
      let parent = li.parentElement;
      while (parent && parent !== tempDiv) {
        if (parent.tagName && parent.tagName.toLowerCase() === "li") depth++;
        parent = parent.parentElement;
      }

      const listParent = li.parentElement;
      let marker = "-";
      if (listParent && listParent.tagName && listParent.tagName.toLowerCase() === "ol") {
        const siblings = Array.from(listParent.children).filter((child) => child.tagName && child.tagName.toLowerCase() === "li");
        const index = siblings.indexOf(li);
        marker = `${index >= 0 ? index + 1 : 1}.`;
      }

      li.setAttribute("data-md-depth", String(depth));
      li.setAttribute("data-md-marker", marker);
    });

    // Convert strong sections to headers and clean up content
    let text = tempDiv.innerHTML;

    //  Basic HTML conversion
    text = text
      .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/g, "# $1")
      .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/g, "## $1")
      .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/g, "### $1")
      .replace(/<h4[^>]*>([\s\S]*?)<\/h4>/g, "#### $1")
      .replace(/<h5[^>]*>([\s\S]*?)<\/h5>/g, "##### $1")
      .replace(/<h6[^>]*>([\s\S]*?)<\/h6>/g, "###### $1")
      .replace(/<p[^>]*>([\s\S]*?)<\/p>/g, (_, content) => {
        const prefs = getPreferences();
        return prefs.addExtraNewlines ? `${content}\n\n` : `${content}\n`;
      })
      .replace(/<br\s*\/?>(?!\n)/g, () => {
        const prefs = getPreferences();
        return prefs.addExtraNewlines ? "\n\n" : "\n";
      })
      .replace(/<strong>([\s\S]*?)<\/strong>/g, "**$1**")
      .replace(/<em>([\s\S]*?)<\/em>/g, "*$1*")
      .replace(/<(?:ul|ol)[^>]*>([\s\S]*?)<\/(?:ul|ol)>/g, (_, content) => {
        const prefs = getPreferences();
        return prefs.addExtraNewlines ? `${content}\n\n` : `${content}\n`;
      });

    // Process <li> tags innermost-first to handle nesting correctly
    const liReplace = (match, content) => {
      const prefs = getPreferences();
      const depthMatch = match.match(/data-md-depth="(\d+)"/);
      const markerMatch = match.match(/data-md-marker="([^"]+)"/);
      const depth = depthMatch ? parseInt(depthMatch[1], 10) : 0;
      const marker = markerMatch ? markerMatch[1] : "-";
      const itemPrefix = `${"    ".repeat(depth)}${marker} `;
      const continuationPrefix = `${"    ".repeat(depth)}  `;

      const normalized = content.trim().replace(/\n\n/g, '\n');
      const normalizedLines = normalized ? normalized.split("\n") : [""];
      const formatted = normalizedLines
        .map((line, index) => {
          if (line === "") return "";
          if (index === 0) return `${itemPrefix}${line}`;

          const currentIndent = (line.match(/^\s*/) || [""])[0].length;
          return currentIndent < continuationPrefix.length
            ? " ".repeat(continuationPrefix.length - currentIndent) + line
            : line;
        })
        .join("\n");

      return prefs.addExtraNewlines ? `${formatted}\n\n` : `${formatted}\n`;
    };
    while (/<li[^>]*>/.test(text)) {
      text = text.replace(/<li[^>]*>((?:(?!<li)[\s\S])*?)<\/li>/g, liReplace);
    }

    // Handle tables before removing remaining HTML
    text = text.replace(/<table[^>]*>([\s\S]*?)<\/table>/g, (match) => {
      const tableDiv = document.createElement("div");
      tableDiv.innerHTML = match;
      const rows = [];

      // Process header rows
      const headerRows = tableDiv.querySelectorAll("thead tr");
      if (headerRows.length > 0) {
        headerRows.forEach((row) => {
          const cells = [...row.querySelectorAll("th, td")].map((cell) => {
            let html = cell.innerHTML;
            html = html.replace(/<code>(.*?)<\/code>/g, '`$1`');
            html = html.replace(/<strong>(.*?)<\/strong>/g, '**$1**');
            html = html.replace(/<em>(.*?)<\/em>/g, '*$1*');
            html = html.replace(/<[^>]+>/g, '');
            html = html.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
            return html.trim() || ' ';
          });
          if (cells.length > 0) {
            rows.push(`| ${cells.join(" | ")} |`);
            // Add separator row after headers
            rows.push(`| ${cells.map(() => "---").join(" | ")} |`);
          }
        });
      }

      // Process body rows
      const bodyRows = tableDiv.querySelectorAll("tbody tr");
      bodyRows.forEach((row) => {
        const cells = [...row.querySelectorAll("td")].map((cell) => {
          let html = cell.innerHTML;
          html = html.replace(/<code>(.*?)<\/code>/g, '`$1`');
          html = html.replace(/<strong>(.*?)<\/strong>/g, '**$1**');
          html = html.replace(/<em>(.*?)<\/em>/g, '*$1*');
          html = html.replace(/<[^>]+>/g, '');
          html = html.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
          return html.trim() || ' ';
        });
        if (cells.length > 0) {
          rows.push(`| ${cells.join(" | ")} |`);
        }
      });

      // Return markdown table with proper spacing
      return rows.length > 0 ? `\n\n${rows.join("\n")}\n\n` : "";
    });

    // Continue with remaining HTML conversion
    text = text
      .replace(/<pre[^>]*?(?:data-language|class\s*=\s*"[^"]*language-)(?:[="]\s*)([a-zA-Z0-9_+-]+)[^>]*>(?:\s*<code[^>]*>)?([\s\S]*?)(?:<\/code>\s*)?<\/pre>/g, (_, lang, code) => {
        const decoded = code.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
        return '```' + lang + '\n' + decoded.trim() + '\n```';
      })
      .replace(/<pre[^>]*>(?:\s*<code[^>]*>)?([\s\S]*?)(?:<\/code>\s*)?<\/pre>/g, (_, code) => {
        const decoded = code.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
        return '```\n' + decoded.trim() + '\n```';
      })
      .replace(/<code>(.*?)<\/code>/g, "`$1`")
      .replace(/<a\s+(?:[^>]*?\s+)?href="([^"]*)"[^>]*>(.*?)<\/a>/g, "[$2]($1)")
      .replace(/<[^>]+>/g, "")
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');

    // Fix malformed code fences where language appears before backticks (e.g. "powershell```")
    text = text.replace(/^([a-zA-Z0-9_+-]+)```$/gm, '```$1');
    // Trim trailing blank lines inside code blocks
    text = text.replace(/(```[a-zA-Z0-9_+-]*\n)([\s\S]*?)\n\n```/g,
      (_, open, body) => open + body.trimEnd() + '\n```');


    // Convert bold text at start of line to h3 headers, but not if inside a list item
    text = text.replace(/^(\s*)\*\*([^*\n]+)\*\*(?!.*\n\s*-)/gm, "$1### $2");

    // This fixes list items where the entire text was incorrectly converted to headers
    // We need to preserve both partial bold items and fully bold items
    text = text.replace(/^(\s*-\s+)###\s+([^\n]+)/gm, function (_, listPrefix, content) {
      // Check if the content contains bold markers
      if (content.includes("**")) {
        // If it already has bold markers, just remove the ### and keep the rest intact
        return `${listPrefix}${content}`;
      } else {
        // If it doesn't have bold markers (because it was fully bold before),
        // add them back (this was incorrectly converted to a header)
        return `${listPrefix}**${content}**`;
      }
    });

    // Fix list spacing (no extra newlines between items)
    text = text.replace(/\n[ \t]-\s+/g, "\n- ");

    // Ensure headers have proper spacing
    text = text.replace(/([^\n])(\n#{1,3} )/g, "$1\n\n$2");

    // Fix unbalanced or misplaced bold markers in list items
    text = text.replace(/^(\s*-\s+.*?)(\s\*\*\s*)$/gm, "$1"); // Remove trailing ** with space before

    // Fix citation and bold issues - make sure citations aren't wrapped in bold
    text = text.replace(/\*\*([^*]+)(\[[0-9]+\]\([^)]+\))\s*\*\*/g, "**$1**$2");
    text = text.replace(/\*\*([^*]+)(\(\[[0-9]+\]\([^)]+\)\))\s*\*\*/g, "**$1**$2");

    // Fix cases where a line ends with an extra bold marker after a citation
    text = text.replace(/(\[[0-9]+\]\([^)]+\))\s*\*\*/g, "$1");
    text = text.replace(/(\(\[[0-9]+\]\([^)]+\)\))\s*\*\*/g, "$1");

    // Protect code blocks and tables from whitespace cleanup
    const preserved = [];
    text = text.replace(/```[\s\S]*?```/g, (match) => {
      preserved.push(match);
      return `%%PRESERVE_${preserved.length - 1}%%`;
    });
    text = text.replace(/\n\n(\|[^\n]+\n\|[^\n]+\n(?:\|[^\n]+\n?)*)/g, (_m, table) => {
      preserved.push(table);
      return `\n\n%%PRESERVE_${preserved.length - 1}%%`;
    });

    // Clean up whitespace (outside code blocks/tables)
    text = text
      .replace(/^[\s\n]+|[\s\n]+$/g, "")
      .replace(/[ \t]+$/gm, "")
      .trim();

    // Handle newline spacing based on user preference
    const prefs = getPreferences();
    if (prefs.addExtraNewlines) {
      text = text.replace(/\n{3,}/g, "\n\n");
    } else {
      text = text
        .replace(/\n+/g, "\n")
        .replace(/\n\s*\n/g, "\n");
    }

    // Restore code blocks and tables (tables get blank line before them)
    preserved.forEach((block, i) => {
      const isTable = block.startsWith("|");
      text = text.replace(`%%PRESERVE_${i}%%`, isTable ? `\n${block.trimEnd()}` : block);
    });

    if (citationStyle === CITATION_STYLES.INLINE || citationStyle === CITATION_STYLES.PARENTHESIZED) {
      // Remove extraneous space before a period, but preserve newlines
      text = text.replace(/ (?=\.)/g, "");
    }

    // Endnotes/footnotes are appended at document level by formatMarkdown using globalCitations

    return text;
  }

  // Format the complete markdown document
  function formatMarkdown(conversations) {
    const title = document.title.replace(" | Perplexity", "").trim();
    const timestamp = new Date().toISOString().split("T")[0];
    const prefs = getPreferences();

    let markdown = "";

    // Only add frontmatter if enabled
    if (prefs.includeFrontmatter) {
      markdown += "---\n";
      markdown += `title: ${title}\n`;
      markdown += `date: ${timestamp}\n`;
      markdown += `source: ${window.location.href}\n`;
      markdown += "---\n\n"; // Add newline after properties
    }

    // Add title as H1 if enabled
    if (prefs.titleAsH1) {
      markdown += `# ${title}\n\n`;
    }

    const gap = prefs.addExtraNewlines ? "\n\n" : "\n";
    const rule = "***";

    function compactContent(text) {
      if (prefs.addExtraNewlines) return text;
      // Protect table blocks, then collapse extra newlines
      const tables = [];
      let result = text.replace(/\n\n(\|[^\n]+\n\|[^\n]+\n(?:\|[^\n]+\n?)*)/g, (_m, table) => {
        tables.push(table);
        return `\n\n%%TBL_${tables.length - 1}%%\n`;
      });
      result = result.replace(/\n+/g, "\n").replace(/\n\s*\n/g, "\n");
      tables.forEach((table, i) => {
        result = result.replace(`%%TBL_${i}%%`, `\n${table.trimEnd()}`);
      });
      return result;
    }

    conversations.forEach((conv, index) => {
      if (conv.role === "Assistant") {
        let cleanContent = indentListContinuations(compactContent(conv.content.trim()));

        if (cleanContent.match(/^#+ /) && prefs.formatStyle === FORMAT_STYLES.FULL) {
          markdown += `**${conv.role}:**\n\n${cleanContent}${gap}`;
        } else if (prefs.formatStyle === FORMAT_STYLES.FULL) {
          markdown += `**${conv.role}:** ${cleanContent}${gap}`;
        } else {
          markdown += `${cleanContent}${gap}`;
        }

        const nextAssistant = conversations.slice(index + 1).find((c) => c.role === "Assistant");
        if (nextAssistant) {
          markdown += `${rule}${gap}`;
        }
      } else if (conv.role === "User" && prefs.formatStyle === FORMAT_STYLES.FULL) {
        markdown += `**${conv.role}:** ${conv.content.trim()}${gap}${rule}${gap}`;
      }
    });

    // Add global citations at the end for endnotes style
    if (prefs.citationStyle === CITATION_STYLES.ENDNOTES && globalCitations.citationRefs.size > 0) {
      markdown += "\n\n### Sources\n";
      for (const [number, { href }] of globalCitations.citationRefs) {
        markdown += `\n[${number}] ${href}`;
      }
      markdown += "\n"; // Add final newline
    }

    // Add global footnote definitions at the end for footnotes style
    if (prefs.citationStyle === CITATION_STYLES.FOOTNOTES && globalCitations.citationRefs.size > 0) {
      markdown += "\n\n";
      for (const [number, { href }] of globalCitations.citationRefs) {
        markdown += `[^${number}]: ${href}\n`;
      }
    }

    return markdown.trim(); // Trim any trailing whitespace at the very end
  }

  // ============================================================================
  // UI FUNCTIONS
  // ============================================================================

  // Download markdown file
  function downloadMarkdown(content, filename) {
    const blob = new Blob([content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Copy to clipboard
  async function copyToClipboard(content) {
    try {
      await navigator.clipboard.writeText(content);
      return { ok: true, needsFocus: false, error: null };
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
      return { ok: false, needsFocus: !document.hasFocus(), error: err };
    }
  }

  // Temporarily prevent navigation (external anchors and window.open) during export
  function installNavBlocker() {
    const clickBlocker = (e) => {
      try {
        const anchor = e.target && e.target.closest && e.target.closest('a[href], area[href]');
        if (!anchor) return;
        const href = (anchor.getAttribute('href') || '').trim();
        const target = (anchor.getAttribute('target') || '').trim().toLowerCase();
        const isExternal = /^https?:\/\//i.test(href);
        if (isExternal || target === '_blank') {
          e.preventDefault();
          e.stopImmediatePropagation();
        }
      } catch {}
    };
    document.addEventListener('click', clickBlocker, true);

    const originalOpen = window.open;
    window.open = function () { return null; };

    return function removeNavBlocker() {
      try { document.removeEventListener('click', clickBlocker, true); } catch {}
      try { window.open = originalOpen; } catch {}
    };
  }

  // Create and add export button
  function addExportButton() {
    const existingControls = document.getElementById("perplexity-export-controls");
    if (existingControls) {
      existingControls.remove();
    }
    const existingFocusOverlay = document.getElementById("perplexity-focus-overlay");
    if (existingFocusOverlay) {
      existingFocusOverlay.remove();
    }

    const container = document.createElement("div");
    container.id = "perplexity-export-controls";
    container.style.cssText = `
            position: fixed;
            bottom: 40px;
            left: 50%;
            transform: translateX(-50%);
            display: flex;
            gap: 8px;
            align-items: stretch;
            z-index: 99999;
            font-family: inherit;
        `;

    const exportButton = document.createElement("button");
    exportButton.id = "perplexity-export-btn";
    exportButton.type = "button";
    exportButton.textContent = "Save as Markdown"; // Default, will be updated
    exportButton.style.cssText = `
            padding: 4px 8px;
            background-color: #30b8c6;
            color: black;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            font-size: 12px;
            font-weight: 600;
            transition: background-color 0.2s;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        `;

    const optionsWrapper = document.createElement("div");
    optionsWrapper.style.cssText = `
            position: relative;
            display: flex;
        `;

    const optionsButton = document.createElement("button");
    optionsButton.id = "perplexity-export-options-btn";
    optionsButton.type = "button";
    optionsButton.setAttribute("aria-haspopup", "true");
    optionsButton.setAttribute("aria-expanded", "false");
    optionsButton.style.cssText = `
            padding: 4px 8px;
            background-color: #30b8c6;
            color: black;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            font-size: 12px;
            font-weight: 600;
            transition: background-color 0.2s;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            white-space: nowrap;
        `;

    const menu = document.createElement("div");
    menu.id = "perplexity-export-options-menu";
    menu.style.cssText = `
            position: absolute;
            bottom: calc(100% + 8px);
            left: 50%;
            transform: translateX(-50%);
            display: none;
            flex-direction: column;
            gap: 10px;
            min-width: 280px;
            background: #1F2121;
            color: white;
            border-radius: 12px;
            padding: 12px;
            box-shadow: 0 12px 24px rgba(0, 0, 0, 0.25);
        `;

    optionsWrapper.appendChild(optionsButton);

    container.appendChild(exportButton);
    container.appendChild(optionsWrapper);
    container.appendChild(menu);

    let queuedClipboardContent = null;
    let queuedCopyFocusListener = null;

    function updateOptionsButtonLabel() {
      const label = `Options`;
      optionsButton.textContent = label;
      optionsButton.setAttribute("aria-label", `Export options. ${label}`);
    }

    function updateExportButtonLabel() {
      const prefs = getPreferences();
      const label = prefs.exportMethod === EXPORT_METHODS.CLIPBOARD ? "Copy as Markdown" : "Save as Markdown";
      exportButton.textContent = label;
    }

    function getFocusOverlay() {
      return document.getElementById("perplexity-focus-overlay");
    }

    function setFocusOverlayMessage(title, subtitle) {
      const overlay = getFocusOverlay();
      if (!overlay) return;
      const titleEl = overlay.querySelector("#perplexity-focus-overlay-title");
      const subtitleEl = overlay.querySelector("#perplexity-focus-overlay-subtitle");
      if (titleEl) titleEl.textContent = title;
      if (subtitleEl) subtitleEl.textContent = subtitle;
    }

    function showFocusOverlay(title, subtitle) {
      const overlay = getFocusOverlay();
      if (!overlay) return;
      setFocusOverlayMessage(title, subtitle);
      overlay.style.display = "flex";
    }

    function hideFocusOverlay() {
      const overlay = getFocusOverlay();
      if (!overlay) return;
      overlay.style.display = "none";
    }

    function setExportButtonStatus(text, resetDelayMs = 0) {
      exportButton.textContent = text;
      if (resetDelayMs > 0) {
        setTimeout(() => {
          if (!queuedClipboardContent) {
            updateExportButtonLabel();
          }
        }, resetDelayMs);
      }
    }

    function armQueuedCopyOnFocus() {
      if (queuedCopyFocusListener) {
        window.removeEventListener("focus", queuedCopyFocusListener);
      }

      queuedCopyFocusListener = async () => {
        queuedCopyFocusListener = null;
        if (!queuedClipboardContent) return;

        await new Promise((resolve) => setTimeout(resolve, 120));
        const copyResult = await copyToClipboard(queuedClipboardContent);

        if (copyResult.ok) {
          queuedClipboardContent = null;
          hideFocusOverlay();
          setExportButtonStatus("Copied!", 2000);
          return;
        }

        if (copyResult.needsFocus) {
          setExportButtonStatus("Copy queued (focus tab)");
          showFocusOverlay("Copy queued", "Text is saved. Keep this tab focused and it will auto-copy.");
          armQueuedCopyOnFocus();
          return;
        }

        hideFocusOverlay();
        setExportButtonStatus("Copy queued (click to copy)");
      };

      window.addEventListener("focus", queuedCopyFocusListener, { once: true });
    }

    async function copyWithQueuedFocus(content) {
      const payload = typeof content === "string" ? content : queuedClipboardContent;
      if (!payload) {
        setExportButtonStatus("Nothing queued to copy", 2000);
        return "empty";
      }

      const copyResult = await copyToClipboard(payload);

      if (copyResult.ok) {
        queuedClipboardContent = null;
        hideFocusOverlay();
        setExportButtonStatus("Copied!", 2000);
        return "copied";
      }

      if (copyResult.needsFocus) {
        queuedClipboardContent = payload;
        setExportButtonStatus("Copy queued (focus tab)");
        showFocusOverlay("Copy queued", "Text is saved. It will auto-copy when this tab regains focus.");
        armQueuedCopyOnFocus();
        return "queued";
      }

      queuedClipboardContent = payload;
      hideFocusOverlay();
      setExportButtonStatus("Copy failed (saved) - check clipboard permission");
      return "failed";
    }

    function createOptionButton(label, value, currentValue, onSelect, tooltip) {
      const optionBtn = document.createElement("button");
      optionBtn.type = "button";
      optionBtn.textContent = label;
      if (tooltip) {
        optionBtn.setAttribute("title", tooltip);
      }
      optionBtn.style.cssText = `
                padding: 6px 8px;
                border-radius: 6px;
                border: 1px solid ${value === currentValue ? "#30b8c6" : "#4a5568"};
                background-color: ${value === currentValue ? "#30b8c6" : "#2d3748"};
                color: ${value === currentValue ? "#0a0e13" : "#f7fafc"};
                font-size: 11px;
                text-align: center;
                cursor: pointer;
                transition: background-color 0.2s, border-color 0.2s, color 0.2s;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            `;
      optionBtn.addEventListener("mouseenter", () => {
        if (value !== currentValue) {
          optionBtn.style.borderColor = "#30b8c6";
          optionBtn.style.backgroundColor = "#4a5568";
        }
      });
      optionBtn.addEventListener("mouseleave", () => {
        if (value !== currentValue) {
          optionBtn.style.borderColor = "#4a5568";
          optionBtn.style.backgroundColor = "#2d3748";
        }
      });
      optionBtn.addEventListener("click", () => {
        onSelect(value);
        renderOptionsMenu();
        updateOptionsButtonLabel();
        updateExportButtonLabel();
      });
      return optionBtn;
    }

    function appendOptionGroup(sectionEl, label, options, currentValue, onSelect, labelTooltip, columns) {
      const group = document.createElement("div");
      group.style.display = "flex";
      group.style.flexDirection = "column";
      group.style.gap = "6px";

      if (label) {
        const groupLabel = document.createElement("div");
        groupLabel.textContent = label;
        groupLabel.style.cssText = "font-size: 12px; font-weight: 600; color: #d1d5db;";
        if (labelTooltip) {
          groupLabel.setAttribute("title", labelTooltip);
          groupLabel.style.cursor = "help";
        }
        group.appendChild(groupLabel);
      }

      const cols = columns || 2;
      const list = document.createElement("div");
      list.style.display = "grid";
      list.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
      list.style.gap = "4px";

      options.forEach((opt) => {
        list.appendChild(createOptionButton(opt.label, opt.value, currentValue, onSelect, opt.tooltip));
      });

      group.appendChild(list);
      sectionEl.appendChild(group);
    }

    function renderOptionsMenu() {
      const prefs = getPreferences();
      menu.innerHTML = "";

      const citationSection = document.createElement("div");
      citationSection.style.display = "flex";
      citationSection.style.flexDirection = "column";
      citationSection.style.gap = "6px";

      const citationHeading = document.createElement("div");
      citationHeading.textContent = "Citation Style";
      citationHeading.style.cssText = "font-size: 13px; font-weight: 700; color: #f9fafb;";
      citationSection.appendChild(citationHeading);

      appendOptionGroup(
        citationSection,
        "Format",
        [
          { label: "Endnotes", value: CITATION_STYLES.ENDNOTES, tooltip: CITATION_STYLE_DESCRIPTIONS[CITATION_STYLES.ENDNOTES] },
          { label: "Footnotes", value: CITATION_STYLES.FOOTNOTES, tooltip: CITATION_STYLE_DESCRIPTIONS[CITATION_STYLES.FOOTNOTES] },
          { label: "Inline", value: CITATION_STYLES.INLINE, tooltip: CITATION_STYLE_DESCRIPTIONS[CITATION_STYLES.INLINE] },
          { label: "Parenthesized", value: CITATION_STYLES.PARENTHESIZED, tooltip: CITATION_STYLE_DESCRIPTIONS[CITATION_STYLES.PARENTHESIZED] },
          { label: "Named", value: CITATION_STYLES.NAMED, tooltip: CITATION_STYLE_DESCRIPTIONS[CITATION_STYLES.NAMED] },
          { label: "No Citations", value: CITATION_STYLES.NONE, tooltip: CITATION_STYLE_DESCRIPTIONS[CITATION_STYLES.NONE] },
        ],
        prefs.citationStyle,
        (next) => GM_setValue("citationStyle", next)
      );

      menu.appendChild(citationSection);

      const outputSection = document.createElement("div");
      outputSection.style.display = "flex";
      outputSection.style.flexDirection = "column";
      outputSection.style.gap = "6px";

      const outputHeading = document.createElement("div");
      outputHeading.textContent = "Output Style";
      outputHeading.style.cssText = "font-size: 13px; font-weight: 700; color: #f9fafb;";
      outputSection.appendChild(outputHeading);

      appendOptionGroup(
        outputSection,
        "Layout",
        [
          { label: "Full (User & Assistant)", value: FORMAT_STYLES.FULL },
          { label: "Concise (content only)", value: FORMAT_STYLES.CONCISE },
        ],
        prefs.formatStyle,
        (next) => GM_setValue("formatStyle", next)
      );

      appendOptionGroup(
        outputSection,
        "Spacing",
        [
          { label: "Standard", value: true, tooltip: "Blank lines between paragraphs for readable rendering" },
          { label: "Compact", value: false, tooltip: "Single newlines only, minimal whitespace" },
        ],
        prefs.addExtraNewlines,
        (next) => GM_setValue("addExtraNewlines", next)
      );

      appendOptionGroup(
        outputSection,
        "Frontmatter",
        [
          { label: "Include", value: true, tooltip: "Include YAML metadata (title, date, source URL) at the top" },
          { label: "Exclude", value: false, tooltip: "Export just the conversation content without metadata" },
        ],
        prefs.includeFrontmatter,
        (next) => GM_setValue("includeFrontmatter", next),
        "YAML metadata section at the top with title, date, and source URL"
      );

      appendOptionGroup(
        outputSection,
        "Title as H1",
        [
          { label: "Include", value: true, tooltip: "Add the conversation title as a level 1 heading" },
          { label: "Exclude", value: false, tooltip: "Don't add title as heading (use frontmatter only)" },
        ],
        prefs.titleAsH1,
        (next) => GM_setValue("titleAsH1", next),
        "Add the conversation title as a # heading at the top"
      );

      menu.appendChild(outputSection);

      const exportSection = document.createElement("div");
      exportSection.style.display = "flex";
      exportSection.style.flexDirection = "column";
      exportSection.style.gap = "6px";

      const exportHeading = document.createElement("div");
      exportHeading.textContent = "Export Options";
      exportHeading.style.cssText = "font-size: 13px; font-weight: 700; color: #f9fafb;";
      exportSection.appendChild(exportHeading);

      appendOptionGroup(
        exportSection,
        "Output Method",
        [
          { label: "Download File", value: EXPORT_METHODS.DOWNLOAD },
          { label: "Copy to Clipboard", value: EXPORT_METHODS.CLIPBOARD },
        ],
        prefs.exportMethod,
        (next) => GM_setValue("exportMethod", next)
      );

      appendOptionGroup(
        exportSection,
        "Extraction Method",
        [
          { label: "Export", value: EXTRACTION_METHODS.EXPORT, tooltip: "Likely to be most reliable, gets all citations. Intercepts Perplexity's Export as Markdown." },
          { label: "Direct", value: EXTRACTION_METHODS.DIRECT_DOM, tooltip: "Parses the content directly, may break with site tweaks. Needs to scroll the page to load all content." },
          { label: "Copy", value: EXTRACTION_METHODS.COPY_BUTTONS, tooltip: "Requires clipboard permissions, scrolls the page to load all content. Currently degraded (requires DOM parsing, misses YouTube citations)." },
        ],
        prefs.extractionMethod,
        (next) => GM_setValue("extractionMethod", next),
        null,
        3
      );

      menu.appendChild(exportSection);
    }

    function openMenu() {
      renderOptionsMenu();
      menu.style.display = "flex";
      optionsButton.setAttribute("aria-expanded", "true");
      optionsButton.style.backgroundColor = "#30b8c6";
      document.addEventListener("mousedown", handleOutsideClick, true);
      document.addEventListener("keydown", handleEscapeKey, true);
    }

    function closeMenu() {
      menu.style.display = "none";
      optionsButton.setAttribute("aria-expanded", "false");
      optionsButton.style.backgroundColor = "#30b8c6";
      document.removeEventListener("mousedown", handleOutsideClick, true);
      document.removeEventListener("keydown", handleEscapeKey, true);
    }

    function toggleMenu() {
      if (menu.style.display === "none" || menu.style.display === "") {
        openMenu();
      } else {
        closeMenu();
      }
    }

    function handleOutsideClick(event) {
      if (!menu.contains(event.target) && !optionsButton.contains(event.target)) {
        closeMenu();
      }
    }

    function handleEscapeKey(event) {
      if (event.key === "Escape") {
        closeMenu();
      }
    }

    optionsButton.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleMenu();
    });

    optionsButton.addEventListener("mouseenter", () => {
      optionsButton.style.backgroundColor = "#30b8c6";
    });

    optionsButton.addEventListener("mouseleave", () => {
      optionsButton.style.backgroundColor = "#30b8c6";
    });

    updateOptionsButtonLabel();
    updateExportButtonLabel();

    const positionContainer = () => {
      let mainContainer = document.querySelector(".max-w-threadContentWidth") || document.querySelector('[class*="threadContentWidth"]');

      if (!mainContainer) {
        const inputArea = document.querySelector("textarea[placeholder]") || document.querySelector('[role="textbox"]') || document.querySelector("form");
        if (inputArea) {
          let parent = inputArea.parentElement;
          while (parent && parent !== document.body) {
            const width = parent.getBoundingClientRect().width;
            if (width > 400 && width < window.innerWidth * 0.8) {
              mainContainer = parent;
              break;
            }
            parent = parent.parentElement;
          }
        }
      }

      if (!mainContainer) {
        mainContainer = document.querySelector("main") || document.querySelector('[role="main"]') || document.querySelector('[class*="main-content"]');
      }

      if (mainContainer) {
        const rect = mainContainer.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        container.style.transition = "none";
        container.style.left = `${centerX}px`;
        container.style.transform = "translateX(-50%)";
        requestAnimationFrame(() => {
          container.style.transition = "left 0.2s";
        });
        console.log("Controls positioned at:", centerX, "Container width:", rect.width, "Container left:", rect.left);
      } else {
        container.style.transition = "none";
        container.style.left = "50%";
        container.style.transform = "translateX(-50%)";
        requestAnimationFrame(() => {
          container.style.transition = "left 0.2s";
        });
      }
    };

    positionContainer();

    window.addEventListener("resize", () => {
      console.log("Window resize detected");
      positionContainer();
    });

    window.addEventListener("orientationchange", () => {
      console.log("Orientation change detected");
      setTimeout(positionContainer, 100);
    });

    const observer = new MutationObserver((mutations) => {
      console.log("DOM mutation detected:", mutations.length, "mutations");
      positionContainer();
    });

    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["class", "style"],
      subtree: false,
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
      subtree: false,
    });

    if (typeof ResizeObserver !== "undefined") {
      const resizeObserver = new ResizeObserver((entries) => {
        console.log("ResizeObserver triggered for", entries.length, "elements");
        positionContainer();
      });

      resizeObserver.observe(document.body);
      resizeObserver.observe(document.documentElement);

      const containers = [
        document.querySelector(".max-w-threadContentWidth"),
        document.querySelector('[class*="threadContentWidth"]'),
        document.querySelector("main"),
        document.querySelector('[role="main"]'),
      ].filter(Boolean);

      containers.forEach((candidate) => {
        console.log("Observing container:", candidate);
        resizeObserver.observe(candidate);
        if (candidate.parentElement) {
          resizeObserver.observe(candidate.parentElement);
        }
      });
    }

    setInterval(() => {
      const currentLeft = parseFloat(container.style.left) || 0;
      const rect = (document.querySelector(".max-w-threadContentWidth") || document.querySelector('[class*="threadContentWidth"]') || document.querySelector("main"))?.getBoundingClientRect();

      if (rect) {
        const expectedX = rect.left + rect.width / 2;
        if (Math.abs(currentLeft - expectedX) > 20) {
          console.log("Periodic check: repositioning controls from", currentLeft, "to", expectedX);
          positionContainer();
        }
      }
    }, 2000);

    exportButton.addEventListener("mouseenter", () => {
      exportButton.style.backgroundColor = "#30b8c6";
    });

    exportButton.addEventListener("mouseleave", () => {
      exportButton.style.backgroundColor = "#30b8c6";
    });

    exportButton.addEventListener("click", async () => {
      const originalText = exportButton.textContent;
      exportButton.textContent = "Exporting...";
      exportButton.disabled = true;
      let keepClipboardStatus = false;

      const removeNavBlocker = installNavBlocker();
      try {
        window.focus();
        await new Promise((resolve) => setTimeout(resolve, 500));

        const prefs = getPreferences();

        if (prefs.exportMethod === EXPORT_METHODS.CLIPBOARD && queuedClipboardContent) {
          keepClipboardStatus = true;
          await copyWithQueuedFocus();
          return;
        }

        const title = document.title.replace(" | Perplexity", "").replace(/ - Perplexity$/, "").trim();
        const safeTitle = title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, " ")
          .replace(/^-+|-+$/g, "");
        const filename = `${safeTitle}.md`;

        // Deep research branch: use export interception instead of DOM scraping
        if (isDeepResearch()) {
          console.log("Deep research detected, using export interception...");
          const markdown = await exportDeepResearch();
          if (!markdown) {
            alert("Failed to export deep research content. Please try again.");
            return;
          }
          if (prefs.exportMethod === EXPORT_METHODS.CLIPBOARD) {
            keepClipboardStatus = true;
            await copyWithQueuedFocus(markdown);
          } else {
            downloadMarkdown(markdown, filename);
          }
          return;
        }

        // Standard conversation export
        const conversation = await extractConversation(prefs.citationStyle);
        if (conversation.length === 0) {
          alert("No conversation content found to export.");
          return;
        }

        const markdown = formatMarkdown(conversation);

        if (prefs.exportMethod === EXPORT_METHODS.CLIPBOARD) {
          keepClipboardStatus = true;
          await copyWithQueuedFocus(markdown);
        } else {
          downloadMarkdown(markdown, filename);
        }
      } catch (error) {
        console.error("Export failed:", error);
        alert("Export failed. Please try again.");
      } finally {
        try {
          removeNavBlocker();
        } catch {}
        if (!keepClipboardStatus && exportButton.textContent !== "Copied!") {
          exportButton.textContent = originalText;
        }
        exportButton.disabled = false;
        closeMenu();
      }
    });

    document.body.appendChild(container);

    // Add focus overlay for when user clicks away during export
    const focusOverlay = document.createElement('div');
    focusOverlay.id = 'perplexity-focus-overlay';
    focusOverlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.7);
      display: none;
      justify-content: center;
      align-items: center;
      z-index: 999999;
      cursor: pointer;
    `;
    focusOverlay.innerHTML = `
      <div style="
        background: #1F2121;
        color: white;
        padding: 24px 32px;
        border-radius: 12px;
        text-align: center;
        box-shadow: 0 12px 24px rgba(0, 0, 0, 0.4);
      ">
        <div id="perplexity-focus-overlay-title" style="font-size: 18px; font-weight: 600; margin-bottom: 8px;">Click here to continue export</div>
        <div id="perplexity-focus-overlay-subtitle" style="font-size: 14px; color: #9ca3af;">Export paused - page needs focus to read clipboard</div>
      </div>
    `;
    focusOverlay.addEventListener('click', () => {
      window.focus();
      if (!queuedClipboardContent) {
        focusOverlay.style.display = 'none';
      }
    });
    document.body.appendChild(focusOverlay);
  }

  // Check if the page has any exportable content (standard conversation or deep research)
  function hasExportableContent() {
    if (document.querySelector(".prose.text-pretty.dark\\:prose-invert") ||
        document.querySelector("[class*='prose'][class*='prose-invert']") ||
        document.querySelector("span[data-lexical-text='true']") ||
        document.querySelector("span.select-text")) {
      return true;
    }
    // Deep research: check for the report card or side panel
    if (isDeepResearch()) return true;
    return false;
  }

  // Initialize the script
  function init() {
    const observer = new MutationObserver(() => {
      if (hasExportableContent() && !document.getElementById("perplexity-export-btn")) {
        addExportButton();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    if (hasExportableContent()) {
      addExportButton();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
