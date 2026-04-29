/* global chrome, browser */
import { convert } from './module/converter.js'
import { setViewport } from './module/dom.js'
import executeRequest, { isHtmlContentType } from './module/fetch.js'
import { showError, updateHTML } from './module/page.js'
import {
  getBrowserInfo,
  getLocalPollFrequency,
  getRemotePollFrequency,
  getSetting,
  isExtensionEnabled,
  isLiveReloadDetected,
  isTxtExtAllowed,
} from './module/settings.js'
import { md5 } from './vendor/md5.js'

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
      fetchContent().then()
    }
  } else {
    fetchContent().then()
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

async function fetchContent() {
  const browserInfo = getBrowserInfo()
  if (browserInfo.name === 'Firefox') {
    // fetch the content from the content script (here)
    let textContent
    // Check if the content is available before using an AJAX query
    // Note: Firefox is not (yet) using UTF-8 to read BOMless file: https://bugzilla.mozilla.org/show_bug.cgi?id=1071816
    // As a result the text content could contain invalid characters, to avoid that we force an AJAX query with charset=utf-8
    // This issue should be fixed in Firefox 60, if this is the case we could potentially remove this condition
    if (
      browserInfo.name !== 'Firefox' &&
      document.body.getElementsByTagName('pre').length === 1 &&
      document.body.childNodes.length === 1
    ) {
      textContent = document.body.getElementsByTagName('pre')[0].innerText
    } else {
      const request = await executeRequest(location.href)
      if (isHtmlContentType(request)) {
        return
      }
      textContent = await request.text()
    }
    let response = {}
    try {
      response = await convert(location.href, textContent)
    } catch (e) {
      response.error = e
    }
    showResponse(response)
    if (response) {
      startAutoReload().then()
    }
  } else {
    // fetch the content from the background script (send a message)
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
}

async function reloadContent(source) {
  const liveReloadDetected = await isLiveReloadDetected()
  // LiveReload.js has been detected
  if (!liveReloadDetected) {
    const md5key = `md5${location.href}`
    const md5sum = await getSetting(md5key)
    if (md5sum && md5sum === md5(source)) {
      return
    }
    // Content has changed...
    if (await isExtensionEnabled()) {
      let response = {}
      try {
        response = await convert(location.href, source)
      } catch (e) {
        response.error = e
      }
      showResponse(response)
    } else {
      displayContentAsPlainText(source)
    }
    // Update md5sum
    const value = {}
    value[md5key] = md5(source)
    webExtension.storage.local.set(value)
  }
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
    const browserInfo = getBrowserInfo()
    if (browserInfo.name === 'Firefox') {
      const request = await executeRequest(location.href)
      reloadContent(await request.text()).then()
    } else {
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
    }
  }, pollFrequency * 1000)
}
