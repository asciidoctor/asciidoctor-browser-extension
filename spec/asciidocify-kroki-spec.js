/* global describe, it, expect, asciidoctor, helper, browser, fail */
describe('Render a PlantUML diagram', () => {
  const Constants = asciidoctor.browser.constants()
  const Dom = asciidoctor.browser.dom(document)
  const Settings = asciidoctor.browser.settings(browser, Constants)
  const Theme = asciidoctor.browser.theme(browser, Settings, Constants)
  const Renderer = asciidoctor.browser.renderer(browser, document, Constants, Settings, Dom, Theme)

  it('should render a PlantUML diagram', (done) => {
    const params = []
    params[Constants.CUSTOM_ATTRIBUTES_KEY] = ''
    params[Constants.SAFE_MODE_KEY] = 'safe'
    helper.configureParameters(params)

    const source = `
[plantuml]
----
Bob -> Alice : hello
----
`

    Renderer.update(source)
      .then(() => {
        const plantumlDiv = document.body.getElementsByClassName('kroki')[0]
        expect(plantumlDiv).toBeDefined()
        const plantumlImg = plantumlDiv.getElementsByTagName('img')[0]
        expect(plantumlImg.getAttribute('src')).toBe('https://kroki.io/plantuml/svg/eNpzyk9S0LVTcMzJTE5VsFLISM3JyQcAPHcGKw==')
        done()
      })
      .catch((error) => {
        fail(error)
      })
  })

  it('should render an external GraphViz diagram', (done) => {
    const params = []
    params[Constants.CUSTOM_ATTRIBUTES_KEY] = ''
    params[Constants.SAFE_MODE_KEY] = 'safe'
    helper.configureParameters(params)

    const source = `
graphviz::http://localhost:9876/base/spec/fixtures/hello.dot[]
`

    Renderer.update(source)
      .then(() => {
        const plantumlDiv = document.body.getElementsByClassName('kroki')[0]
        expect(plantumlDiv).toBeDefined()
        const plantumlImg = plantumlDiv.getElementsByTagName('img')[0]
        expect(plantumlImg.getAttribute('src')).toBe('https://kroki.io/graphviz/svg/eNpLyUwvSizIUHBXqOZSUPBIzcnJ17ULzy_KSeGq5QIAjfEJJA==')
        done()
      })
      .catch((error) => {
        fail(error)
      })
  })
})
