/* global chrome, browser, AsciidoctorKroki */
import asciidoctor from '../vendor/asciidoctor.js'
import { md5 } from '../vendor/md5.js'
import executeRequest, { isHtmlContentType } from './fetch.js'
import {
  getRenderingSettings,
  getSetting,
  isExtensionEnabled,
} from './settings.js'

const Asciidoctor = asciidoctor()
const Extensions = Asciidoctor.Extensions
const webExtension =
  typeof browser !== 'undefined'
    ? browser
    : typeof chrome !== 'undefined'
      ? chrome
      : null
const eqnumValidValues = ['none', 'all', 'ams']

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

export async function convert(url, source) {
  const settings = await getRenderingSettings()
  const options = buildAsciidoctorOptions(settings, url)
  const doc = Asciidoctor.load(source, options)
  if (showTitle(doc)) {
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
    html: doc.convert(),
    text: source,
    title: doc.getDoctitle({ use_fallback: true }),
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
    },
  }
}

export async function fetchAndConvert(url, initial) {
  const response = await executeRequest(url)
  if (isHtmlContentType(response)) {
    // content is not plain-text!
    return undefined
  }
  if (response.status !== 200 && response.status !== 0) {
    // unsuccessful request!
    return undefined
  }
  const source = await response.text()
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
    const result = await convert(url, source)
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
    AsciidoctorKroki.register(registry, {
      vfs: {
        read: (path) => {
          console.warn(
            `Cannot read file: ${path}. Manifest V3 relies on service workers and cannot use synchronous XMLHttpRequest.`,
          )
          return ''
        },
        exists: (_) => false,
        dirname: (_) => {},
        add: (_) => {},
      },
    })
  }
  return {
    safe: safeMode,
    extension_registry: registry,
    backend: 'html5', // Force backend to html5
    attributes: attributes.join(' '), // Pass attributes as String
  }
}
