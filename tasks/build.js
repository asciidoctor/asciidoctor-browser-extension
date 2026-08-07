import fs from 'node:fs'
import { cp, mkdir, rm } from 'node:fs/promises'
import ospath from 'node:path'
import { ZipArchive } from 'archiver'
import { minify } from 'csso'
import { build as esbuild } from 'esbuild'

async function downloadFonts() {
  console.log('download fonts')
  const fontsDir = 'app/fonts/asciidoctor'
  await mkdir(fontsDir, { recursive: true })
  const googleFontsUrl =
    'https://fonts.googleapis.com/css?family=Open+Sans:300,300italic,400,400italic,600,600italic|Noto+Serif:400,400italic,700,700italic|Droid+Sans+Mono:400,700'
  const cssResponse = await fetch(googleFontsUrl, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
  })
  const css = await cssResponse.text()
  const fontUrls = [
    ...new Set(
      [
        ...css.matchAll(
          /url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.woff2)\)/g,
        ),
      ].map((m) => m[1]),
    ),
  ]
  const urlToLocal = new Map()
  for (const url of fontUrls) {
    const filename = new URL(url).pathname.split('/').pop()
    const fontResponse = await fetch(url)
    const buffer = await fontResponse.arrayBuffer()
    fs.writeFileSync(`${fontsDir}/${filename}`, Buffer.from(buffer))
    urlToLocal.set(url, `../fonts/asciidoctor/${filename}`)
  }
  const localCss = css.replace(
    /url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.woff2)\)/g,
    (_, url) => `url('${urlToLocal.get(url)}')`,
  )
  fs.writeFileSync('app/css/asciidoctor-fonts.css', localCss)
  console.log(`Downloaded ${fontUrls.length} font files`)
}

function replaceFontsImport() {
  const path = 'app/css/themes/asciidoctor.css'
  let data = fs.readFileSync(path, 'utf8')
  console.log(
    'Replace Google Fonts @import with local fonts in asciidoctor.css',
  )
  data = data.replace(
    /\/\*\s*@import "https:\/\/fonts\.googleapis\.com\/[^"]+";?\s*\*\//g,
    '@import "../asciidoctor-fonts.css";',
  )
  fs.writeFileSync(path, data, 'utf8')
}

function appendDarkModeStyles() {
  const path = 'app/css/themes/asciidoctor.css'
  console.log('Append dark mode overrides to asciidoctor.css')
  const darkModeCss = fs.readFileSync(
    'src/css/asciidoctor-dark-mode.css',
    'utf8',
  )
  fs.appendFileSync(path, `\n${darkModeCss}`)
}

function appendEmbeddableOverrides() {
  const path = 'app/css/themes/asciidoctor.css'
  console.log('Append embeddable-output overrides to asciidoctor.css')
  const embeddableCss = fs.readFileSync(
    'src/css/asciidoctor-embeddable-overrides.css',
    'utf8',
  )
  fs.appendFileSync(path, `\n${embeddableCss}`)
}

function restrictFontAwesomeToWoff2() {
  const path = 'app/css/font-awesome.min.css'
  console.log('Restrict font-awesome.min.css @font-face src to woff2 only')
  const data = fs.readFileSync(path, 'utf8')
  const updated = data.replace(
    /src:url\('[^']+\.eot[^']*'\);src:url\('[^']+\.eot[^']*'\) format\('embedded-opentype'\),url\('([^']+\.woff2[^']*)'\) format\('woff2'\),url\('[^']+\.woff[^']*'\) format\('woff'\),url\('[^']+\.ttf[^']*'\) format\('truetype'\),url\('[^']+\.svg[^']*'\) format\('svg'\);/,
    "src:url('$1') format('woff2');",
  )
  if (updated === data) {
    throw new Error(
      `Could not restrict @font-face src in ${path} to woff2 (font-awesome package format may have changed)`,
    )
  }
  fs.writeFileSync(path, updated, 'utf8')
}

