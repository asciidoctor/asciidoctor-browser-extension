/* global describe, it, expect, asciidoctor, helper, browser, fail, location, spyOn */
describe('Extension initialization', () => {
  const Constants = asciidoctor.browser.constants()
  const Dom = asciidoctor.browser.dom(document)
  const Settings = asciidoctor.browser.settings(browser, Constants)
  const Theme = asciidoctor.browser.theme(browser, Settings, Constants)
  const Renderer = asciidoctor.browser.renderer(browser, document, Constants, Settings, Dom, Theme)

  it('should load the content using the text content (available in the pre element)', (done) => {
    const params = []
    params[Constants.CUSTOM_ATTRIBUTES_KEY] = ''
    params[Constants.SAFE_MODE_KEY] = 'safe'
    params[Constants.ENABLE_RENDER_KEY] = true
    helper.configureParameters(params)
    helper.plainTextDocument(document, '= Hello world')

    const Loader = asciidoctor.browser.loader(browser, document, location, window.XMLHttpRequest, Settings, Renderer)
    Loader.init()
      .then(() => {
        expect(document.getElementById('content').innerHTML).toContain('<h1>Hello world</h1>')
        done()
      })
      .catch((error) => {
        fail(error)
      })
  })

  it('should load the content using XMLHttpRequest', (done) => {
    const mockXMLHttpRequest = helper.createXMLHttpRequestMock()
    const params = []
    params[Constants.CUSTOM_ATTRIBUTES_KEY] = ''
    params[Constants.SAFE_MODE_KEY] = 'safe'
    params[Constants.ENABLE_RENDER_KEY] = true
    helper.configureParameters(params)
    document.body.innerHTML = ''

    const Loader = asciidoctor.browser.loader(browser, document, location, mockXMLHttpRequest, Settings, Renderer)
    Loader.init()
      .then(() => {
        expect(document.getElementById('content').innerHTML).toContain('<h1>Hello world</h1>')
        done()
      })
      .catch((error) => {
        fail(error)
      })
  })

  it('should call convert method if the extension is enabled', (done) => {
    const mockXMLHttpRequest = helper.createXMLHttpRequestMock()
    const params = []
    params[Constants.ENABLE_RENDER_KEY] = true
    helper.configureParameters(params)

    spyOn(Renderer, 'update').and.callFake(() => Promise.resolve())

    const Loader = asciidoctor.browser.loader(browser, document, location, mockXMLHttpRequest, Settings, Renderer)
    Loader.init()
      .then(() => {
        expect(Renderer.update).toHaveBeenCalledWith('= Hello world')
        done()
      })
      .catch((error) => {
        fail(error)
      })
  })

  it('should not call convert method if the extension is disabled', (done) => {
    const params = []
    params[Constants.ENABLE_RENDER_KEY] = false
    helper.configureParameters(params)

    document.body.innerHTML = '<b>do not touch my body</b>'

    const Loader = asciidoctor.browser.loader(browser, document, location, window.XMLHttpRequest, Settings, Renderer)
    Loader.init()
      .then(() => {
        expect(document.body.innerHTML).toContain('<b>do not touch my body</b>')
        done()
      })
      .catch((error) => {
        fail(error)
      })
  })
})
