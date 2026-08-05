/* global chrome, browser */
import { convert } from './module/converter.js'
import { showError, updateHTML } from './module/page.js'
import { getBrowserInfo } from './module/settings.js'

const webExtension = typeof browser === 'undefined' ? chrome : browser

let alreadyRun = false
const inject = async (source) => {
  if (!alreadyRun) {
    const browserInfo = getBrowserInfo()
    if (browserInfo.name === 'Firefox') {
      let response = {}
      try {
        response = await convert(location.href, source)
      } catch (e) {
        response.error = e
      }
      await showResponse(response)
    } else {
      webExtension.runtime.sendMessage(
        { action: 'convert', source },
        async (response) => {
          await showResponse(response)
        },
      )
    }
    alreadyRun = true
  }
}

const showResponse = async (response) => {
  if (response) {
    if (response.html) {
      await updateHTML(response)
    } else if (response.error) {
      showError(response.error)
    }
  }
}

document.getElementById('content').innerHTML += 'Rendering...'

webExtension.runtime.sendMessage({ action: 'get-selection' }, (response) => {
  if (response?.text) {
    inject(response.text)
  }
})
