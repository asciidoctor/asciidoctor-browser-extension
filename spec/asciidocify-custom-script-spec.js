describe('Append a custom script', () => {

  const Constants = asciidoctor.browser.constants();
  const Dom = asciidoctor.browser.dom(document);
  const Settings = asciidoctor.browser.settings(browser, Constants);
  const Theme = asciidoctor.browser.theme(browser, Settings, Constants);
  const Renderer = asciidoctor.browser.renderer(browser, document, Constants, Settings, Dom, Theme);

  it('should append before the content', (done) => {
    const params = [];
    params[Constants.CUSTOM_ATTRIBUTES_KEY] = '';
    params[Constants.SAFE_MODE_KEY] = 'safe';
    params[Constants.JS_KEY] = 'bar';
    params[Constants.JS_LOAD_KEY] = 'before';
    params[Constants.CUSTOM_JS_PREFIX + 'bar'] = 'document.body.appendChild(document.createElement(\'strong\'));';
    helper.configureParameters(params);

    Renderer.update('= Hello world')
      .then(() => {
        // the custom script must be present in <head>
        expect(Array.from(document.head.children).find(element => element.id === 'asciidoctor-browser-custom-js').innerText).toBe('document.body.appendChild(document.createElement(\'strong\'));');
        // the <b> element created by the custom JavaScript will be removed by the rendering phase (because the script run before)
        expect(Array.from(document.body.children).find(element => element.tagName.toLowerCase() === 'strong')).toBeUndefined();
        // the first element in the body must be the content
        expect(document.body.children[0].id).toBe('content');
        done();
      });
  });

  it('should append after the content', (done) => {
    const params = [];
    params[Constants.CUSTOM_ATTRIBUTES_KEY] = '';
    params[Constants.SAFE_MODE_KEY] = 'safe';
    params[Constants.JS_KEY] = 'foo';
    params[Constants.JS_LOAD_KEY] = 'after';
    params[Constants.CUSTOM_JS_PREFIX + 'foo'] = 'document.body.appendChild(document.createElement(\'i\'));';
    helper.configureParameters(params);

    Renderer.update('= Hello world')
      .then(() => {
        expect(Array.from(document.head.children).find(element => element.id === 'asciidoctor-browser-custom-js').innerText).toBe('document.body.appendChild(document.createElement(\'i\'));');
        // the <i> element created by the custom JavaScript must be present (because the script run after the rendering phase)
        expect(Array.from(document.body.children).find(element => element.tagName.toLowerCase() === 'i')).toBeDefined();
        // the first element in the body must be the content
        expect(document.body.children[0].id).toBe('content');
        done();
      });
  });
});
