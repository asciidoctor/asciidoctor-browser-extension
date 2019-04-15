/* global asciidoctor, processor */
// Namespace
asciidoctor.browser.extensions = {}
asciidoctor.browser.extensions.Chart = {}

asciidoctor.browser.extensions.Chart.process = function (data, labels, attrs) {
  const div = this.getDiv(data, labels, attrs)
  return `${div}`
}

asciidoctor.browser.extensions.Chart.getHeight = function (attrs) {
  const height = attrs.height
  return typeof height === 'string' ? height : '400'
}

asciidoctor.browser.extensions.Chart.getWidth = function (attrs) {
  const width = attrs.width
  return typeof width === 'string' ? width : '600'
}

asciidoctor.browser.extensions.Chart.getDiv = function (data, labels, attrs) {
  const series = data.map((value, index) => `data-chart-series-${index}="${value.join(',')}"`)
  const title = attrs.title ? `<div class="title">${attrs.title}</div>\n` : ''
  return `<div class="openblock">${title}<div class="ct-chart"
               data-chart-height="${this.getHeight(attrs)}"
               data-chart-width="${this.getWidth(attrs)}"
               data-chart-type="${this.getType(attrs)}"
               data-chart-colors="#72B3CC,#8EB33B"
               data-chart-labels="${labels.join(',')}"
               ${series.join(' ')}
               data-chart-height="${this.getHeight(attrs)}"></div></div>`
}

asciidoctor.browser.extensions.Chart.getType = function (attrs) {
  const type = attrs.type
  if (type === 'bar') {
    return 'Bar'
  } else if (type === 'line') {
    return 'Line'
  } else {
    // By default chart line
    return 'Line'
  }
}

// processor is defined in renderer.js
processor.Extensions.register(function () {
  this.blockMacro(function () {
    const self = this

    self.named('chart')
    self.positionalAttributes(['type', 'width', 'height'])

    self.process(function (parent, target, attrs) {
      const filePath = parent.normalizeAssetPath(target, 'target')
      const fileContent = parent.readAsset(filePath, { 'warn_on_failure': true, 'normalize': true })
      const lines = fileContent.split('\n')
      const labels = lines[0].split(',')
      lines.shift()
      const data = lines.map(line => line.split(','))
      const html = asciidoctor.browser.extensions.Chart.process(data, labels, attrs)
      return self.createBlock(parent, 'pass', html, attrs, {})
    })
  })

  this.block(function () {
    const self = this

    self.named('chart')
    self.positionalAttributes(['size', 'width', 'height'])
    self.$content_model('raw')
    self.onContext('literal')

    self.process(function (parent, reader, attrs) {
      const lines = reader.getLines()
      const labels = lines[0].split(',')
      lines.shift()
      const data = lines.map(line => line.split(','))
      const html = asciidoctor.browser.extensions.Chart.process(data, labels, attrs)
      return self.createBlock(parent, 'pass', html, attrs, {})
    })
  })
})
