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
      showResponse(response)
    } else {
      webExtension.runtime.sendMessage(
        { action: 'convert', source },
        (response) => {
          showResponse(response)
        },
      )
    }
    alreadyRun = true
  }
}

const showResponse = (response) => {
  if (response) {
    if (response.html) {
      updateHTML(response).then()
    } else if (response.error) {
      showError(response.error)
    }
  }
}

// eslint-disable-next-line no-unused-vars
window.inject = inject

document.getElementById('content').innerHTML += 'Rendering...'
