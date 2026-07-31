// Fade between sections with keyboard up/down. <h1> and preamble are wrapped in a section.
(() => {
  const requestFrame = window.requestAnimationFrame || ((fn) => setTimeout(fn, 16))

  const fadeIn = (el, time) => {
    el.style.opacity = 0
    el.style.display = 'block'
    let last = Date.now()
    const tick = () => {
      el.style.opacity = Number(el.style.opacity) + (Date.now() - last) / time
      last = Date.now()
      if (Number(el.style.opacity) < 1) {
        requestFrame(tick)
      }
    }
    tick()
  }

  const fadeOut = (el, time, callback) => {
    el.style.opacity = 1
    let last = Date.now()
    const tick = () => {
      el.style.opacity = Number(el.style.opacity) - (Date.now() - last) / time
      last = Date.now()
      if (Number(el.style.opacity) > 0) {
        requestFrame(tick)
      } else {
        el.style.display = 'none'
        callback()
      }
    }
    tick()
  }

  const firstSectionElements = []
  const preambleElement = document.getElementById('preamble')
  if (preambleElement) {
    firstSectionElements.push(preambleElement)
  }
  const documentTitleElement = document.querySelector('#content > h1:first-child')
  if (documentTitleElement) {
    firstSectionElements.push(documentTitleElement)
  }
  const firstSectionDiv = document.createElement('div')
  firstSectionDiv.className = 'sect1'
  firstSectionElements.forEach((element) => firstSectionDiv.appendChild(element))

  const sections = Array.from(document.getElementsByClassName('sect1'))
  sections.forEach((section, index) => {
    if (index > 0) {
      section.style.display = 'none'
    }
  })

  const sectionsLength = sections.length
  let current = 0

  window.addEventListener('keydown', (e) => {
    const origin = current
    if (e.key === 'ArrowUp') {
      current = current > 0 ? current - 1 : sectionsLength - 1
      e.preventDefault()
      fadeOut(sections[origin], 300, () => fadeIn(sections[current], 300))
    } else if (e.key === 'ArrowDown') {
      current = current < sectionsLength - 1 ? current + 1 : 0
      e.preventDefault()
      fadeOut(sections[origin], 300, () => fadeIn(sections[current], 300))
    }
  })
})()
