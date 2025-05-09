function adjustDisplay (math, doc) {
  let node = math.start.node.parentNode
  if (node && (node = node.parentNode) && node.classList.contains('stemblock')) {
    math.root.attributes.set('display', 'block')
  }
}

const config = document.getElementById('asciidoctor-mathjax-config').dataset
window.MathJax = {
  tex: {
    inlineMath: [['\\(', '\\)']],
    displayMath: [['\\[', '\\]']],
    processEscapes: false,
    tags: config.eqnumsValue
  },
  options: {
    ignoreHtmlClass: 'nostem|noasciimath',
    renderActions: {
      adjustDisplay: [25, (doc) => {
        for (const math of doc.math) {
          adjustDisplay(math, doc)
        }
      }, adjustDisplay]
    }
  },
  asciimath: {
    delimiters: [['\\$', '\\$']]
  },
  loader: { load: ['input/asciimath', 'output/chtml', 'ui/menu'] }
}
