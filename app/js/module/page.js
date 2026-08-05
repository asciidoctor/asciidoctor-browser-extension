/* global chrome, browser */
import Constants from './constants.js'
import {
  appendOnce,
  createScriptElement,
  decodeEntities,
  removeElement,
} from './dom.js'
import { getRenderingSettings, getSetting } from './settings.js'
import { getDefaultThemeNames, getThemeName } from './theme.js'

const webExtension =
  typeof browser !== 'undefined'
    ? browser
    : typeof chrome !== 'undefined'
      ? chrome
      : null

const injectedCssFiles = new Set()
let currentThemeCssFile = null

const insertCssFile = (file) => {
  if (!injectedCssFiles.has(file)) {
    injectedCssFiles.add(file)
    webExtension.runtime.sendMessage({ action: 'insert-css', file })
  }
}

const insertInlineCss = (id, css) => {
  if (!injectedCssFiles.has(id)) {
    injectedCssFiles.add(id)
    webExtension.runtime.sendMessage({ action: 'insert-css', css })
  }
}

export async function updateHTML(backgroundConverterResponse) {
  try {
    removeElement('asciidoctor-browser-custom-js')
    // Save the scripts that are present at the root of the <body> to be able to restore them after the update
    // QUESTION: Should we remove this code ? Since using livereload and this extension is not recommended!
    const scripts = document.body.querySelectorAll(':scope > script')
    detectLiveReloadJs(scripts)
    const settings = await getRenderingSettings()
    const customJavaScript = settings.customScript
    await preprocessing(customJavaScript)
    await updateBodyHTML(backgroundConverterResponse, scripts)
    await postprocessing(customJavaScript)
    return true
  } catch (error) {
    showError(error)
    return false
  }
}

/**
 * Update the content of the HTML to show the error
 * @param error An error
 */
export function showError(error) {
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
  appendOnce(
    document.head,
    createScriptElement({
      id: 'asciidoctor-mathjax-config',
      dataset: {
        eqnumsValue,
      },
      src: webExtension.runtime.getURL('js/mathjax/config.js'),
    }),
  )
  appendOnce(
    document.head,
    createScriptElement({
      id: 'asciidoctor-mathjax-initialization',
      src: webExtension.runtime.getURL('vendor/MathJax-3.2.2/startup.js'),
      async: true,
    }),
  )
  removeElement('asciidoctor-mathjax-typesetting')
  /*
  document.head.appendChild(createScriptElement({
    id: 'asciidoctor-mathjax-typesetting',
    src: webExtension.runtime.getURL('js/mathjax/typeset.js')
  })) */
}

/**
 * Append styles
 * @param stylesheet
 */
async function appendStyles(stylesheet) {
  // Theme
  const theme = await getThemeName(stylesheet)
  await appendThemeStyle(theme)
  // Highlight
  const highlightTheme = 'github'
  insertCssFile(`css/highlight/${highlightTheme}.css`)
  if (highlightTheme === 'github') {
    // Dark-mode overrides (self-scoped to prefers-color-scheme: dark, so this is a no-op in light mode)
    insertCssFile('css/highlight/github-dark.css')
  }
}

/**
 * @param customJavaScript
 */
const preprocessing = async (customJavaScript) => {
  if (customJavaScript && customJavaScript.loadDirective === 'before') {
    await appendCustomScript(customJavaScript.content)
  }
}

/**
 * @param customJavaScript
 */
const postprocessing = async (customJavaScript) => {
  if (customJavaScript && customJavaScript.loadDirective === 'after') {
    await appendCustomScript(customJavaScript.content)
  }
}

/**
 * Run the user-provided custom script via the background script, using
 * chrome.scripting.executeScript in the page's MAIN world. This is required
 * (rather than appending a <script> from the content script directly) so the
 * script is exempt from the page's Content-Security-Policy: neither an inline
 * script appended from a content script, nor a Blob URL created in the
 * content script's isolated world (which gets an opaque "null" origin that
 * never matches 'self'), reliably run on pages with a strict CSP.
 * @param content The JavaScript source to execute
 * @returns {Promise<void>} Resolves once the script has run
 */
const appendCustomScript = (content) => {
  return new Promise((resolve, reject) => {
    webExtension.runtime.sendMessage(
      { action: 'run-custom-script', content },
      (response) => {
        if (webExtension.runtime.lastError) {
          reject(new Error(webExtension.runtime.lastError.message))
        } else if (response?.error) {
          reject(new Error(response.error.message || response.error))
        } else {
          resolve()
        }
      },
    )
  })
}

