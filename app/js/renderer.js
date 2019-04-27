/* global Asciidoctor, asciidoctor, location, Chartist */
const processor = Asciidoctor({ runtime: { platform: 'browser' } })

// exports
asciidoctor.browser.renderer = (webExtension, document, Constants, Settings, Dom, Theme) => {
  class AsciidoctorDocument {
    constructor (doc, html) {
      this.doc = doc
      this.html = html
    }
  }

  const module = {}

  /**
   * Initialize the HTML document
   */
  module.prepare = () => {
    Dom.setViewport()
  }

  /**
   * Update the content of the HTML document
   * @param source AsciiDoc source
   * @returns {Promise<boolean>}
   */
  module.update = async (source) => {
    try {
      const settings = await Settings.getRenderingSettings()
      const asciidoctorDocument = module.convert(source, settings)

      Dom.removeElement('asciidoctor-browser-mathjax-refresh')
      Dom.removeElement('asciidoctor-browser-highlightjs-refresh')
      Dom.removeElement('asciidoctor-browser-custom-js')

      // Save the scripts that are present at the root of the <body> to be able to restore them after the update
      // QUESTION: Should we remove this code ? Since using livereload and this extension is not recommended!
      const scripts = document.body.querySelectorAll(':scope > script')
      detectLiveReloadJs(scripts)
      const customJavaScript = settings.customScript
      preprocessing(customJavaScript)
      await updateBody(asciidoctorDocument, scripts)
      postprocessing(customJavaScript)
      return true
    } catch (error) {
      showErrorMessage(`${error.name} : ${error.message}`)
      // eslint-disable-next-line no-console
      console.error(error.stack)
      return false
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

  module.convert = (source, settings) => {
    const options = buildAsciidoctorOptions(settings)
    const doc = processor.load(source, options)
    if (showTitle(doc)) {
      doc.setAttribute('showtitle')
    }
    if (isSourceHighlighterEnabled(doc)) {
      // Force the source highlighter to Highlight.js (since we only support Highlight.js)
      doc.setAttribute('source-highlighter', 'highlight.js')
    }
    return new AsciidoctorDocument(doc, doc.convert())
  }

  /**
   * Append highlight.js script
   */
  module.appendHighlightJsScript = (doc) => {
    Dom.appendOnce(document.head, Dom.createScriptElement({
      id: 'asciidoctor-browser-highlightjs',
      src: webExtension.extension.getURL('js/vendor/highlight.js/highlight.min.js')
    }))
    const languages = doc.getAttribute('highlightjs-languages')
    if (languages) {
      for (let lang of languages.split(',')) {
        lang = lang.trim()
        Dom.appendOnce(document.head, Dom.createScriptElement({
          id: `asciidoctor-browser-highlightjs-${lang}`,
          src: webExtension.extension.getURL(`js/vendor/highlight.js/languages/${lang}.min.js`)
        }))
      }
    }
  }

  /**
   * Append MathJax script
   */
  module.appendMathJax = (doc) => {
    const eqnumsValue = doc.getAttribute('eqnums', 'none')
    const eqnumsOption = ` equationNumbers: { autoNumber: "${eqnumsValue}" } `
    const content = `
MathJax.Hub.Config({
  messageStyle: "none",
  tex2jax: {
    inlineMath: [['\\\\(','\\\\)']],
    displayMath: [['\\\\[', '\\\\]']],
    ignoreClass: 'nostem|nolatexmath'
  },
  asciimath2jax: {
    delimiters: [['\\\\$', '\\\\$']],
    ignoreClass: 'nostem|noasciimath'
  },
  TeX: {${eqnumsOption}}
})
MathJax.Hub.Register.StartupHook("AsciiMath Jax Ready", function () {
  MathJax.InputJax.AsciiMath.postfilterHooks.Add(function (data, node) {
    if ((node = data.script.parentNode) && (node = node.parentNode) && node.classList.contains('stemblock')) {
      data.math.root.display = "block"
    }
    return data
  })
})`
    var element = Dom.createScriptElement({
      id: 'asciidoctor-mathjax-config',
      innerHTML: content
    })
    element.setAttribute('type', 'text/x-mathjax-config')
    Dom.appendOnce(document.head, element)
    Dom.appendOnce(document.head, Dom.createScriptElement({
      id: 'asciidoctor-mathjax-initialization',
      src: webExtension.extension.getURL('vendor/MathJax/MathJax.js?config=TeX-MML-AM_HTMLorMML')
    }))
  }

  /**
   * Append styles
   * @param doc
   */
  const appendStyles = (doc) => {
    // Theme
    return Theme.getThemeName(doc)
      .then(appendThemeStyle)
      .then(() => {
        // Highlight
        const highlightTheme = 'github'
        Dom.appendOnce(document.head, Dom.createStylesheetLinkElement({
          id: `asciidoctor-browser-${highlightTheme}-highlight-style`,
          href: webExtension.extension.getURL(`css/highlight/${highlightTheme}.css`)
        }))
      })
  }

  /**
   * @param customJavaScript
   */
  const preprocessing = (customJavaScript) => {
    if (customJavaScript && customJavaScript.loadDirective === 'before') {
      document.head.appendChild(Dom.createScriptElement({
        id: 'asciidoctor-browser-custom-js',
        innerHTML: customJavaScript.content
      }))
    }
  }

  /**
   * @param customJavaScript
   */
  const postprocessing = (customJavaScript) => {
    if (customJavaScript && customJavaScript.loadDirective === 'after') {
      document.head.appendChild(Dom.createScriptElement({
        id: 'asciidoctor-browser-custom-js',
        innerHTML: customJavaScript.content
      }))
    }
  }

  const appendThemeStyle = async (themeName) => {
    const themeNames = Theme.getDefaultThemeNames()
    // Check if the theme is packaged in the extension... if not it's a custom theme
    if (themeNames.includes(themeName)) {
      Dom.replaceStylesheetLinkElement(document.head, {
        id: 'asciidoctor-browser-style',
        href: webExtension.extension.getURL(`css/themes/${themeName}.css`)
      })
    } else {
      const customThemeContent = await Settings.getSetting(Constants.CUSTOM_THEME_PREFIX + themeName)
      if (customThemeContent) {
        Dom.replaceStyleElement(document.head, {
          id: 'asciidoctor-browser-style',
          innerHTML: customThemeContent
        })
      }
    }
  }

  /**
   * Update the <div id="content"> element.
   * @param html The new HTML content
   */
  const updateContent = (html) => {
    const contentElement = document.getElementById('content')
    if (contentElement) {
      contentElement.innerHTML = html
    } else {
      let contentDiv = document.createElement('div')
      contentDiv.id = 'content'
      contentDiv.innerHTML = html
      document.body.innerHTML = '' // clear <body>
      document.body.appendChild(contentDiv)
    }
  }

  /**
   * Update the HTML document with the Asciidoctor document
   * @param asciidoctorDocument The Asciidoctor document
   * @param scripts The scripts to restore
   */
  const updateBody = async (asciidoctorDocument, scripts) => {
    const doc = asciidoctorDocument.doc
    if (doc.getAttribute('icons') === 'font') {
      appendFontAwesomeStyle()
    }
    await appendStyles(doc)
    appendChartistStyle()

    const title = doc.getDoctitle({ use_fallback: true })
    const doctype = doc.getDoctype()
    const maxWidth = doc.getAttribute('max-width')

    document.title = Dom.decodeEntities(title)
    document.body.className = doctype
    if (maxWidth) {
      document.body.style.maxWidth = maxWidth
    }
    updateContent(asciidoctorDocument.html)

    forceLoadDynamicObjects()
    if (isStemEnabled(doc)) {
      module.appendMathJax(doc)
      refreshMathJax()
    } else {
      Dom.removeElement('asciidoctor-mathjax-config')
      Dom.removeElement('asciidoctor-mathjax-initialization')
    }
    appendScripts(scripts)
    if (isSourceHighlighterEnabled(doc)) {
      module.appendHighlightJsScript(doc)
      syntaxHighlighting()
    } else {
      Dom.removeElement('asciidoctor-browser-highlightjs')
    }
    drawCharts()
  }

  /**
   * Parse URL query parameters
   */
  const getAttributesFromQueryParameters = () => {
    const query = location.search.substr(1)
    const result = []
    query.split('&').forEach((part) => {
      // part can be empty
      if (part) {
        const item = part.split('=')
        const key = item[0]
        const value = item[1]
        if (typeof value !== 'undefined') {
          const escapedValue = Dom.escape(value)
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
  const buildAsciidoctorOptions = (settings) => {
    const attributesQueryParameters = getAttributesFromQueryParameters()
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
      'plantuml-server-url=http://www.plantuml.com/plantuml@']
    const href = window.location.href
    const fileName = href.split('/').pop()
    let fileExtension = fileName.split('.').pop()
    if (fileExtension !== '') {
      // Remove query parameters
      fileExtension = fileExtension.split('?')[0]
      // Remove fragment identifier
      fileExtension = fileExtension.split('#')[0]
      attributes.push(`outfilesuffix=.${fileExtension}`)
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
    return {
      'safe': safeMode,
      // Force backend to html5
      'backend': 'html5',
      // Pass attributes as String
      'attributes': attributes.join(' ')
    }
  }

  /**
   * Detect LiveReload.js script to avoid multiple refreshes
   */
  const detectLiveReloadJs = (scripts) => {
    let liveReloadDetected = false
    for (let script of scripts) {
      if (script.src.indexOf(Constants.LIVERELOADJS_FILENAME) !== -1) {
        // LiveReload.js detected!
        liveReloadDetected = true
        break
      }
    }
    const value = {}
    value[Constants.LIVERELOADJS_DETECTED_KEY] = liveReloadDetected
    webExtension.storage.local.set(value)
  }

  /**
   * Append saved scripts
   */
  const appendScripts = (scripts) => {
    for (let script of scripts) {
      if (!isMathTexScript(script)) {
        document.body.appendChild(script)
      }
    }
  }

  const isMathTexScript = (script) => {
    return /math\/tex/i.test(script.type)
  }

  /**
   * Syntax highlighting with Highlight.js
   */
  const syntaxHighlighting = () => {
    document.body.appendChild(Dom.createScriptElement({
      id: 'asciidoctor-browser-highlightjs-refresh',
      src: webExtension.extension.getURL('js/vendor/highlight.js/refresh.js')
    }))
  }

  /**
   * Draw charts with Chartist
   */
  const drawCharts = () => {
    document.body.querySelectorAll('div.ct-chart').forEach((node) => {
      let options = {
        height: node.dataset['chartHeight'],
        width: node.dataset['chartWidth'],
        colors: node.dataset['chartColors'].split(',')
      }
      const dataset = Object.assign({}, node.dataset)
      const series = Object.values(Object.keys(dataset)
        .filter(key => key.startsWith('chartSeries-'))
        .reduce((obj, key) => {
          obj[key] = dataset[key]
          return obj
        }, {})).map(value => value.split(','))
      let data = {
        labels: node.dataset['chartLabels'].split(','),
        series: series
      }
      Chartist[node.dataset['chartType']](node, data, options)
    })
  }

  /**
   *
   */
  const appendChartistStyle = () => {
    Dom.appendOnce(document.head, Dom.createStylesheetLinkElement({
      id: 'asciidoctor-browser-chartist-style',
      href: webExtension.extension.getURL('css/chartist.min.css')
    }))
    Dom.appendOnce(document.head, Dom.createStyleElement({
      id: 'asciidoctor-browser-chartist-default-style',
      innerHTML: '.ct-chart .ct-series.ct-series-a .ct-line {stroke:#8EB33B} .ct-chart .ct-series.ct-series-b .ct-line {stroke:#72B3CC} .ct-chart .ct-series.ct-series-a .ct-point {stroke:#8EB33B} .ct-chart .ct-series.ct-series-b .ct-point {stroke:#72B3CC}'
    }))
  }

  /**
   *
   */
  const appendFontAwesomeStyle = () => {
    Dom.appendOnce(document.head, Dom.createStylesheetLinkElement({
      id: 'asciidoctor-browser-font-awesome-style',
      href: webExtension.extension.getURL('css/font-awesome.min.css')
    }))
  }

  /**
   *
   */
  const refreshMathJax = () => {
    document.body.appendChild(Dom.createScriptElement({
      id: 'asciidoctor-browser-mathjax-refresh',
      src: webExtension.extension.getURL('vendor/MathJax/refresh.js')
    }))
  }

  /**
   * Force dynamic objects to load (iframe, script...)
   */
  const forceLoadDynamicObjects = () => {
    document.body.querySelectorAll('iframe').forEach((node) => {
      node.setAttribute('src', node.getAttribute('src'))
    })
  }

  /**
   * Show an error message
   * @param message The error message
   */
  const showErrorMessage = (message) => {
    const messageText = `<p>${message}</p>`
    document.body.innerHTML = `<div id="content"><h4>Error</h4>${messageText}</div>`
  }

  return module
}
