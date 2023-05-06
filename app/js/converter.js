/* global fetch, md5, asciidoctor, Asciidoctor, XMLHttpRequest, AsciidoctorKroki */
const processor = Asciidoctor({ runtime: { platform: 'browser' } })
const eqnumValidValues = ['none', 'all', 'ams']

asciidoctor.browser.converter = (webExtension, Constants, Settings) => {
  const module = {}

  module.convert = async (url, source) => {
    const settings = await Settings.getRenderingSettings()
    const options = buildAsciidoctorOptions(settings, url)
    const doc = processor.load(source, options)
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
        stylesheet: doc.getAttribute('stylesheet')
      }
    }
  }

  module.fetchAndConvert = async (url, initial) => {
    const response = await fetch(url)
    if (response.status >= 200 && response.status < 400) {
      const contentType = response.headers.get('Content-Type')
      if (contentType) {
        if (contentType.includes('html') || contentType.includes('json')) {
          // content is not plain-text!
          return undefined
        }
        const source = await response.text()
        if (await Settings.isExtensionEnabled()) {
          const md5key = 'md5' + url
          if (!initial) {
            const md5sum = await Settings.getSetting(md5key)
            if (md5sum && md5sum === md5(source)) {
              // content didn't change!
              return undefined
            }
          }
          // content has changed...
          const result = await module.convert(url, source)
          // Update md5sum
          const value = {}
          value[md5key] = md5(source)
          webExtension.storage.local.set(value)
          return result
        }
        return {
          text: source
        }
      }
    } else {
      // unsuccessful request!
      return undefined
    }
  }

  // REMIND: notitle attribute is automatically set when header_footer equals false.
  const showTitle = (doc) => !doc.isAttribute('noheader')

  /**
   * Is the :source-highlighter: attribute defined ?
   * @param doc
   * @returns {boolean}
   */
  const isSourceHighlighterEnabled = (doc) => doc.isAttribute('source-highlighter')

  /**
   * Is the :stem: attribute defined ?
   * @param doc
   * @returns {boolean}
   */
  const isStemEnabled = (doc) => doc.isAttribute('stem')

  /**
   * Parse URL query parameters
   */
  const getAttributesFromQueryParameters = (url) => {
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

  const httpGet = (uri, encoding = 'utf8') => {
    let data = ''
    let status = -1
    try {
      const xhr = new XMLHttpRequest()
      xhr.open('GET', uri, false)
      if (encoding === 'binary') {
        xhr.responseType = 'arraybuffer'
      }
      xhr.addEventListener('load', function () {
        status = this.status
        if (status === 200 || status === 0) {
          if (encoding === 'binary') {
            const arrayBuffer = xhr.response
            const byteArray = new Uint8Array(arrayBuffer)
            for (let i = 0; i < byteArray.byteLength; i++) {
              data += String.fromCharCode(byteArray[i])
            }
          } else {
            data = this.responseText
          }
        }
      })
      xhr.send()
    } catch (e) {
      throw new Error(`Error reading file: ${uri}; reason: ${e.message}`)
    }
    // assume that no data means it doesn't exist
    if (status === 404 || !data) {
      throw new Error(`No such file: ${uri}`)
    }
    return data
  }

  /**
   * Build Asciidoctor options from settings
   */
  const buildAsciidoctorOptions = (settings, url) => {
    const attributesQueryParameters = getAttributesFromQueryParameters(url)
    const customAttributes = settings.customAttributes
    const safeMode = settings.safeMode
    // Default attributes
    const attributes = [
      'icons=font@',
      'platform=opal',
      'platform-opal',
      'env=browser',
      'env-browser',
      'data-uri!',
      `kroki-server-url=${settings.krokiServerUrl}@`]
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
    const registry = processor.Extensions.create()
    if (settings.krokiEnabled) {
      AsciidoctorKroki.register(registry, {
        vfs: {
          read: (path, encoding = 'utf8') => {
            let absolutePath
            if (path.startsWith('file://') || path.startsWith('http://') || path.startsWith('https://')) {
              // absolute path
              absolutePath = path
            } else {
              absolutePath = pwd + '/' + path
            }
            return httpGet(absolutePath, encoding)
          },
          exists: (_) => {
            return false
          },
          add: (_) => {
            // no-op
          },
          dirname: () => ''
        }
      })
    }
    return {
      safe: safeMode,
      extension_registry: registry,
      backend: 'html5', // Force backend to html5
      attributes: attributes.join(' ') // Pass attributes as String
    }
  }

  return module
}
