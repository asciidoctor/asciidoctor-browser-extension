// Scroll to the next/previous section with keyboard up/down.
(() => {
  const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5')).filter(
    (heading) => !heading.classList.contains('float'),
  )

  const headingsLength = headings.length
  let current = 0

  window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp' && current > 0) {
      e.preventDefault()
      current -= 1
      window.scrollTo({ top: headings[current].offsetTop, behavior: 'smooth' })
    } else if (e.key === 'ArrowDown' && current < headingsLength - 1) {
      e.preventDefault()
      current += 1
      window.scrollTo({ top: headings[current].offsetTop, behavior: 'smooth' })
    }
  })
})()
