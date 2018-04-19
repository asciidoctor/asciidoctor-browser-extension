describe('Load the content', () => {

  const Constants = asciidoctor.browser.constants();
  const Dom = asciidoctor.browser.dom(document);
  const Theme = asciidoctor.browser.theme(browser, Constants);
  const Settings = asciidoctor.browser.settings(browser, Constants);
  const Renderer = asciidoctor.browser.renderer(browser, document, Constants, Settings, Dom, Theme);
  const Loader = asciidoctor.browser.loader(browser, document, location, Settings, Renderer);

  it('should load the content using the text content (available in the pre element)', () => {
    spyOn(browser.storage.local, 'set').and.callFake(() => {
      // noop
    });
    spyOn(browser.storage.local, 'get').and.callFake((name, callback) => {
      const values = [];
      values[Constants.CUSTOM_ATTRIBUTES_KEY] = '';
      values[Constants.SAFE_MODE_KEY] = 'safe';
      values[Constants.ENABLE_RENDER_KEY] = true;
      callback(values);
    });
    document.body.innerHTML = '';
    const textPlainElement = document.createElement('pre');
    textPlainElement.innerHTML = '= Hello world';
    document.body.appendChild(textPlainElement);
    Loader.load()
      .then(() => {
        expect(document.getElementById('content').innerHTML).toContain('<h1>Hello world</h1>');
      })
      .catch((error) => {
        fail(error);
      })
  });

  it('should load the content using XMLHttpRequest', () => {
    const mockXMLHttpRequest = function() {};
    mockXMLHttpRequest.prototype.open = () => {};
    mockXMLHttpRequest.prototype.setRequestHeader = () => {};
    mockXMLHttpRequest.prototype.getResponseHeader = () => {};
    mockXMLHttpRequest.prototype.send = function () {
      const event = {};
      this.readyState = XMLHttpRequest.DONE
      this.status = 0;
      this.responseText = '= Hello world';
      this.onreadystatechange(event);
    };
    const defaultXMLHttpRequest = window.XMLHttpRequest;
    try {
      window.XMLHttpRequest = mockXMLHttpRequest;
      spyOn(browser.storage.local, 'set').and.callFake(() => {
        // noop
      });
      spyOn(browser.storage.local, 'get').and.callFake((name, callback) => {
        const values = [];
        values[Constants.CUSTOM_ATTRIBUTES_KEY] = '';
        values[Constants.SAFE_MODE_KEY] = 'safe';
        values[Constants.ENABLE_RENDER_KEY] = true;
        callback(values);
      });
      document.body.innerHTML = '';
      Loader.load()
        .then(() => {
          expect(document.getElementById('content').innerHTML).toContain('<h1>Hello world</h1>');
        })
        .catch((error) => {
          fail(error);
        })
    } finally {
      window.XMLHttpRequest = defaultXMLHttpRequest;
    }
  });
});
