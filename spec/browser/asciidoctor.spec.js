import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const testPageURL = `file://${path.join(__dirname, 'test-page.html')}`

test.beforeEach(async ({ page }) => {
  await page.goto(testPageURL)
})

test.describe('Custom script', () => {
  test('should append before the content', async ({ page }) => {
    await page.evaluate(async () => {
      const params = []
      params[Constants.ENABLE_RENDER_KEY] = 'true'
      params[Constants.CUSTOM_ATTRIBUTES_KEY] = ''
      params[Constants.SAFE_MODE_KEY] = 'safe'
      params[Constants.JS_KEY] = 'bar'
      params[Constants.JS_LOAD_KEY] = 'before'
      params[`${Constants.CUSTOM_JS_PREFIX}bar`] =
        "document.body.appendChild(document.createElement('strong'));"
      helper.configureParameters(params)

      document.getElementById('content')?.remove()
      const response = await Converter.convert(
        window.location.toString(),
        '= Hello world',
      )
      await Renderer.updateHTML(response)
    })

    const customJsText = await page.evaluate(
      () =>
        Array.from(document.head.children).find(
          (el) => el.id === 'asciidoctor-browser-custom-js',
        )?.innerText,
    )
    expect(customJsText).toBe(
      "document.body.appendChild(document.createElement('strong'));",
    )

    const strongElement = await page.evaluate(() =>
      Array.from(document.body.children).find(
        (el) => el.tagName.toLowerCase() === 'strong',
      ),
    )
    expect(strongElement).toBeUndefined()

    const firstChildId = await page.evaluate(
      () => document.body.children[0]?.id,
    )
    expect(firstChildId).toBe('content')
  })

  test('should append after the content', async ({ page }) => {
    await page.evaluate(async () => {
      const params = []
      params[Constants.ENABLE_RENDER_KEY] = 'true'
      params[Constants.CUSTOM_ATTRIBUTES_KEY] = ''
      params[Constants.SAFE_MODE_KEY] = 'safe'
      params[Constants.JS_KEY] = 'foo'
      params[Constants.JS_LOAD_KEY] = 'after'
      params[`${Constants.CUSTOM_JS_PREFIX}foo`] =
        "document.body.appendChild(document.createElement('i'));"
      helper.configureParameters(params)

      const response = await Converter.convert(
        window.location.toString(),
        '= Hello world',
      )
      await Renderer.updateHTML(response)
    })

    const customJsText = await page.evaluate(
      () =>
        Array.from(document.head.children).find(
          (el) => el.id === 'asciidoctor-browser-custom-js',
        )?.innerText,
    )
    expect(customJsText).toBe(
      "document.body.appendChild(document.createElement('i'));",
    )

    await expect(page.locator('body i')).toHaveCount(1)

    const firstChildId = await page.evaluate(
      () => document.body.children[0]?.id,
    )
    expect(firstChildId).toBe('content')
  })
})

test.describe('Highlight.js', () => {
  test('should append highlight.js if source highlighter is enabled', async ({
    page,
  }) => {
    await page.evaluate(async () => {
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
      const response = await Converter.convert(
        window.location.toString(),
        source,
      )
      await Renderer.updateHTML(response)
    })

    await expect(page.locator('#code code span')).toHaveCount(2)
  })

  test('should not append highlight.js if source highlighter is disabled', async ({
    page,
  }) => {
    await page.evaluate(async () => {
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
      const response = await Converter.convert(
        window.location.toString(),
        source,
      )
      await Renderer.updateHTML(response)
    })

    await expect(page.locator('#code code span')).toHaveCount(0)
  })
})

