// exports
asciidoctor.browser.settings = ((webExtension, Constants) => {

  class RenderingSettings {
    constructor (customAttributes, safeMode, customScript) {
      this.customAttributes = customAttributes;
      this.safeMode = safeMode || 'secure';
      this.customScript = customScript;
    }
  }

  class CustomJavaScript {
    constructor (content, loadDirective) {
      this.content = content;
      this.loadDirective = loadDirective || 'after';
    }
  }

  const module = {};

  /**
   * FIXME: Returns Promise
   * @param callback
   */
  module.isTxtExtAllowed = (callback) => {
    webExtension.storage.local.get(Constants.ALLOW_TXT_EXTENSION_KEY, (items) => {
      const allowed = items[Constants.ALLOW_TXT_EXTENSION_KEY] === 'true';
      callback(allowed);
    });
  }

  /**
   * FIXME: Returns Promise
   * @param callback
   */
  module.isExtensionEnabled = (callback) => {
    module.getSetting(Constants.ENABLE_RENDER_KEY, callback);
  }

  /**
   * FIXME: Returns Promise
   * @param callback
   */
  module.isLiveReloadDetected = (callback) => {
    module.getSetting(Constants.LIVERELOADJS_DETECTED_KEY, callback);
  }

  /**
   * FIXME: Returns Promise
   * @param key
   * @param callback
   */
  module.getMd5sum = (key, callback) => {
    module.getSetting(key, callback);
  }

  /**
   * Get the user's rendering settings defined in the options page.
   * @returns {Promise<RenderingSettings>}
   */
  module.getRenderingSettings = async () => {
    const settings = await module.getSettings([
      Constants.CUSTOM_ATTRIBUTES_KEY,
      Constants.SAFE_MODE_KEY,
      Constants.JS_KEY,
      Constants.JS_LOAD_KEY]);
    const customJavaScriptName = settings[Constants.JS_KEY];
    const customAttributes = settings[Constants.CUSTOM_ATTRIBUTES_KEY];
    const safeMode = settings[Constants.SAFE_MODE_KEY];
    const customJavaScriptContent = await getCustomScriptContent(customJavaScriptName);
    if (customJavaScriptContent) {
      const customJavaScriptLoadDirective = settings[Constants.JS_LOAD_KEY];
      return new RenderingSettings(
        customAttributes,
        safeMode,
        new CustomJavaScript(customJavaScriptContent, customJavaScriptLoadDirective));
    }
    return new RenderingSettings(
      customAttributes,
      safeMode);
  };

  const getCustomScriptContent = (customJavaScriptName) => {
    return new Promise((resolve) => {
      if (customJavaScriptName) {
        module.getSetting(Constants.CUSTOM_JS_PREFIX + customJavaScriptName, (customJavaScriptContent) => {
          resolve(customJavaScriptContent);
        });
      } else {
        resolve(undefined);
      }
    });
  };

  /**
   * Get user's setting defined in the options page.
   * FIXME: Returns Promise
   * @param key
   * @param callback
   */
  module.getSetting = (key, callback) => {
    webExtension.storage.local.get(key, (items) => {
      callback(items[key]);
    });
  };

  /**
   * @param keys
   * @returns {Promise<any>}
   */
  module.getSettings = (keys) => {
    return new Promise((resolve) => {
      webExtension.storage.local.get(keys, (settings) => {
        resolve(settings);
      });
    });
  };

  return module;
});
