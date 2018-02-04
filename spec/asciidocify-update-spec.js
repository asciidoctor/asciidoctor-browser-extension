describe('Update the HTML document', () => {

  const Constants = asciidoctor.browser.constants();
  const Dom = asciidoctor.browser.dom(document);
  const Theme = asciidoctor.browser.theme(browser, Constants);
  const Settings = asciidoctor.browser.settings(browser, Constants);
  const Renderer = asciidoctor.browser.renderer(browser, document, Constants, Settings, Dom, Theme);

  it('should update the HTML document with the AsciiDoc source', (done) => {
    // Given
    const source = '= Hello world';
    spyOn(browser.storage.local, 'set').and.callFake(() => {
      // noop
    });
    spyOn(browser.storage.local, 'get').and.callFake((name, callback) => {
      const values = [];
      values[Constants.CUSTOM_ATTRIBUTES_KEY] = '';
      values[Constants.SAFE_MODE_KEY] = 'safe';
      callback(values);
    });
    // When
    Renderer.update(source)
      .then(() => {
        // Twemoji must be present
        expect(document.getElementById('twemoji-awesome-style').getAttribute('href')).toBe('css/twemoji-awesome.css');
        // Chartist must be present
        expect(document.getElementById('chartist-style').getAttribute('href')).toBe('css/chartist.min.css');
        expect(document.getElementById('chartist-asciidoctor-style').innerText).not.toBe('');
        // Font Awesome must be present
        expect(document.getElementById('font-awesome-style').getAttribute('href')).toBe('css/font-awesome.min.css');
        // Content must be converted
        expect(document.getElementById('content').innerHTML).toContain('<h1>Hello world</h1>');
        done();
      });
  });
});
