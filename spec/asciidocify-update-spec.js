describe('Update the HTML document', () => {
  it('should update the HTML document with the AsciiDoc source', (done) => {
    // Given
    const source = '= Hello world';
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
    asciidoctor.browser.update(source)
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
