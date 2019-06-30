/* global asciidoctor */
// exports
asciidoctor.browser.settings = (webExtension, Constants) => {
  class RenderingSettings {
    constructor (customAttributes, safeMode, krokiEnabled, krokiServerUrl, customScript) {
      this.customAttributes = customAttributes
      this.safeMode = safeMode || 'safe'
      this.krokiEnabled = krokiEnabled
      this.krokiServerUrl = krokiServerUrl
      this.customScript = customScript
    }
  }

  class CustomJavaScript {
    constructor (content, loadDirective) {
      this.content = content
      this.loadDirective = loadDirective || 'after'
    }
  }

  const module = {}

  /**
   * Is the .txt extension allowed ?
   * @returns {Promise<boolean>}
   */
  module.isTxtExtAllowed = async () => await module.getSetting(Constants.ALLOW_TXT_EXTENSION_KEY) === 'true'

  /**
   * Is the Kroki extension enabled ?
   * @returns {Promise<boolean>}
   */
  module.isKrokiEnabled = async () => await module.getSetting(Constants.ENABLE_KROKI_KEY) === 'true'

  /**
   * Get the Kroki server URL.
   * @returns {Promise<String>}
   */
  module.getKrokiServerUrl = async () => module.getSetting(Constants.KROKI_SERVER_URL_KEY)

  /**
   * Is the extension currently enabled ?
   * @returns {Promise<boolean>}
   */
  module.isExtensionEnabled = () => module.getSetting(Constants.ENABLE_RENDER_KEY)

  /**
   * Is "LiveReload" currently enabled on the page ?
   * @returns {Promise<boolean>}
   */
  module.isLiveReloadDetected = () => module.getSetting(Constants.LIVERELOADJS_DETECTED_KEY)

  /**
   * Get the local poll frequency defined in the options page.
   */
  module.getLocalPollFrequency = async () => {
    const pollFrequency = await module.getSetting(Constants.LOCAL_POLL_FREQUENCY_KEY)
    if (typeof pollFrequency === 'undefined') {
      // If the poll frequency is not defined, by default use 2 seconds
      return 2
    }
    return parseInt(pollFrequency)
  }

  /**
   * Get the remote poll frequency defined in the options page.
   */
  module.getRemotePollFrequency = async () => {
    const pollFrequency = await module.getSetting(Constants.REMOTE_POLL_FREQUENCY_KEY)
    if (typeof pollFrequency === 'undefined') {
      // If the poll frequency is not defined, by default use 2 seconds
      return 2
    }
    return parseInt(pollFrequency)
  }

  /**
   * Get the user's rendering settings defined in the options page.
   * @returns {Promise<RenderingSettings>}
   */
  module.getRenderingSettings = async () => {
    const settings = await module.getSettings([
      Constants.KROKI_SERVER_URL_KEY,
      Constants.ENABLE_KROKI_KEY,
      Constants.CUSTOM_ATTRIBUTES_KEY,
      Constants.SAFE_MODE_KEY,
      Constants.JS_KEY,
      Constants.JS_LOAD_KEY])
    const customJavaScriptName = settings[Constants.JS_KEY]
    const customAttributes = settings[Constants.CUSTOM_ATTRIBUTES_KEY]
    const safeMode = settings[Constants.SAFE_MODE_KEY]
    const customJavaScriptContent = await getCustomScriptContent(customJavaScriptName)
    const krokiServerUrl = settings[Constants.KROKI_SERVER_URL_KEY]
    const krokiEnabled = settings[Constants.ENABLE_KROKI_KEY] === 'true'
    if (customJavaScriptContent) {
      const customJavaScriptLoadDirective = settings[Constants.JS_LOAD_KEY]
      return new RenderingSettings(
        customAttributes,
        safeMode,
        krokiEnabled,
        krokiServerUrl,
        new CustomJavaScript(customJavaScriptContent, customJavaScriptLoadDirective))
    }
    return new RenderingSettings(customAttributes, safeMode, krokiEnabled, krokiServerUrl)
  }

  const getCustomScriptContent = async (customJavaScriptName) =>
    customJavaScriptName ? module.getSetting(Constants.CUSTOM_JS_PREFIX + customJavaScriptName) : undefined

  /**
   * Get user's setting defined in the options page.
   * @param key
   * @returns {Promise<any>}
   */
  module.getSetting = (key) => new Promise((resolve) => {
    webExtension.storage.local.get(key, (items) => {
      resolve(items[key])
    })
  })

  /**
   * Get user's settings defined in the options page.
   * @param keys
   * @returns {Promise<any>}
   */
  module.getSettings = (keys) => new Promise((resolve) => {
    webExtension.storage.local.get(keys, (settings) => {
      resolve(settings)
    })
  })

  return module
}
