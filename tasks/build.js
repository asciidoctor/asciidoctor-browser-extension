import fs from 'node:fs'
import { cp, mkdir, rm } from 'node:fs/promises'
import ospath from 'node:path'
import archiver from 'archiver'
import { minify } from 'csso'
import { build as esbuild } from 'esbuild'
import { compile } from 'sass'

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

function removeSourceMapReferences() {
  const path = 'app/js/vendor/chartist.min.js'
  let data = fs.readFileSync(path, 'utf8')
  console.log(`Remove sourcemap in ${path}`)
  data = data.replace(/\n\/\/# sourceMappingURL=(.*)/, '')
  fs.writeFileSync(path, data, 'utf8')
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
  manifest.background.scripts = ['js/background.js']
  fs.writeFileSync(
    ospath.join(import.meta.dirname, '..', 'dist', 'manifest-firefox.json'),
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
    const archive = archiver('zip', { zlib: { level: 9 } })
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

function compileSass() {
  console.log('compile Sass')
  const source = 'src/sass/options.scss'
  const destination = 'app/css/options.min.css'
  console.log(`compile and minify: ${source} -> ${destination}`)
  const result = compile(source, { loadPaths: ['node_modules'] })
  const minified = minify(result.css)
  fs.writeFileSync(destination, minified.css, 'utf-8')
}

async function copyVendorResources() {
  console.log('copy vendor resources')
  await Promise.all([
    cp(
      'node_modules/@asciidoctor/core/dist/browser/asciidoctor.js',
      'app/js/vendor/asciidoctor.js',
    ),
    cp(
      'node_modules/asciidoctor-kroki/dist/browser/asciidoctor-kroki.js',
      'app/js/vendor/kroki.js',
    ),
    cp(
      'node_modules/chartist/dist/chartist.min.js',
      'app/js/vendor/chartist.min.js',
    ),
    cp(
      'node_modules/@asciidoctor/core/dist/css/asciidoctor.css',
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
await downloadFonts()
replaceFontsImport()
replaceImagesURL()
removeSourceMapReferences()
compileSass()
await bundleContentScript()
generateFirefoxManifest()
await compress()
