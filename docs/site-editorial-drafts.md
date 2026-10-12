# Site editorial drafts

`site_editorial_drafts` stores `materia_site`, `resumo_site` and `image_url` by `noticia_id`. It accepts partial text and unfinished image URLs. It contains no approval, receipt, publication or social-platform state. Only the authenticated WireGeek backend can access it through its service role.

API on `/api/publicacoes?mode=site-publish`:

- `GET &action=draft&noticia_id=…`: load the draft or return `data: null`.
- `POST { action: "save-draft", noticia_id, materia_site, resumo_site, image_url }`: replace those three fields, preserving literal text, including empty values.
- Failed storage returns HTTP 503 and `EDITORIAL_DRAFT_STORAGE_UNAVAILABLE`; malformed or oversized inputs return HTTP 422. Existing auth and news ID gates apply to both actions.

The panel loads drafts before allowing editing. When none exists, it restores existing approval text or published text for compatibility, without granting approval to the restored state. A saved draft takes precedence even when its fields are empty. Reloading publication status does not replace an edited draft.

Normal generation makes one OpenAI call with purpose `site-editorial`, validates the editorial contract locally (including no lists, headings or repeated paragraphs), and hands the result to immediate autosave. It does not call `site-editorial-verification` or issue an approval receipt. `verify-editorial` remains an optional manual action; its failure or timeout does not write or clear drafts and is never a prerequisite for generation, autosave or publication. Generation and returned review text save immediately. Editing text, summary or image schedules a save after 1.5 seconds. Writes are serialized within this browser session. Switching news flushes pending edits for the original ID; late responses cannot update another selected news item. Leaving/hiding the page flushes pending edits, uses `keepalive` for bounded requests and warns before unloading when a write remains outstanding. The panel shows pending, saving, saved and error states and offers a manual retry after save failure. A draft read failure blocks editing instead of silently overwriting unknown remote content.

Approval stays an explicit, proof-checked action. Autosave never calls that action or publishes. Publication validates the existing editorial contract (1800–3500 characters, 3–5 paragraphs, summary 120–280 characters) and a credential-free HTTPS image. An explicit image from the panel is now honored; callers omitting `image_url` retain the previous canonical-image fallback. No Meta, Instagram or Facebook flow is changed.

## Deployment prerequisite

Apply `supabase/migrations/20261012030611_site_editorial_drafts.sql` to the intended environment before enabling this frontend there. This PR does not apply remote migrations, merge or deploy production. A Preview using a database without this migration will report that draft storage is unavailable. Do not point a Preview at production to test writes.

## Verification and limits

Regression tests exercise the real React draft hook with synthetic HTTP responses, backend round trips with an injected database, serialized autosave/debounce/retry, page exit, remount/reload, explicit empty image, news switching and stale reads. PGlite executes the migration and verifies service access, constraints, foreign keys, cascade and denied public access. Tests also verify draft actions cannot touch approval/publication tables or call external services, and valid publication does not require an approval row.

These are local tests, not authenticated browser/remote Supabase E2E or real publication proof. Browser unload delivery remains best effort during network failure or forced process termination; the saved indicator means the backend acknowledged the write. Simultaneous edits from separate browsers use last-write-wins; this change does not introduce collaborative editing or version conflict resolution. No paid inference is used by the tests.
