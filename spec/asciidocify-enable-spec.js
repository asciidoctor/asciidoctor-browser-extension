describe('Enable or disable the extension', () => {

  const Constants = asciidoctor.browser.constants();
  const Dom = asciidoctor.browser.dom(document);
  const Theme = asciidoctor.browser.theme(browser, Constants);
  const Settings = asciidoctor.browser.settings(browser, Constants);
  const Renderer = asciidoctor.browser.renderer(browser, document, Constants, Settings, Dom, Theme);
  const Loader = asciidoctor.browser.loader(browser, document, location, Settings, Renderer);

  it('should call convert method if the extension is enabled', () => {
    // Given
    const request = {};
    request.responseText = '= Hello world';
    spyOn(browser.storage.local, 'get').and.callFake((name, callback) => {
      const values = [];
      values[Constants.ENABLE_RENDER_KEY] = true;
      callback(values);
    });
    spyOn(Renderer, 'update').and.callFake(() => Promise.resolve());
    // When
    Loader.loadContent(request)
      .then(() => {
        expect(Renderer.update).toHaveBeenCalledWith('= Hello world');
      });
  });

  it('should not call convert method if the extension is disabled', () => {
    // Given
    const request = {};
    request.responseText = '= Hello world';
    spyOn(browser.storage.local, 'get').and.callFake((name, callback) => {
      const values = [];
      values[Constants.ENABLE_RENDER_KEY] = false;
      callback(values);
    });
    spyOn(Renderer, 'update').and.callFake(() => Promise.resolve());
    // When
    Loader.loadContent(request)
      .then(() => {
        expect(Renderer.update).not.toHaveBeenCalledWith('= Hello world');
      });
  });
});
