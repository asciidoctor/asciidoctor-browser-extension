/* global chrome, browser */
// eslint-disable-next-line no-unused-vars
const webExtension = typeof browser === 'undefined' ? chrome : browser

const asciidoctor = {}
asciidoctor.browser = {}

asciidoctor.browser.constants = () => {
  const module = {
    ENABLE_RENDER_KEY: 'ENABLE_RENDER',
    ALLOW_TXT_EXTENSION_KEY: 'ALLOW_TXT_EXTENSION',
    CUSTOM_ATTRIBUTES_KEY: 'CUSTOM_ATTRIBUTES',
    SAFE_MODE_KEY: 'SAFE_MODE',
    LIVERELOADJS_DETECTED_KEY: 'LIVERELOADJS_DETECTED',
    LIVERELOADJS_FILENAME: 'livereload.js',
    THEME_KEY: 'THEME',
    CUSTOM_THEME_PREFIX: 'CUSTOM_THEME_',
    CUSTOM_JS_PREFIX: 'CUSTOM_JS_',
    JS_KEY: 'JS',
    JS_LOAD_KEY: 'JS_LOAD',
    REMOTE_POLL_FREQUENCY_KEY: 'REMOTE_POLL_FREQUENCY',
    LOCAL_POLL_FREQUENCY_KEY: 'LOCAL_POLL_FREQUENCY'
  }
  return module
}
