/* global chrome, browser */
import Constants from './constants.js'
import { getSetting } from './settings.js'

const webExtension =
  typeof browser !== 'undefined'
    ? browser
    : typeof chrome !== 'undefined'
      ? chrome
      : null

/**
 * Get the theme name.
 * @param stylesheetAttribute The stylesheet attribute value
 * @returns {Promise<String>}
 */
export async function getThemeName(stylesheetAttribute) {
  if (
    typeof stylesheetAttribute !== 'undefined' &&
    stylesheetAttribute !== ''
  ) {
    const themeName = stylesheetAttribute.replace(/\.css$/, '')
    return hasTheme(themeName).then((result) => {
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
export function getDefaultThemeNames() {
  const webAccessibleResources =
    webExtension.runtime.getManifest().web_accessible_resources
  if (webAccessibleResources && webAccessibleResources.length > 0) {
    const resources = webAccessibleResources[0].resources || []
    const themeRegexp = /^\/?css\/themes\/(.*)\.css$/i
    return resources
      .filter((item) => themeRegexp.test(item))
      .map((item) => item.replace(themeRegexp, '$1'))
  }

  return []
}

/**
 * Does the theme exists ?
 * @param themeName The theme name
 * @returns {Promise<boolean>}
 */
async function hasTheme(themeName) {
  return new Promise((resolve) => {
    const themeNames = getDefaultThemeNames()
    if (themeNames.includes(themeName)) {
      resolve(true)
      return
    }
    getSetting(Constants.CUSTOM_THEME_PREFIX + themeName).then(
      (customThemeContent) => resolve(!!customThemeContent),
    )
  })
}

/**
 * Get the user's theme name from the settings.
 * @returns {Promise<String>}
 */
async function getThemeNameFromSettings() {
  return new Promise((resolve) => {
    webExtension.storage.local.get(Constants.THEME_KEY, (settings) => {
      const theme = settings[Constants.THEME_KEY] || 'asciidoctor'
      resolve(theme)
    })
  })
}
