/* global sinon, browser */
function configureParameters(params) {
  if (typeof params === 'undefined') {
    params = []
  }
  sinon.spy(browser.storage.local, 'set')
  sinon.stub(browser.storage.local, 'get').callsFake((_name, callback) => {
    callback(params)
  })
}

function createXMLHttpRequestMock() {
  const mockXMLHttpRequest = () => {}
  mockXMLHttpRequest.prototype.open = () => {}
  mockXMLHttpRequest.prototype.setRequestHeader = () => {}
  mockXMLHttpRequest.prototype.getResponseHeader = () => {}
  mockXMLHttpRequest.DONE = 4
  mockXMLHttpRequest.prototype.send = function () {
    const event = {}
    this.readyState = mockXMLHttpRequest.DONE
    this.status = 0
    this.responseText = '= Hello world'
    this.onreadystatechange(event)
  }
  return mockXMLHttpRequest
}

function plainTextDocument(document, text) {
  document.body.innerHTML = ''
  const textPlainElement = document.createElement('pre')
  textPlainElement.innerHTML = text
  document.body.appendChild(textPlainElement)
}

function configureManifest(manifest) {
  sinon.stub(browser.runtime, 'getManifest').callsFake(() => {
    return manifest
  })
}

function reset() {
  if (typeof browser.storage.local.set.restore === 'function') {
    browser.storage.local.set.restore()
    browser.storage.local.get.restore()
  }
  if (typeof browser.runtime.getManifest.restore === 'function') {
    browser.runtime.getManifest.restore()
  }
}

window.helper = {
  configureParameters,
  reset,
  configureManifest,
  createXMLHttpRequestMock,
  plainTextDocument,
}