function replaceImagesURL() {
  for (const themeName of ['github', 'golo', 'maker', 'riak']) {
    const path = `app/css/themes/${themeName}.css`
    let data = fs.readFileSync(path, 'utf8')
    console.log(`Replace images url in ${themeName}.css`)
    data = data.replace(
      /url\('\.\.\/images\/([^']+)'/,
      "url('../../img/themes/$1'",
    )
    fs.writeFileSync(path, data, 'utf8')
  }
}

async function bundleChartist() {
  console.log('bundle vendor: chartist')
  await esbuild({
    entryPoints: ['node_modules/chartist/dist/index.umd.js'],
    minify: true,
    outfile: 'app/js/vendor/chartist.min.js',
  })
  const css = fs.readFileSync('node_modules/chartist/dist/index.css', 'utf-8')
  const minified = minify(css)
  fs.writeFileSync('app/css/chartist.min.css', minified.css, 'utf-8')
}

async function clean() {
  console.log('clean')
  await rm('dist', { recursive: true, force: true })
  await mkdir('dist', { recursive: true })
}

async function bundleContentScript() {
  console.log('bundle content script')
  await esbuild({
    entryPoints: ['app/js/contentScript.js'],
    bundle: true,
    format: 'iife',
    outfile: 'app/js/content-bundle.js',
    platform: 'browser',
  })
}

async function bundleBackgroundScript() {
  console.log('bundle background script')
  await esbuild({
    entryPoints: ['app/js/background.js'],
    bundle: true,
    format: 'iife',
    outfile: 'app/js/background-bundle.js',
    platform: 'browser',
    // asciidoctor.js's browser build still contains Node-only dynamic
    // imports (node:fs/promises, node:path) behind a runtime environment
    // check for when it's loaded under Node.js; they're never reached in
    // the browser, but esbuild needs them marked external to bundle at all.
    external: ['node:*'],
  })
}

function generateFirefoxManifest() {
  const manifestPath = ospath.join(
    import.meta.dirname,
    '..',
    'app',
    'manifest.json',
  )
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  manifest.web_accessible_resources[0].extension_ids = [
    'asciidoctor-firefox-addon@asciidoctor.org',
    '*',
  ]
  delete manifest.background.service_worker
  manifest.background.scripts = ['js/background-bundle.js']
  fs.writeFileSync(
    ospath.join(import.meta.dirname, '..', 'dist', 'manifest-firefox.json'),
    JSON.stringify(manifest, null, 2),
  )
}

function generateSafariManifest() {
  const manifestPath = ospath.join(
    import.meta.dirname,
    '..',
    'app',
    'manifest.json',
  )
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  // Safari doesn't support the file: scheme in match patterns; a
  // web_accessible_resources entry containing one is rejected wholesale
  // ("Entrée « web_accessible_resources » du manifeste non valide"), taking
  // down every resource it lists (fonts, themes, JS modules, the on/off
  // toolbar icons) with it.
  manifest.web_accessible_resources[0].matches =
    manifest.web_accessible_resources[0].matches.filter(
      (pattern) => !pattern.startsWith('file://'),
    )
  // Safari's MV3 service_worker background mode is unreliable -- it can
  // silently fail to start at all, with no error surfaced anywhere. Use the
  // non-module scripts form instead (same as the Firefox manifest), which
  // is the workaround documented across multiple Apple Developer Forum
  // threads for this exact symptom.
  delete manifest.background.service_worker
  manifest.background.scripts = ['js/background-bundle.js']
  // The Xcode project references this file (via a PBXFileReference whose
  // path is dist/manifest.json) to get copied into the .appex bundle as a
  // Copy Resources build phase, which uses the file's real basename -- not
  // the file reference's display name -- so it must literally be named
  // manifest.json for Safari to recognize it.
  fs.writeFileSync(
    ospath.join(import.meta.dirname, '..', 'dist', 'manifest.json'),
    JSON.stringify(manifest, null, 2),
  )
}

