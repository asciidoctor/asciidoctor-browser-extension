/* global asciidoctor, md5 */
asciidoctor.browser.loader = (webExtension, document, location, XMLHttpRequest, Settings, Renderer) => {
  const module = {}

  webExtension.runtime.onMessage.addListener(function handleMessage (message, sender) {
    if (sender.id === webExtension.runtime.id) {
      if (message.status === 'extension-enabled') {
        module.load()
      } else if (message.status === 'extension-disabled') {
        unloadExtension()
      }
    }
  })

  module.init = async () => {
    // Extension is enabled ?
    if (await Settings.isExtensionEnabled()) {
      await module.load()
    }
  }

  module.load = async () => {
    const txtExtensionRegex = /\.txt[.|?]?.*?$/
    if (location.href.match(txtExtensionRegex)) {
      // .txt extension should be allowed ?
      if (await Settings.isTxtExtAllowed()) {
        await fetchContent()
      }
    } else {
      await fetchContent()
    }
  }

  const executeRequest = (url) => new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    if (request.overrideMimeType) {
      request.overrideMimeType('text/plain;charset=utf-8')
    }
    request.onreadystatechange = (event) => {
      // XMLHttpRequest.DONE === 4
      if (request.readyState === XMLHttpRequest.DONE) {
        if (request.status === 200 || request.status === 0) {
          resolve(request)
          return
        }
        reject(request)
      }
    }
    // disable cache
    request.open('GET', `${url}?_=${new Date().getTime()}`, true)
    request.send(null)
  })

  const unloadExtension = async () => {
    clearInterval(autoReloadInterval)
    const request = await executeRequest(location.href)
    if (isHtmlContentType(request)) {
      return
    }
    displayContentAsPlainText(request.responseText)
  }

  /**
   * Display content as plain text.
   * @param text
   */
  const displayContentAsPlainText = (text) => {
    const preElement = document.createElement('pre')
    preElement.style = 'word-wrap: break-word; white-space: pre-wrap;'
    preElement.innerText = text
    document.head.innerHTML = ''
    document.body.className = ''
    document.body.innerHTML = ''
    document.body.appendChild(preElement)
  }

  const getBrowserInfo = () => {
    const userAgent = navigator.userAgent
    let name
    if (userAgent.indexOf('Chrome') > -1) {
      name = 'Chrome'
    } else if (userAgent.indexOf('Safari') > -1) {
      name = 'Safari'
    } else if (userAgent.indexOf('Opera') > -1) {
      name = 'Opera'
    } else if (userAgent.indexOf('Firefox') > -1) {
      name = 'Firefox'
    } else {
      name = 'Edge'
    }
    return { name: name }
  }

  const fetchContent = async () => {
    let textContent
    // Check if the content is available before using an AJAX query
    // Note: Firefox is not (yet) using UTF-8 to read BOMless file: https://bugzilla.mozilla.org/show_bug.cgi?id=1071816
    // As a result the text content could contain invalid characters, to avoid that we force an AJAX query with charset=utf-8
    // This issue should be fixed in Firefox 60, if this is the case we could potentially remove this condition
    const browserInfo = await getBrowserInfo()
    if (browserInfo.name !== 'Firefox' && document.body.getElementsByTagName('pre').length === 1 && document.body.childNodes.length === 1) {
      textContent = document.body.getElementsByTagName('pre')[0].innerText
    } else {
      const request = await executeRequest(location.href)
      if (isHtmlContentType(request)) {
        return
      }
      textContent = request.responseText
    }
    Renderer.prepare()
    await Renderer.update(textContent)
    startAutoReload()
  }

  const reloadContent = async (source) => {
    const liveReloadDetected = await Settings.isLiveReloadDetected()
    // LiveReload.js has been detected
    if (!liveReloadDetected) {
      const md5key = 'md5' + location.href
      const md5sum = await Settings.getSetting(md5key)
      if (md5sum && md5sum === md5(source)) {
        return
      }
      // Content has changed...
      if (await Settings.isExtensionEnabled()) {
        Renderer.update(source)
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

  const startAutoReload = async () => {
    const href = location.href
    const remoteFile = (href.startsWith('http://') || href.startsWith('https://'))
    const pollFrequency = remoteFile ? await Settings.getRemotePollFrequency() : await Settings.getLocalPollFrequency()
    clearInterval(autoReloadInterval)
    if (pollFrequency === 0) {
      // Poll is disabled!
      return
    }
    autoReloadInterval = setInterval(async () => {
      const request = await executeRequest(location.href)
      reloadContent(request.responseText)
    }, pollFrequency * 1000)
  }

  /**
   * Is the content type html ?
   * @param request The request
   * @return true if the content type is html, false otherwise
   */
  const isHtmlContentType = (request) => {
    const contentType = request.getResponseHeader('Content-Type')
    return contentType && (contentType.indexOf('html') > -1)
  }

  return module
}
