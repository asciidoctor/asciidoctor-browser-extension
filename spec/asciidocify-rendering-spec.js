describe('Load document attributes', () => {
  const Constants = asciidoctor.browser.constants()
  const Dom = asciidoctor.browser.dom(document)
  const Settings = asciidoctor.browser.settings(browser, Constants)
  const Theme = asciidoctor.browser.theme(browser, Settings, Constants)
  const Renderer = asciidoctor.browser.renderer(browser, document, Constants, Settings, Dom, Theme)
  it('', () => {
    let decodeURI = document.location.href.split('/')
    let fileName = decodeURI[decodeURI.length - 1].split('.')[0]
    let html = Renderer.convert('= {docname}', {}).html
    expect(html).toBe('<h1>' + fileName + '</h1>\n')
  })
})
