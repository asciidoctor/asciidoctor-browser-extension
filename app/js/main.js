/* global chrome, browser */
import { revealPage, setViewport } from './module/dom.js'
import { showError, updateHTML } from './module/page.js'
import {
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

function fetchContent() {
  // fetch and convert via background script (avoids page CSP restrictions)
  webExtension.runtime.sendMessage(
    { action: 'fetch-convert', initial: true },
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
      webExtension.runtime.sendMessage(
        { action: 'fetch-convert' },
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
