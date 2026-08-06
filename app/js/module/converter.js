/* global chrome, browser */

import { Extensions, Logger, load, Severity } from '../vendor/asciidoctor.js'
import { register as registerChartExtension } from '../vendor/asciidoctor-chart-block-macro.js'
import { register as registerEmojiExtension } from '../vendor/asciidoctor-emoji-inline-macro.js'
import KrokiExtension from '../vendor/kroki.js'
import { md5 } from '../vendor/md5.js'
import {
  getBrowserInfo,
  getRenderingSettings,
  getSetting,
  isExtensionEnabled,
} from './settings.js'

const webExtension =
  typeof browser !== 'undefined'
    ? browser
    : typeof chrome !== 'undefined'
      ? chrome
      : null
const isFirefox = getBrowserInfo().name === 'Firefox'
const eqnumValidValues = ['none', 'all', 'ams']

// Firefox refuses to let the background page itself fetch() a file:// URL
// (see fetchAndConvert below) -- and that restriction applies just as much
// to the fetch() calls Asciidoctor.js makes internally while resolving
// include::/Kroki-local-file targets during load()/convert(). Route those
// file:// requests through the content script for the duration of a single
// conversion by temporarily substituting the global fetch. Conversions are
// serialized through fileUriRoutingQueue so two file:// tabs converting
// around the same time can never see each other's patched fetch.
let fileUriRoutingQueue = Promise.resolve()

async function relayFileFetch(tabId, url) {
  let text
  try {
    text = await webExtension.tabs.sendMessage(tabId, {
      action: 'get-file-source',
      url,
    })
  } catch (error) {
    // no content script listening, or the content script's own fetch
    // failed (e.g. Firefox's file:// origin isolation, see #302)
    // eslint-disable-next-line no-console
    console.warn(`get-file-source relay failed for ${url}:`, error)
    text = undefined
  }
  return text === undefined
    ? new Response(null, { status: 404 })
    : new Response(text, { status: 200 })
}

function withFileUriRouting(tabId, fn) {
  const run = async () => {
    const realFetch = globalThis.fetch
    globalThis.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input.url
      return url.startsWith('file://')
        ? relayFileFetch(tabId, url)
        : realFetch(input, init)
    }
    try {
      return await fn()
    } finally {
      globalThis.fetch = realFetch
    }
  }
  const result = fileUriRoutingQueue.then(run, run)
  fileUriRoutingQueue = result.then(
    () => {},
    () => {},
  )
  return result
}

function needsFileUriRouting(url, tabId) {
  return isFirefox && tabId !== undefined && url.startsWith('file://')
}

// Asciidoctor's default logger always writes to console.error, regardless of
// severity, so WARNING messages (e.g. "unterminated example block") show up
// as red errors in the browser console. Route by severity via a pipe
// instead, so only ERROR/FATAL use console.error. A single instance is
// reused across conversions; `load()` scopes it to each conversion via
// `withLogger()`.
const browserConsoleLogger = new Logger({
  pipe: (line, severity) => {
    const text = line.replace(/\n$/, '')
    if (severity >= Severity.ERROR) {
      console.error(text)
    } else if (severity === Severity.WARN) {
      console.warn(text)
    } else {
      console.info(text)
    }
  },
})

function executeRequest(url) {
  return fetch(url, {
    method: 'GET',
    headers: {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Accept: 'text/plain, */*',
    },
  })
}

function isHtmlContentType(response) {
  const contentType = response.headers.get('content-type')
  return contentType && contentType.indexOf('html') > -1
}

// A same-page anchor click (e.g. a ToC entry) updates the tab's URL with a
// #fragment without reloading the page, so a later auto-reload poll tick (or
// "Export as HTML") sees a tab.url carrying that fragment. Unlike http(s),
// fetch() doesn't strip the fragment before making a file:// request, and
// Chrome refuses it outright: "'file:' URLs are treated as unique security
// origins." Strip it before it reaches fetch(), or the docfile/docname
// attributes, or the md5 cache key (which would otherwise treat the same
// document as changed every time the reader jumps to a different anchor).
function stripFragment(url) {
  const hashIndex = url.indexOf('#')
  return hashIndex === -1 ? url : url.slice(0, hashIndex)
}

// REMIND: notitle attribute is automatically set when header_footer equals false.
function showTitle(doc) {
  return !doc.isAttribute('noheader')
}

/**
 * Is the :source-highlighter: attribute defined ?
 * @param doc
 * @returns {boolean}
 */
function isSourceHighlighterEnabled(doc) {
  return doc.isAttribute('source-highlighter')
}

/**
 * Is the :stem: attribute defined ?
 * @param doc
 * @returns {boolean}
 */
function isStemEnabled(doc) {
  return doc.isAttribute('stem')
}

