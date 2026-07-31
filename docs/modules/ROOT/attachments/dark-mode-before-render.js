// Apply a dark theme before the document is rendered, to avoid a flash of unstyled/light content (FOUC).
// This only works with the "Before the document is loaded" load directive, since it must run
// before the HTML is written to the page.
(() => {
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
  if (!prefersDark) {
    return
  }

  document.documentElement.classList.add('theme-dark')

  const style = document.createElement('style')
  style.id = 'theme-dark-style'
  style.textContent = `
    .theme-dark { background: #1e1e1e; color: #dcdcdc; color-scheme: dark; }
    .theme-dark a { color: #6cb6ff; }
    .theme-dark pre, .theme-dark code { background: #2a2a2a; color: #dcdcdc; }
  `
  document.head.appendChild(style)
})()
