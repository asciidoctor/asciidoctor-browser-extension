function configureParameters(params) {
  if (typeof params === 'undefined') {
    params = [];
  }
  spyOn(browser.storage.local, 'set').and.callFake(() => {
    // noop
  });
  spyOn(browser.storage.local, 'get').and.callFake((name, callback) => {
    callback(params);
  });
};

function createXMLHttpRequestMock() {
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
};

function plainTextDocument(document, text) {
  document.body.innerHTML = '';
  const textPlainElement = document.createElement('pre');
  textPlainElement.innerHTML = text;
  document.body.appendChild(textPlainElement);
}

function configureManifest(manifest) {
  spyOn(browser.runtime, 'getManifest').and.callFake(() => {
    return manifest;
  });
};

const helper = {
  configureParameters: configureParameters,
  configureManifest: configureManifest,
  createXMLHttpRequestMock: createXMLHttpRequestMock,
  plainTextDocument: plainTextDocument
}