/**
 * Get the document authors, if any.
 * @param doc
 * @returns {Array<{name: string, email: string|null}>}
 */
function getAuthors(doc) {
  return doc.getAuthors().map((author) => ({
    name: author.getName(),
    email: author.getEmail(),
  }))
}

/**
 * Get the document revision info (number, date, remark), if any is defined.
 * @param doc
 * @returns {{number: string|null, date: string|null, remark: string|null}|undefined}
 */
function getRevisionInfo(doc) {
  const revisionInfo = doc.getRevisionInfo()
  if (revisionInfo.isEmpty()) {
    return undefined
  }
  return {
    number: revisionInfo.getNumber() || null,
    date: revisionInfo.getDate(),
    remark: revisionInfo.getRemark(),
  }
}

export async function convert(url, source, tabId) {
  const settings = await getRenderingSettings()
  const options = buildAsciidoctorOptions(settings, url)
  const buildResult = async () => {
    const doc = await load(source, options)
    const displayHeader = showTitle(doc)
    if (displayHeader) {
      doc.removeAttribute('notitle')
      doc.setAttribute('showtitle')
    }
    if (isSourceHighlighterEnabled(doc)) {
      // Force the source highlighter to Highlight.js (since we only support Highlight.js)
      doc.setAttribute('source-highlighter', 'highlight.js')
    }
    let eqnumsValue = doc.getAttribute('eqnums', 'none').toLowerCase()
    if (eqnumsValue.trim().length === 0) {
      // empty value is an alias for AMS-style equation numbering
      eqnumsValue = 'ams'
    }
    if (!eqnumValidValues.includes(eqnumsValue)) {
      // invalid values are not allowed, use AMS-style equation numbering
      eqnumsValue = 'ams'
    }
    return {
      html: await doc.convert(),
      text: source,
      title: doc.getDocumentTitle({ use_fallback: true }),
      doctype: doc.getDoctype(),
      attributes: {
        hasSections: doc.hasSections(),
        tocPosition: doc.getAttribute('toc-position'),
        isSourceHighlighterEnabled: isSourceHighlighterEnabled(doc),
        isStemEnabled: isStemEnabled(doc),
        isFontIcons: doc.getAttribute('icons') === 'font',
        maxWidth: doc.getAttribute('max-width'),
        eqnumsValue,
        stylesheet: doc.getAttribute('stylesheet'),
        authors: displayHeader ? getAuthors(doc) : [],
        revisionInfo: displayHeader ? getRevisionInfo(doc) : undefined,
        favicon: doc.getAttribute('favicon'),
      },
    }
  }
  return needsFileUriRouting(url, tabId)
    ? withFileUriRouting(tabId, buildResult)
    : buildResult()
}

/**
 * Convert a document to a standalone HTML5 page (full <html>/<head>/<body>
 * document, with Asciidoctor's default stylesheet embedded, or the document's
 * own :stylesheet: if it sets one) -- the same output `asciidoctor file.adoc
 * -o file.html` would produce. Unlike `convert()`, this doesn't apply the
 * "always show the title" override, since the standalone template already
 * shows it by default (that override only exists to work around the
 * embedded template hiding it).
 */
export async function convertStandalone(url, source, tabId) {
  const settings = await getRenderingSettings()
  const options = buildAsciidoctorOptions(settings, url)
  // `standalone` has to be set at load/parse time (not just passed to
  // `convert()`): it's what makes the parser default `notitle` to unset
  // (so the title shows) and set `stylesheet`/`iconfont-remote`/`copycss`
  // to their standalone defaults (embedded default stylesheet, remote
  // Font Awesome). Passing it only to `convert()` picks the document vs.
  // embedded template but leaves those parse-time attribute defaults
  // untouched, e.g. `stylesheet` ends up unset and no CSS is embedded.
  const buildResult = async () => {
    const doc = await load(source, { ...options, standalone: true })
    if (isSourceHighlighterEnabled(doc)) {
      // Force the source highlighter to Highlight.js (since we only support Highlight.js)
      doc.setAttribute('source-highlighter', 'highlight.js')
    }
    return {
      html: await doc.convert({ standalone: true }),
    }
  }
  return needsFileUriRouting(url, tabId)
    ? withFileUriRouting(tabId, buildResult)
    : buildResult()
}

export async function fetchAndConvertStandalone(url, source, tabId) {
  url = stripFragment(url)
  // `source` is provided by the content script for file:// documents on
  // Firefox, see fetchAndConvert below for why.
  if (source === undefined) {
    const response = await executeRequest(url)
    if (isHtmlContentType(response)) {
      // content is not plain-text!
      return undefined
    }
    if (response.status !== 200 && response.status !== 0) {
      // unsuccessful request!
      return undefined
    }
    source = await response.text()
  }
  return convertStandalone(url, source, tabId)
}

