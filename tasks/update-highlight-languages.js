const fs = require('fs')
const https = require('https')
const util = require('util')
const writeFile = util.promisify(fs.writeFile)

const HIGHLIGHT_JS_VERSION = '9.15.6'
const CDN_BASE_URL = `https://cdnjs.cloudflare.com/ajax/libs/highlight.js/${HIGHLIGHT_JS_VERSION}`
const DEST_DIRECTORY = 'app/js/vendor/highlight.js/languages'
const LANGUAGES = [
  '1c',
  'abnf',
  'accesslog',
  'actionscript',
  'ada',
  'angelscript',
  'apache',
  'applescript',
  'arcade',
  'arduino',
  'armasm',
  'asciidoc',
  'aspectj',
  'autohotkey',
  'autoit',
  'avrasm',
  'awk',
  'axapta',
  'bash',
  'basic',
  'bnf',
  'brainfuck',
  'cal',
  'capnproto',
  'ceylon',
  'clean',
  'clojure',
  'clojure-repl',
  'cmake',
  'coffeescript',
  'coq',
  'cos',
  'cpp',
  'crmsh',
  'crystal',
  'cs',
  'csp',
  'css',
  'dart',
  'delphi',
  'diff',
  'django',
  'd',
  'dns',
  'dockerfile',
  'dos',
  'dsconfig',
  'dts',
  'dust',
  'ebnf',
  'elixir',
  'elm',
  'erb',
  'erlang',
  'erlang-repl',
  'excel',
  'fix',
  'flix',
  'fortran',
  'fsharp',
  'gams',
  'gauss',
  'gcode',
  'gherkin',
  'glsl',
  'gml',
  'golo',
  'go',
  'gradle',
  'groovy',
  'haml',
  'handlebars',
  'haskell',
  'haxe',
  'hsp',
  'htmlbars',
  'http',
  'hy',
  'inform7',
  'ini',
  'irpf90',
  'isbl',
  'java',
  'javascript',
  'jboss-cli',
  'json',
  'julia',
  'julia-repl',
  'kotlin',
  'lasso',
  'ldif',
  'leaf',
  'less',
  'lisp',
  'livecodeserver',
  'livescript',
  'llvm',
  'lsl',
  'lua',
  'makefile',
  'markdown',
  'mathematica',
  'matlab',
  'maxima',
  'mel',
  'mercury',
  'mipsasm',
  'mizar',
  'mojolicious',
  'monkey',
  'moonscript',
  'n1ql',
  'nginx',
  'nimrod',
  'nix',
  'nsis',
  'objectivec',
  'ocaml',
  'openscad',
  'oxygene',
  'parser3',
  'perl',
  'pf',
  'pgsql',
  'php',
  'plaintext',
  'pony',
  'powershell',
  'processing',
  'profile',
  'prolog',
  'properties',
  'protobuf',
  'puppet',
  'purebasic',
  'python',
  'q',
  'qml',
  'reasonml',
  'rib',
  'r',
  'roboconf',
  'routeros',
  'rsl',
  'ruby',
  'ruleslanguage',
  'rust',
  'sas',
  'scala',
  'scheme',
  'scilab',
  'scss',
  'shell',
  'smali',
  'smalltalk',
  'sml',
  'sqf',
  'sql',
  'stan',
  'stata',
  'step21',
  'stylus',
  'subunit',
  'swift',
  'taggerscript',
  'tap',
  'tcl',
  'tex',
  'thrift',
  'tp',
  'twig',
  'typescript',
  'vala',
  'vbnet',
  'vbscript-html',
  'vbscript',
  'verilog',
  'vhdl',
  'vim',
  'x86asm',
  'xl',
  'xml',
  'xquery',
  'yaml',
  'zephir'
]
const get = (url) =>
  new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode === 200) {
        let data = ''
        res.on('data', (chunk) => {
          data += chunk
        })
        res.on('end', () => resolve(data))
      } else {
        reject(new Error(`statusCode is ${res.statusCode}`))
      }
    }).on('error', (e) => {
      console.log(`Unable to GET ${url}`, e)
      reject(e)
    })
  })

;(async () => {
  try {
    const content = await get(`${CDN_BASE_URL}/highlight.min.js`)
    const highlightFile = 'app/js/vendor/highlight.js/highlight.min.js'
    await writeFile(highlightFile, content, 'utf8')
    console.log(`wrote ${highlightFile}`)
    for (const lang of LANGUAGES) {
      const fileName = `${lang}.min.js`
      const url = `${CDN_BASE_URL}/languages/${fileName}`
      const data = await get(url)
      const dest = `${DEST_DIRECTORY}/${fileName}`
      await writeFile(dest, data, 'utf8')
      console.log(`wrote ${dest}`)
    }
  } catch (e) {
    console.log('error', e)
    process.exit(1)
  }
})()