test.describe('Kroki', () => {
  test('should render a PlantUML diagram', async ({ page }) => {
    await page.evaluate(async () => {
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
      const response = await Converter.convert(
        window.location.toString(),
        source,
      )
      await Renderer.updateHTML(response)
    })

    await expect(page.locator('.kroki')).toHaveCount(1)
    await expect(page.locator('.kroki img')).toHaveAttribute(
      'src',
      'https://kroki.io/plantuml/svg/eNpzyk9S0LVTcMzJTE5VsFLISM3JyQcAPHcGKw==',
    )
  })

  test('should use a custom server URL', async ({ page }) => {
    await page.evaluate(async () => {
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
      const response = await Converter.convert(
        window.location.toString(),
        source,
      )
      await Renderer.updateHTML(response)
    })

    await expect(page.locator('.kroki img')).toHaveAttribute(
      'src',
      'http://localhost:1234/plantuml/svg/eNpzyk9S0LVTcMzJTE5VsFLISM3JyQcAPHcGKw==',
    )
  })

  test('should not render a diagram if the extension is disabled', async ({
    page,
  }) => {
    await page.evaluate(async () => {
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
      const response = await Converter.convert(
        window.location.toString(),
        source,
      )
      await Renderer.updateHTML(response)
    })

    await expect(page.locator('.kroki')).toHaveCount(0)
  })
})

test.describe('Document attributes', () => {
  test.beforeEach(async ({ page }) => {
    await page.evaluate(() => {
      const params = []
      params[Constants.ENABLE_RENDER_KEY] = 'true'
      helper.configureParameters(params)
    })
  })

  test('should set docname correct', async ({ page }) => {
    const { html, fileName } = await page.evaluate(async () => {
      const urlParts = document.location.href.split('/')
      const fileName = urlParts[urlParts.length - 1].split('.')[0]
      const response = await Converter.convert(
        document.location.toString(),
        '= {docname}',
      )
      return { html: response.html, fileName }
    })
    expect(html).toBe(`<h1>${fileName}</h1>\n`)
  })

  test('should set outfilesuffix correct', async ({ page }) => {
    const html = await page.evaluate(async () => {
      const response = await Converter.convert(
        document.location.toString(),
        '= {outfilesuffix}',
      )
      return response.html
    })
    expect(html).toBe('<h1>.adoc</h1>\n')
  })

  test('should resolve inter-document cross reference', async ({ page }) => {
    const html = await page.evaluate(async () => {
      const response = await Converter.convert(
        document.location.toString(),
        'Refer to <<document-b.adoc#section-b,Section B>> for more information.',
      )
      return response.html
    })
    expect(html).toBe(
      '<div class="paragraph">\n<p>Refer to <a href="document-b.adoc#section-b">Section B</a> for more information.</p>\n</div>',
    )
  })

  test('should set docfilesuffix correct', async ({ page }) => {
    const { html, expected } = await page.evaluate(async () => {
      const urlParts = document.location.href.split('/')
      const expected = urlParts[urlParts.length - 1].split('.')[1]
      const response = await Converter.convert(
        document.location.toString(),
        '= {docfilesuffix}',
      )
      return { html: response.html, expected }
    })
    expect(html).toBe(`<h1>.${expected}</h1>\n`)
  })

  test('should set docfile correct', async ({ page }) => {
    const { html, expected } = await page.evaluate(async () => {
      const expected = document.location.href
      const response = await Converter.convert(
        window.location.toString(),
        '= {docfile}',
      )
      return { html: response.html, expected }
    })
    expect(html).toBe(
      `<h1><a href="${expected}" class="bare">${expected}</a></h1>\n`,
    )
  })
})

test.describe('Decode entities', () => {
  test('should decode entities', async ({ page }) => {
    const results = await page.evaluate(() => ({
      plain: Dom.decodeEntities('Hansel et Gretel'),
      ampersand: Dom.decodeEntities('Hansel & Gretel'),
      encoded: Dom.decodeEntities('Hansel &amp; Gretel'),
      mixed: Dom.decodeEntities('Hansel&#x20&amp;&#x20Gretel'),
    }))
    expect(results.plain).toBe('Hansel et Gretel')
    expect(results.ampersand).toBe('Hansel & Gretel')
    expect(results.encoded).toBe('Hansel & Gretel')
    expect(results.mixed).toBe('Hansel & Gretel')
  })
})

test.describe('Escape characters', () => {
  test('should escape characters', async ({ page }) => {
    const result = await page.evaluate(() =>
      Dom.escape('<script>alert();</script>'),
    )
    expect(result).toBe('&lt;script&gt;alert();&lt;/script&gt;')
  })
})

