/* global asciidoctor */
asciidoctor.browser.loader = (webExtension, document, location, XMLHttpRequest, Settings, Renderer) => {
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

  const fetchContent = () => {
    webExtension.runtime.sendMessage({ action: 'fetch-convert', initial: true }, async function (response) {
      if (response) {
        Renderer.prepare()
        if (response.html) {
          Renderer.updateHTML(response)
        } else if (response.error) {
          Renderer.showError(response.error)
        }
        startAutoReload()
      }
    })
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
    }, pollFrequency * 1000)
  }

  return module
}
