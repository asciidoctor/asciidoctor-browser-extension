# asciidoctor-browser-extension

Chrome/Firefox/Edge/Opera/Safari browser extension (Manifest V3) that renders AsciiDoc files (`.ad`, `.adoc`, `.asc`, `.asciidoc`, optionally `.txt`) as HTML directly in the browser.
Works for both remote (`http(s)://`) and local (`file://`) documents.

## Layout

- `app/`: the actual extension source, loaded directly by the browser.
  It is not a generated directory, despite looking like a build output.
  This is what `chrome://extensions` → *Load unpacked* points at.
  - `app/manifest.json`: MV3 manifest (Chrome/Chromium/Edge/Opera flavor).
  - `app/js/background.js`: background service worker entry point.
    It owns the actual AsciiDoc→HTML conversion (via `module/converter.js`), CSS injection into the page, custom-JS injection, context menu, HTML export.
  - `app/js/contentScript.js`: trivial entry point, just calls `module/main.js`'s `init()`.
  - `app/js/module/`: the extension's own hand-written modules (`converter.js`, `dom.js`, `page.js`, `settings.js`, `theme.js`, `constants.js`).
    Also listed in `manifest.json`'s `web_accessible_resources` since some are dynamically imported.
  - `app/js/vendor/`: third-party libraries, vendored/bundled in-repo: `asciidoctor.js` (core, from `@asciidoctor/core`), `chartist.min.js` (built from `node_modules/chartist` by `tasks/build.js`), `kroki.js`, `md5.js`, `asciidoctor-chart-block-macro.js` (this repo's own `chart::` block macro, reads a local CSV-like file via `readAsset` and renders it with Chartist), `asciidoctor-emoji-inline-macro.js`, `highlight.js/*`.
    Excluded from Biome linting (see `biome.json`).
  - `app/js/background-bundle.js`, `app/js/content-bundle.js`: esbuild output (gitignored), built from `background.js`/`contentScript.js` by `tasks/build.js`.
    The manifest's `background.service_worker` and the second `content_scripts` entry point at these, not at the raw sources.
  - `app/html/`, `app/css/`, `app/img/`, `app/fonts/`: static assets.
- `src/`: a handful of CSS partials (`asciidoctor-dark-mode.css`, `asciidoctor-embeddable-overrides.css`, `options.css`) that `tasks/build.js` appends/copies into `app/css/` during the build.
  It is not a general "source lives here" directory.
  Most JS source is directly under `app/js/`.
- `tasks/build.js`: the whole build.
  It downloads Google Fonts and vendors them locally, appends dark-mode/embeddable CSS overrides, rewrites theme CSS image URLs, and bundles Chartist and the content/background scripts with esbuild.
  It also generates a Firefox-specific manifest variant and zips per-browser packages into `dist/`.
  This includes special-cased packages, e.g. Opera excludes `.adoc`/`README.adoc` because its validator rejects the `.adoc` file type.
- `dist/`: build output (zips + unpacked variants per browser). Gitignored.
- `safari/`: Xcode project wrapping the extension as a Safari Web Extension.
  `npm run build:safari` builds `app/` then runs `xcodebuild`.
  Safari does not support `file://` at all (no manifest matches, no `web_accessible_resources` for it).
  See `docs/modules/ROOT/pages/safari-known-issues.adoc`.
- `docs/`: Antora documentation module (`docs/antora.yml`, `docs/modules/ROOT/pages/*.adoc`), published as the project's user docs site.
  Update these alongside any user-visible feature change, not just the changelog (nav lives in `docs/modules/ROOT/nav.adoc`).
  Notably `docs/modules/ROOT/pages/privacy.adoc` explains what each manifest permission is used for and why.
  Keep it in sync with `manifest.json`.
- `spec/`: Playwright tests (`spec/browser/`) and fixtures (`spec/fixtures/`).
  Run via `npm test` (`playwright test`).
- `changelog.adoc`: user-facing changelog (AsciiDoc, not Markdown).
  Has a `merge=union` git attribute so parallel "Unreleased" entries merge without conflicting.
- `contrib/`, `promotional/`: sample AsciiDoc book used in docs/examples, and store-listing assets.

## Architecture notes

- Conversion happens entirely in the background service worker (`module/converter.js`'s `convert`/`fetchAndConvert`), not in the content script.
  The content script fetches/detects the page and messages the background script (`action: 'convert'` / `'fetch-convert'`) to get back rendered HTML.
- Local file reading (for the top-level document, `include::` targets, and the `chart::` macro's data file) all goes through `fetch()` on `file://` URLs from the background service worker.
  This is why `file://*/*`-style patterns exist in `host_permissions`/`content_scripts` matches in `app/manifest.json`.
  Chrome additionally requires the user to manually enable "Allow access to file URLs" for the extension in `chrome://extensions` before any of this works at all.
  This is a browser-level toggle, orthogonal to manifest-declared host permissions.
  See `docs/modules/ROOT/pages/install.adoc`.
- Firefox isolates every `file://` page into its own unique origin (`privacy.file_unique_origin`), which can silently break `include::` across sibling `file://` files.
  See `docs/modules/ROOT/pages/firefox-known-issues.adoc`.
- `chrome.permissions` is not available to content scripts (isolated world), only to extension pages (background, options, popup).
  Anything involving `chrome.permissions.request`/`.contains` has to be driven from the background script or an extension page, not `main.js`/`page.js`.

## Commands

- `npm run build`: lint (Biome) then run `tasks/build.js`.
- `npm run lint` / `npm run format`: Biome check / write.
- `npm test`: Playwright tests.
- `npm run build:safari` / `npm run open:safari`: Safari packaging.
- `npm run validate:firefox`: runs `addons-linter` against the built Firefox zip.
