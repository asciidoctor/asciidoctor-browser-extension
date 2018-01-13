describe('Enable or disable the extension', () => {
  beforeEach(() => {
    asciidoctor.browser.convert = () => {
    };
  });

  it('should call convert method if the extension is enabled', () => {
    // Given
    const data = {};
    data.responseText = '= Hello world';
    spyOn(browser.storage.local, 'get').and.callFake((name, callback) => {
      const values = [];
      values[asciidoctor.browser.ENABLE_RENDER_KEY] = true;
      callback(values);
    });
    spyOn(asciidoctor.browser, 'convert');
    // When
    asciidoctor.browser.loadContent(data);
    // Then
    expect(asciidoctor.browser.convert).toHaveBeenCalledWith('= Hello world');
  });

  it('should not call convert method if the extension is disabled', () => {
    // Given
    const data = {};
    data.responseText = '= Hello world';
    spyOn(browser.storage.local, 'get').and.callFake((name, callback) => {
      const values = [];
      values[asciidoctor.browser.ENABLE_RENDER_KEY] = false;
      callback(values);
    });
    spyOn(asciidoctor.browser, 'convert');
    // When
    asciidoctor.browser.loadContent(data);
    // Then
    expect(asciidoctor.browser.convert).not.toHaveBeenCalledWith('= Hello world');
  });
});
