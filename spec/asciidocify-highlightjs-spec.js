describe('Syntax highlighting', () => {

  const Constants = asciidoctor.browser.constants();
  const Dom = asciidoctor.browser.dom(document);
  const Settings = asciidoctor.browser.settings(browser, Constants);
  const Theme = asciidoctor.browser.theme(browser, Settings, Constants);
  const Renderer = asciidoctor.browser.renderer(browser, document, Constants, Settings, Dom, Theme);

  it('should append highlight.js if source highlighter is enabled', (done) => {
    const params = [];
    params[Constants.CUSTOM_ATTRIBUTES_KEY] = '';
    params[Constants.SAFE_MODE_KEY] = 'safe';
    helper.configureParameters(params);

    const source = `= Hello world
:source-highlighter: prettier
    
== Code block

[source,js]
----
console.log('Hello world')
----`;
    Renderer.update(source)
      .then(() => {
        expect(document.getElementById('asciidoctor-browser-highlightjs').getAttribute('src')).toBe('js/vendor/highlight.js/highlight.min.js');
        expect(document.getElementById('asciidoctor-browser-highlightjs-refresh').getAttribute('src')).toBe('js/vendor/highlight.js/refresh.js');
        done();
      });
  });

  it('should not append highlight.js if source highlighter is disabled', (done) => {
    const params = [];
    params[Constants.CUSTOM_ATTRIBUTES_KEY] = '';
    params[Constants.SAFE_MODE_KEY] = 'safe';
    helper.configureParameters([]);

    const source = `= Hello world
    
== Code block

[source,js]
----
console.log('Hello world')
----`;

    Renderer.update(source)
      .then(() => {
        expect(document.getElementById('asciidoctor-browser-highlightjs')).toBeNull();
        done();
      });
  });
});
