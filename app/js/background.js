/* global chrome, browser */
import {
  convert,
  fetchAndConvert,
  fetchAndConvertStandalone,
} from './module/converter.js'
import { getBrowserInfo } from './module/settings.js'

function getErrorInfo(error) {
  const errorInfo = {}
  if (typeof error === 'object') {
    Object.getOwnPropertyNames(error).forEach((key) => {
      errorInfo[key] = error[key]
    }, error)
  } else {
    errorInfo.message = error
  }
  return errorInfo
}

const webExtension = typeof browser === 'undefined' ? chrome : browser
const isFirefox = getBrowserInfo().name === 'Firefox'

// Cache resolved CSS (with absolute URLs) per extension file path (Chrome only)
const cssContentCache = new Map()

function rewriteUrlsToAbsolute(css, baseUrl) {
  return css.replace(/url\((['"]?)([^'")]+)\1\)/g, (match, quote, url) => {
    if (/^(data:|https?:|chrome-extension:|moz-extension:)/.test(url)) {
      return match
    }
    try {
      return `url(${quote}${new URL(url, baseUrl).href}${quote})`
    } catch {
      return match
    }
  })
}

async function resolveImports(css, baseUrl) {
  const importRegex = /@import\s+"([^"]+)";\s*/g
  const replacements = [...css.matchAll(importRegex)].map((m) => ({
    full: m[0],
    url: m[1],
  }))
  let result = css
  for (const { full, url } of replacements) {
    try {
      const absoluteUrl = /^https?:/.test(url)
        ? url
        : new URL(url, baseUrl).href
      const importResponse = await fetch(absoluteUrl)
      const importBaseUrl = absoluteUrl.substring(
        0,
        absoluteUrl.lastIndexOf('/') + 1,
      )
      const importedCss = rewriteUrlsToAbsolute(
        await importResponse.text(),
        importBaseUrl,
      )
      result = result.replace(full, importedCss)
    } catch {
      result = result.replace(full, '')
    }
  }
  return result
}

async function fetchCssWithAbsoluteUrls(file) {
  if (cssContentCache.has(file)) {
    return cssContentCache.get(file)
  }
  const fileUrl = webExtension.runtime.getURL(file)
  const response = await fetch(fileUrl)
  let css = await response.text()
  const baseUrl = fileUrl.substring(0, fileUrl.lastIndexOf('/') + 1)
  css = await resolveImports(css, baseUrl)
  const resolved = rewriteUrlsToAbsolute(css, baseUrl)
  cssContentCache.set(file, resolved)
  return resolved
}

