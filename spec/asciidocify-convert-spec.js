describe('Convert the AsciiDoc content', () => {
  it('should convert the AsciiDoc content', (done) => {
    // Given
    const data = '= Hello world';
    spyOn(browser.storage.local, 'set').and.callFake(() => {
      // noop
    });
    spyOn(browser.storage.local, 'get').and.callFake((name, callback) => {
      const values = [];
      values[asciidoctor.browser.CUSTOM_ATTRIBUTES_KEY] = '';
      values[asciidoctor.browser.SAFE_MODE_KEY] = 'safe';
      callback(values);
    });
    // When
    asciidoctor.browser.convert(data)
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
