/* global it, describe, afterEach, beforeEach, mocha, chai, mochaOpts, asciidoctor, browser, helper, sinon */
// bootstrap
(async () => {
  let reporter
  if (typeof mochaOpts === 'function') {
    reporter = await mochaOpts().reporter
  } else {
    reporter = 'html'
  }
  mocha.setup({
    ui: 'bdd',
    checkLeaks: false,
    reporter: reporter
  })

  const expect = chai.expect

  const parts = window.location.href.split('/') // break the string into an array
  parts.pop()
  parts.pop()
  parts.pop()
  const baseDir = parts.join('/')

  const Constants = asciidoctor.browser.constants()
  const Dom = asciidoctor.browser.dom(document)
  const Settings = asciidoctor.browser.settings(browser, Constants)
  const Theme = asciidoctor.browser.theme(browser, Settings, Constants)
  const Renderer = asciidoctor.browser.renderer(browser, document, Constants, Settings, Dom, Theme)
  const Converter = asciidoctor.browser.converter(browser, Constants, Settings)
  const Loader = asciidoctor.browser.loader(browser, document, document.location, window.XMLHttpRequest, Settings, Renderer)

  describe('Custom script', () => {
    afterEach(() => {
      helper.reset()
    })

    it('should append before the content', async () => {
      const params = []
      params[Constants.ENABLE_RENDER_KEY] = 'true'
      params[Constants.CUSTOM_ATTRIBUTES_KEY] = ''
      params[Constants.SAFE_MODE_KEY] = 'safe'
      params[Constants.JS_KEY] = 'bar'
      params[Constants.JS_LOAD_KEY] = 'before'
      params[Constants.CUSTOM_JS_PREFIX + 'bar'] = 'document.body.appendChild(document.createElement(\'strong\'));'
      helper.configureParameters(params)

      const contentElement = document.getElementById('content')
      if (contentElement) {
        contentElement.remove()
      }
      const response = await Converter.convert(window.location.toString(), '= Hello world')
      await Renderer.updateHTML(response)
      // the custom script must be present in <head>
      expect(Array.from(document.head.children).find(element => element.id === 'asciidoctor-browser-custom-js').innerText).to.equal('document.body.appendChild(document.createElement(\'strong\'));')
      // the <b> element created by the custom JavaScript will be removed by the rendering phase (because the script run before)
      expect(Array.from(document.body.children).find(element => element.tagName.toLowerCase() === 'strong')).to.be.undefined()
      // the first element in the body must be the content
      expect(document.body.children[0].id).to.equal('content')
    })

    it('should append after the content', async () => {
      const params = []
      params[Constants.ENABLE_RENDER_KEY] = 'true'
      params[Constants.CUSTOM_ATTRIBUTES_KEY] = ''
      params[Constants.SAFE_MODE_KEY] = 'safe'
      params[Constants.JS_KEY] = 'foo'
      params[Constants.JS_LOAD_KEY] = 'after'
      params[Constants.CUSTOM_JS_PREFIX + 'foo'] = 'document.body.appendChild(document.createElement(\'i\'));'
      helper.configureParameters(params)

      const response = await Converter.convert(window.location.toString(), '= Hello world')
      await Renderer.updateHTML(response)

      expect(Array.from(document.head.children).find(element => element.id === 'asciidoctor-browser-custom-js').innerText).to.equal('document.body.appendChild(document.createElement(\'i\'));')
      // the <i> element created by the custom JavaScript must be present (because the script run after the rendering phase)
      expect(Array.from(document.body.children).filter(element => element.tagName.toLowerCase() === 'i').length).to.equal(1)
      // the first element in the body must be the content
      expect(document.body.children[0].id).to.equal('content')
    })
  })

  describe('Highlight.js', () => {
    afterEach(() => {
      helper.reset()
    })

    it('should append highlight.js if source highlighter is enabled', async () => {
      const params = []
      params[Constants.ENABLE_RENDER_KEY] = 'true'
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

      const response = await Converter.convert(window.location.toString(), source)
      await Renderer.updateHTML(response)
      expect(document.getElementById('code').querySelectorAll('code > span').length).to.equal(2)
    })

    it('should not append highlight.js if source highlighter is disabled', async () => {
      const params = []
      params[Constants.ENABLE_RENDER_KEY] = 'true'
      params[Constants.CUSTOM_ATTRIBUTES_KEY] = ''
      params[Constants.SAFE_MODE_KEY] = 'safe'
      helper.configureParameters(params)

      const source = `= Hello world

== Code block

[source#code,js]
----
console.log('Hello world')
----`

      const response = await Converter.convert(window.location.toString(), source)
      await Renderer.updateHTML(response)
      expect(document.getElementById('code').querySelectorAll('code > span').length).to.equal(0)
    })
  })

  describe('Kroki', () => {
    afterEach(() => {
      helper.reset()
    })

    it('should render a PlantUML diagram', async () => {
      const params = []
      params[Constants.ENABLE_RENDER_KEY] = 'true'
      params[Constants.CUSTOM_ATTRIBUTES_KEY] = ''
      params[Constants.SAFE_MODE_KEY] = 'safe'
      params[Constants.ENABLE_KROKI_KEY] = 'true'
      params[Constants.KROKI_SERVER_URL_KEY] = 'https://kroki.io'
      helper.configureParameters(params)

      const source = `
[plantuml]
----
Bob -> Alice : hello
----
`
      const response = await Converter.convert(window.location.toString(), source)
      await Renderer.updateHTML(response)
      const plantumlDiv = document.body.getElementsByClassName('kroki')
      expect(plantumlDiv.length).to.equal(1)
      const plantumlImg = plantumlDiv[0].getElementsByTagName('img')[0]
      expect(plantumlImg.getAttribute('src')).to.equal('https://kroki.io/plantuml/svg/eNpzyk9S0LVTcMzJTE5VsFLISM3JyQcAPHcGKw==')
    })

    it('should use a custom server URL', async () => {
      const params = []
      params[Constants.ENABLE_RENDER_KEY] = 'true'
      params[Constants.CUSTOM_ATTRIBUTES_KEY] = ''
      params[Constants.SAFE_MODE_KEY] = 'safe'
      params[Constants.ENABLE_KROKI_KEY] = 'true'
      params[Constants.KROKI_SERVER_URL_KEY] = 'http://localhost:1234'
      helper.configureParameters(params)

      const source = `
[plantuml]
----
Bob -> Alice : hello
----
`
      const response = await Converter.convert(window.location.toString(), source)
      await Renderer.updateHTML(response)
      const plantumlDiv = document.body.getElementsByClassName('kroki')
      expect(plantumlDiv.length).to.equal(1)
      const plantumlImg = plantumlDiv[0].getElementsByTagName('img')[0]
      expect(plantumlImg.getAttribute('src')).to.equal('http://localhost:1234/plantuml/svg/eNpzyk9S0LVTcMzJTE5VsFLISM3JyQcAPHcGKw==')
    })

    it('should render an external GraphViz diagram', async () => {
      const params = []
      params[Constants.ENABLE_RENDER_KEY] = 'true'
      params[Constants.CUSTOM_ATTRIBUTES_KEY] = ''
      params[Constants.SAFE_MODE_KEY] = 'safe'
      params[Constants.ENABLE_KROKI_KEY] = 'true'
      params[Constants.KROKI_SERVER_URL_KEY] = 'https://kroki.io'
      helper.configureParameters(params)

      const source = `
graphviz::${baseDir}/spec/fixtures/hello.dot[]
`

      const response = await Converter.convert(window.location.toString(), source)
      await Renderer.updateHTML(response)

      console.log(document.body.innerText)
      const plantumlDiv = document.body.getElementsByClassName('kroki')
      expect(plantumlDiv.length).to.equal(1)
      const plantumlImg = plantumlDiv[0].getElementsByTagName('img')[0]
      // Since Windows is using CRLF the deflate + base64 won't be exactly the same :(
      expect(plantumlImg.getAttribute('src')).to.match(/^https:\/\/kroki\.io\/graphviz\/svg\/eNpLyU/)
    })

    it('should not render a diagram if the extension is disabled', async () => {
      const params = []
      params[Constants.ENABLE_RENDER_KEY] = 'true'
      params[Constants.CUSTOM_ATTRIBUTES_KEY] = ''
      params[Constants.SAFE_MODE_KEY] = 'safe'
      params[Constants.ENABLE_KROKI_KEY] = 'false'
      params[Constants.KROKI_SERVER_URL_KEY] = 'https://kroki.io'
      helper.configureParameters(params)

      const source = `
[plantuml]
----
Bob -> Alice : hello
----
`

      const response = await Converter.convert(window.location.toString(), source)
      await Renderer.updateHTML(response)
      const plantumlDiv = document.body.getElementsByClassName('kroki')
      expect(plantumlDiv.length).to.equal(0)
    })
  })

  describe('Document attributes', () => {
    beforeEach(() => {
      const params = []
      params[Constants.ENABLE_RENDER_KEY] = 'true'
      helper.configureParameters(params)
    })

    afterEach(() => {
      helper.reset()
    })

    it('should set docname correct', async () => {
      const decodeURI = document.location.href.split('/')
      const fileName = decodeURI[decodeURI.length - 1].split('.')[0]
      const response = await Converter.convert(document.location.toString(), '= {docname}')
      expect(response.html).to.equal('<h1>' + fileName + '</h1>\n')
    })

    it('should set outfilesuffix correct', async () => {
      const response = await Converter.convert(document.location.toString(), '= {outfilesuffix}')
      expect(response.html).to.equal('<h1>.adoc</h1>\n')
    })

    it('should resolve inter-document cross reference', async () => {
      const response = await Converter.convert(document.location.toString(), 'Refer to <<document-b.adoc#section-b,Section B>> for more information.')
      expect(response.html).to.equal('<div class="paragraph">\n<p>Refer to <a href="document-b.adoc#section-b">Section B</a> for more information.</p>\n</div>')
    })

    it('should set docfilesuffix correct', async () => {
      const decodeURI = document.location.href.split('/')
      const expected = decodeURI[decodeURI.length - 1].split('.')[1]
      const response = await Converter.convert(document.location.toString(), '= {docfilesuffix}')
      expect(response.html).to.equal(`<h1>.${expected}</h1>
`)
    })

    it('should set docfile correct', async () => {
      const expected = document.location.href
      const response = await Converter.convert(window.location.toString(), '= {docfile}')
      expect(response.html).to.equal(`<h1><a href="${expected}" class="bare">${expected}</a></h1>
`)
    })
  })

  describe('Decode entities', () => {
    it('should decode entities', () => {
      expect(Dom.decodeEntities('Hansel et Gretel')).to.equal('Hansel et Gretel')
      expect(Dom.decodeEntities('Hansel & Gretel')).to.equal('Hansel & Gretel')
      expect(Dom.decodeEntities('Hansel &amp; Gretel')).to.equal('Hansel & Gretel')
      expect(Dom.decodeEntities('Hansel&#x20&amp;&#x20Gretel')).to.equal('Hansel & Gretel')
    })
  })

  describe('Escape characters', () => {
    it('should escape characters', () => {
      expect(Dom.escape('<script>alert();</script>')).to.equal('&lt;script&gt;alert();&lt;/script&gt;')
    })
  })

  describe('Update the HTML document', () => {
    afterEach(() => {
      helper.reset()
    })

    it('should update the HTML document with the AsciiDoc source', async () => {
      const params = []
      params[Constants.ENABLE_RENDER_KEY] = 'true'
      params[Constants.CUSTOM_ATTRIBUTES_KEY] = ''
      params[Constants.SAFE_MODE_KEY] = 'safe'
      helper.configureParameters(params)
      helper.configureManifest({
        web_accessible_resources: [
          'css/themes/asciidoctor.css',
          'css/themes/colony.css',
          'css/themes/foundation.css',
          'css/themes/foundation-lime.css',
          'css/themes/foundation-potion.css',
          'css/themes/github.css',
          'css/themes/golo.css',
          'css/themes/iconic.css',
          'css/themes/maker.css',
          'css/themes/readthedocs.css',
          'css/themes/riak.css',
          'css/themes/rocket-panda.css',
          'css/themes/rubygems.css'
        ]
      })

      const response = await Converter.convert(window.location.toString(), '= Hello world')
      await Renderer.updateHTML(response)
      // Chartist must be present
      expect(document.getElementById('asciidoctor-browser-chartist-style').getAttribute('href')).to.equal('css/chartist.min.css')
      expect(document.getElementById('asciidoctor-browser-chartist-default-style').innerText).not.to.equal('')
      // Default Asciidoctor stylesheet must be present
      expect(document.getElementById('asciidoctor-browser-style').getAttribute('href')).to.equal('css/themes/asciidoctor.css')
      // Font Awesome must be present
      expect(document.getElementById('asciidoctor-browser-font-awesome-style').getAttribute('href')).to.equal('css/font-awesome.min.css')
      // Content must be converted
      expect(document.getElementById('content').innerHTML).to.contain('<h1>Hello world</h1>')
    })

    it('should hide the document title when noheader attribute is defined', async () => {
      const params = []
      params[Constants.ENABLE_RENDER_KEY] = 'true'
      params[Constants.CUSTOM_ATTRIBUTES_KEY] = ''
      params[Constants.SAFE_MODE_KEY] = 'safe'
      helper.configureParameters(params)

      const source = `= Hello world
:noheader:

When the noheader attribute is defined, the title must not be shown.
`
      const response = await Converter.convert(window.location.toString(), source)
      await Renderer.updateHTML(response)
      // the document title element <h1> must not be shown
      expect(Array.from(document.getElementsByTagName('h1')).length).to.equal(0)
    })

    it('should show the document title by default', async () => {
      const params = []
      params[Constants.ENABLE_RENDER_KEY] = 'true'
      params[Constants.CUSTOM_ATTRIBUTES_KEY] = ''
      params[Constants.SAFE_MODE_KEY] = 'safe'
      helper.configureParameters(params)

      const source = `= Hello world

By default, the title must be shown.
`
      const response = await Converter.convert(window.location.toString(), source)
      await Renderer.updateHTML(response)
      // the document title element <h1> must be shown
      expect(Array.from(document.getElementsByTagName('h1'))[0].innerText).to.equal('Hello world')
    })
  })

  describe('Theme module', () => {
    afterEach(() => {
      helper.reset()
    })

    it('should get the default theme name', async () => {
      helper.configureParameters()
      const themeName = await Theme.getThemeName('')
      expect(themeName).to.equal('asciidoctor')
    })

    it('should get the default theme name when the custom stylesheet does not exist', async () => {
      helper.configureParameters()
      const themeName = await Theme.getThemeName('foo')
      expect(themeName).to.equal('asciidoctor')
    })

    it('should get the custom stylesheet when exists', async () => {
      const params = []
      params[Constants.CUSTOM_THEME_PREFIX + 'foo'] = 'h1 { color: red; }'
      helper.configureParameters(params)
      const themeName = await Theme.getThemeName('foo')
      expect(themeName).to.equal('foo')
    })

    it('should get the stylesheet when exists', async () => {
      helper.configureParameters()
      helper.configureManifest({
        web_accessible_resources: [
          'css/themes/asciidoctor.css',
          'css/themes/colony.css',
          'css/themes/foundation.css',
          'css/themes/foundation-lime.css',
          'css/themes/foundation-potion.css',
          'css/themes/github.css',
          'css/themes/golo.css',
          'css/themes/iconic.css',
          'css/themes/maker.css',
          'css/themes/readthedocs.css',
          'css/themes/riak.css',
          'css/themes/rocket-panda.css',
          'css/themes/rubygems.css'
        ]
      })
      const themeName = await Theme.getThemeName('colony.css')
      expect(themeName).to.equal('colony')
    })
  })

  describe('Retrieve the rendering settings', () => {
    afterEach(() => {
      helper.reset()
    })

    it('should return the configured settings', async () => {
      const params = []
      params[Constants.CUSTOM_ATTRIBUTES_KEY] = 'foo=bar'
      params[Constants.SAFE_MODE_KEY] = 'server'
      helper.configureParameters(params)

      const renderingSettings = await Settings.getRenderingSettings()
      expect(renderingSettings.customAttributes).to.equal('foo=bar')
      expect(renderingSettings.safeMode).to.equal('server')
    })

    it('should return \'safe\' if the safe mode is undefined', async () => {
      helper.configureParameters()

      const renderingSettings = await Settings.getRenderingSettings()
      expect(renderingSettings.safeMode).to.equal('safe')
    })

    describe('Retrieve the custom script', () => {
      it('should return undefined if the name is undefined', async () => {
        helper.configureParameters()

        const renderingSettings = await Settings.getRenderingSettings()
        expect(renderingSettings.customScript).to.be.undefined()
      })

      it('should return undefined if the name is defined but the content is undefined', async () => {
        const params = []
        params[Constants.JS_KEY] = 'alert'
        helper.configureParameters(params)

        const renderingSettings = await Settings.getRenderingSettings()
        expect(renderingSettings.customScript).to.be.undefined()
      })

      it('should return \'after\' if the load directive is undefined', async () => {
        const params = []
        params[Constants.JS_KEY] = 'alert'
        params[Constants.CUSTOM_JS_PREFIX + 'alert'] = 'alert();'
        helper.configureParameters(params)

        const renderingSettings = await Settings.getRenderingSettings()
        expect(renderingSettings.customScript.content).to.equal('alert();')
        expect(renderingSettings.customScript.loadDirective).to.equal('after')
      })

      it('should return the configured custom script', async () => {
        const params = []
        params[Constants.JS_KEY] = 'alert'
        params[Constants.CUSTOM_JS_PREFIX + 'alert'] = 'alert();'
        params[Constants.JS_LOAD_KEY] = 'before'
        helper.configureParameters(params)

        const renderingSettings = await Settings.getRenderingSettings()
        expect(renderingSettings.customScript.content).to.equal('alert();')
        expect(renderingSettings.customScript.loadDirective).to.equal('before')
      })
    })
  })

  describe('Extension initialization', () => {
    afterEach(() => {
      helper.reset()
      if (typeof browser.runtime.sendMessage.restore === 'function') {
        browser.runtime.sendMessage.restore()
      }
    })

    it('should fetch the content from the background script using the sendMessage API', async () => {
      const params = []
      params[Constants.CUSTOM_ATTRIBUTES_KEY] = ''
      params[Constants.SAFE_MODE_KEY] = 'safe'
      params[Constants.ENABLE_RENDER_KEY] = true
      helper.configureParameters(params)

      const sendMessageSpy = sinon.spy(browser.runtime, 'sendMessage')
      await Loader.init()
      expect(sendMessageSpy.calledOnce).to.equal(true)
      expect(sendMessageSpy.firstCall.args[0].action).to.equal('fetch-convert')
      expect(sendMessageSpy.firstCall.args[0].initial).to.equal(true)
    })

    it('should fetch the content from the background script if the extension is disabled', async () => {
      const params = []
      params[Constants.ENABLE_RENDER_KEY] = false
      helper.configureParameters(params)

      const sendMessageSpy = sinon.spy(browser.runtime, 'sendMessage')
      await Loader.init()
      expect(sendMessageSpy.notCalled).to.equal(true)
    })
  })

  describe('STEM', () => {
    afterEach(() => {
      helper.reset()
    })

    beforeEach(() => {
      const mathjaxConfigElement = document.getElementById('asciidoctor-mathjax-config')
      if (mathjaxConfigElement) {
        mathjaxConfigElement.parentNode.removeChild(mathjaxConfigElement)
      }
    })

    it('should configure AMS-style equation numbering when eqnums is empty', async () => {
      const params = []
      params[Constants.ENABLE_RENDER_KEY] = 'true'
      params[Constants.CUSTOM_ATTRIBUTES_KEY] = ''
      params[Constants.SAFE_MODE_KEY] = 'safe'
      helper.configureParameters(params)

      const source = `= Equation number
:stem: latexmath
:eqnums:

stem:[\\sin(x^2)]`

      const response = await Converter.convert(window.location.toString(), source)
      await Renderer.updateHTML(response)
      expect(document.getElementById('asciidoctor-mathjax-config').innerText).to.includes('tags: "ams"')
    })

    it('should disable equation numbering when eqnums is missing', async () => {
      const params = []
      params[Constants.ENABLE_RENDER_KEY] = 'true'
      params[Constants.CUSTOM_ATTRIBUTES_KEY] = ''
      params[Constants.SAFE_MODE_KEY] = 'safe'
      helper.configureParameters(params)

      const source = `= Equation number
:stem: latexmath

stem:[\\sin(x^2)]`

      const response = await Converter.convert(window.location.toString(), source)
      await Renderer.updateHTML(response)
      expect(document.getElementById('asciidoctor-mathjax-config').innerText).to.includes('tags: "none"')
    })

    it('should configure AMS-style equation numbering when eqnums contains an invalid value', async () => {
      const params = []
      params[Constants.ENABLE_RENDER_KEY] = 'true'
      params[Constants.CUSTOM_ATTRIBUTES_KEY] = ''
      params[Constants.SAFE_MODE_KEY] = 'safe'
      helper.configureParameters(params)

      const source = `= Equation number
:stem: latexmath
:eqnums: invalid

stem:[\\sin(x^2)]`

      const response = await Converter.convert(window.location.toString(), source)
      await Renderer.updateHTML(response)
      expect(document.getElementById('asciidoctor-mathjax-config').innerText).to.includes('tags: "ams"')
    })

    it('should enable equation numbering when eqnums is all', async () => {
      const params = []
      params[Constants.ENABLE_RENDER_KEY] = 'true'
      params[Constants.CUSTOM_ATTRIBUTES_KEY] = ''
      params[Constants.SAFE_MODE_KEY] = 'safe'
      helper.configureParameters(params)

      const source = `= Equation number
:stem: latexmath
:eqnums: all

stem:[\\sin(x^2)]`

      const response = await Converter.convert(window.location.toString(), source)
      await Renderer.updateHTML(response)
      expect(document.getElementById('asciidoctor-mathjax-config').innerText).to.includes('tags: "all"')
    })

    it('should disable equation numbering when eqnums is none', async () => {
      const params = []
      params[Constants.ENABLE_RENDER_KEY] = 'true'
      params[Constants.CUSTOM_ATTRIBUTES_KEY] = ''
      params[Constants.SAFE_MODE_KEY] = 'safe'
      helper.configureParameters(params)

      const source = `= Equation number
:stem: latexmath
:eqnums: none

stem:[\\sin(x^2)]`

      const response = await Converter.convert(window.location.toString(), source)
      await Renderer.updateHTML(response)
      expect(document.getElementById('asciidoctor-mathjax-config').innerText).to.includes('tags: "none"')
    })
  })

  mocha.run(function (failures) {
    if (failures > 0) {
      console.error('%d failures', failures)
    }
  })
})().catch(err => {
  console.error('Unable to start the browser tests suite: ' + err)
})