test.describe('Update the HTML document', () => {
  test('should update the HTML document with the AsciiDoc source', async ({
    page,
  }) => {
    await page.evaluate(async () => {
      const params = []
      params[Constants.ENABLE_RENDER_KEY] = 'true'
      params[Constants.CUSTOM_ATTRIBUTES_KEY] = ''
      params[Constants.SAFE_MODE_KEY] = 'safe'
      helper.configureParameters(params)
      helper.configureManifest({
        web_accessible_resources: [
          {
            resources: [
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
              'css/themes/rubygems.css',
            ],
          },
        ],
      })

      const response = await Converter.convert(
        window.location.toString(),
        '= Hello world',
      )
      await Renderer.updateHTML(response)
    })

    await expect(
      page.locator('#asciidoctor-browser-chartist-style'),
    ).toHaveAttribute('href', 'css/chartist.min.css')
    await expect(
      page.locator('#asciidoctor-browser-chartist-default-style'),
    ).not.toBeEmpty()
    await expect(page.locator('#asciidoctor-browser-style')).toHaveAttribute(
      'href',
      'css/themes/asciidoctor.css',
    )
    await expect(
      page.locator('#asciidoctor-browser-font-awesome-style'),
    ).toHaveAttribute('href', 'css/font-awesome.min.css')
    await expect(page.locator('#content')).toContainText('Hello world')
  })

  test('should hide the document title when noheader attribute is defined', async ({
    page,
  }) => {
    await page.evaluate(async () => {
      const params = []
      params[Constants.ENABLE_RENDER_KEY] = 'true'
      params[Constants.CUSTOM_ATTRIBUTES_KEY] = ''
      params[Constants.SAFE_MODE_KEY] = 'safe'
      helper.configureParameters(params)

      const source = `= Hello world
:noheader:

When the noheader attribute is defined, the title must not be shown.
`
      const response = await Converter.convert(
        window.location.toString(),
        source,
      )
      await Renderer.updateHTML(response)
    })

    await expect(page.locator('h1')).toHaveCount(0)
  })

  test('should show the document title by default', async ({ page }) => {
    await page.evaluate(async () => {
      const params = []
      params[Constants.ENABLE_RENDER_KEY] = 'true'
      params[Constants.CUSTOM_ATTRIBUTES_KEY] = ''
      params[Constants.SAFE_MODE_KEY] = 'safe'
      helper.configureParameters(params)

      const source = `= Hello world

By default, the title must be shown.
`
      const response = await Converter.convert(
        window.location.toString(),
        source,
      )
      await Renderer.updateHTML(response)
    })

    await expect(page.locator('h1')).toHaveText('Hello world')
  })
})

test.describe('Theme module', () => {
  test('should get the default theme name', async ({ page }) => {
    const themeName = await page.evaluate(async () => {
      helper.configureParameters()
      return Theme.getThemeName('')
    })
    expect(themeName).toBe('asciidoctor')
  })

  test('should get the default theme name when the custom stylesheet does not exist', async ({
    page,
  }) => {
    const themeName = await page.evaluate(async () => {
      helper.configureParameters()
      return Theme.getThemeName('foo')
    })
    expect(themeName).toBe('asciidoctor')
  })

  test('should get the custom stylesheet when exists', async ({ page }) => {
    const themeName = await page.evaluate(async () => {
      const params = []
      params[`${Constants.CUSTOM_THEME_PREFIX}foo`] = 'h1 { color: red; }'
      helper.configureParameters(params)
      return Theme.getThemeName('foo')
    })
    expect(themeName).toBe('foo')
  })

  test('should get the stylesheet when exists', async ({ page }) => {
    const themeName = await page.evaluate(async () => {
      helper.configureParameters()
      helper.configureManifest({
        web_accessible_resources: [
          {
            resources: [
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
              'css/themes/rubygems.css',
            ],
          },
        ],
      })
      return Theme.getThemeName('colony.css')
    })
    expect(themeName).toBe('colony')
  })
})

