/* global webExtension, asciidoctor, localStorage */
const Constants = asciidoctor.browser.constants()
const Settings = asciidoctor.browser.settings(webExtension, Constants)
const Converter = asciidoctor.browser.converter(webExtension, Constants, Settings)

// exports
;(async (webExtension) => {
  const matchesTabUrl = webExtension.runtime.getManifest().content_scripts[0].matches
  const renderSelectionMenuItemId = 'renderSelectionMenuItem'

  let injectTabId
  let injectText

  const enableDisableRender = async function (enabled) {
    // Save the status of the extension
    webExtension.storage.local.set({ ENABLE_RENDER: enabled })

    // Update the extension icon
    const iconPrefix = enabled ? 'enabled' : 'disabled'
    const iconPath = {
      16: `/img/${iconPrefix}-16.png`,
      32: `/img/${iconPrefix}-32.png`
    }
    if (typeof webExtension.action.setIcon === 'function') {
      webExtension.action.setIcon({ path: iconPath })
    } else if (typeof webExtension.action.setTitle === 'function') {
      webExtension.action.setTitle({ title: `Asciidoctor.js Preview (${enabled ? '✔' : '✘'})` })
    } else {
      // eslint-disable-next-line no-console
      console.log(`Asciidoctor.js Preview (${enabled ? 'enabled' : 'disabled'})`)
    }

    // Reload the active tab in the current windows that matches
    findActiveTab((activeTab) => {
      if (enabled) {
        // opposite action, the extension was enabled, so we disable!
        disableExtension(activeTab)
      } else {
        notifyTab(activeTab, 'extension-enabled')
      }
    })
  }

  webExtension.runtime.onInstalled.addListener(() => {
    if (webExtension.contextMenus) {
      webExtension.contextMenus.create({
        id: renderSelectionMenuItemId,
        title: 'Render selection',
        contexts: ['selection']
      })

      webExtension.contextMenus.onClicked.addListener((info) => {
        if (info.menuItemId === renderSelectionMenuItemId) {
          const funcToInject = () => {
            const selection = window.getSelection()
            return (selection.rangeCount > 0) ? selection.toString() : ''
          }
          const javascriptCode = `;(${funcToInject})();`
          webExtension.tabs.executeScript({
            code: javascriptCode,
            allFrames: true
          }, (selectedTextPerFrame) => {
            if (webExtension.runtime.lastError) {
              // eslint-disable-next-line no-console
              console.error('error:' + webExtension.runtime.lastError.message)
            } else if (selectedTextPerFrame.length > 0 && typeof selectedTextPerFrame[0] === 'string') {
              injectText = selectedTextPerFrame[0]
              webExtension.tabs.create({
                url: webExtension.runtime.getURL('html/inject.html'),
                active: true
              }, (tab) => {
                injectTabId = tab.id
              })
            }
          })
        }
      })
    }
  })

  webExtension.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    if (request.action === 'fetch-convert') {
      Converter.fetchAndConvert(sender.tab.url, request.initial)
        .then(result => {
          if (result) {
            sendResponse(result)
          } else {
            sendResponse({})
          }
        })
        .catch((error) => sendResponse({ error: getErrorInfo(error) }))
      return true
    } else if (request.action === 'convert') {
      Converter.convert(sender.tab.url, request.source)
        .then(result => sendResponse(result))
        .catch((error) => sendResponse({ error: getErrorInfo(error) }))
      return true
    } else if (request.action === 'refresh-options') {
      webExtension.storage.local.set({
        CUSTOM_ATTRIBUTES: localStorage.CUSTOM_ATTRIBUTES,
        SAFE_MODE: localStorage.SAFE_MODE,
        ALLOW_TXT_EXTENSION: localStorage.ALLOW_TXT_EXTENSION,
        ENABLE_KROKI: localStorage.ENABLE_KROKI,
        KROKI_SERVER_URL: localStorage.KROKI_SERVER_URL,
        THEME: localStorage.THEME,
        JS: localStorage.JS,
        JS_LOAD: localStorage.JS_LOAD,
        LOCAL_POLL_FREQUENCY: localStorage.LOCAL_POLL_FREQUENCY,
        REMOTE_POLL_FREQUENCY: localStorage.REMOTE_POLL_FREQUENCY
      })
      const customThemeNames = JSON.parse(localStorage.CUSTOM_THEME_NAMES || '[]')
      if (customThemeNames.length > 0) {
        customThemeNames.forEach((themeName) => {
          const themeNameKey = 'CUSTOM_THEME_' + themeName
          const themeObj = {}
          themeObj[themeNameKey] = localStorage[themeNameKey]
          webExtension.storage.local.set(themeObj)
        })
      }
      const customJavaScriptNames = JSON.parse(localStorage.CUSTOM_JS_NAMES || '[]')
      if (customJavaScriptNames.length > 0) {
        customJavaScriptNames.forEach((javaScriptName) => {
          const javaScriptNameKey = 'CUSTOM_JS_' + javaScriptName
          const javaScriptObj = {}
          javaScriptObj[javaScriptNameKey] = localStorage[javaScriptNameKey]
          webExtension.storage.local.set(javaScriptObj)
        })
      }
    }
    // send an empty response to avoid the pesky error "The message port closed before a response was received"
    sendResponse({})
  })

  webExtension.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'complete' && tabId === injectTabId) {
      const tabs = webExtension.extension.getViews({ type: 'tab' })
      // Get the latest tab opened
      tabs[tabs.length - 1].inject(injectText)
    }
  })

  const getErrorInfo = (error) => {
    const errorInfo = {}
    if (typeof error === 'object') {
      Object.getOwnPropertyNames(error).forEach(function (key) {
        errorInfo[key] = error[key]
      }, error)
    } else {
      errorInfo.message = error
    }
    return errorInfo
  }

  const disableExtension = tab => {
    webExtension.tabs.reload(tab.id)
  }

  const notifyTab = (tab, status) => {
    webExtension.tabs.sendMessage(tab.id, { status: status })
  }

  const findActiveTab = (callback) => {
    let tabFound = false
    for (const matchTabUrl of matchesTabUrl) {
      webExtension.tabs.query({ active: true, currentWindow: true, url: matchTabUrl }, (tabs) => {
        if (!tabFound && tabs.length > 0) {
          callback(tabs[0])
          tabFound = true
        }
      })
    }
  }

  webExtension.action.onClicked.addListener(async () => {
    const { enableRender } = await webExtension.storage.local.get(['ENABLE_RENDER'])
    await enableDisableRender(!enableRender)
  })

  const { enableRender } = await webExtension.storage.local.get(['ENABLE_RENDER'])
  await enableDisableRender(enableRender)
})(webExtension)
