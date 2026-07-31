// Highlight the current chapter/section in the TOC while scrolling.
(() => {
  // Auto-reload re-runs this script on every update; tear down the previous
  // instance first so listeners/styles don't stack up across reloads.
  if (window.__asciidoctorTocScrollspyCleanup) {
    window.__asciidoctorTocScrollspyCleanup()
  }

  const toc = document.getElementById('toc')
  if (!toc) {
    return // :toc: is not enabled for this document
  }

  const headings = Array.from(document.querySelectorAll('h1[id], h2[id], h3[id], h4[id], h5[id]'))
    .map((heading) => ({ heading, link: toc.querySelector(`a[href="#${heading.id}"]`) }))
    .filter(({ link }) => link)
  if (headings.length === 0) {
    return
  }

  const styleElement = document.createElement('style')
  styleElement.id = 'toc-scrollspy-style'
  styleElement.textContent =
    '#toc a.is-active { font-weight: bold; border-left: 3px solid currentColor; padding-left: 0.5em; margin-left: -0.5em; }'
  document.head.appendChild(styleElement)

  let activeLink
  const setActive = (link) => {
    if (link === activeLink) {
      return
    }
    if (activeLink) {
      activeLink.classList.remove('is-active')
    }
    if (link) {
      link.classList.add('is-active')
    }
    activeLink = link
  }

  let ticking = false
  const updateActiveHeading = () => {
    ticking = false
    const scrollPosition = window.scrollY + 96 // clears a sticky header, if any
    let current = headings[0]
    for (const entry of headings) {
      if (entry.heading.offsetTop <= scrollPosition) {
        current = entry
      } else {
        break
      }
    }
    setActive(current.link)
  }

  const onScroll = () => {
    if (!ticking) {
      ticking = true
      requestAnimationFrame(updateActiveHeading)
    }
  }
  window.addEventListener('scroll', onScroll, { passive: true })
  updateActiveHeading()

  window.__asciidoctorTocScrollspyCleanup = () => {
    window.removeEventListener('scroll', onScroll)
    styleElement.remove()
    if (activeLink) {
      activeLink.classList.remove('is-active')
    }
  }
})()
