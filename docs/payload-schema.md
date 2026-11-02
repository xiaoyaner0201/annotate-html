## Payload contract (v1)

`payload` is a JSON string part in `multipart/form-data`. Screenshot parts use the name `screenshot-<annotationId>` and the corresponding `annotations[].screenshot.part` references that name. The schema is [`schema/feedback-v1.schema.json`](../schema/feedback-v1.schema.json), using JSON Schema draft 2020-12. Neither the browser UI nor automated clients use a different format.

Top-level fields: `schema` (`annotate-html/feedback@1`), UUID `id`, `kind`, `title`, ISO `createdAt`, `reporter` (`type: human | agent`, optional `name` and `id`), `page`, `app.version`, `annotations`, `console`, `network`, and `markdown`. Each annotation has `id`, `comment`, `element`, and optional `screenshot` (`part`, pixel `width`, `height`, MIME `type`, viewport `region`, optional `renderer` (`html2canvas-pro` or `fallback`) and optional fallback `error`).

Page context includes URL (with sensitive query parameters dropped), title, referrer, viewport, device pixel ratio, user agent, language, timezone and timestamp. `context` flags can disable individual page fields and console/network arrays. Console messages and stacks are truncated to 500 characters; request metadata excludes bodies and authentication headers. Because URL paths or free-text comments can themselves contain secrets, review collector-side access and retention policies.

Collector response should be JSON with optional `message` and `url`. Non-2xx responses reject submission without clearing annotations. `clearOnSubmit: false` retains them after success too. A custom `onSubmit(payload, files)` replaces the HTTP request and receives an object mapping screenshot part names to PNG/JPEG `Blob`s.
