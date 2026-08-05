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
  if (stylesheetAttribute) {
    const themeName = stylesheetAttribute?.replace(/\.css$/, '')
    const result = await hasTheme(themeName)
    if (result) {
      return themeName
    }
    return getThemeNameFromSettings()
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
  // A custom theme takes precedence over a built-in one of the same name,
  // matching appendThemeStyle() in page.js.
  const customThemeContent = await getSetting(
    Constants.CUSTOM_THEME_PREFIX + themeName,
  )
  if (customThemeContent) {
    return true
  }
  const themeNames = getDefaultThemeNames()
  return themeNames.includes(themeName)
}

/**
 * Get the user's theme name from the settings.
 * @returns {Promise<String>}
 */
async function getThemeNameFromSettings() {
  const settings = await webExtension.storage.local.get(Constants.THEME_KEY)
  return settings[Constants.THEME_KEY] || 'asciidoctor'
}
