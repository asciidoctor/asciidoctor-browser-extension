/* global asciidoctor, Chartist, hljs */
// exports
asciidoctor.browser.renderer = (webExtension, document, Constants, Settings, Dom, Theme) => {
  const module = {}

  /**
   * Initialize the HTML document
   */
  module.prepare = () => {
    Dom.setViewport()
  }

  /**
   * Update the content of the HTML document
   * @param backgroundConverterResponse The response sent by the background script
   * @returns {Promise<boolean>}
   */
  module.updateHTML = async (backgroundConverterResponse) => {
    try {
      Dom.removeElement('asciidoctor-browser-custom-js')
      // Save the scripts that are present at the root of the <body> to be able to restore them after the update
      // QUESTION: Should we remove this code ? Since using livereload and this extension is not recommended!
      const scripts = document.body.querySelectorAll(':scope > script')
      detectLiveReloadJs(scripts)
      const settings = await Settings.getRenderingSettings()
      const customJavaScript = settings.customScript
      preprocessing(customJavaScript)
      await updateBodyHTML(backgroundConverterResponse, scripts)
      postprocessing(customJavaScript)
      return true
    } catch (error) {
      module.showError(error)
      return false
    }
  }

  /**
   * Update the content of the HTML to show the error
   * @param error An error
   */
  module.showError = (error) => {
    const message = `${error.name} : ${error.message}`
    const messageText = `<p>${message}</p>`
    document.body.innerHTML = `<div id="content"><h4>Error</h4>${messageText}</div>`
    // eslint-disable-next-line no-console
    console.error(error.stack)
  }

  /**
   * Append MathJax script
   */
  const initializeMathJax = (eqnumsValue) => {
    const content = `function adjustDisplay(math, doc) {
  let node = math.start.node.parentNode
  if (node && (node = node.parentNode) && node.classList.contains('stemblock')) {
    math.root.attributes.set('display', 'block')
  }
}
window.MathJax = {
  tex: {
    inlineMath: [['\\\\(', '\\\\)']],
    displayMath: [['\\\\[', '\\\\]']],
    processEscapes: false,
    tags: "${eqnumsValue}"
  },
  options: {
    ignoreHtmlClass: 'nostem|noasciimath',
    renderActions: {
      adjustDisplay: [25, (doc) => {for (math of doc.math) {adjustDisplay(math, doc)}}, adjustDisplay]
    }
  },
  asciimath: {
    delimiters: [['\\\\$', '\\\\$']]
  },
  loader: {load: ['input/asciimath', 'output/chtml', 'ui/menu']}
};`
    Dom.appendOnce(document.head, Dom.createScriptElement({
      id: 'asciidoctor-mathjax-config',
      innerHTML: content
    }))
    Dom.appendOnce(document.head, Dom.createScriptElement({
      id: 'asciidoctor-mathjax-initialization',
      src: webExtension.extension.getURL('vendor/mathjax-3.2.0/tex-chtml-full.js'),
      async: true
    }))
    Dom.removeElement('asciidoctor-mathjax-typesetting')
    document.head.appendChild(Dom.createScriptElement({
      id: 'asciidoctor-mathjax-typesetting',
      innerHTML: 'if (MathJax && typeof MathJax.typesetPromise === \'function\') { MathJax.typesetPromise() }',
      async: true
    }))
  }

  /**
   * Append styles
   * @param doc
   */
  const appendStyles = (stylesheet) => {
    // Theme
    return Theme.getThemeName(stylesheet)
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
      const contentDiv = document.createElement('div')
      contentDiv.id = 'content'
      contentDiv.innerHTML = html
      document.body.innerHTML = '' // clear <body>
      document.body.appendChild(contentDiv)
    }
  }

  /**
   * Update the HTML document with the Asciidoctor document
   * @param converterResponse The response sent by the converter
   * @param scripts The scripts to restore
   */
  const updateBodyHTML = async (converterResponse, scripts) => {
    const attributes = converterResponse.attributes
    if (attributes.isFontIcons) {
      appendFontAwesomeStyle()
    }
    await appendStyles(attributes.stylesheet)
    appendChartistStyle()

    const title = converterResponse.title
    const doctype = converterResponse.doctype
    const maxWidth = attributes.maxWidth

    document.title = Dom.decodeEntities(title)
    if (maxWidth) {
      document.body.style.maxWidth = maxWidth
    }
    updateContent(converterResponse.html)
    let tocClassNames = ''
    if (attributes.hasSections && (attributes.tocPosition === 'left' || attributes.tocPosition === 'right')) {
      tocClassNames = ` toc2 toc-${attributes.tocPosition}`
      const tocElement = document.getElementById('toc')
      if (tocElement !== null) {
        tocElement.className = 'toc2'
      }
    }
    document.body.className = `${doctype}${tocClassNames}`

    forceLoadDynamicObjects()
    if (attributes.isStemEnabled) {
      initializeMathJax(attributes.eqnumsValue)
    } else {
      Dom.removeElement('asciidoctor-mathjax-config')
      Dom.removeElement('asciidoctor-mathjax-initialization')
    }
    appendScripts(scripts)
    if (attributes.isSourceHighlighterEnabled) {
      syntaxHighlighting()
    }
    drawCharts()
  }

  /**
   * Detect LiveReload.js script to avoid multiple refreshes
   */
  const detectLiveReloadJs = (scripts) => {
    let liveReloadDetected = false
    for (const script of scripts) {
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
    for (const script of scripts) {
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
    document.body.querySelectorAll('pre.highlight > code').forEach((node) => {
      const match = /language-(\S+)/.exec(node.className)
      if (match !== null && hljs.getLanguage(match[1]) !== null) {
        hljs.highlightBlock(node)
      } else {
        node.className += ' hljs'
      }
    })
  }

  /**
   * Draw charts with Chartist
   */
  const drawCharts = () => {
    document.body.querySelectorAll('div.ct-chart').forEach((node) => {
      const options = {
        height: node.dataset.chartHeight,
        width: node.dataset.chartWidth,
        colors: node.dataset.chartColors.split(',')
      }
      const dataset = Object.assign({}, node.dataset)
      const series = Object.values(Object.keys(dataset)
        .filter(key => key.startsWith('chartSeries-'))
        .reduce((obj, key) => {
          obj[key] = dataset[key]
          return obj
        }, {})).map(value => value.split(','))
      const data = {
        labels: node.dataset.chartLabels.split(','),
        series: series
      }
      Chartist[node.dataset.chartType](node, data, options)
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
   * Force dynamic objects to load (iframe, script...)
   */
  const forceLoadDynamicObjects = () => {
    document.body.querySelectorAll('iframe').forEach((node) => {
      node.setAttribute('src', node.getAttribute('src'))
    })
  }

  return module
}
