import asciidoctor from './asciidoctor.js'

const Asciidoctor = asciidoctor()

function process(data, labels, attrs) {
  const div = getDiv(data, labels, attrs)
  return `${div}`
}

function getHeight(attrs) {
  const height = attrs.height
  return typeof height === 'string' ? height : '400'
}

function getWidth(attrs) {
  const width = attrs.width
  return typeof width === 'string' ? width : '600'
}

function getDiv(data, labels, attrs) {
  const series = data.map(
    (value, index) => `data-chart-series-${index}="${value.join(',')}"`,
  )
  const title = attrs.title ? `<div class="title">${attrs.title}</div>\n` : ''
  return `<div class="openblock">${title}<div class="ct-chart"
               data-chart-height="${getHeight(attrs)}"
               data-chart-width="${getWidth(attrs)}"
               data-chart-type="${getType(attrs)}"
               data-chart-colors="#72B3CC,#8EB33B"
               data-chart-labels="${labels.join(',')}"
               ${series.join(' ')}
               data-chart-height="${getHeight(attrs)}"></div></div>`
}

function getType(attrs) {
  const type = attrs.type
  if (type === 'bar') {
    return 'Bar'
  } else if (type === 'line') {
    return 'Line'
  } else {
    // By default, chart line
    return 'Line'
  }
}

Asciidoctor.Extensions.register(function () {
  this.blockMacro(function () {
    this.named('chart')
    this.positionalAttributes(['type', 'width', 'height'])

    this.process((parent, target, attrs) => {
      const filePath = parent.normalizeAssetPath(target, 'target')
      try {
        const fileContent = parent.readAsset(filePath, {
          warn_on_failure: true,
          normalize: true,
        })
        const lines = fileContent.split('\n')
        const labels = lines[0].split(',')
        lines.shift()
        const data = lines.map((line) => line.split(','))
        const html = process(data, labels, attrs)
        return this.createBlock(parent, 'pass', html, attrs, {})
      } catch (_e) {
        console.warn(
          `Cannot read file: ${filePath}. Manifest V3 relies on service workers and cannot use synchronous XMLHttpRequest.`,
        )
        return this.createBlock(
          parent,
          'pass',
          `Unsupported directive - chart::${target}[]`,
          attrs,
          {},
        )
      }
    })
  })

  this.block(function () {
    this.named('chart')
    this.positionalAttributes(['size', 'width', 'height'])
    this.$content_model('raw')
    this.onContext('literal')

    this.process((parent, reader, attrs) => {
      const lines = reader.getLines()
      const labels = lines[0].split(',')
      lines.shift()
      const data = lines.map((line) => line.split(','))
      const html = process(data, labels, attrs)
      return this.createBlock(parent, 'pass', html, attrs, {})
    })
  })
})