export async function fetchAndConvert(url, initial, source, tabId) {
  url = stripFragment(url)
  // `source` is provided by the content script for file:// documents:
  // Firefox refuses to let the background page itself fetch() a file:// URL
  // ("Security Error: Content at moz-extension://... may not load or link
  // to file://..."), so the content script -- which runs same-origin with
  // the file:// document -- fetches it instead and passes the text along.
  if (source === undefined) {
    const response = await executeRequest(url)
    if (isHtmlContentType(response)) {
      // content is not plain-text!
      return undefined
    }
    if (response.status !== 200 && response.status !== 0) {
      // unsuccessful request!
      return undefined
    }
    source = await response.text()
  }
  if (await isExtensionEnabled()) {
    const md5key = `md5${url}`
    if (!initial) {
      const md5sum = await getSetting(md5key)
      if (md5sum && md5sum === md5(source)) {
        // content didn't change!
        return undefined
      }
    }
    // content has changed...
    const result = await convert(url, source, tabId)
    // Update md5sum
    const value = {}
    value[md5key] = md5(source)
    webExtension.storage.local.set(value)
    return result
  }
  return {
    text: source,
  }
}

/**
 * Parse URL query parameters
 */
function getAttributesFromQueryParameters(url) {
  const query = new URL(url).search.substr(1)
  const result = []
  query.split('&').forEach((part) => {
    // part can be empty
    if (part) {
      const item = part.split('=')
      const key = item[0]
      const value = item[1]
      if (typeof value !== 'undefined') {
        // FIXME: decode!
        const escapedValue = decodeURIComponent(value)
        result.push(key.concat('=').concat(escapedValue))
      } else {
        result.push(key)
      }
    }
  })
  return result
}
/**
 * Build Asciidoctor options from settings
 */
export function buildAsciidoctorOptions(settings, url) {
  const attributesQueryParameters = getAttributesFromQueryParameters(url)
  const customAttributes = settings.customAttributes
  const safeMode = settings.safeMode
  // Default attributes
  const attributes = [
    'icons=font@',
    'env=browser',
    'env-browser',
    'data-uri!',
    `kroki-server-url=${settings.krokiServerUrl}@`,
  ]
  const href = new URL(url).href
  const fileName = href.split('/').pop()
  attributes.push(`docfile=${href}`)
  // Inter-document cross references must point to AsciiDoc source files
  attributes.push('outfilesuffix=.adoc')
  const fileNameExtensionPair = fileName.split('.')

  if (fileNameExtensionPair.length > 1) {
    let fileExtension = fileNameExtensionPair[fileNameExtensionPair.length - 1]
    // Remove query parameters
    fileExtension = fileExtension.split('?')[0]
    // Remove fragment identifier
    fileExtension = fileExtension.split('#')[0]
    attributes.push(`docfilesuffix=.${fileExtension}`)
  }
  if (fileNameExtensionPair.length > 0) {
    const docname = fileNameExtensionPair[0]
    attributes.push(`docname=${docname}`)
  }
  if (customAttributes) {
    attributes.push(customAttributes)
  }
  const parts = href.split('/') // break the string into an array
  parts.pop() // remove its last element
  const pwd = parts.join('/')
  attributes.push(`docdir=${pwd}`)
  if (attributesQueryParameters.length > 0) {
    Array.prototype.push.apply(attributes, attributesQueryParameters)
  }
  // Forcibly remove the "kroki-fetch-diagram" attribute because this feature is not supported in a browser environment.
  attributes.push('kroki-fetch-diagram!')
  const registry = Extensions.create()
  if (settings.krokiEnabled) {
    KrokiExtension.register(registry, {
      vfs: {
        read: async (path, encoding = 'utf8') => {
          const absolutePath =
            path.startsWith('file://') ||
            path.startsWith('http://') ||
            path.startsWith('https://')
              ? path
              : `${pwd}/${path}`
          const response = await fetch(absolutePath)
          if (!(response.status === 200 || response.status === 0)) {
            throw new Error(`No such file: ${absolutePath}`)
          }
          if (encoding === 'binary') {
            const buffer = await response.arrayBuffer()
            return String.fromCharCode(...new Uint8Array(buffer))
          }
          return response.text()
        },
        exists: (_) => false,
        parse: (path) => ({
          dir: path.substring(0, path.lastIndexOf('/')),
          path,
        }),
        add: (_) => {},
      },
    })
  }
  registerEmojiExtension(registry)
  registerChartExtension(registry)
  return {
    safe: safeMode,
    extension_registry: registry,
    backend: 'html5', // Force backend to html5
    attributes: attributes.join(' '), // Pass attributes as String
    logger: browserConsoleLogger,
  }
}