test.describe('Retrieve the rendering settings', () => {
  test('should return the configured settings', async ({ page }) => {
    const settings = await page.evaluate(async () => {
      const params = []
      params[Constants.CUSTOM_ATTRIBUTES_KEY] = 'foo=bar'
      params[Constants.SAFE_MODE_KEY] = 'server'
      helper.configureParameters(params)
      const s = await Settings.getRenderingSettings()
      return { customAttributes: s.customAttributes, safeMode: s.safeMode }
    })
    expect(settings.customAttributes).toBe('foo=bar')
    expect(settings.safeMode).toBe('server')
  })

  test("should return 'safe' if the safe mode is undefined", async ({
    page,
  }) => {
    const safeMode = await page.evaluate(async () => {
      helper.configureParameters()
      const s = await Settings.getRenderingSettings()
      return s.safeMode
    })
    expect(safeMode).toBe('safe')
  })

  test.describe('Retrieve the custom script', () => {
    test('should return undefined if the name is undefined', async ({
      page,
    }) => {
      const customScript = await page.evaluate(async () => {
        helper.configureParameters()
        const s = await Settings.getRenderingSettings()
        return s.customScript
      })
      expect(customScript).toBeUndefined()
    })

    test('should return undefined if the name is defined but the content is undefined', async ({
      page,
    }) => {
      const customScript = await page.evaluate(async () => {
        const params = []
        params[Constants.JS_KEY] = 'alert'
        helper.configureParameters(params)
        const s = await Settings.getRenderingSettings()
        return s.customScript
      })
      expect(customScript).toBeUndefined()
    })

    test("should return 'after' if the load directive is undefined", async ({
      page,
    }) => {
      const result = await page.evaluate(async () => {
        const params = []
        params[Constants.JS_KEY] = 'alert'
        params[`${Constants.CUSTOM_JS_PREFIX}alert`] = 'alert();'
        helper.configureParameters(params)
        const s = await Settings.getRenderingSettings()
        return {
          content: s.customScript.content,
          loadDirective: s.customScript.loadDirective,
        }
      })
      expect(result.content).toBe('alert();')
      expect(result.loadDirective).toBe('after')
    })

    test('should return the configured custom script', async ({ page }) => {
      const result = await page.evaluate(async () => {
        const params = []
        params[Constants.JS_KEY] = 'alert'
        params[`${Constants.CUSTOM_JS_PREFIX}alert`] = 'alert();'
        params[Constants.JS_LOAD_KEY] = 'before'
        helper.configureParameters(params)
        const s = await Settings.getRenderingSettings()
        return {
          content: s.customScript.content,
          loadDirective: s.customScript.loadDirective,
        }
      })
      expect(result.content).toBe('alert();')
      expect(result.loadDirective).toBe('before')
    })
  })
})

test.describe('Extension initialization', () => {
  test('should fetch the content from the background script using the sendMessage API', async ({
    page,
  }) => {
    const result = await page.evaluate(async () => {
      const params = []
      params[Constants.CUSTOM_ATTRIBUTES_KEY] = ''
      params[Constants.SAFE_MODE_KEY] = 'safe'
      params[Constants.ENABLE_RENDER_KEY] = true
      helper.configureParameters(params)

      const spy = sinon.spy(browser.runtime, 'sendMessage')
      await Loader.init()
      return {
        calledOnce: spy.calledOnce,
        action: spy.firstCall?.args[0]?.action,
        initial: spy.firstCall?.args[0]?.initial,
      }
    })
    expect(result.calledOnce).toBe(true)
    expect(result.action).toBe('fetch-convert')
    expect(result.initial).toBe(true)
  })

  test('should not fetch the content from the background script if the extension is disabled', async ({
    page,
  }) => {
    const notCalled = await page.evaluate(async () => {
      const params = []
      params[Constants.ENABLE_RENDER_KEY] = false
      helper.configureParameters(params)

      const spy = sinon.spy(browser.runtime, 'sendMessage')
      await Loader.init()
      return spy.notCalled
    })
    expect(notCalled).toBe(true)
  })
})

