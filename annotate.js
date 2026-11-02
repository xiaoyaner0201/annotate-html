// =============================================================================
// Annotate.js — Standalone visual feedback tool for AI coding agents
// Inspired by Agentation (benjitaylor/agentation), rebuilt for plain HTML.
// No React. No build step. Just drop a <script> tag.
//
// Usage: <script src="annotate.js"></script>
// =============================================================================

(function () {
  "use strict";

  if (typeof window === "undefined") return;

  // ═══════════════════════════════════════════
  // Double-injection guard
  // ═══════════════════════════════════════════
  // If annotate.js has already booted on this page (e.g. Chrome extension
  // clicked twice, or script tag + extension), do NOT build a second toolbar.
  // Instead, ask the existing instance to toggle its visibility and bail.
  if (window.__annotateHtml && typeof window.__annotateHtml.toggle === "function") {
    try { window.__annotateHtml.toggle(); } catch (e) {}
    return;
  }

  const script = document.currentScript;
  const data = script && script.dataset || {};
  let config = Object.assign({lang: 'en', screenshot: false, screenshotPadding: 120,
    maskSelectors: ['[data-annotate-mask]', '.rr-mask', '.rr-block'],
    semanticAttributes: ['data-testid','data-test','data-qa','data-cy','data-action','data-track','data-component'],
    kinds: ['bug','request','agent'], clearOnSubmit: true, context: {}, maxEvents: 20,
    responseHeaders: ['x-request-id','x-trace-id','traceparent']}, window.AnnotateHtmlConfig || {});
  if (data.endpoint) config.endpoint = data.endpoint;
  if (data.lang) config.lang = data.lang;
  if (data.screenshot != null) config.screenshot = data.screenshot === 'true';
  if (data.kinds) config.kinds = data.kinds.split(',');
  if (data.position) config.position = data.position;
  if (data.startHidden != null) config.startHidden = data.startHidden !== 'false';
  const t = (en) => config.lang === 'zh-CN' ? ({Annotate:'标注', 'Change marker color':'更改标记颜色',
    'Show or hide markers':'显示或隐藏标记', 'Copy feedback':'复制反馈', 'Clear all':'清空', Close:'关闭',
    'What should change?':'需要修改什么？', Cancel:'取消', Add:'添加', Save:'保存',
    'Delete annotation':'删除标注', Submit:'提交', Screenshot:'截图', Title:'标题',
    'No annotations':'没有标注', 'Copied to clipboard':'已复制到剪贴板',
    'Submit feedback':'提交反馈', Retry:'重试', bug:'问题', request:'需求', agent:'智能体'}[en] || en) : en;
  const host = document.createElement('annotate-html-widget');
  const root = host.attachShadow({mode:'open'});
  const consoleEvents = [], networkEvents = [];
  const record = (buffer, entry) => { buffer.push(entry); if (buffer.length > config.maxEvents) buffer.shift(); };
  const shorten = value => String(value == null ? '' : value).slice(0, 500);
  const safeUrl = value => { try {
    const u = new URL(String(value), location.href);
    for (const key of [...u.searchParams.keys()]) if (/token|key|secret|password|auth|session|code/i.test(key)) u.searchParams.delete(key);
    u.hash = ''; return u.href;
  } catch (_) { return '[invalid URL]'; } };
  const originalConsole = {};
  ['warn','error'].forEach(level => { const original = console[level]; originalConsole[level] = original;
    console[level] = function (...args) { try { record(consoleEvents, {level, message: shorten(args.map(a => typeof a === 'string' ? a : String(a)).join(' ')), timestamp: new Date().toISOString()}); } catch (_) {} return original.apply(this, args); };
  });
  window.addEventListener('error', e => record(consoleEvents, {level:'error', message:shorten(e.message), stack:shorten(e.error && e.error.stack), timestamp:new Date().toISOString()}));
  window.addEventListener('unhandledrejection', e => record(consoleEvents, {level:'error', message:shorten(e.reason), stack:shorten(e.reason && e.reason.stack), timestamp:new Date().toISOString()}));
  function networkRecord(method, url, status, start, headers) { try {
    const selected = {}; for (const key of config.responseHeaders) { const value = headers && headers.get(key); if (value) selected[key] = shorten(value); }
    record(networkEvents, {method:shorten(method || 'GET'), url:safeUrl(url), status:status || 0, duration:Math.round(performance.now()-start), ok:status >= 200 && status < 400, headers:selected});
  } catch (_) {} }
  if (window.fetch) { const nativeFetch = window.fetch; window.fetch = function (input, init) {
    const start = performance.now(), method = init && init.method || input && input.method || 'GET', url = typeof input === 'string' || input instanceof URL ? input : input && input.url;
    return nativeFetch.apply(this, arguments).then(response => { networkRecord(method,url,response.status,start,response.headers); return response; }, error => { networkRecord(method,url,0,start); throw error; });
  }; }
  const xhrOpen = XMLHttpRequest.prototype.open, xhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method,url) { try { this.__annRequest = {method,url}; } catch (_) {} return xhrOpen.apply(this,arguments); };
  XMLHttpRequest.prototype.send = function() { try { const request=this.__annRequest, start=performance.now(); if(request) this.addEventListener('loadend', () => networkRecord(request.method,request.url,this.status,start,{get:key => this.getResponseHeader(key)}), {once:true}); } catch (_) {} return xhrSend.apply(this,arguments); };

  // ═══════════════════════════════════════════
  // State
  // ═══════════════════════════════════════════
  const state = {
    active: false,
    annotations: [],
    hoveredEl: null,
    detailLevel: "detailed",
    counter: 0,
    markersHidden: false,
    toolbarHidden: false,
    rulerDragging: false,
    markerColor: "#C96442",
  };

  var MARKER_COLORS = [
    "#C96442", "#EF4444", "#F59E0B",
    "#22C55E", "#06B6D4", "#3B82F6", "#8B5CF6",
  ];

  // ═══════════════════════════════════════════
  // Element Identification (ported from agentation)
  // ═══════════════════════════════════════════

  function getElementPath(target, maxDepth) {
    maxDepth = maxDepth || 4;
    const parts = [];
    let current = target;
    let depth = 0;
    while (current && depth < maxDepth) {
      const tag = current.tagName.toLowerCase();
      if (tag === "html" || tag === "body") break;
      let id = tag;
      if (current.id) {
        id = "#" + current.id;
      } else if (current.className && typeof current.className === "string") {
        const cls = current.className
          .split(/\s+/)
          .find(function (c) {
            return c.length > 2 && !c.match(/^[a-z]{1,2}$/) && !c.match(/[A-Z0-9]{5,}/);
          });
        if (cls) id = "." + cls.split("_")[0];
      }
      parts.unshift(id);
      current = current.parentElement;
      depth++;
    }
    return parts.join(" > ");
  }

  function identifyElement(target) {
    const path = getElementPath(target);
    const tag = target.tagName.toLowerCase();

    if (target.dataset && target.dataset.element) return { name: target.dataset.element, path: path };

    // SVG
    if (["path", "circle", "rect", "line", "g", "svg"].indexOf(tag) !== -1) {
      return { name: "graphic element", path: path };
    }
    // Buttons
    if (tag === "button") {
      var text = (target.textContent || "").trim();
      var ariaLabel = target.getAttribute("aria-label");
      if (ariaLabel) return { name: 'button [' + ariaLabel + ']', path: path };
      return { name: text ? 'button "' + text.slice(0, 25) + '"' : "button", path: path };
    }
    // Links
    if (tag === "a") {
      var linkText = (target.textContent || "").trim();
      return { name: linkText ? 'link "' + linkText.slice(0, 25) + '"' : "link", path: path };
    }
    // Inputs
    if (tag === "input") {
      var type = target.getAttribute("type") || "text";
      var ph = target.getAttribute("placeholder");
      if (ph) return { name: 'input "' + ph + '"', path: path };
      return { name: type + " input", path: path };
    }
    // Headings
    if (/^h[1-6]$/.test(tag)) {
      var hText = (target.textContent || "").trim();
      return { name: hText ? tag + ' "' + hText.slice(0, 35) + '"' : tag, path: path };
    }
    // Paragraphs
    if (tag === "p") {
      var pText = (target.textContent || "").trim();
      if (pText) return { name: 'paragraph: "' + pText.slice(0, 40) + (pText.length > 40 ? '...' : '') + '"', path: path };
      return { name: "paragraph", path: path };
    }
    // Spans / labels
    if (tag === "span" || tag === "label") {
      var sText = (target.textContent || "").trim();
      if (sText && sText.length < 40) return { name: '"' + sText + '"', path: path };
      return { name: tag, path: path };
    }
    // Images
    if (tag === "img") {
      var alt = target.getAttribute("alt");
      return { name: alt ? 'image "' + alt.slice(0, 30) + '"' : "image", path: path };
    }
    // Containers
    if (["div", "section", "article", "nav", "header", "footer", "aside", "main"].indexOf(tag) !== -1) {
      var role = target.getAttribute("role");
      var ariaL = target.getAttribute("aria-label");
      if (ariaL) return { name: tag + " [" + ariaL + "]", path: path };
      if (role) return { name: role, path: path };
      if (typeof target.className === "string" && target.className) {
        var words = target.className.split(/[\s_-]+/)
          .map(function (c) { return c.replace(/[A-Z0-9]{5,}.*$/, ""); })
          .filter(function (c) { return c.length > 2; })
          .slice(0, 2);
        if (words.length > 0) return { name: words.join(" "), path: path };
      }
      return { name: tag === "div" ? "container" : tag, path: path };
    }

    return { name: tag, path: path };
  }

  function getNearbyText(el) {
    var texts = [];
    var own = (el.textContent || "").trim();
    if (own && own.length < 100) texts.push(own);
    var prev = el.previousElementSibling;
    if (prev) {
      var pt = (prev.textContent || "").trim();
      if (pt && pt.length < 50) texts.unshift('[before: "' + pt.slice(0, 40) + '"]');
    }
    var next = el.nextElementSibling;
    if (next) {
      var nt = (next.textContent || "").trim();
      if (nt && nt.length < 50) texts.push('[after: "' + nt.slice(0, 40) + '"]');
    }
    return texts.join(" ");
  }

  function getClasses(el) {
    if (typeof el.className !== "string" || !el.className) return "";
    return el.className.split(/\s+/).filter(function (c) { return c.length > 0; }).join(", ");
  }

  function getComputedSnapshot(el) {
    var s = window.getComputedStyle(el);
    var parts = [];
    if (s.color && s.color !== "rgb(0, 0, 0)") parts.push("color: " + s.color);
    var bg = s.backgroundColor;
    if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") parts.push("bg: " + bg);
    if (s.fontSize) parts.push("font: " + s.fontSize);
    if (s.fontWeight && s.fontWeight !== "400" && s.fontWeight !== "normal") parts.push("weight: " + s.fontWeight);
    if (s.padding && s.padding !== "0px") parts.push("padding: " + s.padding);
    if (s.margin && s.margin !== "0px") parts.push("margin: " + s.margin);
    var d = s.display;
    if (d && d !== "block" && d !== "inline") parts.push("display: " + d);
    if (s.position && s.position !== "static") parts.push("position: " + s.position);
    if (s.borderRadius && s.borderRadius !== "0px") parts.push("radius: " + s.borderRadius);
    return parts.join(", ");
  }

  function getFullPath(el) {
    var parts = [];
    var cur = el;
    while (cur && cur.tagName && cur.tagName.toLowerCase() !== "html") {
      var tag = cur.tagName.toLowerCase();
      var ident = tag;
      if (cur.id) ident = tag + "#" + cur.id;
      else if (cur.className && typeof cur.className === "string") {
        var cls = cur.className.split(/\s+/).find(function (c) { return c.length > 2; });
        if (cls) ident = tag + "." + cls;
      }
      parts.unshift(ident);
      cur = cur.parentElement;
    }
    return parts.join(" > ");
  }

  function getA11yInfo(el) {
    var parts = [];
    var role = el.getAttribute("role");
    var ariaLabel = el.getAttribute("aria-label");
    var tabIndex = el.getAttribute("tabindex");
    var ariaHidden = el.getAttribute("aria-hidden");
    if (role) parts.push('role="' + role + '"');
    if (ariaLabel) parts.push('aria-label="' + ariaLabel + '"');
    if (tabIndex) parts.push("tabindex=" + tabIndex);
    if (ariaHidden === "true") parts.push("aria-hidden");
    if (el.matches("a, button, input, select, textarea, [tabindex]")) parts.push("focusable");
    return parts.join(", ");
  }

  // ═══════════════════════════════════════════
  // Output Generation (ported from agentation)
  // ═══════════════════════════════════════════

  function generateOutput() {
    if (state.annotations.length === 0) return "";
    var viewport = window.innerWidth + "\u00d7" + window.innerHeight;
    var pathname = window.location.pathname;
    var dl = state.detailLevel;
    var out = "## Page Feedback: " + pathname + "\n";

    if (dl === "forensic") {
      out += "\n**Environment:**\n";
      out += "- Viewport: " + viewport + "\n";
      out += "- URL: " + window.location.href + "\n";
      out += "- Timestamp: " + new Date().toISOString() + "\n";
      out += "\n---\n";
    } else if (dl !== "compact") {
      out += "**Viewport:** " + viewport + "\n";
    }
    out += "\n";

    state.annotations.forEach(function (a, i) {
      if (dl === "compact") {
        out += (i + 1) + ". **" + a.element + "**: " + a.comment;
        if (a.selectedText) out += ' (re: "' + a.selectedText.slice(0, 30) + '")';
        out += "\n";
      } else if (dl === "forensic") {
        out += "### " + (i + 1) + ". " + a.element + "\n";
        if (a.fullPath) out += "**Full DOM Path:** " + a.fullPath + "\n";
        if (a.cssClasses) out += "**CSS Classes:** " + a.cssClasses + "\n";
        if (a.boundingBox) {
          var bb = a.boundingBox;
          out += "**Position:** x:" + Math.round(bb.x) + ", y:" + Math.round(bb.y) +
            " (" + Math.round(bb.width) + "\u00d7" + Math.round(bb.height) + "px)\n";
        }
        if (a.selectedText) out += '**Selected text:** "' + a.selectedText + '"\n';
        if (a.nearbyText && !a.selectedText) out += "**Context:** " + a.nearbyText.slice(0, 100) + "\n";
        if (a.computedStyles) out += "**Computed Styles:** " + a.computedStyles + "\n";
        if (a.accessibility) out += "**Accessibility:** " + a.accessibility + "\n";
        out += "**Feedback:** " + a.comment + "\n\n";
      } else {
        out += "### " + (i + 1) + ". " + a.element + "\n";
        out += "**Location:** " + a.elementPath + "\n";
        if (dl === "detailed") {
          if (a.cssClasses) out += "**Classes:** " + a.cssClasses + "\n";
          if (a.boundingBox) {
            var b = a.boundingBox;
            out += "**Position:** " + Math.round(b.x) + "px, " + Math.round(b.y) +
              "px (" + Math.round(b.width) + "\u00d7" + Math.round(b.height) + "px)\n";
          }
          if (a.nearbyText && !a.selectedText) out += "**Context:** " + a.nearbyText.slice(0, 100) + "\n";
        }
        if (a.selectedText) out += '**Selected text:** "' + a.selectedText + '"\n';
        out += "**Feedback:** " + a.comment + "\n\n";
      }
    });

    return out.trim();
  }

  // ═══════════════════════════════════════════
  // UI — Styles (injected once)
  // ═══════════════════════════════════════════

  function injectStyles() {
    var css = [
      // Design tokens (Claude-native palette)
      // --ann-bg:        #FAF9F5  cream surface
      // --ann-bg-alt:    #F5F4ED  recessed surface
      // --ann-ink:       #1F1E1D  primary text
      // --ann-ink-mute:  #75726B  secondary text
      // --ann-line:      rgba(31,30,29,.08) hairline
      // --ann-accent:    #C96442  Claude orange
      // --ann-accent-bg: rgba(201,100,66,.10)

      // Toolbar
      '#ann-toolbar{position:fixed;bottom:24px;right:24px;z-index:99999;',
      'font-family:ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;',
      '-webkit-font-smoothing:antialiased;font-feature-settings:"ss01","cv11";',
      'font-size:13px;display:flex;align-items:center;gap:4px;',
      'background:#FAF9F5;color:#1F1E1D;padding:6px;border-radius:14px;',
      'height:44px;max-width:600px;overflow:hidden;',
      'border:1px solid rgba(31,30,29,.08);',
      'box-shadow:0 1px 2px rgba(31,30,29,.04),0 8px 24px rgba(31,30,29,.10);',
      'transition:max-width .36s cubic-bezier(.65,0,.35,1),',
      'padding .36s cubic-bezier(.65,0,.35,1),',
      'border-radius .36s cubic-bezier(.65,0,.35,1),',
      'box-shadow .25s ease;',
      'user-select:none;cursor:grab}',
      '#ann-toolbar.ann-dragging,#ann-toolbar.ann-dragging *{cursor:grabbing !important}',

      // Collapsed (round button) state — same element morphs
      '#ann-toolbar.collapsed{max-width:44px;padding:0;border-radius:50%;',
      'overflow:visible;justify-content:center;cursor:grab;',
      'box-shadow:0 1px 2px rgba(31,30,29,.04),0 6px 18px rgba(31,30,29,.10)}',
      '@media (hover:hover){#ann-toolbar.collapsed:hover{',
      'box-shadow:0 2px 4px rgba(31,30,29,.06),0 10px 28px rgba(31,30,29,.14)}}',

      // Children fade — fast out on collapse, delayed in on expand
      '#ann-toolbar > *:not(.ann-collapsed-view){',
      'opacity:1;transition:opacity .15s ease .22s}',
      '#ann-toolbar.collapsed > *:not(.ann-collapsed-view){',
      'opacity:0;pointer-events:none;transition:opacity .12s ease 0s}',

      // The collapsed face — pencil icon + badge, sits absolute over the row
      '.ann-collapsed-view{position:absolute;inset:0;display:flex;align-items:center;',
      'justify-content:center;color:#C96442;pointer-events:none;opacity:0;',
      'transition:opacity .14s ease 0s}',
      '#ann-toolbar.collapsed .ann-collapsed-view{opacity:1;pointer-events:auto;',
      'transition:opacity .14s ease .22s}',
      '.ann-collapsed-view svg{width:18px;height:18px;display:block}',
      '.ann-collapsed-view .ann-collapsed-badge{position:absolute;top:-4px;right:-4px;',
      'background:#C96442;color:#FAF9F5;border:1.5px solid #FAF9F5;',
      'border-radius:100px;min-width:17px;height:17px;padding:0 4px;',
      'font-size:10px;font-weight:600;font-variant-numeric:tabular-nums;',
      'display:flex;align-items:center;justify-content:center;line-height:1;',
      'pointer-events:none;transform-origin:center;',
      'transition:transform .2s cubic-bezier(.2,.8,.2,1)}',
      '.ann-collapsed-view .ann-collapsed-badge.empty{display:none}',
      '.ann-collapsed-view .ann-collapsed-badge.bump{animation:ann-badge-pop .35s cubic-bezier(.2,.8,.2,1)}',


      '#ann-toolbar button{background:none;border:none;color:#1F1E1D;cursor:pointer;',
      'padding:7px 10px;border-radius:9px;font-size:13px;font-weight:500;font-family:inherit;',
      'transition:background .15s ease,color .15s ease,transform .1s ease;',
      'display:inline-flex;align-items:center;gap:6px;white-space:nowrap;line-height:1}',
      '#ann-toolbar button svg{width:18px;height:18px;flex-shrink:0;display:block}',
      '@media (hover:hover){#ann-toolbar button:hover{background:#F0EEE6;color:#1F1E1D}}',
      '#ann-toolbar button:active{transform:scale(.97)}',
      '#ann-toolbar button.active{background:rgba(201,100,66,.10);color:#C96442}',
      '#ann-toolbar button.icon-only{padding:7px}',

      // Eye-toggle button with corner badge
      '#ann-toolbar .ann-eye-btn{position:relative}',
      '#ann-toolbar .ann-eye-badge{position:absolute;top:-3px;right:-3px;',
      'background:#C96442;color:#FAF9F5;border:1.5px solid #FAF9F5;',
      'border-radius:100px;min-width:17px;height:17px;padding:0 4px;',
      'font-size:10px;font-weight:600;font-variant-numeric:tabular-nums;',
      'display:flex;align-items:center;justify-content:center;line-height:1;',
      'pointer-events:none;transform-origin:center;',
      'transition:transform .2s cubic-bezier(.2,.8,.2,1)}',
      '#ann-toolbar .ann-eye-badge.empty{display:none}',
      '#ann-toolbar .ann-eye-btn.hidden-state{color:#75726B}',
      // pop on increment
      '@keyframes ann-badge-pop{0%{transform:scale(1)}40%{transform:scale(1.25)}100%{transform:scale(1)}}',
      '#ann-toolbar .ann-eye-badge.bump{animation:ann-badge-pop .35s cubic-bezier(.2,.8,.2,1)}',

      // Copy success state
      '#ann-toolbar button.success{background:rgba(34,165,90,.10)}',
      '#ann-toolbar button.success svg{color:inherit}',

      // Color swatch (toolbar circle)
      '#ann-toolbar .ann-color-swatch{width:22px;height:22px;border-radius:50%;cursor:pointer;',
      'border:2px solid rgba(31,30,29,.10);flex-shrink:0;',
      'transition:transform .15s ease,border-color .15s ease}',
      '@media (hover:hover){#ann-toolbar .ann-color-swatch:hover{transform:scale(1.1);',
      'border-color:rgba(31,30,29,.25)}}',
      '#ann-toolbar .ann-color-swatch:active{transform:scale(.95)}',

      // Color picker popover
      '#ann-color-picker{position:fixed;z-index:99998;',
      'background:#FAF9F5;border:1px solid rgba(31,30,29,.08);',
      'border-radius:12px;padding:10px 14px;',
      'box-shadow:0 1px 2px rgba(31,30,29,.04),0 12px 32px rgba(31,30,29,.14);',
      'display:flex;gap:8px;align-items:center;',
      'animation:ann-popup-in .2s cubic-bezier(.2,.8,.2,1) both}',
      '.ann-color-opt{width:28px;height:28px;border-radius:50%;cursor:pointer;',
      'flex-shrink:0;border:none;padding:0;',
      'transition:transform .12s ease}',
      '@media (hover:hover){.ann-color-opt:hover{transform:scale(1.15)}}',
      '.ann-color-opt:active{transform:scale(.92)}',
      '.ann-color-opt.active{box-shadow:0 0 0 2px #FAF9F5,0 0 0 3.5px #1F1E1D}',

      // Custom toolbar tooltip (pops above)
      '#ann-tip{position:fixed;z-index:100000;',
      'background:#FAF9F5;border:1px solid rgba(31,30,29,.08);',
      'border-radius:8px;padding:5px 10px;',
      'box-shadow:0 2px 12px rgba(31,30,29,.12);',
      'font-family:ui-sans-serif,-apple-system,system-ui,sans-serif;',
      '-webkit-font-smoothing:antialiased;',
      'font-size:12px;font-weight:500;color:#1F1E1D;',
      'white-space:nowrap;pointer-events:none;',
      'opacity:0;transform:translateX(-50%) translateY(4px);',
      'transition:opacity .1s ease,transform .1s ease}',
      '#ann-tip.show{opacity:1;transform:translateX(-50%) translateY(0)}',
      '#ann-tip .ann-tip-key{color:#9A968E;margin-left:6px;font-size:11px;font-weight:400}',
      "#ann-tip::after{content:'';position:absolute;bottom:-5px;left:50%;",
      'transform:translateX(-50%);',
      'border-left:5px solid transparent;border-right:5px solid transparent;',
      'border-top:5px solid #FAF9F5}',

      '#ann-toolbar .ann-divider{width:1px;height:18px;background:rgba(31,30,29,.10);margin:0 2px}',

      '#ann-toolbar select{appearance:none;-webkit-appearance:none;-moz-appearance:none;',
      'background-color:#F5F4ED;',
      'background-repeat:no-repeat;background-position:right 9px center;',
      'border:1px solid rgba(31,30,29,.08);',
      'color:#1F1E1D;border-radius:8px;padding:5px 26px 5px 10px;',
      'font-size:12px;font-weight:500;line-height:1.4;',
      'font-family:inherit;cursor:pointer;transition:border-color .15s ease}',
      '#ann-toolbar select:hover{border-color:rgba(31,30,29,.18)}',
      '#ann-toolbar select:focus{outline:none;border-color:#C96442}',
      '#ann-toolbar select::-ms-expand{display:none}',

      // Hover highlight
      '#ann-hover-highlight{position:fixed;z-index:99990;pointer-events:none;',
      'border:1.5px solid #C96442;border-radius:4px;',
      'background:rgba(201,100,66,.04);',
      'transition:all .12s cubic-bezier(.2,.8,.2,1)}',

      // Hover label
      '#ann-hover-label{position:fixed;z-index:99991;pointer-events:none;',
      'background:#1F1E1D;color:#FAF9F5;',
      'padding:5px 10px;border-radius:7px;font-size:11px;font-weight:500;',
      'font-family:ui-monospace,SFMono-Regular,Menlo,monospace;',
      'white-space:nowrap;box-shadow:0 4px 16px rgba(31,30,29,.18)}',

      // Markers — outer wrapper handles position + entry pop only (no visual)
      '.ann-marker{position:absolute;z-index:99992;width:24px;height:24px;',
      'cursor:pointer;overflow:visible;',
      'transform:translate(-50%,-50%);',
      'animation:ann-pop .3s cubic-bezier(.2,.8,.2,1) backwards}',
      // Inner circle — the actual visible pin, scales on hover
      '.ann-marker-circle{cursor:pointer;width:24px;height:24px;border-radius:50%;',
      'background:#C96442;color:#FAF9F5;',
      'font-size:11px;font-weight:600;font-variant-numeric:tabular-nums;',
      'display:flex;align-items:center;justify-content:center;',
      'border:2px solid #FAF9F5;box-sizing:border-box;',
      'box-shadow:0 1px 2px rgba(31,30,29,.10),0 4px 12px rgba(201,100,66,.30);',
      'font-family:ui-sans-serif,-apple-system,system-ui,sans-serif;',
      'transform-origin:center;',
      'transition:transform .2s cubic-bezier(.2,.8,.2,1),box-shadow .2s ease}',
      '.ann-marker .ann-marker-num,.ann-marker .ann-marker-edit{',
      'display:flex;align-items:center;justify-content:center;line-height:1}',
      '.ann-marker .ann-marker-edit{display:none}',
      '.ann-marker .ann-marker-edit svg{width:13px;height:13px;display:block}',
      '@media (hover:hover){.ann-marker:hover .ann-marker-circle{',
      'transform:scale(1.3);',
      'box-shadow:0 2px 4px rgba(31,30,29,.12),0 8px 22px rgba(201,100,66,.42)}',
      '.ann-marker:hover .ann-marker-num{display:none}',
      '.ann-marker:hover .ann-marker-edit{display:flex}}',
      '@keyframes ann-pop{from{transform:translate(-50%,-50%) scale(.8);opacity:0}',
      'to{transform:translate(-50%,-50%) scale(1);opacity:1}}',

      // Marker tooltip
      '.ann-marker-tip{position:absolute;left:30px;top:50%;transform:translateY(-50%);',
      'background:#FAF9F5;color:#1F1E1D;',
      'padding:10px 12px;border-radius:10px;font-size:12px;min-width:200px;max-width:320px;',
      'border:1px solid rgba(31,30,29,.08);',
      'box-shadow:0 1px 2px rgba(31,30,29,.04),0 12px 32px rgba(31,30,29,.14);',
      'pointer-events:none;white-space:normal;line-height:1.5;text-wrap:pretty;',
      'opacity:0;transition:opacity .15s}',
      '.ann-marker:hover .ann-marker-tip{opacity:1}',
      '.ann-marker-tip .ann-tip-element{color:#9A968E;font-size:11px;',
      'font-family:ui-monospace,SFMono-Regular,Menlo,monospace;',
      'display:block;margin-bottom:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.ann-marker-tip .ann-tip-comment{color:#1F1E1D;font-size:12px;line-height:1.5}',

      // Popup (comment input)
      '#ann-popup{position:fixed;z-index:99998;background:#FAF9F5;',
      'border:1px solid rgba(31,30,29,.08);',
      'border-radius:14px;padding:18px;min-width:320px;max-width:400px;',
      'box-shadow:0 1px 2px rgba(31,30,29,.04),0 16px 48px rgba(31,30,29,.16);',
      'font-family:ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;',
      '-webkit-font-smoothing:antialiased;',
      'animation:ann-popup-in .2s cubic-bezier(.2,.8,.2,1) both}',
      '@keyframes ann-popup-in{from{transform:translateY(4px) scale(.98);opacity:0}',
      'to{transform:translateY(0) scale(1);opacity:1}}',

      // Header — inline chevron + element name
      '#ann-popup .ann-popup-header{display:flex;align-items:center;gap:5px;',
      'margin-bottom:8px;cursor:pointer;user-select:none}',
      '#ann-popup .ann-popup-chevron{color:#9A968E;flex-shrink:0;',
      'width:14px;height:14px;display:block;',
      'transition:transform .15s ease;transform:rotate(-90deg)}',
      '#ann-popup .ann-popup-header.expanded .ann-popup-chevron{transform:rotate(0deg)}',
      '#ann-popup .ann-popup-label{color:#1F1E1D;font-size:13px;font-weight:400;',
      'font-family:ui-sans-serif,-apple-system,system-ui,sans-serif;',
      'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}',

      // Computed styles block (shown when header expanded)
      '#ann-popup .ann-popup-styles{display:none;',
      'background:#F5F4ED;border:1px solid rgba(31,30,29,.06);',
      'border-radius:8px;padding:10px 12px;margin-bottom:12px;',
      'font-family:ui-monospace,SFMono-Regular,Menlo,monospace;',
      'font-size:12px;line-height:1.7;word-break:break-word}',
      '#ann-popup .ann-popup-header.expanded ~ .ann-popup-styles{display:block}',
      '#ann-popup .ann-popup-styles .ann-prop{color:#C96442}',
      '#ann-popup .ann-popup-styles .ann-val{color:#1F1E1D}',

      '#ann-popup textarea{width:100%;background:#F5F4ED;border:1px solid rgba(31,30,29,.08);',
      'color:#1F1E1D;border-radius:9px;padding:10px 12px;font-size:13px;',
      'font-family:inherit;-webkit-font-smoothing:antialiased;',
      'resize:vertical;min-height:64px;outline:none;line-height:1.55;',
      'transition:border-color .15s ease,background .15s ease}',
      '#ann-popup textarea::placeholder{color:#A8A49B}',
      '#ann-popup textarea:focus{border-color:#C96442;background:#FAF9F5}',

      '#ann-popup .ann-popup-actions{display:flex;gap:8px;margin-top:12px;align-items:center;',
      'justify-content:flex-end}',
      '#ann-popup .ann-popup-actions .ann-spacer{flex:1}',

      '#ann-popup .ann-popup-actions button{background:transparent;border:none;',
      'color:#75726B;border-radius:9px;padding:8px 16px;font-size:13px;font-weight:500;',
      'cursor:pointer;font-family:inherit;',
      'transition:background .15s,color .15s,transform .1s}',
      '@media (hover:hover){#ann-popup .ann-popup-actions button:hover{color:#1F1E1D}}',
      '#ann-popup .ann-popup-actions button:active{transform:scale(.97)}',
      '#ann-popup .ann-popup-actions button.primary{background:#C96442;',
      'color:#FAF9F5;border-radius:100px;padding:8px 20px}',
      '@media (hover:hover){#ann-popup .ann-popup-actions button.primary:hover{background:#B5573A}}',
      '#ann-popup .ann-popup-actions button.icon-only{padding:7px;color:#9A968E}',
      '#ann-popup .ann-popup-actions button.icon-only svg{width:15px;height:15px;display:block}',
      '@media (hover:hover){#ann-popup .ann-popup-actions button.icon-only:hover{',
      'background:rgba(201,100,66,.10);color:#C96442}}',

      // Copied toast
      '#ann-toast{position:fixed;top:24px;left:50%;transform:translateX(-50%) translateY(-12px);',
      'z-index:99999;background:#1F1E1D;color:#FAF9F5;padding:10px 18px;',
      'border-radius:100px;font-size:13px;font-weight:500;',
      'font-family:ui-sans-serif,-apple-system,system-ui,sans-serif;',
      '-webkit-font-smoothing:antialiased;',
      'box-shadow:0 1px 2px rgba(31,30,29,.10),0 12px 32px rgba(31,30,29,.24);',
      'opacity:0;transition:all .25s cubic-bezier(.2,.8,.2,1);pointer-events:none;',
      'display:inline-flex;align-items:center;gap:8px}',
      '#ann-toast svg{width:14px;height:14px;color:#C96442}',
      '#ann-toast.show{opacity:1;transform:translateX(-50%) translateY(0)}',

      // Rulers — hidden by default, slide in on edge hover
      // Base state defines EXIT transition (short, ease-in — subtle retreat)
      '#ann-ruler-h,#ann-ruler-v{position:fixed;z-index:99988;',
      'background:rgba(250,249,245,.92);backdrop-filter:blur(6px);',
      'cursor:crosshair;pointer-events:none;',
      'opacity:0;transition:opacity .15s ease-in,transform .15s ease-in}',
      '#ann-ruler-h{top:0;left:19px;right:0;height:20px;',
      'border-bottom:1px solid rgba(31,30,29,.08);',
      'transform:translateY(-100%)}',
      '#ann-ruler-v{top:19px;left:0;bottom:0;width:20px;',
      'border-right:1px solid rgba(31,30,29,.08);',
      'transform:translateX(-100%)}',
      '#ann-ruler-corner{position:fixed;z-index:99989;top:0;left:0;width:20px;height:20px;',
      'background:rgba(250,249,245,.92);backdrop-filter:blur(6px);',
      'border-right:1px solid rgba(31,30,29,.08);',
      'border-bottom:1px solid rgba(31,30,29,.08);',
      'pointer-events:none;opacity:0;transform:scale(.9);',
      'transition:opacity .15s ease-in,transform .15s ease-in}',
      // Show state defines ENTER transition (longer, bouncy easing — confident slide-in)
      '#ann-ruler-h.ann-ruler-show{opacity:1;transform:translateY(0);pointer-events:auto;',
      'transition:opacity .3s cubic-bezier(.2,.8,.2,1),transform .3s cubic-bezier(.2,.8,.2,1)}',
      '#ann-ruler-v.ann-ruler-show{opacity:1;transform:translateX(0);pointer-events:auto;',
      'transition:opacity .3s cubic-bezier(.2,.8,.2,1),transform .3s cubic-bezier(.2,.8,.2,1)}',
      '#ann-ruler-corner.ann-ruler-show{opacity:1;transform:scale(1);pointer-events:auto;',
      'transition:opacity .3s cubic-bezier(.2,.8,.2,1),transform .3s cubic-bezier(.2,.8,.2,1)}',
      '#ann-ruler-h canvas,#ann-ruler-v canvas{display:block}',

      // Guide lines (dropped from rulers)
      '.ann-guide{position:fixed;z-index:99987;pointer-events:auto}',
      '.ann-guide-h{left:0;right:0;height:0;padding:4px 0;border-top:1px solid;',
      'cursor:ns-resize;background:none !important;box-sizing:content-box}',
      '.ann-guide-v{top:0;bottom:0;width:0;padding:0 4px;border-left:1px solid;',
      'cursor:ew-resize;background:none !important;box-sizing:content-box}',
      // Guide handle (drag affordance + label + close)
      '.ann-guide-handle{position:absolute;display:flex;align-items:center;gap:2px;',
      'background:#FAF9F5;border:1px solid rgba(31,30,29,.10);',
      'border-radius:6px;padding:3px 3px 3px 8px;',
      'box-shadow:0 1px 6px rgba(31,30,29,.10);',
      'cursor:grab;user-select:none;',
      'font-family:ui-monospace,SFMono-Regular,Menlo,monospace;',
      'font-size:10px;font-weight:500;color:#1F1E1D;white-space:nowrap;',
      'font-variant-numeric:tabular-nums;',
      'opacity:0;transition:opacity .15s ease}',
      '.ann-guide:hover .ann-guide-handle,.ann-guide-handle.dragging{opacity:1}',
      '.ann-guide-handle:active{cursor:grabbing}',
      '.ann-guide-h .ann-guide-handle{left:24px;top:50%;transform:translateY(-50%)}',
      '.ann-guide-v .ann-guide-handle{top:24px;left:50%;transform:translateX(-50%)}',
      '.ann-guide-close{background:none;border:none;color:#9A968E;cursor:pointer;',
      'padding:2px;border-radius:4px;display:flex;align-items:center;justify-content:center;',
      'transition:color .12s,background .12s}',
      '@media (hover:hover){.ann-guide-close:hover{background:rgba(31,30,29,.08);color:#1F1E1D}}',
      '.ann-guide-close svg{width:12px;height:12px;display:block}',
      // Wider invisible hit area on the line itself
      '.ann-guide::before{content:"";position:absolute}',
      '.ann-guide-h::before{left:0;right:0;top:-4px;bottom:-4px}',
      '.ann-guide-v::before{top:0;bottom:0;left:-4px;right:-4px}',

      '#ann-submit{position:fixed;bottom:90px;right:24px;z-index:99998;background:#FAF9F5}',
      '#ann-popup.ann-submit-form{display:flex;flex-direction:column;gap:12px;min-width:320px}',
      '#ann-popup.ann-submit-form input,#ann-popup.ann-submit-form select{background:#F5F4ED;color:#1F1E1D;border:1px solid #ddd;border-radius:9px;padding:9px;font:inherit}',
      '#ann-popup label{display:flex;gap:7px;align-items:center;font-size:12px;color:#75726B;margin-top:8px}',
      '#ann-popup .ann-preview{max-width:120px;max-height:80px;object-fit:contain;border-radius:6px;margin-top:8px}',
      '#ann-markers{position:absolute;top:0;left:0;width:0;height:0;overflow:visible;z-index:99992}',
      // Reduced motion
      '@media (prefers-reduced-motion:reduce){',
      '#ann-toolbar,#ann-popup,#ann-toast,.ann-marker,#ann-hover-highlight,',
      '#ann-ruler-h,#ann-ruler-v,#ann-ruler-corner{',
      'transition:none !important;animation:none !important}}',
    ].join("\n");
    if ('adoptedStyleSheets' in root) {
      const sheet = new CSSStyleSheet(); sheet.replaceSync(':host{all:initial;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;font-family:system-ui,sans-serif;color:#1F1E1D} :host *{box-sizing:border-box} #ann-toolbar,#ann-popup,#ann-submit,#ann-color-picker,.ann-marker,.ann-guide,#ann-ruler-h,#ann-ruler-v,#ann-tip{pointer-events:auto} ' + css);
      root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
    } else if (config.styleNonce) { const style=document.createElement('style'); style.nonce=config.styleNonce; style.textContent=css; root.appendChild(style);
    } else if (config.cssUrl) { const link=document.createElement('link'); link.rel='stylesheet'; link.href=config.cssUrl; root.appendChild(link); }
    else throw new Error('Constructable stylesheets unavailable: supply styleNonce or cssUrl');
  }

  // ═══════════════════════════════════════════
  // UI — DOM helpers
  // ═══════════════════════════════════════════

  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === "className") e.className = attrs[k];
      else if (k.startsWith("on")) e.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
      else e.setAttribute(k, typeof attrs[k] === "string" ? t(attrs[k]) : attrs[k]);
    });
    if (children) {
      if (typeof children === "string") e.textContent = t(children);
      else if (Array.isArray(children)) children.forEach(function (c) { if (c) e.appendChild(c); });
      else e.appendChild(children);
    }
    return e;
  }

  // ═══════════════════════════════════════════
  // Icons (Lucide — ISC license, inlined for zero-dep)
  // ═══════════════════════════════════════════

  var ICON_ATTRS = 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ' +
    'fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';

  var ICONS = {
    // square-pen (toolbar Annotate button + collapsed face)
    pencil: '<svg ' + ICON_ATTRS + '>' +
      '<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>' +
      '<path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"/>' +
      '</svg>',
    // plain pencil (marker hover edit)
    pencilPlain: '<svg ' + ICON_ATTRS + '>' +
      '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/>' +
      '<path d="m15 5 4 4"/>' +
      '</svg>',
    // copy
    copy: '<svg ' + ICON_ATTRS + '>' +
      '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>' +
      '<path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>' +
      '</svg>',
    // trash-2
    trash: '<svg ' + ICON_ATTRS + '>' +
      '<path d="M3 6h18"/>' +
      '<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>' +
      '<path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>' +
      '<line x1="10" x2="10" y1="11" y2="17"/>' +
      '<line x1="14" x2="14" y1="11" y2="17"/>' +
      '</svg>',
    // x
    x: '<svg ' + ICON_ATTRS + '>' +
      '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>' +
      '</svg>',
    // check
    check: '<svg ' + ICON_ATTRS + '>' +
      '<path d="M20 6 9 17l-5-5"/>' +
      '</svg>',
    // eye
    eye: '<svg ' + ICON_ATTRS + '>' +
      '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/>' +
      '<circle cx="12" cy="12" r="3"/>' +
      '</svg>',
    // eye-off
    eyeOff: '<svg ' + ICON_ATTRS + '>' +
      '<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/>' +
      '<path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/>' +
      '<path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/>' +
      '<path d="m2 2 20 20"/>' +
      '</svg>',
    // chevron-right
    chevronRight: '<svg ' + ICON_ATTRS + '>' +
      '<path d="m9 18 6-6-6-6"/>' +
      '</svg>',
    // chevron-down
    chevronDown: '<svg ' + ICON_ATTRS + '>' +
      '<path d="m6 9 6 6 6-6"/>' +
      '</svg>',
    // asterisk logo mark
    asterisk: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 155 157" fill="currentColor" aria-hidden="true">' +
      '<path d="M58.8282 156.513L62.2248 103.934L18.2055 133.416L0 101.353L47.4158 78.2565L0 55.1599L18.2055 23.0965L62.2248 52.5786L58.8282 0H95.3751L91.8427 52.5786L135.862 23.0965L154.067 55.1599L106.787 78.2565L154.067 101.353L135.862 133.416L91.8427 103.934L95.3751 156.513H58.8282Z"/>' +
      '</svg>',
    // check-circle filled (for copy success)
    checkCircleFilled: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true">' +
      '<circle cx="12" cy="12" r="10" fill="#22A55A"/>' +
      '<path d="m8.5 12.5 2.5 2.5 4.5-5" fill="none" stroke="#FAF9F5" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>' +
      '</svg>',
  };

  function iconEl(name) {
    var span = document.createElement("span");
    span.innerHTML = ICONS[name];
    return span.firstChild;
  }

  // ═══════════════════════════════════════════
  // UI — Toolbar
  // ═══════════════════════════════════════════

  var toolbar, hoverHighlight, hoverLabel, popup, toast;
  var markersContainer;
  var eyeBtn, eyeIconWrap, eyeBadge, copyBtn;
  var collapsedView, collapsedBadge;
  var colorSwatch, colorPicker;
  var accentSheet;
  var tipEl;

  function cursorSvg(hex) {
    var encoded = hex.replace("#", "%23");
    return "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 155 157' fill='none'%3E%3Cpath d='M58.8282 156.513L62.2248 103.934L18.2055 133.416L0 101.353L47.4158 78.2565L0 55.1599L18.2055 23.0965L62.2248 52.5786L58.8282 0H95.3751L91.8427 52.5786L135.862 23.0965L154.067 55.1599L106.787 78.2565L154.067 101.353L135.862 133.416L91.8427 103.934L95.3751 156.513H58.8282Z' fill='" + encoded + "'/%3E%3C/svg%3E\") 14 14,crosshair";
  }

  function darkenHex(hex, amt) {
    var r = Math.max(0, parseInt(hex.slice(1, 3), 16) - amt);
    var g = Math.max(0, parseInt(hex.slice(3, 5), 16) - amt);
    var b = Math.max(0, parseInt(hex.slice(5, 7), 16) - amt);
    return "#" + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
  }

  function updateAccentColor(hex) {
    state.markerColor = hex;
    if (colorSwatch) colorSwatch.style.background = hex;

    if (!accentSheet) { accentSheet = new CSSStyleSheet(); root.adoptedStyleSheets = [...root.adoptedStyleSheets, accentSheet]; }
    var bg10 = hex + "1A";   // 10%
    var bg42 = hex + "6B";   // 42%
    var dark = darkenHex(hex, 20);

    accentSheet.replaceSync([
      "#ann-toolbar button.active{background:" + bg10 + ";color:" + hex + "}",
      "#ann-toolbar .ann-eye-badge{background:" + hex + "}",
      ".ann-collapsed-view{color:" + hex + "}",
      ".ann-collapsed-view .ann-collapsed-badge{background:" + hex + "}",
      "#ann-popup .ann-popup-label{color:" + hex + "}",
      "#ann-popup .ann-popup-header.expanded .ann-popup-chevron{color:" + hex + "}",
      "#ann-popup textarea:focus{border-color:" + hex + "}",
      "#ann-popup .ann-popup-actions button.primary{background:" + hex + ";border-color:" + hex + "}",
      "#ann-toast svg{color:" + hex + "}",
      "@media (hover:hover){",
      "#ann-popup .ann-popup-actions button.primary:hover{background:" + dark + ";border-color:" + dark + "}",
      "#ann-popup .ann-popup-actions button.icon-only:hover{background:" + bg10 + ";color:" + hex + "}",
      ".ann-marker:hover .ann-marker-circle{box-shadow:0 2px 4px rgba(31,30,29,.12),0 8px 22px " + bg42 + "}}",
    ].join("\n"));

    renderMarkers();
  }

  function addTip(target, text, key) {
    target.addEventListener("mouseenter", function () {
      if (!tipEl) return;
      tipEl.innerHTML = escHtml(t(text)) + (key ? '<span class="ann-tip-key">' + escHtml(key) + '</span>' : "");
      var r = target.getBoundingClientRect();
      tipEl.style.left = (r.left + r.width / 2) + "px";
      tipEl.style.top = (r.top - 8) + "px";
      tipEl.style.bottom = "auto";
      // Anchor bottom of tooltip to that top value
      requestAnimationFrame(function () {
        var th = tipEl.offsetHeight;
        tipEl.style.top = (r.top - 8 - th) + "px";
        tipEl.classList.add("show");
      });
    });
    target.addEventListener("mouseleave", function () {
      if (tipEl) tipEl.classList.remove("show");
    });
  }

  function createToolbar() {
    injectStyles();

    // Hover highlight box
    hoverHighlight = el("div", { id: "ann-hover-highlight" });
    if (!hoverHighlight) return;
    hoverHighlight.style.display = "none";
    root.appendChild(hoverHighlight);

    // Hover label
    hoverLabel = el("div", { id: "ann-hover-label" });
    hoverLabel.style.display = "none";
    root.appendChild(hoverLabel);

    // Markers container
    markersContainer = el("div", { id: "ann-markers" });
    root.appendChild(markersContainer);

    // Toast
    toast = el("div", { id: "ann-toast" });
    toast.appendChild(iconEl("check"));
    toast.appendChild(document.createTextNode(t("Copied to clipboard")));
    root.appendChild(toast);

    // Build toolbar
    toolbar = el("div", { id: "ann-toolbar" });

    if (config.position === 'left') { toolbar.style.right='auto'; toolbar.style.left='24px'; }
    var isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
    var altKey = isMac ? "\u2325" : "Alt";

    // Shared tooltip element
    tipEl = el("div", { id: "ann-tip" });
    root.appendChild(tipEl);

    // Toggle annotate mode
    var toggleBtn = el("button", {
      onClick: toggleActive
    });
    toggleBtn.id = "ann-toggle-btn";
    toggleBtn.appendChild(iconEl("asterisk"));
    toggleBtn.appendChild(document.createTextNode(t("Annotate")));

    // Color swatch
    colorSwatch = el("div", {
      className: "ann-color-swatch",
      role: "button",
      tabindex: "0",
      "aria-label": "Change marker color"
    });
    colorSwatch.style.background = state.markerColor;
    colorSwatch.addEventListener("click", function (e) { e.stopPropagation(); showColorPicker(); });
    colorSwatch.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); showColorPicker(); }
    });

    var divider1 = el("span", { className: "ann-divider" });

    // Eye toggle (markers visibility) with corner count badge
    eyeBtn = el("button", {
      className: "icon-only ann-eye-btn",
      onClick: toggleMarkersVisibility,
      "aria-label": "Show or hide markers"
    });
    eyeIconWrap = el("span", { className: "ann-eye-icon" });
    eyeIconWrap.appendChild(iconEl("eye"));
    eyeBadge = el("span", { className: "ann-eye-badge empty" }, "0");
    eyeBtn.appendChild(eyeIconWrap);
    eyeBtn.appendChild(eyeBadge);

    // Copy
    copyBtn = el("button", {
      className: "icon-only",
      onClick: copyOutput,
      "aria-label": "Copy feedback"
    });
    copyBtn.appendChild(iconEl("copy"));

    // Clear all
    var clearBtn = el("button", {
      className: "icon-only",
      onClick: clearAll,
      "aria-label": "Clear all"
    });
    clearBtn.appendChild(iconEl("trash"));

    var divider3 = el("span", { className: "ann-divider" });

    // Close (collapse toolbar)
    var closeBtn = el("button", {
      className: "icon-only",
      onClick: hideToolbar,
      "aria-label": "Close"
    });
    closeBtn.appendChild(iconEl("x"));

    var toggleKey = (isMac ? "\u2325" : "Alt") + "A";
    var extKey = isMac ? "\u2325\u21E7A" : "Alt+Shift+A";
    addTip(toggleBtn, "Toggle mode", toggleKey);
    addTip(colorSwatch, "Marker color", "M");
    addTip(eyeBtn, "Show/hide markers", "H");
    addTip(copyBtn, "Copy markdown", "C");
    addTip(clearBtn, "Clear all");
    addTip(closeBtn, "Close", extKey);

    toolbar.appendChild(toggleBtn);
    toolbar.appendChild(colorSwatch);
    toolbar.appendChild(divider1);
    toolbar.appendChild(eyeBtn);
    toolbar.appendChild(copyBtn);
    if (config.endpoint || config.onSubmit) {
      var submitBtn = el('button', {id:'ann-submit-btn', onClick: showSubmitForm, 'aria-label':'Submit'}, 'Submit');
      toolbar.appendChild(submitBtn);
    }
    toolbar.appendChild(clearBtn);
    toolbar.appendChild(divider3);
    toolbar.appendChild(closeBtn);

    // Collapsed face — overlay sibling that's revealed when toolbar morphs to round
    collapsedView = el("div", {
      className: "ann-collapsed-view",
      role: "button",
      tabindex: "0",
      title: "Open annotate-html (" + altKey + "+A)",
      "aria-label": "Open annotate toolbar"
    });
    collapsedView.appendChild(iconEl("asterisk"));
    collapsedBadge = el("span", { className: "ann-collapsed-badge empty" }, "0");
    collapsedView.appendChild(collapsedBadge);
    collapsedView.addEventListener("click", showToolbar);
    collapsedView.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); showToolbar(); }
    });
    toolbar.appendChild(collapsedView);

    root.appendChild(toolbar);

    // Make toolbar draggable
    initToolbarDrag();

    // Create rulers (visible when annotation mode is active)
    createRulers();
  }

  // ═══════════════════════════════════════════
  // Toolbar drag
  // ═══════════════════════════════════════════

  function initToolbarDrag() {
    var dragging = false;
    var didDrag = false;
    var startX, startY, origLeft, origTop;

    toolbar.addEventListener("mousedown", function (e) {
      // Only drag from non-interactive surfaces
      var node = e.target;
      while (node && node !== toolbar) {
        var tag = node.tagName;
        if (tag === "BUTTON" || tag === "SELECT" || tag === "TEXTAREA" || tag === "INPUT") return;
        if (node.className && typeof node.className === "string" &&
            node.className.indexOf("ann-color-swatch") !== -1) return;
        node = node.parentElement;
      }

      e.preventDefault();
      dragging = false;
      didDrag = false;
      startX = e.clientX;
      startY = e.clientY;
      var rect = toolbar.getBoundingClientRect();
      origLeft = rect.left;
      origTop = rect.top;

      function onMove(ev) {
        var dx = ev.clientX - startX;
        var dy = ev.clientY - startY;
        if (!dragging && Math.abs(dx) + Math.abs(dy) > 3) {
          dragging = true;
          didDrag = true;
          toolbar.classList.add("ann-dragging");
          toolbar.style.bottom = "auto";
          toolbar.style.right = "auto";
        }
        if (dragging) {
          var w = toolbar.offsetWidth;
          var h = toolbar.offsetHeight;
          var l = Math.max(0, Math.min(origLeft + dx, window.innerWidth - w));
          var t = Math.max(0, Math.min(origTop + dy, window.innerHeight - h));
          toolbar.style.left = l + "px";
          toolbar.style.top = t + "px";
        }
      }

      function onUp() {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        toolbar.classList.remove("ann-dragging");
        dragging = false;
        if (didDrag) {
          // Anchor to whichever side the toolbar landed on
          var rect = toolbar.getBoundingClientRect();
          var center = rect.left + rect.width / 2;
          if (center >= window.innerWidth / 2) {
            // Right half — anchor right, expands leftward
            toolbar.style.right = (window.innerWidth - rect.right) + "px";
            toolbar.style.left = "auto";
          }
          // Left half — keep left anchoring, expands rightward

          // Suppress the click that fires after drag
          var suppress = function (ev) { ev.stopPropagation(); ev.preventDefault(); };
          toolbar.addEventListener("click", suppress, true);
          setTimeout(function () { toolbar.removeEventListener("click", suppress, true); }, 0);
        }
      }

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });

    // Re-clamp after expand/collapse transition or window resize
    toolbar.addEventListener("transitionend", function (e) {
      if (e.propertyName === "max-width") clampToolbar();
    });
  }

  function clampToolbar() {
    if (!toolbar || toolbar.style.top === "") return;
    var rect = toolbar.getBoundingClientRect();
    var anchorsLeft = toolbar.style.left !== "" && toolbar.style.left !== "auto";

    if (anchorsLeft) {
      // Left-anchored — check right overflow
      if (rect.right > window.innerWidth) {
        toolbar.style.left = Math.max(0, window.innerWidth - rect.width) + "px";
      }
    } else {
      // Right-anchored — check left overflow
      if (rect.left < 0) {
        toolbar.style.right = Math.max(0, window.innerWidth - rect.width) + "px";
      }
    }
    if (rect.bottom > window.innerHeight) {
      toolbar.style.top = Math.max(0, window.innerHeight - rect.height) + "px";
    }
    if (rect.top < 0) {
      toolbar.style.top = "0px";
    }
  }

  // ═══════════════════════════════════════════
  // Actions
  // ═══════════════════════════════════════════

  // ═══════════════════════════════════════════
  // Rulers & Guides
  // ═══════════════════════════════════════════

  var rulerH, rulerV, rulerCorner, rulerHCanvas, rulerVCanvas;
  var guides = [];

  function createRulers() {
    rulerCorner = el("div", { id: "ann-ruler-corner" });
    root.appendChild(rulerCorner);

    rulerH = el("div", { id: "ann-ruler-h" });
    rulerHCanvas = document.createElement("canvas");
    rulerHCanvas.height = 20;
    rulerH.appendChild(rulerHCanvas);
    initRulerDrag(rulerH, "v");
    root.appendChild(rulerH);

    rulerV = el("div", { id: "ann-ruler-v" });
    rulerVCanvas = document.createElement("canvas");
    rulerVCanvas.width = 20;
    rulerV.appendChild(rulerVCanvas);
    initRulerDrag(rulerV, "h");
    root.appendChild(rulerV);

    drawRulers();
  }

  function initRulerDrag(rulerEl, guideDir) {
    var preview = null;

    rulerEl.addEventListener("mousedown", function (e) {
      e.preventDefault();
      state.rulerDragging = true;
      preview = el("div", { className: "ann-guide ann-guide-" + guideDir });
      preview.style.borderColor = state.markerColor;
      preview.style.opacity = "0.5";
      var lbl = el("span", { className: "ann-guide-label" }, "0px");
      preview.appendChild(lbl);
      root.appendChild(preview);

      function onMove(ev) {
        if (!preview) return;
        var pos, pagePos;
        if (guideDir === "h") {
          pos = ev.clientY;
          pagePos = pos + window.scrollY;
          preview.style.top = pos + "px";
        } else {
          pos = ev.clientX;
          pagePos = pos + window.scrollX;
          preview.style.left = pos + "px";
        }
        preview.querySelector(".ann-guide-label").textContent = Math.round(pagePos) + "px";
        // If dragged back onto the ruler, dim it
        var onRuler = guideDir === "h" ? ev.clientX < 20 : ev.clientY < 20;
        preview.style.opacity = onRuler ? "0.2" : "0.5";
      }

      function onUp(ev) {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        state.rulerDragging = false;
        if (!preview) return;
        // Check if dropped back on the ruler — cancel
        var onRuler = guideDir === "h" ? ev.clientX < 20 : ev.clientY < 20;
        if (preview.parentNode) preview.parentNode.removeChild(preview);
        preview = null;
        if (onRuler) return;

        var viewPos, pagePos;
        if (guideDir === "h") {
          viewPos = ev.clientY;
          pagePos = viewPos + window.scrollY;
        } else {
          viewPos = ev.clientX;
          pagePos = viewPos + window.scrollX;
        }
        addGuide(guideDir, viewPos, pagePos);
      }

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  }

  function drawRulers() {
    if (!rulerHCanvas || !rulerVCanvas) return;
    var dpr = window.devicePixelRatio || 1;
    var w = window.innerWidth - 20;
    var h = window.innerHeight - 20;
    var sx = window.scrollX;
    var sy = window.scrollY;
    var tickColor = "rgba(31,30,29,.25)";
    var textColor = "rgba(31,30,29,.5)";

    // Horizontal ruler
    rulerHCanvas.width = w * dpr;
    rulerHCanvas.height = 20 * dpr;
    rulerHCanvas.style.width = w + "px";
    rulerHCanvas.style.height = "20px";
    var ctxH = rulerHCanvas.getContext("2d");
    ctxH.scale(dpr, dpr);
    ctxH.font = "9px ui-monospace,SFMono-Regular,Menlo,monospace";
    ctxH.fillStyle = textColor;
    ctxH.strokeStyle = tickColor;
    ctxH.lineWidth = 0.5;
    var startX = Math.floor(sx / 10) * 10;
    for (var px = startX; px < sx + w; px += 10) {
      var x = px - sx;
      var isMajor = px % 100 === 0;
      var isMid = px % 50 === 0;
      ctxH.beginPath();
      ctxH.moveTo(x + 0.5, 20);
      ctxH.lineTo(x + 0.5, isMajor ? 4 : isMid ? 10 : 14);
      ctxH.stroke();
      if (isMajor) {
        ctxH.fillText(String(px), x + 3, 12);
      }
    }

    // Vertical ruler
    rulerVCanvas.width = 20 * dpr;
    rulerVCanvas.height = h * dpr;
    rulerVCanvas.style.width = "20px";
    rulerVCanvas.style.height = h + "px";
    var ctxV = rulerVCanvas.getContext("2d");
    ctxV.scale(dpr, dpr);
    ctxV.font = "9px ui-monospace,SFMono-Regular,Menlo,monospace";
    ctxV.fillStyle = textColor;
    ctxV.strokeStyle = tickColor;
    ctxV.lineWidth = 0.5;
    var startY = Math.floor(sy / 10) * 10;
    for (var py = startY; py < sy + h; py += 10) {
      var y = py - sy;
      var isMajorY = py % 100 === 0;
      var isMidY = py % 50 === 0;
      ctxV.beginPath();
      ctxV.moveTo(20, y + 0.5);
      ctxV.lineTo(isMajorY ? 4 : isMidY ? 10 : 14, y + 0.5);
      ctxV.stroke();
      if (isMajorY && y >= 10) {
        ctxV.save();
        ctxV.translate(12, y + 3);
        ctxV.rotate(-Math.PI / 2);
        ctxV.fillText(String(py), 0, 0);
        ctxV.restore();
      }
    }
  }

  function addGuide(dir, viewPos, pagePos) {
    var guide = el("div", { className: "ann-guide ann-guide-" + dir });
    guide.style[dir === "h" ? "top" : "left"] = viewPos + "px";
    guide.style.borderColor = state.markerColor;
    guide._pagePos = pagePos;
    guide._dir = dir;

    // Handle: drag affordance + px label + close button
    var handle = el("div", { className: "ann-guide-handle" });
    var label = el("span", {}, String(Math.round(pagePos)) + "px");

    var closeBtn = el("button", { className: "ann-guide-close", "aria-label": "Remove guide" });
    closeBtn.appendChild(iconEl("x"));
    closeBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      removeGuide(guide);
    });

    handle.appendChild(label);
    handle.appendChild(closeBtn);
    guide.appendChild(handle);

    // Drag from handle or line to reposition; drag to ruler edge to remove
    function startDrag(e) {
      e.preventDefault();
      e.stopPropagation();
      handle.classList.add("dragging");
      function onMove(ev) {
        var pos, pp;
        if (dir === "h") {
          pos = ev.clientY;
          pp = pos + window.scrollY;
          guide.style.top = pos + "px";
        } else {
          pos = ev.clientX;
          pp = pos + window.scrollX;
          guide.style.left = pos + "px";
        }
        guide._pagePos = pp;
        label.textContent = Math.round(pp) + "px";
        var onRuler = dir === "h" ? ev.clientX < 20 : ev.clientY < 20;
        guide.style.opacity = onRuler ? "0.3" : "1";
      }
      function onUp(ev) {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        handle.classList.remove("dragging");
        var onRuler = dir === "h" ? ev.clientX < 20 : ev.clientY < 20;
        if (onRuler) { removeGuide(guide); return; }
        guide.style.opacity = "1";
      }
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    }

    handle.addEventListener("mousedown", startDrag);
    guide.addEventListener("mousedown", function (e) {
      if (e.target === guide || e.target === guide.querySelector("::before")) startDrag(e);
    });

    root.appendChild(guide);
    guides.push(guide);
  }

  function removeGuide(guide) {
    if (guide.parentNode) guide.parentNode.removeChild(guide);
    guides = guides.filter(function (g) { return g !== guide; });
  }

  function updateGuidePositions() {
    guides.forEach(function (g) {
      if (g._dir === "h") {
        g.style.top = (g._pagePos - window.scrollY) + "px";
      } else {
        g.style.left = (g._pagePos - window.scrollX) + "px";
      }
    });
  }

  function clearGuides() {
    guides.forEach(function (g) { if (g.parentNode) g.parentNode.removeChild(g); });
    guides = [];
  }

  // ═══════════════════════════════════════════
  // Ruler edge-hover reveal
  // ═══════════════════════════════════════════

  var RULER_EDGE_PX = 40;
  var rulerTimerH = null, rulerTimerV = null;

  function showRulerAxis(axis) {
    if (state.markersHidden) return;
    if (axis === "h") {
      if (rulerTimerH) { clearTimeout(rulerTimerH); rulerTimerH = null; }
      if (rulerH) rulerH.classList.add("ann-ruler-show");
    } else {
      if (rulerTimerV) { clearTimeout(rulerTimerV); rulerTimerV = null; }
      if (rulerV) rulerV.classList.add("ann-ruler-show");
    }
    if (rulerCorner) rulerCorner.classList.add("ann-ruler-show");
  }

  function hideRulerAxis(axis) {
    if (state.rulerDragging) return;
    if (axis === "h") {
      if (rulerTimerH) return;
      rulerTimerH = setTimeout(function () {
        rulerTimerH = null;
        if (rulerH) rulerH.classList.remove("ann-ruler-show");
        if (rulerCorner && rulerV && !rulerV.classList.contains("ann-ruler-show")) {
          rulerCorner.classList.remove("ann-ruler-show");
        }
      }, 300);
    } else {
      if (rulerTimerV) return;
      rulerTimerV = setTimeout(function () {
        rulerTimerV = null;
        if (rulerV) rulerV.classList.remove("ann-ruler-show");
        if (rulerCorner && rulerH && !rulerH.classList.contains("ann-ruler-show")) {
          rulerCorner.classList.remove("ann-ruler-show");
        }
      }, 300);
    }
  }

  function handleRulerProximity(e) {
    if (!rulerH) return;
    var x = e.clientX, y = e.clientY;
    if (y <= RULER_EDGE_PX) showRulerAxis("h");
    else hideRulerAxis("h");
    if (x <= RULER_EDGE_PX) showRulerAxis("v");
    else hideRulerAxis("v");
  }

  function toggleActive() {
    state.active = !state.active;
    var btn = root.getElementById("ann-toggle-btn");
    if (state.active) {
      btn.classList.add("active");

    } else {
      btn.classList.remove("active");

      hideHover();
      closePopup();
    }
  }

  function hideHover() {
    hoverHighlight.style.display = "none";
    hoverLabel.style.display = "none";
    state.hoveredEl = null;
  }

  function hideToolbar() {
    if (!toolbar) return;
    if (state.active) toggleActive();
    closePopup();
    hideHover();
    toolbar.classList.add("collapsed");
    state.toolbarHidden = true;
  }

  function showToolbar() {
    if (!toolbar) return;
    toolbar.classList.remove("collapsed");
    state.toolbarHidden = false;
  }

  function toggleMarkersVisibility() {
    state.markersHidden = !state.markersHidden;
    markersContainer.style.display = state.markersHidden ? "none" : "";
    eyeIconWrap.innerHTML = "";
    eyeIconWrap.appendChild(iconEl(state.markersHidden ? "eyeOff" : "eye"));
    if (state.markersHidden) eyeBtn.classList.add("hidden-state");
    else eyeBtn.classList.remove("hidden-state");
    // Toggle rulers and guides visibility
    if (state.markersHidden) {
      if (rulerH) rulerH.classList.remove("ann-ruler-show");
      if (rulerV) rulerV.classList.remove("ann-ruler-show");
      if (rulerCorner) rulerCorner.classList.remove("ann-ruler-show");
    }
    guides.forEach(function (g) {
      g.style.display = state.markersHidden ? "none" : "";
    });
  }

  function updateCount() {
    if (!eyeBadge) return;
    var n = state.annotations.length;
    var prev = parseInt(eyeBadge.textContent, 10) || 0;

    eyeBadge.textContent = n;
    if (n === 0) eyeBadge.classList.add("empty");
    else eyeBadge.classList.remove("empty");

    if (collapsedBadge) {
      collapsedBadge.textContent = n;
      if (n === 0) collapsedBadge.classList.add("empty");
      else collapsedBadge.classList.remove("empty");
    }

    // Pop on increment
    if (n > prev) {
      eyeBadge.classList.remove("bump");
      void eyeBadge.offsetWidth;
      eyeBadge.classList.add("bump");
      if (collapsedBadge) {
        collapsedBadge.classList.remove("bump");
        void collapsedBadge.offsetWidth;
        collapsedBadge.classList.add("bump");
      }
    }
  }

  function showToast(msg) {
    // Replace text node (preserve the icon SVG child)
    var tn = null;
    for (var i = 0; i < toast.childNodes.length; i++) {
      if (toast.childNodes[i].nodeType === 3) { tn = toast.childNodes[i]; break; }
    }
    if (tn) tn.nodeValue = t(msg || "Copied to clipboard");
    else toast.appendChild(document.createTextNode(msg || "Copied to clipboard"));
    toast.classList.add("show");
    setTimeout(function () { toast.classList.remove("show"); }, 1800);
  }

  function flashCopySuccess() {
    if (!copyBtn) return;
    copyBtn.innerHTML = ICONS.checkCircleFilled;
    copyBtn.classList.add("success");
    setTimeout(function () {
      copyBtn.innerHTML = "";
      copyBtn.appendChild(iconEl("copy"));
      copyBtn.classList.remove("success");
    }, 1500);
  }

  function copyOutput() {
    var md = generateOutput();
    if (!md) { showToast("No annotations"); return; }
    navigator.clipboard.writeText(md).then(function () {
      flashCopySuccess();
      showToast("Copied " + state.annotations.length + " annotation(s)");
    });
  }

  function clearAll() {
    state.annotations = [];
    updateCount();
    renderMarkers();
  }

  // ═══════════════════════════════════════════
  // Color picker
  // ═══════════════════════════════════════════

  function closeColorPicker() {
    if (colorPicker && colorPicker.parentNode) colorPicker.parentNode.removeChild(colorPicker);
    colorPicker = null;
  }

  function showColorPicker() {
    if (colorPicker) { closeColorPicker(); return; }
    colorPicker = el("div", { id: "ann-color-picker" });

    MARKER_COLORS.forEach(function (hex) {
      var opt = el("div", { className: "ann-color-opt" + (hex === state.markerColor ? " active" : "") });
      opt.style.background = hex;
      opt.addEventListener("click", function (e) {
        e.stopPropagation();
        updateAccentColor(hex);
        closeColorPicker();
      });
      colorPicker.appendChild(opt);
    });

    // Position above the swatch
    var swRect = colorSwatch.getBoundingClientRect();
    colorPicker.style.bottom = (window.innerHeight - swRect.top + 8) + "px";
    colorPicker.style.right = (window.innerWidth - swRect.right) + "px";

    root.appendChild(colorPicker);
  }

  // ═══════════════════════════════════════════
  // Popup (comment input)
  // ═══════════════════════════════════════════

  function closePopup() {
    if (popup && popup.parentNode) popup.parentNode.removeChild(popup);
    popup = null;
    closeColorPicker();
  }

  function getStyleEntries(target) {
    if (!target) return [];
    var s = window.getComputedStyle(target);
    var entries = [];
    var color = s.color;
    if (color && color !== "rgb(0, 0, 0)") entries.push(["color", color]);
    var bg = s.backgroundColor;
    if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") entries.push(["background", bg]);
    if (s.fontSize) entries.push(["font-size", s.fontSize]);
    if (s.fontWeight && s.fontWeight !== "400" && s.fontWeight !== "normal") entries.push(["font-weight", s.fontWeight]);
    if (s.fontFamily) entries.push(["font-family", s.fontFamily]);
    var d = s.display;
    if (d && d !== "block" && d !== "inline") entries.push(["display", d]);
    if (s.borderRadius && s.borderRadius !== "0px") entries.push(["border-radius", s.borderRadius]);
    if (s.padding && s.padding !== "0px") entries.push(["padding", s.padding]);
    return entries;
  }

  function buildPopupHeader(elementName, target) {
    var header = el("div", { className: "ann-popup-header" });
    var chevWrap = el("span", { className: "ann-popup-chevron" });
    chevWrap.appendChild(iconEl("chevronDown"));
    var label = el("span", { className: "ann-popup-label" }, elementName);
    header.appendChild(chevWrap);
    header.appendChild(label);
    header.addEventListener("click", function () {
      header.classList.toggle("expanded");
    });

    var stylesBlock = el("div", { className: "ann-popup-styles" });
    var entries = target ? (target.nodeType ? getStyleEntries(target) : target) : [];
    entries.forEach(function (pair) {
      var line = document.createElement("div");
      line.innerHTML = '<span class="ann-prop">' + escHtml(pair[0]) + ':</span> ' +
        '<span class="ann-val">' + escHtml(pair[1]) + ';</span>';
      stylesBlock.appendChild(line);
    });

    return { header: header, styles: stylesBlock };
  }

  function positionPopup(x, y) {
    popup.style.left = Math.min(x + 12, window.innerWidth - 400) + "px";
    popup.style.top = Math.min(y + 12, window.innerHeight - 220) + "px";
  }

  function showPopup(clickX, clickY, info, rect, selectedText) {
    closePopup();

    var bb = rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;

    popup = el("div", { id: "ann-popup" });

    var hp = buildPopupHeader(info.name, info.target);
    var textarea = el("textarea", { placeholder: "What should change?", rows: "3" });

    var screenshotToggle = el('input',{type:'checkbox'}); screenshotToggle.checked=!!config.screenshot;
    var screenshotLabel=el('label',{},[screenshotToggle,document.createTextNode(t('Screenshot'))]);
    var cancelBtn = el("button", { onClick: function () { closePopup(); } }, "Cancel");
    var addBtn = el("button", { className: "primary", onClick: function () {
      var comment = textarea.value.trim();
      if (!comment) { closePopup(); return; }

      var annotation = {
        id: "ann-" + (++state.counter),
        x: clickX + window.scrollX,
        y: clickY + window.scrollY,
        comment: comment,
        element: info.name,
        elementPath: info.path,
        timestamp: Date.now(),
        selectedText: selectedText || undefined,
        boundingBox: bb,
        nearbyText: getNearbyText(info.target),
        cssClasses: getClasses(info.target),
        fullPath: getFullPath(info.target),
        accessibility: getA11yInfo(info.target),
        computedStyles: getComputedSnapshot(info.target),
      };

      annotation.elementInfo = elementInfo(info.target);
      annotation.target = info.target;
      annotation.screenshotEnabled = screenshotToggle && screenshotToggle.checked;
      state.annotations.push(annotation);
      window.dispatchEvent(new CustomEvent('annotate:created',{detail:annotation}));
      if (annotation.screenshotEnabled) captureAnnotation(annotation).catch(e => window.dispatchEvent(new CustomEvent('annotate:error',{detail:e})));
      updateCount();
      renderMarkers();
      closePopup();
    }}, "Add");

    var actions = el("div", { className: "ann-popup-actions" }, [
      el("span", { className: "ann-spacer" }),
      cancelBtn,
      addBtn,
    ]);

    popup.appendChild(hp.header);
    popup.appendChild(hp.styles);
    popup.appendChild(textarea);
    popup.appendChild(screenshotLabel);
    popup.appendChild(actions);

    positionPopup(clickX, clickY);
    root.appendChild(popup);
    textarea.focus();

    textarea.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) addBtn.click();
      if (e.key === "Escape") closePopup();
    });
  }

  function showEditPopup(x, y, index) {
    closePopup();
    var ann = state.annotations[index];
    if (!ann) return;

    popup = el("div", { id: "ann-popup" });

    // Parse stored styles string back into pairs for display
    var pairs = [];
    if (ann.computedStyles) {
      ann.computedStyles.replace(/([a-z]+): ([^,]+(?:,(?![a-z]+:)[^,]*)*)/g, function (_, k, v) {
        pairs.push([k, v.trim()]);
      });
    }
    var hp = buildPopupHeader(ann.element, pairs);
    var textarea = el("textarea", { placeholder: "What should change?", rows: "3" });
    textarea.value = ann.comment;
    if(ann.blob) { const preview=el('canvas',{className:'ann-preview'});
      createImageBitmap(ann.blob).then(bitmap=>{preview.width=Math.min(120,bitmap.width);preview.height=Math.max(1,Math.round(bitmap.height*preview.width/bitmap.width));preview.getContext('2d').drawImage(bitmap,0,0,preview.width,preview.height);bitmap.close();}).catch(()=>{});
      popup.appendChild(preview);
    }

    var trashBtn = el("button", {
      className: "icon-only",
      title: "Delete annotation",
      "aria-label": "Delete annotation",
      onClick: function () {
        state.annotations.splice(index, 1);
        updateCount();
        renderMarkers();
        closePopup();
      }
    });
    trashBtn.appendChild(iconEl("trash"));

    var cancelBtn = el("button", { onClick: function () { closePopup(); } }, "Cancel");
    var saveBtn = el("button", { className: "primary", onClick: function () {
      var comment = textarea.value.trim();
      if (!comment) {
        // Empty save = delete
        state.annotations.splice(index, 1);
      } else {
        ann.comment = comment;
      }
      updateCount();
      renderMarkers();
      closePopup();
    }}, "Save");

    var actions = el("div", { className: "ann-popup-actions" }, [
      trashBtn,
      el("span", { className: "ann-spacer" }),
      cancelBtn,
      saveBtn,
    ]);

    popup.appendChild(hp.header);
    popup.appendChild(hp.styles);
    popup.appendChild(textarea);
    popup.appendChild(actions);

    positionPopup(x, y);
    root.appendChild(popup);
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);

    textarea.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) saveBtn.click();
      if (e.key === "Escape") closePopup();
    });
  }

  // ═══════════════════════════════════════════
  // Markers
  // ═══════════════════════════════════════════

  function renderMarkers() {
    if (!markersContainer) return;
    markersContainer.innerHTML = "";
    state.annotations.forEach(function (a, i) {
      var marker = el("div", { className: "ann-marker" });
      marker.style.left = a.x + "px";
      marker.style.top = a.y + "px";

      // Inner visible circle — this scales on hover, the wrapper does not
      var circle = el("div", { className: "ann-marker-circle" });
      circle.style.background = state.markerColor;
      circle.style.boxShadow = "0 1px 2px rgba(31,30,29,.10),0 4px 12px " +
        state.markerColor + "4D"; // 30% opacity hex suffix
      var numEl = el("span", { className: "ann-marker-num" }, String(i + 1));
      var editEl = el("span", { className: "ann-marker-edit" });
      editEl.appendChild(iconEl("pencilPlain"));
      circle.appendChild(numEl);
      circle.appendChild(editEl);
      marker.appendChild(circle);

      // Tooltip — sibling of circle so it doesn't scale with it
      var tip = el("div", { className: "ann-marker-tip" });
      tip.innerHTML = '<span class="ann-tip-element">' + escHtml(a.element) + '</span>' +
        '<span class="ann-tip-comment">' + escHtml(a.comment) + '</span>';
      marker.appendChild(tip);

      // Click to edit
      marker.addEventListener("click", function (e) {
        e.stopPropagation();
        e.preventDefault();
        showEditPopup(e.clientX, e.clientY, i);
      });

      markersContainer.appendChild(marker);
    });
  }

  function escHtml(s) {
    var d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  // ═══════════════════════════════════════════
  // Event Handlers
  // ═══════════════════════════════════════════

  function isToolbarElement(el) {
    if (!el) return false;
    if (el === host || root.contains(el)) return true;
    var node = el;
    while (node) {
      if (node.id === "ann-toolbar" || node.id === "ann-popup" ||
          node.id === "ann-color-picker" || node.id === "ann-tip" ||
          node.id === "ann-ruler-h" || node.id === "ann-ruler-v" ||
          node.id === "ann-ruler-corner" ||
          (node.className && typeof node.className === "string" && node.className.indexOf("ann-guide") !== -1) ||
          node.id === "ann-hover-highlight" || node.id === "ann-hover-label" ||
          (node.className && typeof node.className === "string" && node.className.indexOf("ann-marker") !== -1)) {
        return true;
      }
      node = node.parentElement;
    }
    return false;
  }

  function handleMouseMove(e) {
    if (!state.active) return;
    if (isToolbarElement(e.target)) { hideHover(); return; }

    var target = document.elementFromPoint(e.clientX, e.clientY);
    if (!target || isToolbarElement(target)) { hideHover(); return; }

    state.hoveredEl = target;
    var rect = target.getBoundingClientRect();

    // Highlight box
    hoverHighlight.style.display = "block";
    hoverHighlight.style.left = rect.left + "px";
    hoverHighlight.style.top = rect.top + "px";
    hoverHighlight.style.width = rect.width + "px";
    hoverHighlight.style.height = rect.height + "px";
    hoverHighlight.style.borderColor = state.markerColor;
    hoverHighlight.style.background = state.markerColor + "0A";

    // Label
    var info = identifyElement(target);
    hoverLabel.style.display = "block";
    hoverLabel.textContent = info.name + "  " + info.path;

    // Position label above element or below if too high
    var labelTop = rect.top - 28;
    if (labelTop < 4) labelTop = rect.bottom + 6;
    hoverLabel.style.left = Math.max(4, rect.left) + "px";
    hoverLabel.style.top = labelTop + "px";
  }

  function handleClick(e) {
    if (!state.active) return;
    if (isToolbarElement(e.target)) return;

    e.preventDefault();
    e.stopPropagation();

    var target = document.elementFromPoint(e.clientX, e.clientY);
    if (!target || isToolbarElement(target)) return;

    var info = identifyElement(target);
    info.target = target;
    var rect = target.getBoundingClientRect();

    // Check for text selection
    var sel = window.getSelection();
    var selectedText = sel && sel.toString().trim() ? sel.toString().trim() : null;

    showPopup(e.clientX, e.clientY, info, rect, selectedText);
  }

  function handleKeydown(e) {
    // Alt+A: bring back hidden toolbar OR toggle annotate mode
    if (e.altKey && (e.code === "KeyA" || (e.key && e.key.toLowerCase() === "a"))) {
      e.preventDefault();
      if (state.toolbarHidden) {
        showToolbar();
        if (!state.active) toggleActive();
      } else {
        toggleActive();
      }
    }
    // Single-key shortcuts (only when no popup/input is focused)
    if (!e.metaKey && !e.ctrlKey && !e.altKey && !popup && !colorPicker &&
        document.activeElement && document.activeElement.tagName !== "TEXTAREA" &&
        document.activeElement.tagName !== "INPUT") {
      var k = e.key.toLowerCase();
      if (k === "c" && state.annotations.length > 0) { e.preventDefault(); copyOutput(); }
      if (k === "m") { e.preventDefault(); showColorPicker(); }
      if (k === "h") { e.preventDefault(); toggleMarkersVisibility(); }
    }
    // Escape to deactivate or close popup
    if (e.key === "Escape") {
      if (colorPicker) { closeColorPicker(); return; }
      if (popup) { closePopup(); return; }
      if (state.active) toggleActive();
    }
  }

  // ═══════════════════════════════════════════
  // Init
  // ═══════════════════════════════════════════

  function init() {
    document.documentElement.appendChild(host);
    if (config.ui !== false) createToolbar();
    else { injectStyles(); markersContainer=el('div',{id:'ann-markers'}); root.appendChild(markersContainer); }
    document.addEventListener("mousemove", handleMouseMove, true);
    document.addEventListener("click", handleClick, true);
    document.addEventListener("keydown", handleKeydown);
    window.addEventListener("scroll", function () {
      if (state.active) hideHover();
      drawRulers();
      updateGuidePositions();
    }, { passive: true });
    window.addEventListener("resize", function () {
      drawRulers();
      clampToolbar();
    }, { passive: true });

    if (config.startHidden && toolbar) hideToolbar();
    // Edge-hover reveal for rulers
    document.addEventListener("mousemove", handleRulerProximity, { passive: true });
    document.documentElement.addEventListener("mouseleave", function () {
      hideRulerAxis("h");
      hideRulerAxis("v");
    });

    // Publish a tiny control hook so re-injection (Chrome extension click,
    // second <script> tag, etc.) toggles this instance instead of duplicating.
    window.__annotateHtml = {
      version: '2.0.0',
      annotate: addAnnotation,
      list: () => state.annotations.map(a => Object.assign({}, a, {target:undefined, blob:undefined})),
      remove: id => { const n=state.annotations.findIndex(a=>a.id===id); if(n<0)return false; state.annotations.splice(n,1); updateCount(); renderMarkers(); return true; },
      clear: clearAll,
      buildPayload,
      submit: submitFeedback,
      configure: partial => { config=Object.assign({},config,partial); },
      toggle: function () {
        if (state.toolbarHidden) showToolbar();
        else hideToolbar();
      },
      show: showToolbar,
      hide: hideToolbar,
      // Programmatic API for seeding annotations and guides onto the page.
      seed: function (annotations, seedGuides) {
        if (annotations) {
          annotations.forEach(function (a) {
            var target = typeof a.target === "string"
              ? document.querySelector(a.target) : a.target;
            if (!target) return;
            var rect = target.getBoundingClientRect();
            var info = identifyElement(target, getElementPath(target));
            var bb = "x:" + Math.round(rect.x) + ", y:" + Math.round(rect.y) +
              " (" + Math.round(rect.width) + "x" + Math.round(rect.height) + "px)";
            state.annotations.push({
              id: "ann-" + (++state.counter),
              x: rect.x + rect.width / 2 + window.scrollX,
              y: rect.y + window.scrollY,
              comment: a.comment || "",
              element: info.name,
              elementPath: info.path,
              timestamp: Date.now(),
              boundingBox: bb,
              nearbyText: getNearbyText(target),
              cssClasses: getClasses(target),
              fullPath: getFullPath(target),
              accessibility: getA11yInfo(target),
              computedStyles: getComputedSnapshot(target),
              elementInfo: elementInfo(target), target: target, screenshotEnabled: false,
            });
          });
          updateCount();
          renderMarkers();
        }
        if (seedGuides) {
          seedGuides.forEach(function (g) {
            var viewPos = g.dir === "h"
              ? g.pos - window.scrollY
              : g.pos - window.scrollX;
            addGuide(g.dir, viewPos, g.pos);
          });
        }
      }
    };
  }

  function elementInfo(target) {
    try {
      const tag=target.localName || 'element', attrs={}, ancestors=[];
      let node=target;
      for(let depth=0; node && depth<6; depth++,node=node.parentElement) {
        const found={}; for(const key of config.semanticAttributes) if(node.hasAttribute(key)) found[key]=shorten(node.getAttribute(key));
        if(depth===0) Object.assign(attrs,found); else if(Object.keys(found).length) ancestors.push({depth, attributes:found});
      }
      let selector='';
      if(target.id && document.querySelectorAll('#'+CSS.escape(target.id)).length===1) selector='#'+CSS.escape(target.id);
      if(!selector) for(const key of config.semanticAttributes) {
        if(target.hasAttribute(key)) { const candidate=tag+'['+key+'="'+CSS.escape(target.getAttribute(key))+'"]';
          try {if(document.querySelectorAll(candidate).length===1) {selector=candidate; break;} } catch(_){} }
      }
      if(!selector) {
        const path=[]; node=target;
        while(node && node.nodeType===1 && node!==document.documentElement) {
          let part=node.localName;
          if(node.id) {part+='#'+CSS.escape(node.id); path.unshift(part); break;}
          const siblings=node.parentElement && [...node.parentElement.children].filter(x=>x.localName===node.localName);
          if(siblings && siblings.length>1) part+=':nth-of-type('+(siblings.indexOf(node)+1)+')';
          path.unshift(part); node=node.parentElement;
        }
        selector=path.join(' > ');
      }
      const xpath=[]; node=target;
      while(node && node.nodeType===1) {const siblings=node.parentElement && [...node.parentElement.children].filter(x=>x.localName===node.localName) || [node]; xpath.unshift(node.localName+'['+(siblings.indexOf(node)+1)+']'); node=node.parentElement;}
      const result={name:identifyElement(target).name, path:getElementPath(target), selector, id:target.id||'',
        inputName:target.getAttribute('name')||'', role:target.getAttribute('role')||'', ariaLabel:target.getAttribute('aria-label')||'',
        attributes:attrs, ancestors, outerHTML:(target.matches('input[type="password"]') || (config.maskSelectors||[]).some(selector=>{try{return target.matches(selector)}catch(_){return false}})) ? '[masked]' : shorten(target.outerHTML).slice(0,500), xpath:'/'+xpath.join('/'),
        classes:getClasses(target), bbox:(()=>{const r=target.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};})(),
        computedStyles:getComputedSnapshot(target), nearbyText:shorten(getNearbyText(target)), a11y:getA11yInfo(target)};
      const rootNode=target.getRootNode();
      if(rootNode instanceof ShadowRoot) result.shadowPath=rootNode.host.localName;
      if(window.frameElement) result.iframePath=window.frameElement.id || window.frameElement.localName;
      try {const fiberKey=Object.keys(target).find(k=>k.startsWith('__reactFiber$')); let fiber=fiberKey && target[fiberKey], names=[];
        while(fiber && names.length<8) {const type=fiber.type; if(type && typeof type!=='string') {const n=type.displayName||type.name;if(n) names.push(n);if(fiber._debugSource) result.reactSource=shorten(fiber._debugSource.fileName)+':'+fiber._debugSource.lineNumber;}fiber=fiber.return;} if(names.length)result.reactComponents=names;
      } catch(_){}
      try {const vue=target.__vueParentComponent;if(vue) {result.vueComponent=vue.type && (vue.type.name||vue.type.__name);result.vueSource=vue.type && vue.type.__file;} } catch(_){}
      return result;
    } catch(_) {return {name:target.localName||'element',selector:getElementPath(target)};}
  }

  function safeCanvas(region) {
    const canvas=document.createElement('canvas');canvas.width=region.width;canvas.height=region.height;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
    const masks=['input[type="password"]',...(config.maskSelectors||[])];if(config.maskAllInputs)masks.push('input','textarea');
    const masked=node=>masks.some(selector=>{try{return node.matches(selector)||!!node.closest(selector);}catch(_){return false;}});
    function paint(node,depth) {
      if(depth>40||node===host||!node.getBoundingClientRect)return;
      const r=node.getBoundingClientRect(),x=r.x-region.x,y=r.y-region.y;
      if(r.width<=0||r.height<=0||x>=canvas.width||y>=canvas.height||x+r.width<=0||y+r.height<=0)return;
      const style=getComputedStyle(node);if(style.display==='none'||style.visibility==='hidden')return;
      if(masked(node)){ctx.fillStyle='#222';ctx.fillRect(x,y,r.width,r.height);return;}
      const bg=style.backgroundColor;
      if(bg && bg!=='rgba(0, 0, 0, 0)' && bg!=='transparent'){ctx.fillStyle=bg;ctx.fillRect(x,y,r.width,r.height);}
      if(node instanceof HTMLInputElement||node instanceof HTMLTextAreaElement){
        ctx.strokeStyle='#888';ctx.strokeRect(x,y,r.width,r.height);
        ctx.fillStyle=style.color||'#222';ctx.font=style.font||'14px sans-serif';ctx.fillText(String(node.value||'').slice(0,100),x+5,y+Math.min(20,r.height-3));
      } else if(node.children.length===0 && node.textContent && node.textContent.trim()){
        ctx.fillStyle=style.color||'#222';ctx.font=style.font||'14px sans-serif';
        ctx.fillText(node.textContent.trim().slice(0,100),x,y+Math.min(parseFloat(style.fontSize)||14,r.height));
      }
      for(const child of node.children)paint(child,depth+1);
    }
    for(const child of document.body.children)paint(child,0);
    return canvas;
  }
  function makeAnnotation(target,comment,kind,screenshot) {
    const r=target.getBoundingClientRect(), info=identifyElement(target);
    const a={id:'ann-'+(++state.counter), x:r.x+r.width/2+scrollX, y:r.y+scrollY,
      comment:String(comment||''), kind:kind||undefined, element:info.name,elementPath:info.path,
      timestamp:Date.now(),boundingBox:{x:r.x,y:r.y,width:r.width,height:r.height},
      nearbyText:getNearbyText(target),cssClasses:getClasses(target),fullPath:getFullPath(target),
      accessibility:getA11yInfo(target),computedStyles:getComputedSnapshot(target),
      elementInfo:elementInfo(target),target,screenshotEnabled:!!screenshot};
    state.annotations.push(a);updateCount();renderMarkers();
    window.dispatchEvent(new CustomEvent('annotate:created',{detail:a}));return a;
  }
  async function addAnnotation({target,comment,kind,screenshot}={}) {
    try {const node=typeof target==='string'?document.querySelector(target):target;
      if(!(node instanceof Element) || node===host || root.contains(node))throw new Error('Annotation target not found');
      const a=makeAnnotation(node,comment,kind,screenshot==null?config.screenshot:screenshot);
      if(a.screenshotEnabled) await captureAnnotation(a);
      return Object.assign({},a,{target:undefined,blob:undefined});
    }catch(e){window.dispatchEvent(new CustomEvent('annotate:error',{detail:e}));throw e;}
  }
  let canvasLoading;
  function loadCanvas() {
    if(window.html2canvas) return Promise.resolve(window.html2canvas);
    if(!canvasLoading) canvasLoading=new Promise((resolve,reject)=>{
      const vendor=document.createElement('script'); vendor.src=config.vendorUrl || new URL('vendor/html2canvas.min.js',script && script.src || location.href).href;
      vendor.onload=()=>window.html2canvas?resolve(window.html2canvas):reject(new Error('Screenshot vendor unavailable'));
      vendor.onerror=()=>reject(new Error('Screenshot vendor blocked'));document.head.appendChild(vendor);
    }).catch(e=>{canvasLoading=null;throw e;});
    return canvasLoading;
  }
  async function captureAnnotation(a) {
    const r=a.target && a.target.getBoundingClientRect() || a.boundingBox;
    const padding=config.screenshotPadding == null?120:Math.max(0,Number(config.screenshotPadding));
    const region=config.screenshotRegion==='viewport' ? {x:0,y:0,width:innerWidth,height:innerHeight} : {
      x:Math.max(0,Math.floor(r.x-padding)), y:Math.max(0,Math.floor(r.y-padding)),
      width:0,height:0};
    if(config.screenshotRegion!=='viewport') {region.width=Math.max(1,Math.ceil(Math.min(innerWidth, r.right+padding)-region.x));region.height=Math.max(1,Math.ceil(Math.min(innerHeight,r.bottom+padding)-region.y));}
    const maskSelectors=['input[type="password"]',...(config.maskSelectors||[])];
    if(config.maskAllInputs) maskSelectors.push('input','textarea');
    const hidden=host.style.getPropertyValue('visibility'); host.style.setProperty('visibility','hidden','important');
    try {
      const canvas=config.screenshotRenderer==='html2canvas' ? await (await loadCanvas())(document.body,{backgroundColor:'#ffffff',useCORS:false,allowTaint:false,
        foreignObjectRendering:false,logging:false,scale:1,x:region.x+scrollX,y:region.y+scrollY,width:region.width,height:region.height,
        ignoreElements:node=>node===host,
        onclone:doc=>{for(const selector of maskSelectors) {try {for(const node of doc.querySelectorAll(selector)) {
          const cover=doc.createElement('span'),rect=node.getBoundingClientRect();
          cover.style.setProperty('position','absolute');cover.style.setProperty('left',(rect.left+scrollX)+'px');cover.style.setProperty('top',(rect.top+scrollY)+'px');
          cover.style.setProperty('width',rect.width+'px');cover.style.setProperty('height',rect.height+'px');
          cover.style.setProperty('background','#222');cover.style.setProperty('z-index','2147483646');doc.body.appendChild(cover);
        }}catch(_){} }
        }
      }) : safeCanvas(region);
      const type=config.screenshotType==='image/jpeg'?'image/jpeg':'image/png';
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,type,config.screenshotQuality||0.9));
      if(!blob)throw new Error('Screenshot export failed');
      a.blob=blob;a.screenshot={part:'screenshot-'+a.id,width:canvas.width,height:canvas.height,type:blob.type,region};
      return blob;
    }finally {host.style.setProperty('visibility',hidden||'visible','important');}
  }
  function pageContext() {
    const keys={url:safeUrl(location.href),title:document.title,referrer:safeUrl(document.referrer||location.href),
      viewport:{width:innerWidth,height:innerHeight},devicePixelRatio:devicePixelRatio,userAgent:navigator.userAgent,
      language:navigator.language,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,timestamp:new Date().toISOString()};
    for(const key of Object.keys(keys))if(config.context[key]===false)delete keys[key];return keys;
  }
  async function buildPayload({kind,title,reporter}={}) {
    const files={};const annotations=[];
    for(const a of state.annotations) {
      if(a.screenshotEnabled && !a.blob && a.target)await captureAnnotation(a);
      const item={id:a.id,comment:a.comment,element:a.elementInfo||{name:a.element,path:a.elementPath}};
      if(a.blob && a.screenshot){item.screenshot=a.screenshot;files[a.screenshot.part]=a.blob;}annotations.push(item);
    }
    const appVersion=typeof config.appVersion==='function'?config.appVersion():config.appVersion ||
      document.querySelector('meta[name="app-version"],meta[name="version"]')?.content || '';
    const payload={schema:'annotate-html/feedback@1',id:crypto.randomUUID(),kind:kind||'bug',title:title||'',
      createdAt:new Date().toISOString(),reporter:reporter||{type:'human'},page:pageContext(),app:{version:appVersion},
      annotations,console:config.context.console===false?[]:consoleEvents.slice(),
      network:config.context.network===false?[]:networkEvents.slice(),markdown:generateOutput()};
    return {payload,files};
  }
  async function submitFeedback(options={}) {
    try {const {payload,files}=await buildPayload(options);let result;
      if(config.onSubmit)result=await config.onSubmit(payload,files);
      else {if(!config.endpoint)throw new Error('No endpoint configured');const form=new FormData();
        form.append('payload',JSON.stringify(payload));for(const [name,blob] of Object.entries(files))form.append(name,blob,name+'.'+(blob.type==='image/jpeg'?'jpg':'png'));
        const response=await fetch(config.endpoint,{method:'POST',credentials:'same-origin',headers:config.headers||{},body:form});
        if(!response.ok)throw new Error('Submit failed: HTTP '+response.status);
        result=await response.json().catch(()=>({message:'Submitted'}));
      }
      window.dispatchEvent(new CustomEvent('annotate:submitted',{detail:{payload,result}}));
      if(config.clearOnSubmit)clearAll();return result;
    }catch(e){window.dispatchEvent(new CustomEvent('annotate:error',{detail:e}));throw e;}
  }
  function showSubmitForm() {
    closePopup();popup=el('div',{id:'ann-popup'});popup.classList.add('ann-submit-form');
    const heading=el('strong',{},'Submit feedback'),kind=el('select',{'aria-label':'Kind'});
    for(const value of config.kinds)kind.appendChild(el('option',{value},value));
    const title=el('input',{type:'text',placeholder:'Title','aria-label':'Title'});
    const status=el('div',{id:'ann-submit-status'}), actions=el('div',{className:'ann-popup-actions'});
    const cancel=el('button',{onClick:closePopup},'Cancel'),send=el('button',{className:'primary'},'Submit');
    send.onclick=async()=>{send.disabled=true;status.textContent='';try{const result=await submitFeedback({kind:kind.value,title:title.value});
      status.textContent=String(result && result.message || 'Submitted');
      if(result && result.url) {const url=new URL(result.url,location.href);if(['http:','https:'].includes(url.protocol)){
        const link=el('a',{href:url.href,target:'_blank',rel:'noopener noreferrer'},url.href);status.appendChild(link);}}
    }catch(e){status.textContent=e.message;send.textContent=t('Retry');}finally{send.disabled=false;}};
    actions.append(cancel,send);popup.append(heading,kind,title,status,actions);
    popup.style.left=Math.max(12,innerWidth-420)+'px';popup.style.top=Math.max(12,innerHeight-330)+'px';root.appendChild(popup);
  }

  // Boot when DOM ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

})();
