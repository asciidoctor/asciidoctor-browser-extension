describe('Enable or disable the extension', () => {
  it('should call convert method if the extension is enabled', () => {
    // Given
    const request = {};
    request.responseText = '= Hello world';
    spyOn(browser.storage.local, 'get').and.callFake((name, callback) => {
      const values = [];
      values[asciidoctor.browser.ENABLE_RENDER_KEY] = true;
      callback(values);
    });
    spyOn(asciidoctor.browser, 'update').and.callFake(() => Promise.resolve());
    // When
    asciidoctor.browser.loadContent(request);
    // Then
    expect(asciidoctor.browser.update).toHaveBeenCalledWith('= Hello world');
  });

  it('should not call convert method if the extension is disabled', () => {
    // Given
    const request = {};
    request.responseText = '= Hello world';
    spyOn(browser.storage.local, 'get').and.callFake((name, callback) => {
      const values = [];
      values[asciidoctor.browser.ENABLE_RENDER_KEY] = false;
      callback(values);
    });
    spyOn(asciidoctor.browser, 'update').and.callFake(() => Promise.resolve());
    // When
    asciidoctor.browser.loadContent(request);
    // Then
    expect(asciidoctor.browser.update).not.toHaveBeenCalledWith('= Hello world');
  });
});
