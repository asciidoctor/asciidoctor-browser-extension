/* global asciidoctor, webExtension, location */
((webExtension, document, location) => {
  const Constants = asciidoctor.browser.constants()
  const Dom = asciidoctor.browser.dom(document)
  const Settings = asciidoctor.browser.settings(webExtension, Constants)
  const Theme = asciidoctor.browser.theme(webExtension, Settings, Constants)

  const Renderer = asciidoctor.browser.renderer(webExtension, document, Constants, Settings, Dom, Theme)
  const Loader = asciidoctor.browser.loader(webExtension, document, location, window.XMLHttpRequest, Settings, Renderer)

  Loader.init()
})(webExtension, document, location)
