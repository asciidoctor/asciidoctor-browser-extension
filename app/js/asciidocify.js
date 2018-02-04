((webExtension, document, location) => {
  const Constants = asciidoctor.browser.constants();
  const Dom = asciidoctor.browser.dom(document);
  const Theme = asciidoctor.browser.theme(webExtension, Constants);
  const Settings = asciidoctor.browser.settings(webExtension, Constants);

  const Renderer = asciidoctor.browser.renderer(webExtension, document, Constants, Settings, Dom, Theme);
  const Loader = asciidoctor.browser.loader(webExtension, document, location, Settings, Renderer);

  Loader.load();
})(webExtension, document, location);
