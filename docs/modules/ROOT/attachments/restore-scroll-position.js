// Restore your reading position after each auto-reload, instead of jumping back to the top.
(() => {
  if (window.__asciidoctorRestoreScrollCleanup) {
    window.__asciidoctorRestoreScrollCleanup()
  }

  const storageKey = 'asciidoctor-scroll-position'
  const savedPosition = Number(sessionStorage.getItem(storageKey))

  // Save the current position right before the content is replaced.
  sessionStorage.setItem(storageKey, String(window.scrollY))

  if (!savedPosition) {
    return // first load, or already at the top: nothing to restore
  }

  const observer = new MutationObserver(() => {
    window.scrollTo(0, savedPosition)
    observer.disconnect()
  })
  observer.observe(document.body, { childList: true, subtree: true })

  window.__asciidoctorRestoreScrollCleanup = () => observer.disconnect()
})()
