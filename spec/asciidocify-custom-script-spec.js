describe('Append a custom script', () => {

  const Constants = asciidoctor.browser.constants();
  const Dom = asciidoctor.browser.dom(document);
  const Theme = asciidoctor.browser.theme(browser, Constants);
  const Settings = asciidoctor.browser.settings(browser, Constants);
  const Renderer = asciidoctor.browser.renderer(browser, document, Constants, Settings, Dom, Theme);

  it('should append before the content', (done) => {
    // Given
    const source = '= Hello world';
    spyOn(browser.storage.local, 'set').and.callFake(() => {
      // noop
    });
    spyOn(browser.storage.local, 'get').and.callFake((name, callback) => {
      const values = [];
      values[Constants.CUSTOM_ATTRIBUTES_KEY] = '';
      values[Constants.SAFE_MODE_KEY] = 'safe';
      values[Constants.JS_KEY] = 'bar';
      values[Constants.JS_LOAD_KEY] = 'before';
      values[Constants.CUSTOM_JS_PREFIX + 'bar'] = 'const bar = \'bar\';';
      callback(values);
    });
    // When
    Renderer.update(source)
      .then(() => {
        // the custom script must be the first element in the <body>
        expect(document.body.children[0].innerText).toBe('const bar = \'bar\';');
        // the next element must be the content
        expect(document.body.children[1].id).toBe('content');
        done();
      });
  });

  it('should append after the content', (done) => {
    // Given
    const source = '= Hello world';
    spyOn(browser.storage.local, 'set').and.callFake(() => {
      // noop
    });
    spyOn(browser.storage.local, 'get').and.callFake((name, callback) => {
      const values = [];
      values[Constants.CUSTOM_ATTRIBUTES_KEY] = '';
      values[Constants.SAFE_MODE_KEY] = 'safe';
      values[Constants.JS_KEY] = 'foo';
      values[Constants.JS_LOAD_KEY] = 'after';
      values[Constants.CUSTOM_JS_PREFIX + 'foo'] = 'const foo = \'foo\';';
      callback(values);
    });
    // When
    Renderer.update(source)
      .then(() => {
        // the content must be the first element in the <body>
        expect(document.body.children[0].id).toBe('content');
        // the custom script must be present in the <body>
        expect(Array.from(document.body.children).find(element => element.id === 'asciidoctor-custom-js').innerText).toBe('const foo = \'foo\';');
        done();
      });
  });
});
