/* global chrome, browser */
import { revealPage, setViewport } from './module/dom.js'
import { showError, updateHTML } from './module/page.js'
import {
  getBrowserInfo,
  getLocalPollFrequency,
  getRemotePollFrequency,
  isAdExtAllowed,
  isAscExtAllowed,
  isExtensionEnabled,
  isTxtExtAllowed,
} from './module/settings.js'

// Safety net for css/pre-render.css, which hides the page at document_start:
// if nothing reveals it within a few seconds (unexpected error, missed code
// path), reveal it anyway rather than leaving it permanently hidden.
setTimeout(revealPage, 3000)

export async function init() {
  // Extension is enabled ?
  if (await isExtensionEnabled()) {
    await load()
  } else {
    revealPage()
  }
}

// .ad and .asc are matched with a boundary (end of string, "?" or ".") right
// after the extension so they don't also match .adoc/.asciidoc, which are
// always allowed and not gated by an opt-in setting like .txt/.ad/.asc are.
const optInExtensions = [
  { regex: /\.txt(?:[.?]|$)/, isAllowed: isTxtExtAllowed },
  { regex: /\.ad(?:[.?]|$)/, isAllowed: isAdExtAllowed },
  { regex: /\.asc(?:[.?]|$)/, isAllowed: isAscExtAllowed },
]

async function load() {
  const optInExtension = optInExtensions.find(({ regex }) =>
    location.href.match(regex),
  )
  if (optInExtension) {
    if (await optInExtension.isAllowed()) {
      fetchContent()
    } else {
      revealPage()
    }
  } else {
    fetchContent()
  }
}

const webExtension =
  typeof browser !== 'undefined'
    ? browser
    : typeof chrome !== 'undefined'
      ? chrome
      : null
if (webExtension) {
  webExtension.runtime.onMessage.addListener(
    async function handleMessage(message, sender) {
      if (sender.id === webExtension.runtime.id) {
        if (message.status === 'extension-enabled') {
          await load()
        } else if (message.action === 'get-file-source') {
          // Used by the background script on Firefox to fetch a file:// URL
          // it can't reach itself (see fetchLocalSource): the tab's own
          // document (Export as HTML, no `url` given) or an include::
          // target elsewhere under the same file:// origin (`url` given,
          // see module/converter.js's file URI routing).
          return fetchLocalSource(message.url || location.href)
        }
      }
    },
  )
}

/**
 * Display content as plain text.
 * @param text
 */
function displayContentAsPlainText(text) {
  const preElement = document.createElement('pre')
  preElement.style = 'word-wrap: break-word; white-space: pre-wrap;'
  preElement.innerText = text
  document.head.innerHTML = ''
  document.body.className = ''
  document.body.innerHTML = ''
  document.body.appendChild(preElement)
}

// Last content actually rendered, so a poll tick that returns the same
// content can skip the DOM update. Rebuilding the DOM on every tick (even
// when nothing changed) resets the page, which drops any text selection the
// user was in the middle of making (particularly painful for the plain-text
// rendering, where selecting/copying the raw source is the whole point).
let lastRenderedContent

function isSameAsLastRendered(response) {
  if (response.html) {
    return (
      lastRenderedContent?.type === 'html' &&
      lastRenderedContent.value === response.html
    )
  }
  if (response.text) {
    return (
      lastRenderedContent?.type === 'text' &&
      lastRenderedContent.value === response.text
    )
  }
  return false
}

async function applyResponse(response) {
  if (response.html) {
    lastRenderedContent = { type: 'html', value: response.html }
    await updateHTML(response)
  } else if (response.text) {
    lastRenderedContent = { type: 'text', value: response.text }
    displayContentAsPlainText(response.text)
  } else if (response.error) {
    showError(response.error)
  }
}

async function showResponse(response) {
  if (response) {
    setViewport()
    await applyResponse(response)
  }
  revealPage()
}

// Firefox refuses to let the background page fetch() a file:// URL
// ("Security Error: Content at moz-extension://... may not load or link to
// file://..."), even though the content script itself -- running
// same-origin with the file:// document -- can. So on Firefox, fetch here
// and hand the source to the background script instead of asking it to
// fetch. (Chrome is the opposite: fetching file:// from the content script
// fails there -- "origin 'null' has been blocked by CORS policy" -- so it
// must keep going through the background script, which Chrome allows once
// "Allow access to file URLs" is granted.) Returns undefined if the fetch
// failed or the content turned out to be HTML rather than plain text.
const isFirefox = getBrowserInfo().name === 'Firefox'

// A same-page anchor click (e.g. a ToC entry) updates location.href with a
// #fragment without reloading the page, so a later auto-reload poll tick
// sees a fragment here too. Strip it before fetching: fetch() doesn't strip
// fragments for file:// the way it does for http(s), and browsers may
// refuse the request outright as a result (Chrome: "'file:' URLs are
// treated as unique security origins").
async function fetchLocalSource(url) {
  const hashIndex = url.indexOf('#')
  if (hashIndex !== -1) {
    url = url.slice(0, hashIndex)
  }
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Accept: 'text/plain, */*',
    },
  })
  const contentType = response.headers.get('content-type')
  if (contentType?.indexOf('html') > -1) {
    // eslint-disable-next-line no-console
    console.warn(`fetchLocalSource: ${url} looks like HTML, skipping`)
    return undefined
  }
  if (response.status !== 200 && response.status !== 0) {
    // eslint-disable-next-line no-console
    console.warn(`fetchLocalSource: ${url} returned status ${response.status}`)
    return undefined
  }
  return response.text()
}

async function fetchContent() {
  const needsLocalFetch = isFirefox && location.protocol === 'file:'
  const source = needsLocalFetch
    ? await fetchLocalSource(location.href)
    : undefined
  if (needsLocalFetch && source === undefined) {
    revealPage()
    return
  }
  // fetch (remote documents) and convert via background script (avoids page
  // CSP restrictions)
  webExtension.runtime.sendMessage(
    { action: 'fetch-convert', initial: true, source },
    async (response) => {
      await showResponse(response)
      if (response) {
        await startAutoReload()
      }
    },
  )
}

let autoReloadInterval

async function startAutoReload() {
  const href = location.href
  const remoteFile = href.startsWith('http://') || href.startsWith('https://')
  const pollFrequency = remoteFile
    ? await getRemotePollFrequency()
    : await getLocalPollFrequency()
  clearInterval(autoReloadInterval)
  if (pollFrequency === 0) {
    // Poll is disabled!
    return
  }
  autoReloadInterval = setInterval(async () => {
    try {
      // Skip the fetch entirely while the tab isn't visible, so a background
      // tab doesn't keep polling on every tick (see #232).
      if (document.hidden) {
        return
      }
      const needsLocalFetch = isFirefox && location.protocol === 'file:'
      const source = needsLocalFetch
        ? await fetchLocalSource(location.href)
        : undefined
      if (needsLocalFetch && source === undefined) {
        return
      }
      webExtension.runtime.sendMessage(
        { action: 'fetch-convert', source },
        async (response) => {
          if (response && !isSameAsLastRendered(response)) {
            await applyResponse(response)
          }
        },
      )
    } catch (e) {
      if (e.message === 'Extension context invalidated.') {
        // extension has been disabled, stop auto reload
        clearInterval(autoReloadInterval)
        return
      }
      throw e
    }
  }, pollFrequency * 1000)
}