webExtension.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'fetch-convert') {
    fetchAndConvert(sender.tab.url, request.initial)
      .then((result) => {
        if (result) {
          sendResponse(result)
        } else {
          sendResponse({})
        }
      })
      .catch((error) => sendResponse({ error: getErrorInfo(error) }))
    return true
  } else if (request.action === 'convert') {
    convert(sender.tab.url, request.source)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ error: getErrorInfo(error) }))
    return true
  } else if (request.action === 'insert-css') {
    const target = { tabId: sender.tab.id }
    if (request.file) {
      if (isFirefox) {
        // Firefox: use files: mode so the stylesheet gets the extension origin,
        // allowing @font-face rules to load moz-extension:// font URLs.
        // (css: mode gives a null principal that blocks extension resource access)
        webExtension.scripting
          .insertCSS({ target, files: [request.file] })
          .catch(console.error)
      } else {
        // Chrome: use inline CSS with rewritten absolute URLs because Chrome's
        // files: mode resolves url() relative to the page instead of the CSS file
        fetchCssWithAbsoluteUrls(request.file)
          .then((css) => webExtension.scripting.insertCSS({ target, css }))
          .catch(console.error)
      }
    } else {
      webExtension.scripting
        .insertCSS({ target, css: request.css })
        .catch(console.error)
    }
  } else if (request.action === 'remove-css') {
    if (isFirefox) {
      webExtension.scripting
        .removeCSS({ target: { tabId: sender.tab.id }, files: [request.file] })
        .catch(console.error)
    } else {
      const css = cssContentCache.get(request.file)
      if (css) {
        webExtension.scripting
          .removeCSS({ target: { tabId: sender.tab.id }, css })
          .catch(console.error)
      }
    }
  } else if (request.action === 'run-custom-script') {
    // Run in the page's own MAIN world (rather than from the content script's
    // isolated world) via the scripting API, which is exempt from the page's CSP.
    // The script is loaded from a Blob URL (not set as inline content) so the
    // resulting <script> element still needs to satisfy CSP as an external
    // script source; creating the Blob in the MAIN world gives it the page's
    // real origin (isolated-world Blobs get an opaque "null" origin that
    // never matches 'self').
    webExtension.scripting
      .executeScript({
        target: { tabId: sender.tab.id },
        world: 'MAIN',
        func: (id, content) =>
          new Promise((resolve, reject) => {
            const url = URL.createObjectURL(
              new Blob([content], { type: 'text/javascript' }),
            )
            const script = document.createElement('script')
            script.id = id
            script.src = url
            script.onload = () => {
              URL.revokeObjectURL(url)
              resolve()
            }
            script.onerror = () => {
              URL.revokeObjectURL(url)
              reject(new Error('Unable to load the custom script'))
            }
            document.head.appendChild(script)
          }),
        args: ['asciidoctor-browser-custom-js', request.content],
      })
      .then(() => sendResponse({}))
      .catch((error) => sendResponse({ error: getErrorInfo(error) }))
    return true
  } else if (request.action === 'get-selection') {
    const text = pendingSelections.get(sender.tab.id) || ''
    pendingSelections.delete(sender.tab.id)
    sendResponse({ text })
    return
  }
  // send an empty response to avoid the pesky error "The message port closed before a response was received"
  sendResponse({})
})

const matchesTabUrl =
  webExtension.runtime.getManifest().content_scripts[0].matches
const renderSelectionMenuItemId = 'renderSelectionMenuItem'
const exportHtmlMenuItemId = 'exportHtmlMenuItem'

// Selected text waiting to be picked up by the inject.html tab it was opened
// for, keyed by that tab's id (see the 'get-selection' message below).
const pendingSelections = new Map()

function suggestedHtmlFilename(url) {
  try {
    const basename = decodeURIComponent(
      new URL(url).pathname.split('/').pop() || '',
    )
    if (basename) {
      return basename.replace(/\.[^./]+$/, '.html')
    }
  } catch {
    // fall through to the generic filename below
  }
  return 'document.html'
}

async function exportHtml(tab) {
  if (!tab?.url) {
    return
  }
  try {
    const result = await fetchAndConvertStandalone(tab.url)
    if (!result) {
      return
    }
    // Trigger the download from the page itself (rather than via
    // chrome.downloads.download) so the extension doesn't need the
    // "downloads" permission -- a blob URL clicked through a hidden <a
    // download> follows the browser's own download settings (including its
    // "ask where to save" prompt, if the user has that turned on).
    await webExtension.scripting.executeScript({
      target: { tabId: tab.id },
      func: (html, filename) => {
        const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
        const link = document.createElement('a')
        link.href = url
        link.download = filename
        link.style.display = 'none'
        document.body.appendChild(link)
        link.click()
        link.remove()
        URL.revokeObjectURL(url)
      },
      args: [result.html, suggestedHtmlFilename(tab.url)],
    })
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(error)
  }
}

