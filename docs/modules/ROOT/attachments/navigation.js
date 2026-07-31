// Scroll to the next/previous section with keyboard up/down.
(() => {
  // Auto-reload re-runs this script on every update; remove the previous
  // instance's listener first so they don't stack up across reloads.
  if (window.__asciidoctorNavigationCleanup) {
    window.__asciidoctorNavigationCleanup()
  }

  const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5')).filter(
    (heading) => !heading.classList.contains('float'),
  )

  const headingsLength = headings.length
  let current = 0

  const onKeydown = (e) => {
    if (e.key === 'ArrowUp' && current > 0) {
      e.preventDefault()
      current -= 1
      window.scrollTo({ top: headings[current].offsetTop, behavior: 'smooth' })
    } else if (e.key === 'ArrowDown' && current < headingsLength - 1) {
      e.preventDefault()
      current += 1
      window.scrollTo({ top: headings[current].offsetTop, behavior: 'smooth' })
    }
  }
  window.addEventListener('keydown', onKeydown)
  window.__asciidoctorNavigationCleanup = () =>
    window.removeEventListener('keydown', onKeydown)
})()
