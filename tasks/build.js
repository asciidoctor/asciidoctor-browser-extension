import fs from 'node:fs'
import { cp, mkdir, rm } from 'node:fs/promises'
import ospath from 'node:path'
import archiver from 'archiver'
import { minify } from 'csso'
import { compile } from 'sass'

function uncommentFontsImport() {
  const path = 'app/css/themes/asciidoctor.css'
  let data = fs.readFileSync(path, 'utf8')
  console.log('Uncomment fonts @import in asciidoctor.css')
  data = data.replace(/\/\*(@import "[^"]+";)\*\//g, '$1')
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
  manifest.background.scripts = [
    'js/vendor/md5.js',
    'js/vendor/asciidoctor.js',
    'js/vendor/kroki.js',
    'js/module/namespace.js',
    'js/module/settings.js',
    'js/converter.js',
    'js/background.js',
    'js/vendor/asciidoctor-chart-block-macro.js',
    'js/vendor/asciidoctor-emoji-inline-macro.js',
  ]
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
uncommentFontsImport()
replaceImagesURL()
removeSourceMapReferences()
compileSass()
generateFirefoxManifest()
await compress()
