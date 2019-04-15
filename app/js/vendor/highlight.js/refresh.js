console.log('121')
if (window.hljs) {
  console.log('111')
  var blocks = document.querySelectorAll('pre code')
  blocks.forEach(window.hljs.highlightBlock)
}
