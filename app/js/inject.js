/* global asciidoctor, webExtension, location */
asciidoctor.browser.inject = ((webExtension, document, location) => {
  const Constants = asciidoctor.browser.constants()
  const Dom = asciidoctor.browser.dom(document)
  const Settings = asciidoctor.browser.settings(webExtension, Constants)
  const Theme = asciidoctor.browser.theme(webExtension, Settings, Constants)
  const Renderer = asciidoctor.browser.renderer(webExtension, document, Constants, Settings, Dom, Theme)
  const Converter = asciidoctor.browser.converter(webExtension, Constants, Settings)

  let alreadyRun = false

  const inject = async (source) => {
    if (!alreadyRun) {
      const browserInfo = Settings.getBrowserInfo()
      if (browserInfo.name === 'Firefox') {
        let response = {}
        try {
          response = await Converter.convert(location.href, source)
        } catch (e) {
          response.error = e
        }
        showResponse(response)
      } else {
        webExtension.runtime.sendMessage({ action: 'convert', source }, function (response) {
          showResponse(response)
        })
      }
      alreadyRun = true
    }
  }

  const showResponse = (response) => {
    if (response) {
      if (response.html) {
        Renderer.updateHTML(response)
      } else if (response.error) {
        Renderer.showError(response.error)
      }
    }
  }

  // eslint-disable-next-line no-unused-vars
  window.inject = inject

  document.getElementById('content').innerHTML += 'Rendering...'
})(webExtension, document, location)
