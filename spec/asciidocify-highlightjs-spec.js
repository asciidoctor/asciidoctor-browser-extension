describe('Syntax highlighting', () => {

  const Constants = asciidoctor.browser.constants();
  const Dom = asciidoctor.browser.dom(document);
  const Theme = asciidoctor.browser.theme(browser, Constants);
  const Settings = asciidoctor.browser.settings(browser, Constants);
  const Renderer = asciidoctor.browser.renderer(browser, document, Constants, Settings, Dom, Theme);

  it('should append highlight.js if source highlighter is enabled', (done) => {
    // Given
    const source = `= Hello world
:source-highlighter: prettier
    
== Code block

[source,js]
----
console.log('Hello world')
----`;
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
        expect(document.getElementById('asciidoctor-browser-highlightjs').getAttribute('src')).toBe('js/vendor/highlight.min.js');
        const preElement = document.body.getElementsByTagName('pre')[0];
        const codeElement = preElement.getElementsByTagName('code')[0];
        expect(preElement.classList.contains('highlightjs')).toBeTruthy();
        expect(codeElement.classList.contains('hljs')).toBeTruthy();
        expect(codeElement.innerText).toBe('console.log(\'Hello world\')');
        expect(codeElement.getElementsByTagName('span').length).toBeGreaterThan(0);
        done();
      });
  });

  it('should not append highlight.js if source highlighter is disabled', (done) => {
    // Given
    const source = `= Hello world
    
== Code block

[source,js]
----
console.log('Hello world')
----`;
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
        expect(document.getElementById('asciidoctor-browser-highlightjs')).toBeNull();
        const preElement = document.body.getElementsByTagName('pre')[0];
        const codeElement = preElement.getElementsByTagName('code')[0];
        expect(preElement.classList.contains('highlightjs')).toBeFalsy();
        expect(codeElement.classList.contains('hljs')).toBeFalsy();
        expect(codeElement.innerText).toBe('console.log(\'Hello world\')');
        expect(codeElement.getElementsByTagName('span').length).toBe(0);
        done();
      });
  });
});
