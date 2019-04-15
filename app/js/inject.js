/* global asciidoctor, webExtension, location */
asciidoctor.browser.inject = ((webExtension, document, location) => {
  const Constants = asciidoctor.browser.constants()
  const Dom = asciidoctor.browser.dom(document)
  const Settings = asciidoctor.browser.settings(webExtension, Constants)
  const Theme = asciidoctor.browser.theme(webExtension, Settings, Constants)
  const Renderer = asciidoctor.browser.renderer(webExtension, document, Constants, Settings, Dom, Theme)

  let alreadyRun = false

  const inject = (source) => {
    if (!alreadyRun) {
      Renderer.update(source)
      alreadyRun = true
    }
  }

  // eslint-disable-next-line no-unused-vars
  window.inject = inject

  document.getElementById('content').innerHTML += 'Rendering...'
})(webExtension, document, location)
