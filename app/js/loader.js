/* global asciidoctor, md5 */
asciidoctor.browser.loader = (webExtension, document, location, XMLHttpRequest, Settings, Renderer, Converter) => {
  const module = {}

  webExtension.runtime.onMessage.addListener(function handleMessage (message, sender) {
    if (sender.id === webExtension.runtime.id) {
      if (message.status === 'extension-enabled') {
        module.load()
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
        fetchContent()
      }
    } else {
      fetchContent()
    }
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

  const showResponse = (response) => {
    if (response) {
      Renderer.prepare()
      if (response.html) {
        Renderer.updateHTML(response)
      } else if (response.text) {
        displayContentAsPlainText(response.text)
      } else if (response.error) {
        Renderer.showError(response.error)
      }
    }
  }

  const fetchContent = async () => {
    const browserInfo = Settings.getBrowserInfo()
    if (browserInfo.name === 'Firefox') {
      // fetch the content from the content script (here)
      let textContent
      // Check if the content is available before using an AJAX query
      // Note: Firefox is not (yet) using UTF-8 to read BOMless file: https://bugzilla.mozilla.org/show_bug.cgi?id=1071816
      // As a result the text content could contain invalid characters, to avoid that we force an AJAX query with charset=utf-8
      // This issue should be fixed in Firefox 60, if this is the case we could potentially remove this condition
      if (browserInfo.name !== 'Firefox' && document.body.getElementsByTagName('pre').length === 1 && document.body.childNodes.length === 1) {
        textContent = document.body.getElementsByTagName('pre')[0].innerText
      } else {
        const request = await Converter.executeRequest(location.href)
        if (Converter.isHtmlContentType(request)) {
          return
        }
        textContent = await request.text()
      }
      let response = {}
      try {
        response = await Converter.convert(location.href, textContent)
      } catch (e) {
        response.error = e
      }
      showResponse(response)
      if (response) {
        startAutoReload()
      }
    } else {
      // fetch the content from the background script (send a message)
      webExtension.runtime.sendMessage({ action: 'fetch-convert', initial: true }, async function (response) {
        showResponse(response)
        if (response) {
          startAutoReload()
        }
      })
    }
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
        let response = {}
        try {
          response = await Converter.convert(location.href, source)
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
      const browserInfo = Settings.getBrowserInfo()
      if (browserInfo.name === 'Firefox') {
        const request = await Converter.executeRequest(location.href)
        reloadContent(await request.text())
      } else {
        try {
          webExtension.runtime.sendMessage({ action: 'fetch-convert' }, function (response) {
            if (response) {
              if (response.html) {
                Renderer.updateHTML(response)
              } else if (response.text) {
                displayContentAsPlainText(response.text)
              } else if (response.error) {
                Renderer.showError(response.error)
              }
            }
          })
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

  return module
}