async function compress() {
  console.log('compress')
  const manifestPath = ospath.join(
    import.meta.dirname,
    '..',
    'app',
    'manifest.json',
  )
  const { version } = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  await Promise.all([
    createZip(
      `dist/asciidoctor-browser-extension-${version}.zip`,
      (archive) => {
        archive.file('LICENSE')
        archive.file('README.adoc')
        archive.file('changelog.adoc')
        archive.directory('app/', false)
      },
    ),
    createZip(
      `dist/asciidoctor-browser-extension-opera-${version}.zip`,
      (archive) => {
        // Opera's addon validator rejects the whole package when it
        // encounters a file extension it doesn't recognize ("type de
        // fichier inconnu"), so .adoc files (changelog.adoc, README.adoc)
        // are left out here.
        archive.file('LICENSE')
        archive.directory('app/', false)
      },
    ),
    createZip(
      `dist/asciidoctor-browser-extension-firefox-${version}.zip`,
      (archive) => {
        archive.file('LICENSE')
        archive.file('README.adoc')
        archive.file('changelog.adoc')
        archive.directory('app/css', 'css')
        archive.directory('app/fonts', 'fonts')
        archive.directory('app/html', 'html')
        archive.directory('app/img', 'img')
        archive.directory('app/js', 'js')
        archive.directory('app/vendor', 'vendor')
        archive.file('dist/manifest-firefox.json', { name: 'manifest.json' })
      },
    ),
  ])
}

function createZip(outputPath, addFiles) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath)
    const archive = new ZipArchive({
      zlib: { level: 9 },
    })
    output.on('close', () => {
      console.log(`${outputPath}: ${archive.pointer()} bytes`)
      resolve()
    })
    archive.on('warning', (err) =>
      err.code === 'ENOENT' ? console.warn(err) : reject(err),
    )
    archive.on('error', reject)
    archive.pipe(output)
    addFiles(archive)
    archive.finalize().then()
  })
}

function minifyOptionsCss() {
  const source = 'src/css/options.css'
  const destination = 'app/css/options.min.css'
  console.log(`minify: ${source} -> ${destination}`)
  const css = fs.readFileSync(source, 'utf-8')
  const minified = minify(css)
  fs.writeFileSync(destination, minified.css, 'utf-8')
}

async function copyVendorResources() {
  console.log('copy vendor resources')
  await Promise.all([
    cp(
      'node_modules/@asciidoctor/core/build/browser/index.js',
      'app/js/vendor/asciidoctor.js',
    ),
    cp(
      'node_modules/asciidoctor-kroki/build/browser/index.js',
      'app/js/vendor/kroki.js',
    ),
    cp(
      'node_modules/asciidoctor-emoji/src/asciidoctor-emoji.js',
      'app/js/vendor/asciidoctor-emoji-inline-macro.js',
    ),
    cp(
      'node_modules/asciidoctor-emoji/src/twemoji-map.js',
      'app/js/vendor/twemoji-map.js',
    ),
    cp(
      'node_modules/@asciidoctor/core/data/asciidoctor-default.css',
      'app/css/themes/asciidoctor.css',
    ),
    cp(
      'node_modules/font-awesome/css/font-awesome.min.css',
      'app/css/font-awesome.min.css',
    ),
    cp(
      'node_modules/font-awesome/fonts/fontawesome-webfont.woff2',
      'app/fonts/fontawesome-webfont.woff2',
    ),
  ])
}

await clean()
await copyVendorResources()
restrictFontAwesomeToWoff2()
await bundleChartist()
await downloadFonts()
replaceFontsImport()
appendDarkModeStyles()
appendEmbeddableOverrides()
replaceImagesURL()
minifyOptionsCss()
await bundleContentScript()
await bundleBackgroundScript()
generateFirefoxManifest()
generateSafariManifest()
await compress()
