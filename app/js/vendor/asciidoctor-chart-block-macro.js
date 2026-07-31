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
    return 'BarChart'
  } else if (type === 'line') {
    return 'LineChart'
  } else {
    // By default, chart line
    return 'LineChart'
  }
}

export function register(registry) {
  registry.blockMacro(function () {
    this.named('chart')
    this.positionalAttributes(['type', 'width', 'height'])

    this.process(async (parent, target, attrs) => {
      const filePath = parent.normalizeAssetPath(target, 'target')
      try {
        const fileContent = await parent.readAsset(filePath, {
          warnOnFailure: false,
          normalize: true,
        })
        if (fileContent == null) {
          throw new Error(`Cannot read file: ${filePath}`)
        }
        const lines = fileContent.split('\n')
        const labels = lines[0].split(',')
        lines.shift()
        const data = lines.map((line) => line.split(','))
        const html = process(data, labels, attrs)
        return this.createBlock(parent, 'pass', html, attrs, {})
      } catch (_e) {
        const doc = parent.getDocument()
        doc.getLogger().warn(
          doc.messageWithContext(`Cannot read file: ${filePath}`, {
            source_location: parent.getSourceLocation?.() ?? null,
          }),
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

  registry.block(function () {
    this.named('chart')
    this.positionalAttributes(['size', 'width', 'height'])
    this.contentModel('raw')
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
}
