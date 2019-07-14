/* global describe, it, expect, asciidoctor, browser */
describe('Load document attributes', () => {
  const Constants = asciidoctor.browser.constants()
  const Dom = asciidoctor.browser.dom(document)
  const Settings = asciidoctor.browser.settings(browser, Constants)
  const Theme = asciidoctor.browser.theme(browser, Settings, Constants)
  const Renderer = asciidoctor.browser.renderer(browser, document, Constants, Settings, Dom, Theme)

  it('should set docname correct', () => {
    const decodeURI = document.location.href.split('/')
    const fileName = decodeURI[decodeURI.length - 1].split('.')[0]
    const html = Renderer.convert('= {docname}', {}).html
    expect(html).toBe('<h1>' + fileName + '</h1>\n')
  })

  it('should set outfilesuffix correct', () => {
    const html = Renderer.convert('= {outfilesuffix}', {}).html
    expect(html).toBe('<h1>.adoc</h1>\n')
  })

  it('should resolve inter-document cross reference', () => {
    const html = Renderer.convert('Refer to <<document-b.adoc#section-b,Section B>> for more information.', {}).html
    expect(html).toBe('<div class="paragraph">\n<p>Refer to <a href="document-b.adoc#section-b">Section B</a> for more information.</p>\n</div>')
  })

  it('should set docfilesuffix correct', () => {
    const decodeURI = document.location.href.split('/')
    const expected = decodeURI[decodeURI.length - 1].split('.')[1]
    const html = Renderer.convert('= {docfilesuffix}', {}).html
    expect(html).toBe('<h1>.' + expected + '</h1>\n')
  })

  it('should set docfile correct', () => {
    const decodeURI = document.location.href.split('/')
    const expected = decodeURI[decodeURI.length - 1]
    const html = Renderer.convert('= {docfile}', {}).html
    expect(html).toBe('<h1>' + expected + '</h1>\n')
  })
})
