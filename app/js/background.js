/* global chrome, browser */
import { convert, fetchAndConvert } from './module/converter.js'
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
  }
  // send an empty response to avoid the pesky error "The message port closed before a response was received"
  sendResponse({})
})

const matchesTabUrl =
  webExtension.runtime.getManifest().content_scripts[0].matches
const renderSelectionMenuItemId = 'renderSelectionMenuItem'

let injectTabId
let injectText

webExtension.runtime.onInstalled.addListener(() => {
  if (webExtension.contextMenus) {
    webExtension.contextMenus.create({
      id: renderSelectionMenuItemId,
      title: 'Render selection',
      contexts: ['selection'],
    })

    webExtension.contextMenus.onClicked.addListener((info) => {
      if (info.menuItemId === renderSelectionMenuItemId) {
        const funcToInject = () => {
          const selection = window.getSelection()
          return selection.rangeCount > 0 ? selection.toString() : ''
        }
        const javascriptCode = `;(${funcToInject})();`
        webExtension.tabs.executeScript(
          {
            code: javascriptCode,
            allFrames: true,
          },
          (selectedTextPerFrame) => {
            if (webExtension.runtime.lastError) {
              // eslint-disable-next-line no-console
              console.error(`error:${webExtension.runtime.lastError.message}`)
            } else if (
              selectedTextPerFrame.length > 0 &&
              typeof selectedTextPerFrame[0] === 'string'
            ) {
              injectText = selectedTextPerFrame[0]
              webExtension.tabs.create(
                {
                  url: webExtension.extension.getURL('html/inject.html'),
                  active: true,
                },
                (tab) => {
                  injectTabId = tab.id
                },
              )
            }
          },
        )
      }
    })
  }
})

webExtension.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'complete' && tabId === injectTabId) {
    const tabs = webExtension.extension.getViews({ type: 'tab' })
    // Get the latest tab opened
    tabs[tabs.length - 1].inject(injectText)
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

let enableRender = true

function enableDisableRender() {
  // Save the new status of the extension (opposite of current)
  webExtension.storage.local.set({ ENABLE_RENDER: !enableRender })
  // Update the extension icon
  webExtension.action.setBadgeText({
    text: enableRender ? 'off' : '',
  })
  webExtension.action.setBadgeBackgroundColor({
    color: '#2f2f2f',
  })
  if (typeof webExtension.action.setTitle === 'function') {
    webExtension.action.setTitle({
      title: `Asciidoctor.js Preview (${enableRender ? '✘' : '✔'})`,
    })
  } else {
    // eslint-disable-next-line no-console
    console.log(
      `Asciidoctor.js Preview (${enableRender ? 'disabled' : 'enabled'})`,
    )
  }

  // Reload the active tab in the current windows that matches
  findActiveTab((activeTab) => {
    if (enableRender) {
      // opposite action, the extension was enabled, so we disable!
      disableExtension(activeTab)
    } else {
      notifyTab(activeTab, 'extension-enabled')
    }
  })

  // Switch the flag
  enableRender = !enableRender
}

webExtension.action.onClicked.addListener(enableDisableRender)