test.describe('STEM', () => {
  test.beforeEach(async ({ page }) => {
    await page.evaluate(() => {
      document.getElementById('asciidoctor-mathjax-config')?.remove()
    })
  })

  test('should configure AMS-style equation numbering when eqnums is empty', async ({
    page,
  }) => {
    await page.evaluate(async () => {
      const params = []
      params[Constants.ENABLE_RENDER_KEY] = 'true'
      params[Constants.CUSTOM_ATTRIBUTES_KEY] = ''
      params[Constants.SAFE_MODE_KEY] = 'safe'
      helper.configureParameters(params)

      const source = `= Equation number
:stem: latexmath
:eqnums:

stem:[\\sin(x^2)]`
      const response = await Converter.convert(
        window.location.toString(),
        source,
      )
      await Renderer.updateHTML(response)
    })

    const eqnumsValue = await page.evaluate(
      () =>
        document.getElementById('asciidoctor-mathjax-config')?.dataset
          .eqnumsValue,
    )
    expect(eqnumsValue).toContain('ams')
  })

  test('should disable equation numbering when eqnums is missing', async ({
    page,
  }) => {
    await page.evaluate(async () => {
      const params = []
      params[Constants.ENABLE_RENDER_KEY] = 'true'
      params[Constants.CUSTOM_ATTRIBUTES_KEY] = ''
      params[Constants.SAFE_MODE_KEY] = 'safe'
      helper.configureParameters(params)

      const source = `= Equation number
:stem: latexmath

stem:[\\sin(x^2)]`
      const response = await Converter.convert(
        window.location.toString(),
        source,
      )
      await Renderer.updateHTML(response)
    })

    const eqnumsValue = await page.evaluate(
      () =>
        document.getElementById('asciidoctor-mathjax-config')?.dataset
          .eqnumsValue,
    )
    expect(eqnumsValue).toContain('none')
  })

  test('should configure AMS-style equation numbering when eqnums contains an invalid value', async ({
    page,
  }) => {
    await page.evaluate(async () => {
      const params = []
      params[Constants.ENABLE_RENDER_KEY] = 'true'
      params[Constants.CUSTOM_ATTRIBUTES_KEY] = ''
      params[Constants.SAFE_MODE_KEY] = 'safe'
      helper.configureParameters(params)

      const source = `= Equation number
:stem: latexmath
:eqnums: invalid

stem:[\\sin(x^2)]`
      const response = await Converter.convert(
        window.location.toString(),
        source,
      )
      await Renderer.updateHTML(response)
    })

    const eqnumsValue = await page.evaluate(
      () =>
        document.getElementById('asciidoctor-mathjax-config')?.dataset
          .eqnumsValue,
    )
    expect(eqnumsValue).toContain('ams')
  })

  test('should enable equation numbering when eqnums is all', async ({
    page,
  }) => {
    await page.evaluate(async () => {
      const params = []
      params[Constants.ENABLE_RENDER_KEY] = 'true'
      params[Constants.CUSTOM_ATTRIBUTES_KEY] = ''
      params[Constants.SAFE_MODE_KEY] = 'safe'
      helper.configureParameters(params)

      const source = `= Equation number
:stem: latexmath
:eqnums: all

stem:[\\sin(x^2)]`
      const response = await Converter.convert(
        window.location.toString(),
        source,
      )
      await Renderer.updateHTML(response)
    })

    const eqnumsValue = await page.evaluate(
      () =>
        document.getElementById('asciidoctor-mathjax-config')?.dataset
          .eqnumsValue,
    )
    expect(eqnumsValue).toContain('all')
  })

  test('should disable equation numbering when eqnums is none', async ({
    page,
  }) => {
    await page.evaluate(async () => {
      const params = []
      params[Constants.ENABLE_RENDER_KEY] = 'true'
      params[Constants.CUSTOM_ATTRIBUTES_KEY] = ''
      params[Constants.SAFE_MODE_KEY] = 'safe'
      helper.configureParameters(params)

      const source = `= Equation number
:stem: latexmath
:eqnums: none

stem:[\\sin(x^2)]`
      const response = await Converter.convert(
        window.location.toString(),
        source,
      )
      await Renderer.updateHTML(response)
    })

    const eqnumsValue = await page.evaluate(
      () =>
        document.getElementById('asciidoctor-mathjax-config')?.dataset
          .eqnumsValue,
    )
    expect(eqnumsValue).toContain('none')
  })
})
