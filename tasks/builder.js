'use strict'
module.exports = Builder

const ospath = require('node:path')
const fs = require('node:fs')
const log = require('bestikk-log')
const bfs = require('bestikk-fs')
const archiver = require('archiver')
const sass = require('sass')
const csso = require('csso')

function Builder () {
}

Builder.prototype.uncommentFontsImport = function () {
  const path = 'app/css/themes/asciidoctor.css'
  let data = fs.readFileSync(path, 'utf8')
  log.debug('Uncomment fonts @import in asciidoctor.css')
  data = data.replace(/\/\*(@import "[^"]+";)\*\//g, '$1')
  fs.writeFileSync(path, data, 'utf8')
}

Builder.prototype.replaceImagesURL = function () {
  const themesNamesWithImages = ['github', 'golo', 'maker', 'riak']

  function replaceURL (themeName) {
    const path = `app/css/themes/${themeName}.css`
    let data = fs.readFileSync(path, 'utf8')
    log.debug(`Replace images url in ${themeName}.css`)
    data = data.replace(/url\('\.\.\/images\/([^']+)'/, 'url(\'../../img/themes/$1\'')
    fs.writeFileSync(path, data, 'utf8')
  }

  themesNamesWithImages.forEach(replaceURL)
}

Builder.prototype.removeSourceMapReferences = function () {
  const path = 'app/js/vendor/chartist.min.js'
  let data = fs.readFileSync(path, 'utf8')
  log.debug(`Remove sourcemap in ${path}`)
  data = data.replace(/\n\/\/# sourceMappingURL=(.*)/, '')
  fs.writeFileSync(path, data, 'utf8')
}

Builder.prototype.clean = function () {
  log.task('clean')
  log.debug('remove dist directory')
  bfs.removeSync('dist')
  bfs.mkdirsSync('dist')
}

Builder.prototype.generateFirefoxManifest = function () {
  const manifestPath = ospath.join(__dirname, '..', 'app', 'manifest.json')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  manifest.web_accessible_resources[0].extension_ids = [
    'asciidoctor-firefox-addon@asciidoctor.org',
    '*'
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
    'js/vendor/asciidoctor-emoji-inline-macro.js'
  ]
  fs.writeFileSync(ospath.join(__dirname, '..', 'dist', 'manifest-firefox.json'), JSON.stringify(manifest, null, 2))
}

Builder.prototype.compress = function () {
  log.task('compress')
  const manifestPath = ospath.join(__dirname, '..', 'app', 'manifest.json')
  const version = require(manifestPath).version
  // firefox
  firefoxArchive(version)

  // chrome
  chromeArchive(version)
}

function chromeArchive (version) {
  const archive = createArchive(`dist/asciidoctor-browser-extension-${version}.zip`)
  archive.file('LICENSE')
  archive.file('README.adoc')
  archive.file('changelog.adoc')
  archive.directory('app/', false)
  archive.finalize()
}

function firefoxArchive (version) {
  const archive = createArchive(`dist/asciidoctor-browser-extension-firefox-${version}.zip`)
  archive.file('LICENSE')
  archive.file('README.adoc')
  archive.file('changelog.adoc')
  archive.directory('app/css', 'css')
  archive.directory('app/fonts', 'fonts')
  archive.directory('app/html', 'html')
  archive.directory('app/img', 'img')
  archive.directory('app/js', 'js')
  archive.directory('app/vendor', 'vendor')
  archive.file('dist/manifest-firefox.json', {
    name: 'manifest.json'
  })
  archive.finalize()
}

function createArchive (outputPath) {
  const output = fs.createWriteStream(outputPath)
  const archive = archiver('zip', { zlib: { level: 9 } })
  output.on('close', function () {
    log.debug(outputPath + ' ' + archive.pointer() + ' total bytes written')
  })
  archive.on('warning', function (err) {
    if (err.code === 'ENOENT') {
      log.warn('archiver warning: ' + err)
    } else {
      throw err
    }
  })
  archive.on('error', function (err) {
    throw err
  })
  archive.pipe(output)
  return archive
}

Builder.prototype.compileSass = function () {
  log.task('compile Sass')
  const source = 'src/sass/options.scss'
  const destination = 'app/css/options.min.css'
  log.transform('compile and minify', source, destination)
  const result = sass.compile(source, { loadPaths: ['node_modules'] })
  const minified = csso.minify(result.css)
  fs.writeFileSync(destination, minified.css, 'utf-8')
}

Builder.prototype.copy = function () {
  log.task('copy vendor resources')
  // JavaScript files
  bfs.copySync('node_modules/@asciidoctor/core/dist/browser/asciidoctor.js', 'app/js/vendor/asciidoctor.js')
  bfs.copySync('node_modules/asciidoctor-kroki/dist/browser/asciidoctor-kroki.js', 'app/js/vendor/kroki.js')
  bfs.copySync('node_modules/chartist/dist/chartist.min.js', 'app/js/vendor/chartist.min.js')
  // Stylesheets
  bfs.copySync('node_modules/@asciidoctor/core/dist/css/asciidoctor.css', 'app/css/themes/asciidoctor.css')
  bfs.copySync('node_modules/font-awesome/css/font-awesome.min.css', 'app/css/font-awesome.min.css')
  // Web Fonts
  bfs.copySync('node_modules/font-awesome/fonts/fontawesome-webfont.woff2', 'app/fonts/fontawesome-webfont.woff2')
}

Builder.prototype.dist = function () {
  this.clean()
  this.copy()
  this.uncommentFontsImport()
  this.replaceImagesURL()
  this.removeSourceMapReferences()
  this.compileSass()
  this.generateFirefoxManifest()
  this.compress()
}