async function appendThemeStyle(themeName) {
  const themeNames = getDefaultThemeNames()
  // Check if the theme is packaged in the extension... if not it's a custom theme
  if (themeNames.includes(themeName)) {
    const file = `css/themes/${themeName}.css`
    if (currentThemeCssFile !== file) {
      if (currentThemeCssFile) {
        webExtension.runtime.sendMessage({
          action: 'remove-css',
          file: currentThemeCssFile,
        })
      }
      currentThemeCssFile = file
      webExtension.runtime.sendMessage({ action: 'insert-css', file })
    }
  } else {
    const customThemeContent = await getSetting(
      Constants.CUSTOM_THEME_PREFIX + themeName,
    )
    if (customThemeContent) {
      insertInlineCss(`custom-theme-${themeName}`, customThemeContent)
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
 * Update (or remove) the page's favicon from the :favicon: document attribute.
 * The href is resolved by the browser against the current tab URL, the same
 * way relative image references in the document already are.
 * @param favicon The :favicon: attribute value, or a falsy value to remove it
 */
const updateFavicon = (favicon) => {
  const id = 'asciidoctor-browser-favicon'
  let link = document.getElementById(id)
  if (!favicon) {
    if (link) {
      link.remove()
    }
    return
  }
  if (!link) {
    link = document.createElement('link')
    link.id = id
    link.rel = 'icon'
    document.head.appendChild(link)
  }
  link.href = favicon
}

/**
 * Build the <div class="details"> block (author(s) + revision info), matching
 * the markup Asciidoctor's standalone <div id="header"> template produces.
 * The embeddable output used by this extension never includes it, so it has
 * to be reconstructed here (see asciidoctor/asciidoctor-browser-extension#460).
 * @param authors
 * @param revisionInfo
 * @returns {HTMLDivElement}
 */
const createDetailsElement = (authors, revisionInfo) => {
  const details = document.createElement('div')
  details.className = 'details'
  authors.forEach((author, index) => {
    const suffix = index === 0 ? '' : `${index + 1}`
    const authorSpan = document.createElement('span')
    authorSpan.id = `author${suffix}`
    authorSpan.className = 'author'
    authorSpan.textContent = author.name
    details.appendChild(authorSpan)
    details.appendChild(document.createElement('br'))
    if (author.email) {
      const emailSpan = document.createElement('span')
      emailSpan.id = `email${suffix}`
      emailSpan.className = 'email'
      const emailLink = document.createElement('a')
      emailLink.href = `mailto:${author.email}`
      emailLink.textContent = author.email
      emailSpan.appendChild(emailLink)
      details.appendChild(emailSpan)
      details.appendChild(document.createElement('br'))
    }
  })
  if (revisionInfo) {
    if (revisionInfo.number) {
      const revnumberSpan = document.createElement('span')
      revnumberSpan.id = 'revnumber'
      revnumberSpan.textContent = `version ${revisionInfo.number}${revisionInfo.date ? ',' : ''}`
      details.appendChild(revnumberSpan)
    }
    if (revisionInfo.date) {
      const revdateSpan = document.createElement('span')
      revdateSpan.id = 'revdate'
      revdateSpan.textContent = revisionInfo.date
      details.appendChild(revdateSpan)
    }
    if (revisionInfo.remark) {
      details.appendChild(document.createElement('br'))
      const revremarkSpan = document.createElement('span')
      revremarkSpan.id = 'revremark'
      revremarkSpan.textContent = revisionInfo.remark
      details.appendChild(revremarkSpan)
    }
  }
  return details
}

/**
 * Wrap the document title (rendered by Asciidoctor as a bare <h1> at the root
 * of #content in embeddable output) together with the author/revision details
 * block in a <div id="header">, so the existing theme stylesheets — written
 * against Asciidoctor's standalone #header markup — style it correctly.
 * @param authors
 * @param revisionInfo
 */
const wrapHeader = (authors, revisionInfo) => {
  const contentElement = document.getElementById('content')
  const titleElement = contentElement?.querySelector(':scope > h1:first-child')
  if (!titleElement) {
    return
  }
  const headerElement = document.createElement('div')
  headerElement.id = 'header'
  titleElement.replaceWith(headerElement)
  headerElement.appendChild(titleElement)
  headerElement.appendChild(createDetailsElement(authors, revisionInfo))
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

  document.title = decodeEntities(title)
  if (maxWidth) {
    document.body.style.maxWidth = maxWidth
  }
  updateContent(converterResponse.html)
  updateFavicon(attributes.favicon)
  if (attributes.authors.length > 0 || attributes.revisionInfo) {
    wrapHeader(attributes.authors, attributes.revisionInfo)
  }
  let tocClassNames = ''
  if (
    attributes.hasSections &&
    (attributes.tocPosition === 'left' || attributes.tocPosition === 'right')
  ) {
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
    removeElement('asciidoctor-mathjax-config')
    removeElement('asciidoctor-mathjax-initialization')
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
      colors: node.dataset.chartColors.split(','),
    }
    const dataset = Object.assign({}, node.dataset)
    const series = Object.values(
      Object.keys(dataset)
        .filter((key) => key.startsWith('chartSeries-'))
        .reduce((obj, key) => {
          obj[key] = dataset[key]
          return obj
        }, {}),
    ).map((value) => value.split(','))
    const data = {
      labels: node.dataset.chartLabels.split(','),
      series,
    }
    new Chartist[node.dataset.chartType](node, data, options)
  })
}

/**
 *
 */
const appendChartistStyle = () => {
  insertCssFile('css/chartist.min.css')
  insertInlineCss(
    'chartist-default',
    '.ct-chart .ct-series.ct-series-a .ct-line {stroke:#8EB33B} .ct-chart .ct-series.ct-series-b .ct-line {stroke:#72B3CC} .ct-chart .ct-series.ct-series-a .ct-point {stroke:#8EB33B} .ct-chart .ct-series.ct-series-b .ct-point {stroke:#72B3CC}',
  )
}

/**
 *
 */
const appendFontAwesomeStyle = () => {
  insertCssFile('css/font-awesome.min.css')
}

/**
 * Force dynamic objects to load (iframe, script...)
 */
const forceLoadDynamicObjects = () => {
  document.body.querySelectorAll('iframe').forEach((node) => {
    node.setAttribute('src', node.getAttribute('src'))
  })
}
