/* global asciidoctor */
// exports
asciidoctor.browser.theme = (webExtension, Settings, Constants) => {
  const module = {}

  /**
   * Get the theme name.
   * @param asciidoctorDocument The Asciidoctor document
   * @returns {Promise<String>}
   */
  module.getThemeName = (asciidoctorDocument) => {
    const stylesheetAttribute = asciidoctorDocument.getAttribute('stylesheet')
    if (typeof stylesheetAttribute !== 'undefined' && stylesheetAttribute !== '') {
      const themeName = stylesheetAttribute.replace(/\.css$/, '')
      return hasTheme(themeName)
        .then((result) => {
          if (result) {
            return Promise.resolve(themeName)
          }
          return getThemeNameFromSettings()
        })
    }
    return getThemeNameFromSettings()
  }

  /**
   * Get the list of default themes name.
   * @returns {Array}
   */
  module.getDefaultThemeNames = () => {
    const webAccessibleResources = webExtension.runtime.getManifest().web_accessible_resources
    const themeRegexp = /^css\/themes\/(.*)\.css$/i
    return webAccessibleResources
      .filter(item => themeRegexp.test(item))
      .map(item => item.replace(themeRegexp, '$1'))
  }

  /**
   * Does the theme exists ?
   * @param themeName The theme name
   * @returns {Promise<boolean>}
   */
  const hasTheme = (themeName) => {
    return new Promise((resolve) => {
      const themeNames = module.getDefaultThemeNames()
      if (themeNames.includes(themeName)) {
        resolve(true)
        return
      }
      Settings.getSetting(Constants.CUSTOM_THEME_PREFIX + themeName)
        .then((customThemeContent) => resolve(!!customThemeContent))
    })
  }

  /**
   * Get the user's theme name from the settings.
   * @returns {Promise<String>}
   */
  const getThemeNameFromSettings = () => {
    return new Promise((resolve) => {
      webExtension.storage.local.get(Constants.THEME_KEY, (settings) => {
        const theme = settings[Constants.THEME_KEY] || 'asciidoctor'
        resolve(theme)
      })
    })
  }

  return module
}