webExtension.runtime.onInstalled.addListener(async (details) => {
  // Safari fires onInstalled with reason "install" every time the extension
  // is turned off and back on again in Safari's Extensions preferences, not
  // just on a true first install as the other browsers (and the spec) do.
  // Guard with a persisted flag so the quickstart tab only ever opens once.
  if (details.reason === 'install') {
    const { QUICKSTART_SHOWN } =
      await webExtension.storage.local.get('QUICKSTART_SHOWN')
    if (!QUICKSTART_SHOWN) {
      await webExtension.storage.local.set({ QUICKSTART_SHOWN: true })
      webExtension.tabs.create({
        url: 'https://docs.asciidoctor.org/browser-extension/quickstart/',
      })
    }
  }
  if (webExtension.contextMenus) {
    webExtension.contextMenus.create({
      id: renderSelectionMenuItemId,
      title: 'Render selection',
      contexts: ['selection'],
    })

    webExtension.contextMenus.create({
      id: exportHtmlMenuItemId,
      title: 'Export as HTML',
      contexts: ['page'],
      documentUrlPatterns: matchesTabUrl,
    })

    webExtension.contextMenus.onClicked.addListener(async (info, tab) => {
      if (info.menuItemId === exportHtmlMenuItemId && tab) {
        await exportHtml(tab)
        return
      }
      if (info.menuItemId === renderSelectionMenuItemId && tab) {
        let results
        try {
          results = await webExtension.scripting.executeScript({
            target: { tabId: tab.id, allFrames: true },
            func: () => {
              const selection = window.getSelection()
              return selection.rangeCount > 0 ? selection.toString() : ''
            },
          })
        } catch (error) {
          // eslint-disable-next-line no-console
          console.error(`error:${error.message}`)
          return
        }
        const selectedText = results.find(
          (frameResult) => frameResult.result,
        )?.result
        if (selectedText) {
          const injectTab = await webExtension.tabs.create({
            url: webExtension.runtime.getURL('html/inject.html'),
            active: true,
          })
          pendingSelections.set(injectTab.id, selectedText)
        }
      }
    })
  }
})

const disableExtension = (tab) => {
  webExtension.tabs.reload(tab.id)
}

const notifyTab = async (tab, status) => {
  try {
    await webExtension.tabs.sendMessage(tab.id, { status })
  } catch {
    // No content script listener in the tab (Firefox rejects the Promise)
  }
}

const findActiveTab = (callback) => {
  let tabFound = false
  for (const matchTabUrl of matchesTabUrl) {
    webExtension.tabs.query(
      { active: true, currentWindow: true, url: matchTabUrl },
      (tabs) => {
        if (!tabFound && tabs.length > 0) {
          callback(tabs[0])
          tabFound = true
        }
      },
    )
  }
}

if (webExtension.commands) {
  webExtension.commands.onCommand.addListener((command) => {
    if (command === 'export-html') {
      findActiveTab((tab) => exportHtml(tab))
    }
  })
}

// Read the current status from storage.local (rather than keeping it in a
// module-level variable) so this stays correct even when the background
// context has been restarted since the last click: MV3 background scripts
// aren't guaranteed to stay alive between events (this is especially
// aggressive in Safari, where the background page can be torn down within
// seconds), and a module-level flag would silently reset to its initial
// value on every restart, desyncing from the real persisted state.
async function enableDisableRender() {
  const { ENABLE_RENDER } =
    await webExtension.storage.local.get('ENABLE_RENDER')
  const wasEnabled = ENABLE_RENDER !== false
  const enabled = !wasEnabled
  // Save the new status of the extension
  await webExtension.storage.local.set({ ENABLE_RENDER: enabled })
  // Update the extension icon
  webExtension.action.setBadgeText({
    text: enabled ? '' : 'off',
  })
  webExtension.action.setBadgeBackgroundColor({
    color: '#2f2f2f',
  })
  if (typeof webExtension.action.setTitle === 'function') {
    webExtension.action.setTitle({
      title: `Asciidoctor.js Preview (${enabled ? '✔' : '✘'})`,
    })
  } else {
    // eslint-disable-next-line no-console
    console.log(`Asciidoctor.js Preview (${enabled ? 'enabled' : 'disabled'})`)
  }

  // Reload the active tab in the current windows that matches
  findActiveTab((activeTab) => {
    if (enabled) {
      notifyTab(activeTab, 'extension-enabled')
    } else {
      disableExtension(activeTab)
    }
  })
}

webExtension.action.onClicked.addListener(enableDisableRender)
