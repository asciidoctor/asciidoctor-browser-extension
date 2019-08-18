/* global describe, it, expect, asciidoctor, helper, browser */
describe('Syntax highlighting', () => {
  const Constants = asciidoctor.browser.constants()
  const Dom = asciidoctor.browser.dom(document)
  const Settings = asciidoctor.browser.settings(browser, Constants)
  const Theme = asciidoctor.browser.theme(browser, Settings, Constants)
  const Renderer = asciidoctor.browser.renderer(browser, document, Constants, Settings, Dom, Theme)

  it('should append highlight.js if source highlighter is enabled', (done) => {
    const params = []
    params[Constants.CUSTOM_ATTRIBUTES_KEY] = ''
    params[Constants.SAFE_MODE_KEY] = 'safe'
    helper.configureParameters(params)

    const source = `= Hello world
:source-highlighter: prettier
    
== Code block

[source#code,js]
----
console.log('Hello world')
----`
    Renderer.update(source)
      .then(() => {
        expect(document.getElementById('code').querySelectorAll('code > span').length).toBe(2)
        done()
      })
  })

  it('should not append highlight.js if source highlighter is disabled', (done) => {
    const params = []
    params[Constants.CUSTOM_ATTRIBUTES_KEY] = ''
    params[Constants.SAFE_MODE_KEY] = 'safe'
    helper.configureParameters([])

    const source = `= Hello world
    
== Code block

[source#code,js]
----
console.log('Hello world')
----`

    Renderer.update(source)
      .then(() => {
        expect(document.getElementById('code').querySelectorAll('code > span').length).toBe(0)
        done()
      })
  })
})
