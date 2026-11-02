# annotate-html

Point at things on any webpage. Tell your AI agent what to change.

One script tag. No framework, no build step, no dependencies. Also ships as a Chrome extension for pages you don't control.

## Install

**Script tag** — add before `</body>`:

```html
<script src="https://cdn.jsdelivr.net/gh/AsimSayed/annotate-html@main/annotate.js"></script>
```

**Chrome extension** — for any page, no code changes needed:

1. Clone this repo
2. `chrome://extensions` → Developer mode → Load unpacked → select `extension/`
3. Click the asterisk icon on any tab (or press `Alt+Shift+A`)

Both channels run the same `annotate.js`.

## How it works

1. A toolbar appears bottom-right. Click **Annotate** or press `Alt+A` — an asterisk cursor appears
2. Hover any element to see its selector and highlight. Click to open a popup with computed styles and a feedback field
3. Markers drop at your click position. Hover to preview, click to edit
4. Press `C` to copy all feedback as structured markdown. Paste into Claude Code, Cursor, or any AI coding tool

The toolbar collapses to a round button when closed. Rulers along the top and left edges let you drag out guide lines for alignment.

### Keyboard shortcuts

| Key | What it does |
|---|---|
| `Alt+A` | Toggle annotation mode |
| `C` | Copy markdown |
| `M` | Marker color picker |
| `H` | Show/hide markers, rulers, guides |
| `Cmd/Ctrl+Enter` | Submit annotation |
| `Esc` | Close popup or exit mode |

### Color picker

Click the color swatch or press `M`. Seven colors. Choosing one repaints everything — markers, highlights, cursor, active states, badges, buttons.

## What gets captured

Each annotation records what an AI agent needs to find and fix the right code:

- **Element name** — `button "Download"`, `h2 "Features"`, `image "hero.png"`
- **Selector path** — `.hero > .cta > .btn-primary`
- **CSS classes, bounding box, computed styles**
- **Selected text** (if you highlight before clicking)
- **Nearby text context** from sibling elements
- **Accessibility info** — role, aria-label, focusable

### Example output

```markdown
## Page Feedback: /index.html
**Viewport:** 1440×900

### 1. button "Download for macOS"
**Location:** .hero > .wrap > .hero-actions > .btn-primary
**Classes:** btn-primary
**Position:** 420px, 380px (180×48px)
**Feedback:** Make the border-radius softer, more like 100px pill shape

### 2. h2 "Built with Swift."
**Location:** .native-section > .wrap > .vis
**Feedback:** Font weight feels too heavy here, try 600 instead of 700
```


## Embed in any app (reverse proxy injection)

This fork adds a page-feedback collector and QA API while preserving the original annotation toolbar. Serve the script and optional screenshot vendor from the **same origin** as the target app. For example:

```nginx
location / {
    proxy_pass http://app;
    proxy_set_header Accept-Encoding ""; # sub_filter cannot rewrite compressed HTML
    sub_filter_types text/html;
    sub_filter_once on;
    sub_filter '</body>' '<script src="/feedback/annotate.js" data-endpoint="/feedback/submit"></script></body>';
}
location /feedback/ {
    alias /srv/feedback-widget/;
}
```

Route `/feedback/submit` to your own collector rather than serving it as a static file. A reverse proxy may also need to adjust cache headers and content length after substitution. Injection requires a closing `</body>` in the HTML response.

### Configuration

Set `window.AnnotateHtmlConfig = {...}` before loading the script. `data-endpoint`, `data-lang`, `data-screenshot`, `data-kinds` (comma-separated), `data-position`, and `data-start-hidden` on the script override corresponding global values.

| Option | Default | Purpose |
| --- | --- | --- |
| `endpoint` / `onSubmit(payload, files)` | unset | Enable Submit; POST multipart or custom promise hook. Without either, Submit is hidden (including extension mode). |
| `headers` | `{}` | Additional same-origin POST headers; do not set `Content-Type` for multipart. |
| `kinds` | `['bug','request','agent']` | Submission type options. |
| `lang` | `en` | `en` or `zh-CN`. |
| `ui` | `true` | Set `false` for headless QA scripts. |
| `screenshot` | `false` | Default screenshot toggle for new annotations. |
| `screenshotPadding` / `screenshotRegion` | `120` / target | Pixels around target or `viewport`. |
| `screenshotRenderer` | safe canvas | `html2canvas` for higher-fidelity rendering on compatible policies. |
| `screenshotType` / `screenshotQuality` | PNG / `0.9` | Optional JPEG and encoding quality. |
| `vendorUrl` | sibling `vendor/html2canvas.min.js` | Same-origin vendor override. |
| `maskSelectors` / `maskAllInputs` | `['[data-annotate-mask]','.rr-mask','.rr-block']` / `false` | Solid-block screenshot redaction; passwords always masked. |
| `semanticAttributes` | common data-test attributes | Element metadata lookup. |
| `appVersion` | version meta tag | String or function. |
| `context` | all enabled | Per-field `false` disables page fields; `console`/`network` disable event arrays. |
| `maxEvents` / `responseHeaders` | `20` / request/trace IDs | Ring-buffer size and safe response-header allowlist. |
| `clearOnSubmit` | `true` | Keep annotations after successful submit when false. |
| `styleNonce` / `cssUrl` | unset | Stylesheet fallback for browsers without constructable stylesheets. |

### Submit and collector contract

The collector accepts `multipart/form-data`: a JSON `payload` field and optional `screenshot-<annotationId>` image files. See [versioned schema and examples](docs/payload-schema.md). The UI shows `message` and a link from JSON responses. A failed request leaves annotations for retry. `credentials: 'same-origin'` is used for the default POST.

### Programmatic API for QA agents

```js
const api = window.__annotateHtml;
await api.annotate({target: '#save', comment: 'No success confirmation', screenshot: true});
const {payload, files} = await api.buildPayload({kind:'bug', reporter:{type:'agent',name:'Browser QA'}});
await api.submit({kind:'bug', title:'Missing confirmation', reporter:{type:'agent'}});
api.list(); api.remove('ann-1'); api.clear(); api.configure({clearOnSubmit:false});
```

`toggle`, `show`, `hide` and `seed` remain available. `annotate:created`, `annotate:submitted`, and `annotate:error` are dispatched on `window`. Use `{ui:false}` for automated runs without a toolbar. Human and agent requests share the same payload builder.

### CSP and screenshot privacy

The widget uses a single open shadow root, constructable stylesheets and CSSOM setters; it does not insert inline style attributes or global CSS. Scripts and the optional vendored html2canvas file must be served from the app's origin. No external fonts are required. Three policy fixtures are exercised by Playwright tests.

The default safe-canvas renderer intentionally approximates page boxes and text instead of embedding the DOM as images: this avoids `data:` image violations on restrictive `img-src 'self'` policies. Use `screenshotRenderer:'html2canvas'` for greater fidelity where the host policy permits its internal `data:` image probes; under `img-src 'self'` those probes generate CSP violations even when the resulting canvas exports. Passwords are always drawn as solid blocks; other configured masks are applied before rasterization. Sensitive values in DOM metadata or comments are **not** automatically redacted. Preview thumbnails may be unavailable under policies disallowing `blob:` images.

## License

MIT

## Credits

Element identification approach adapted from [Agentation](https://github.com/benjitaylor/agentation) (MIT). Built by [Asim Sayed](https://asimsayed.com).
