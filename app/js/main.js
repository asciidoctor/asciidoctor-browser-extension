/* global chrome, browser */
import { setViewport } from './module/dom.js'
import { showError, updateHTML } from './module/page.js'
import {
  getLocalPollFrequency,
  getRemotePollFrequency,
  isExtensionEnabled,
  isTxtExtAllowed,
} from './module/settings.js'

export async function init() {
  // Extension is enabled ?
  if (await isExtensionEnabled()) {
    await load()
  }
}

async function load() {
  const txtExtensionRegex = /\.txt[.|?]?.*?$/
  if (location.href.match(txtExtensionRegex)) {
    // .txt extension should be allowed ?
    if (await isTxtExtAllowed()) {
      fetchContent()
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
    function handleMessage(message, sender) {
      if (sender.id === webExtension.runtime.id) {
        if (message.status === 'extension-enabled') {
          load().then()
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

function showResponse(response) {
  if (response) {
    setViewport()
    if (response.html) {
      updateHTML(response).then()
    } else if (response.text) {
      displayContentAsPlainText(response.text)
    } else if (response.error) {
      showError(response.error)
    }
  }
}

function fetchContent() {
  // fetch and convert via background script (avoids page CSP restrictions)
  webExtension.runtime.sendMessage(
    { action: 'fetch-convert', initial: true },
    async (response) => {
      showResponse(response)
      if (response) {
        startAutoReload().then()
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
      webExtension.runtime.sendMessage(
        { action: 'fetch-convert' },
        (response) => {
          if (response) {
            if (response.html) {
              updateHTML(response)
            } else if (response.text) {
              displayContentAsPlainText(response.text)
            } else if (response.error) {
              showError(response.error)
            }
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
