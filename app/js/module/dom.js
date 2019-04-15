/* global asciidoctor */
// exports
asciidoctor.browser.dom = (document) => {
  const module = {}
  /**
   * Append a child element to the parent if the child element does not exist in the document.
   * @param parent The parent element
   * @param childElement The child element
   */
  module.appendOnce = (parent, childElement) => {
    if (document.getElementById(childElement.id) === null) {
      parent.appendChild(childElement)
    }
  }

  /**
   * Replace the child element in the document.
   * Effectively removing and then appending the child to the parent in the document.
   * @param parent
   * @param childElement
   */
  module.replace = (parent, childElement) => {
    module.removeElement(childElement.id)
    parent.appendChild(childElement)
  }

  /**
   * Replace a <link rel="stylesheet"> if the element changed.
   * Effectively comparing the href attribute.
   * @param parent
   * @param stylesheetLinkElementAttributes
   */
  module.replaceStylesheetLinkElement = (parent, stylesheetLinkElementAttributes) => {
    const element = document.getElementById(stylesheetLinkElementAttributes.id)
    if (element) {
      if (element.href === stylesheetLinkElementAttributes.href) {
        // nothing to do
        return
      }
      element.parentNode.removeChild(element)
    }
    parent.appendChild(module.createStylesheetLinkElement(stylesheetLinkElementAttributes))
  }

  /**
   * Replace a <style type="text/css"> if the element changed.
   * Effectively comparing the innerHTML attribute.
   * @param parent
   * @param stylesheetLinkElementAttributes
   */
  module.replaceStyleElement = (parent, styleElementAttributes) => {
    const element = document.getElementById(styleElementAttributes.id)
    if (element) {
      if (element.innerHTML === styleElementAttributes.innerHTML) {
        // nothing to do
        return
      }
      element.parentNode.removeChild(element)
    }
    parent.appendChild(module.createStyleElement(styleElementAttributes))
  }

  /**
   * Remove a element by id from the document.
   * @param id The element's id
   */
  module.removeElement = (id) => {
    const element = document.getElementById(id)
    if (element) {
      element.parentNode.removeChild(element)
    }
  }

  /**
   * Create a <style type="text/css"> element.
   * @param attributes
   */
  module.createStyleElement = (attributes) => {
    const style = document.createElement('style')
    style.type = 'text/css'
    return Object.assign(style, attributes)
  }

  /**
   * Create a <link rel="stylesheet"> element.
   * @param attributes The element's attributes
   * @returns {HTMLLinkElement}
   */
  module.createStylesheetLinkElement = (attributes) => {
    const stylesheetLink = document.createElement('link')
    stylesheetLink.rel = 'stylesheet'
    return Object.assign(stylesheetLink, attributes)
  }

  /**
   * Create a <script type="text/javascript"> element.
   * @param attributes The element's attributes
   * @returns {HTMLScriptElement}
   */
  module.createScriptElement = (attributes) => {
    const scriptElement = document.createElement('script')
    scriptElement.type = 'text/javascript'
    return Object.assign(scriptElement, attributes)
  }

  /**
   * @param value
   * @returns {string | null}
   */
  module.decodeEntities = (value) => {
    // QUESTION: Should we use a solution that does not rely on DOM ?
    // https://github.com/mathiasbynens/he
    let div = document.createElement('div')
    div.innerHTML = value
    return div.textContent
  }

  /**
   * @param value
   * @returns {string}
   */
  module.escape = (value) => {
    // QUESTION: Should we use https://lodash.com/docs/4.17.4#escape ?
    let div = document.createElement('div')
    div.textContent = decodeURIComponent(value)
    return div.innerHTML
  }

  /**
   * Set the appropriate viewport <meta> tag
   */
  module.setViewport = () => {
    // Remove existing viewport meta elements.
    document.getElementsByName('viewport').forEach((existingViewport) => {
      existingViewport.remove()
    })
    // Set the viewport meta element that we want.
    const viewportMeta = document.createElement('meta')
    viewportMeta.name = 'viewport'
    viewportMeta.content = 'width=device-width, initial-scale=1.0'
    document.head.appendChild(viewportMeta)
  }

  return module
}
