/* global chrome, browser */
;(async () => {
  const webExtension = typeof browser === 'undefined' ? chrome : browser
  const src = webExtension.runtime.getURL('js/main.js')
  const contentMain = await import(src)
  contentMain.init()
})()
