function createXMLHttpRequestMock () {
  const mockXMLHttpRequest = function () {
  };
  mockXMLHttpRequest.prototype.open = () => {
  };
  mockXMLHttpRequest.prototype.setRequestHeader = () => {
  };
  mockXMLHttpRequest.prototype.getResponseHeader = () => {
  };
  mockXMLHttpRequest.DONE = 4;
  mockXMLHttpRequest.prototype.send = function () {
    const event = {};
    this.readyState = mockXMLHttpRequest.DONE;
    this.status = 0;
    this.responseText = '= Hello world';
    this.onreadystatechange(event);
  };
  return mockXMLHttpRequest;
}

describe('Extension initialization', () => {

  const Constants = asciidoctor.browser.constants();
  const Dom = asciidoctor.browser.dom(document);
  const Theme = asciidoctor.browser.theme(browser, Constants);
  const Settings = asciidoctor.browser.settings(browser, Constants);
  const Renderer = asciidoctor.browser.renderer(browser, document, Constants, Settings, Dom, Theme);

  it('should load the content using the text content (available in the pre element)', (done) => {
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
    const Loader = asciidoctor.browser.loader(browser, document, location, window.XMLHttpRequest, Settings, Renderer);
    Loader.init()
      .then(() => {
        expect(document.getElementById('content').innerHTML).toContain('<h1>Hello world</h1>');
        done();
      })
      .catch((error) => {
        fail(error);
      })
  });

  it('should load the content using XMLHttpRequest', (done) => {
    const mockXMLHttpRequest = createXMLHttpRequestMock();
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
    const Loader = asciidoctor.browser.loader(browser, document, location, mockXMLHttpRequest, Settings, Renderer);
    Loader.init()
      .then(() => {
        expect(document.getElementById('content').innerHTML).toContain('<h1>Hello world</h1>');
        done();
      })
      .catch((error) => {
        fail(error);
      })
  });

  it('should call convert method if the extension is enabled', (done) => {
    const mockXMLHttpRequest = createXMLHttpRequestMock();
    spyOn(browser.storage.local, 'get').and.callFake((name, callback) => {
      const values = [];
      values[Constants.ENABLE_RENDER_KEY] = true;
      callback(values);
    });
    spyOn(Renderer, 'update').and.callFake(() => Promise.resolve());
    const Loader = asciidoctor.browser.loader(browser, document, location, mockXMLHttpRequest, Settings, Renderer);
    Loader.init()
      .then(() => {
        expect(Renderer.update).toHaveBeenCalledWith('= Hello world');
        done();
      })
      .catch((error) => {
        fail(error);
      })
  });

  it('should not call convert method if the extension is disabled', (done) => {
    spyOn(browser.storage.local, 'get').and.callFake((name, callback) => {
      const values = [];
      values[Constants.ENABLE_RENDER_KEY] = false;
      callback(values);
    });
    document.body.innerHTML = '<b>do not touch my body</b>';
    const Loader = asciidoctor.browser.loader(browser, document, location, window.XMLHttpRequest, Settings, Renderer);
    Loader.init()
      .then(() => {
        expect(document.body.innerHTML).toContain('<b>do not touch my body</b>');
        done();
      })
      .catch((error) => {
        fail(error);
      })
  });
});
