/* global chrome, browser */
import Constants from './constants.js'

const webExtension =
  typeof browser !== 'undefined'
    ? browser
    : typeof chrome !== 'undefined'
      ? chrome
      : null

class RenderingSettings {
  constructor(
    customAttributes,
    safeMode,
    krokiEnabled,
    krokiServerUrl,
    customScript,
  ) {
    this.customAttributes = customAttributes
    this.safeMode = safeMode || 'safe'
    this.krokiEnabled = krokiEnabled
    this.krokiServerUrl = krokiServerUrl
    this.customScript = customScript
  }
}

class CustomJavaScript {
  constructor(content, loadDirective) {
    this.content = content
    this.loadDirective = loadDirective || 'after'
  }
}

/**
 * Get user's setting defined in the options page.
 * @param key
 * @returns {Promise<any>}
 */
export async function getSetting(key) {
  return new Promise((resolve) => {
    webExtension.storage.local.get(key, (items) => {
      resolve(items[key])
    })
  })
}

/**
 * Is the .txt extension allowed ?
 * @returns {Promise<boolean>}
 */
export async function isTxtExtAllowed() {
  return (await getSetting(Constants.ALLOW_TXT_EXTENSION_KEY)) === 'true'
}

/**
 * Is the Kroki extension enabled ?
 * @returns {Promise<boolean>}
 */
export async function isKrokiEnabled() {
  return (await getSetting(Constants.ENABLE_KROKI_KEY)) === 'true'
}

/**
 * Get the Kroki server URL.
 * @returns {Promise<String>}
 */
export async function getKrokiServerUrl() {
  return getSetting(Constants.KROKI_SERVER_URL_KEY)
}

/**
 * Is the extension currently enabled ?
 * @returns {Promise<boolean>}
 */
export async function isExtensionEnabled() {
  const value = await getSetting(Constants.ENABLE_RENDER_KEY)
  return value !== false
}

/**
 * Is "LiveReload" currently enabled on the page ?
 * @returns {Promise<boolean>}
 */
export async function isLiveReloadDetected() {
  return getSetting(Constants.LIVERELOADJS_DETECTED_KEY)
}

/**
 * Get the local poll frequency defined in the options page.
 */
export async function getLocalPollFrequency() {
  const pollFrequency = await getSetting(Constants.LOCAL_POLL_FREQUENCY_KEY)
  if (typeof pollFrequency === 'undefined') {
    // If the poll frequency is not defined, by default use 2 seconds
    return 2
  }
  return parseInt(pollFrequency, 10)
}

/**
 * Get the remote poll frequency defined in the options page.
 */
export async function getRemotePollFrequency() {
  const pollFrequency = await getSetting(Constants.REMOTE_POLL_FREQUENCY_KEY)
  if (typeof pollFrequency === 'undefined') {
    // If the poll frequency is not defined, by default use 2 seconds
    return 2
  }
  return parseInt(pollFrequency, 10)
}

/**
 * Get the user's rendering settings defined in the options page.
 * @returns {Promise<RenderingSettings>}
 */
export async function getRenderingSettings() {
  const settings = await getSettings([
    Constants.KROKI_SERVER_URL_KEY,
    Constants.ENABLE_KROKI_KEY,
    Constants.CUSTOM_ATTRIBUTES_KEY,
    Constants.SAFE_MODE_KEY,
    Constants.JS_KEY,
    Constants.JS_LOAD_KEY,
  ])
  const customJavaScriptName = settings[Constants.JS_KEY]
  const customAttributes = settings[Constants.CUSTOM_ATTRIBUTES_KEY]
  const safeMode = settings[Constants.SAFE_MODE_KEY]
  const customJavaScriptContent =
    await getCustomScriptContent(customJavaScriptName)
  const krokiServerUrl = settings[Constants.KROKI_SERVER_URL_KEY]
  const krokiEnabled = settings[Constants.ENABLE_KROKI_KEY] === 'true'
  if (customJavaScriptContent) {
    const customJavaScriptLoadDirective = settings[Constants.JS_LOAD_KEY]
    return new RenderingSettings(
      customAttributes,
      safeMode,
      krokiEnabled,
      krokiServerUrl,
      new CustomJavaScript(
        customJavaScriptContent,
        customJavaScriptLoadDirective,
      ),
    )
  }
  return new RenderingSettings(
    customAttributes,
    safeMode,
    krokiEnabled,
    krokiServerUrl,
  )
}

const getCustomScriptContent = async (customJavaScriptName) =>
  customJavaScriptName
    ? getSetting(Constants.CUSTOM_JS_PREFIX + customJavaScriptName)
    : undefined

/**
 * Get user's settings defined in the options page.
 * @param keys
 * @returns {Promise<any>}
 */
export async function getSettings(keys) {
  return new Promise((resolve) => {
    webExtension.storage.local.get(keys, (settings) => {
      resolve(settings)
    })
  })
}

export function getBrowserInfo() {
  const userAgent = navigator.userAgent
  let name
  if (userAgent.indexOf('Chrome') > -1) {
    name = 'Chrome'
  } else if (userAgent.indexOf('Safari') > -1) {
    name = 'Safari'
  } else if (userAgent.indexOf('Opera') > -1) {
    name = 'Opera'
  } else if (userAgent.indexOf('Firefox') > -1) {
    name = 'Firefox'
  } else {
    name = 'Edge'
  }
  return { name }
}
