/* global localStorage, chrome, browser, FileReader, Event */
'use strict'

const webExtension = typeof browser === 'undefined' ? chrome : browser

;(() => {
  const selectTheme = document.getElementById('selectTheme')
  const selectJavaScript = document.getElementById('selectJavaScript')
  const selectSafeMode = document.getElementById('selectSafeMode')
  const selectLocalPollFrequency = document.getElementById('selectLocalPollFrequency')
  const selectRemotePollFrequency = document.getElementById('selectRemotePollFrequency')
  const inputAllowTxtExtension = document.getElementById('inputAllowTxtExtension')
  const inputCustomAttributes = document.getElementById('inputCustomAttributes')
  const inputEnableKroki = document.getElementById('inputEnableKroki')
  const inputKrokiServerURL = document.getElementById('inputKrokiServerURL')
  const inputLoadJavaScript = Array.from(document.body.querySelectorAll('input[name=optionsLoadJavaScript]'))

  const addCustomThemeNotification = document.getElementById('addCustomThemeNotification')
  const addCustomJavaScriptNotification = document.getElementById('addCustomJavaScriptNotification')
  const enablingLocalFileNotification = document.getElementById('enablingLocalFileNotification')
  const openExtensionsPageLink = document.getElementById('openExtensionsPageLink')
  const removeCustomStyleSheet = document.getElementById('removeCustomStyleSheet')
  const showEnablingLocalFileNotification = () => {
    openExtensionsPageLink.onclick = () => webExtension.tabs.create({ url: 'chrome://extensions/?id=' + webExtension.runtime.id })
    initNotification(enablingLocalFileNotification)
    enablingLocalFileNotification.classList.remove('is-hidden')
  }

  const initEnablingLocalFileAlert = () => {
    // This API is currently only implemented in Firefox and Firefox Mobile.
    // Reference: https://developer.mozilla.org/en-US/Add-ons/WebExtensions/API/runtime/getBrowserInfo
    if (typeof webExtension.runtime.getBrowserInfo === 'function') {
      webExtension.runtime.getBrowserInfo().then((info) => {
        if (info.name.includes('Chrome') || info.name.includes('Opera')) {
          showEnablingLocalFileNotification()
        }
      })
    } else {
      // Assume that we are running Chrome or Opera (even if it can be Edge)
      showEnablingLocalFileNotification()
    }
  }

  const optionsChanged = () => {
    return localStorage.CUSTOM_ATTRIBUTES !== inputCustomAttributes.value ||
      localStorage.SAFE_MODE !== selectSafeMode.value ||
      localStorage.LOCAL_POLL_FREQUENCY !== selectLocalPollFrequency.value ||
      localStorage.REMOTE_POLL_FREQUENCY !== selectRemotePollFrequency.value ||
      localStorage.ALLOW_TXT_EXTENSION !== inputAllowTxtExtension.checked.toString() ||
      localStorage.ENABLE_KROKI !== inputEnableKroki.checked.toString() ||
      localStorage.KROKI_SERVER_URL !== inputKrokiServerURL.value ||
      localStorage.THEME !== selectTheme.value ||
      localStorage.JS !== selectJavaScript.value ||
      localStorage.JS_LOAD !== inputLoadJavaScript.find((element) => element.checked).value
  }

  /**
   * Saves options to localStorage.
   */
  const saveOptions = () => {
    localStorage.CUSTOM_ATTRIBUTES = inputCustomAttributes.value
    localStorage.SAFE_MODE = selectSafeMode.value
    localStorage.LOCAL_POLL_FREQUENCY = selectLocalPollFrequency.value
    localStorage.REMOTE_POLL_FREQUENCY = selectRemotePollFrequency.value
    localStorage.ALLOW_TXT_EXTENSION = inputAllowTxtExtension.checked
    localStorage.ENABLE_KROKI = inputEnableKroki.checked
    localStorage.KROKI_SERVER_URL = inputKrokiServerURL.value
    localStorage.THEME = selectTheme.value
    localStorage.JS = selectJavaScript.value
    localStorage.JS_LOAD = inputLoadJavaScript.find((element) => element.checked).value
    webExtension.storage.local.set({
      CUSTOM_ATTRIBUTES: localStorage.CUSTOM_ATTRIBUTES,
      SAFE_MODE: localStorage.SAFE_MODE,
      ALLOW_TXT_EXTENSION: localStorage.ALLOW_TXT_EXTENSION,
      ENABLE_KROKI: localStorage.ENABLE_KROKI,
      KROKI_SERVER_URL: localStorage.KROKI_SERVER_URL,
      THEME: localStorage.THEME,
      JS: localStorage.JS,
      JS_LOAD: localStorage.JS_LOAD,
      LOCAL_POLL_FREQUENCY: localStorage.LOCAL_POLL_FREQUENCY,
      REMOTE_POLL_FREQUENCY: localStorage.REMOTE_POLL_FREQUENCY
    })
    const customThemeNames = JSON.parse(localStorage.CUSTOM_THEME_NAMES || '[]')
    if (customThemeNames.length > 0) {
      customThemeNames.forEach((themeName) => {
        const themeNameKey = 'CUSTOM_THEME_' + themeName
        const themeObj = {}
        themeObj[themeNameKey] = localStorage[themeNameKey]
        webExtension.storage.local.set(themeObj)
      })
    }
    const customJavaScriptNames = JSON.parse(localStorage.CUSTOM_JS_NAMES || '[]')
    if (customJavaScriptNames.length > 0) {
      customJavaScriptNames.forEach((javaScriptName) => {
        const javaScriptNameKey = 'CUSTOM_JS_' + javaScriptName
        const javaScriptObj = {}
        javaScriptObj[javaScriptNameKey] = localStorage[javaScriptNameKey]
        webExtension.storage.local.set(javaScriptObj)
      })
    }
  }

  /**
   * Restores options to saved value from localStorage.
   */
  const restoreOptions = () => {
    inputCustomAttributes.value = localStorage.CUSTOM_ATTRIBUTES || ''
    selectSafeMode.value = localStorage.SAFE_MODE || 'safe'
    selectLocalPollFrequency.value = localStorage.LOCAL_POLL_FREQUENCY || '2'
    selectRemotePollFrequency.value = localStorage.REMOTE_POLL_FREQUENCY || '2'
    inputAllowTxtExtension.checked = localStorage.ALLOW_TXT_EXTENSION === 'true'
    inputEnableKroki.checked = localStorage.ENABLE_KROKI === 'true'
    inputKrokiServerURL.value = localStorage.KROKI_SERVER_URL || 'https://kroki.io'
    const loadJavaScriptValue = ['before', 'after'].includes(localStorage.JS_LOAD) ? localStorage.JS_LOAD : 'after'
    inputLoadJavaScript.find((element) => element.value === loadJavaScriptValue).checked = true

    // Themes
    const customThemeNames = JSON.parse(localStorage.CUSTOM_THEME_NAMES || '[]')
    if (customThemeNames.length > 0) {
      const customThemesOptGroup = getCustomThemeOptGroup()
      for (const customThemeName of customThemeNames) {
        const optionElement = document.createElement('option')
        optionElement.value = customThemeName
        optionElement.innerText = customThemeName
        customThemesOptGroup.appendChild(optionElement)
      }
    }
    selectTheme.value = localStorage.THEME || 'asciidoctor'
    selectTheme.dispatchEvent(new Event('change'))

    // JavaScripts
    const customJavaScriptNames = JSON.parse(localStorage.CUSTOM_JS_NAMES || '[]')
    if (customJavaScriptNames.length > 0) {
      for (const customJavaScriptName of customJavaScriptNames) {
        const optionElement = document.createElement('option')
        optionElement.value = customJavaScriptName
        optionElement.innerText = customJavaScriptName
        selectJavaScript.appendChild(optionElement)
      }
    }
    selectJavaScript.value = localStorage.JS
  }

  const initNotification = (element) => {
    element.getElementsByClassName('delete').item(0).onclick = () => {
      element.classList.add('is-hidden')
    }
    element.classList.add('is-hidden')
  }

  const addNewOpt = (parentElement, name) => {
    const optionElement = document.createElement('option')
    optionElement.value = name
    optionElement.innerText = name
    parentElement.appendChild(optionElement)
  }

  const getCustomThemeOptGroup = () => {
    let optGroupElement = document.getElementById('customThemeOptGroup')
    if (optGroupElement === null) {
      optGroupElement = document.createElement('optgroup')
      optGroupElement.id = 'customThemeOptGroup'
      optGroupElement.label = 'Custom'
      selectTheme.appendChild(optGroupElement)
    }
    return optGroupElement
  }

  const updateThemeFile = (themeFile, themeName) => {
    const reader = new FileReader()
    reader.onload = (evt) => {
      const fileString = evt.target.result
      const customThemeNames = JSON.parse(localStorage.CUSTOM_THEME_NAMES || '[]')
      if (!customThemeNames.includes(themeName)) {
        customThemeNames.push(themeName)
        localStorage.CUSTOM_THEME_NAMES = JSON.stringify(customThemeNames)
      }
      localStorage['CUSTOM_THEME_' + themeName] = fileString
      saveOptions()
    }
    reader.readAsText(themeFile)
  }

  const updateJavaScriptFile = (javaScriptFile, javaScriptName) => {
    const reader = new FileReader()
    reader.onload = (evt) => {
      const fileString = evt.target.result
      const customJavaScriptNames = JSON.parse(localStorage.CUSTOM_JS_NAMES || '[]')
      if (!customJavaScriptNames.includes(javaScriptName)) {
        customJavaScriptNames.push(javaScriptName)
        localStorage.CUSTOM_JS_NAMES = JSON.stringify(customJavaScriptNames)
      }
      localStorage['CUSTOM_JS_' + javaScriptName] = fileString
      saveOptions()
    }
    reader.readAsText(javaScriptFile)
  }

  const getFileNameWithoutExtension = (file) => {
    const fileName = file.name
    return fileName.substr(0, fileName.lastIndexOf('.')) || fileName
  }

  const buildNotification = (exists, name, type) => {
    let classes
    let message
    if (!exists) {
      classes = ['notification', 'is-small', 'is-info']
      message = `New ${type} <b>${name}</b> has been added!`
    } else {
      classes = ['notification', 'is-small', 'is-warning']
      message = `Existing ${type} <b>${name}</b> has been replaced!`
    }
    return { classes, message }
  }

  const showNotification = (element, notification) => {
    element.classList.add(...notification.classes)
    element.getElementsByClassName('notification-text').item(0).innerHTML = notification.message
    element.classList.remove('is-hidden')
  }

  const resetNotification = (element) => {
    element.classList.add('is-hidden')
    element.classList.remove('notification', 'is-small', 'is-info', 'is-warning')
  }

  const selectOpt = (parentElement, name) => {
    parentElement.value = name
    parentElement.dispatchEvent(new Event('change'))
  }

  const initAutoSave = () => {
    function saving (controlElement) {
      if (controlElement) {
        controlElement.classList.add('is-loading')
        controlElement.getElementsByClassName('icon').item(0).classList.add('is-hidden')
      }
    }

    function saved (controlElement) {
      if (controlElement) {
        controlElement.classList.remove('is-loading')
        controlElement.getElementsByClassName('icon').item(0).classList.remove('is-hidden')
      }
    }

    let saveAction
    const save = (controlElement) => {
      if (optionsChanged()) {
        saving(controlElement)
        clearTimeout(saveAction)
        saveAction = setTimeout(() => {
          saveOptions()
          saved(controlElement)
        }, 150)
      }
    }

    Array.from(document.body.querySelectorAll('.form-input')).forEach((element) => {
      if (element.tagName.toLowerCase() === 'input' && element.type === 'text') {
        const parentElement = element.parentElement
        let controlElement
        if (parentElement.classList.contains('has-save-indicator') && parentElement.classList.contains('control')) {
          controlElement = parentElement
        }
        element.onkeyup = element.oninput = element.onpaste = element.onchange = () => save(controlElement)
      } else {
        element.onchange = () => save()
      }
    })
  }
  selectTheme.addEventListener('change', () => {
    if (selectTheme.selectedOptions) {
      if (selectTheme.selectedOptions.length === 1 && selectTheme.selectedOptions[0].parentNode.label !== 'Default') {
        removeCustomStyleSheet.classList.remove('is-hidden')
      } else {
        removeCustomStyleSheet.classList.add('is-hidden')
      }
    }
  })
  restoreOptions()

  initNotification(addCustomThemeNotification)
  initNotification(addCustomJavaScriptNotification)
  initEnablingLocalFileAlert()

  removeCustomStyleSheet.onclick = () => {
    if (selectTheme.selectedOptions) {
      if (selectTheme.selectedOptions.length === 1 && selectTheme.selectedOptions[0].parentNode.label !== 'Default') {
        const themeName = selectTheme.value
        const customThemeNames = JSON.parse(localStorage.CUSTOM_THEME_NAMES || '[]')
        const customThemeFoundIndex = customThemeNames.indexOf(themeName)
        if (customThemeFoundIndex > -1) {
          customThemeNames.splice(customThemeFoundIndex, 1)
          localStorage.CUSTOM_THEME_NAMES = JSON.stringify(customThemeNames)
        }
        localStorage.removeItem('CUSTOM_THEME_' + themeName)
        selectTheme.selectedOptions[0].remove()
        const customThemeOptGroup = document.getElementById('customThemeOptGroup')
        if (customThemeOptGroup && !customThemeOptGroup.hasChildNodes()) {
          customThemeOptGroup.remove()
        }
        localStorage.THEME = 'asciidoctor'
        selectTheme.value = 'asciidoctor'
        selectTheme.dispatchEvent(new Event('change'))
        addCustomThemeNotification.classList.add('is-hidden')
      }
    }
  }

  const inputCustomThemeElement = document.getElementById('inputCustomTheme')
  inputCustomThemeElement.onchange = () => {
    resetNotification(addCustomThemeNotification)
    const files = inputCustomThemeElement.files
    if (files.length !== 0) {
      const file = files[0]
      const themeName = getFileNameWithoutExtension(file)
      const customThemeOptGroup = getCustomThemeOptGroup()
      const options = Array.from(customThemeOptGroup.querySelectorAll('option'))
      const maybeTheme = options.find((element) => element.value === themeName)
      const themeExists = typeof maybeTheme !== 'undefined'
      const alert = buildNotification(themeExists, themeName, 'theme')
      if (!themeExists) {
        addNewOpt(customThemeOptGroup, themeName)
      }
      selectOpt(selectTheme, themeName)
      updateThemeFile(file, themeName)
      showNotification(addCustomThemeNotification, alert)
      inputCustomThemeElement.value = ''
    }
  }

  const inputCustomJavaScriptElement = document.getElementById('inputCustomJavaScript')
  inputCustomJavaScriptElement.onchange = () => {
    resetNotification(addCustomJavaScriptNotification)
    const files = inputCustomJavaScriptElement.files
    if (files.length !== 0) {
      const file = files[0]
      const javaScriptName = getFileNameWithoutExtension(file)
      const options = Array.from(selectJavaScript.querySelectorAll('option'))
      const maybeJavaScript = options.find((element) => element.value === javaScriptName)
      const javaScriptExists = typeof maybeJavaScript !== 'undefined'
      const alert = buildNotification(javaScriptExists, javaScriptName, 'JavaScript')
      if (!javaScriptExists) {
        addNewOpt(selectJavaScript, javaScriptName)
      }
      selectOpt(selectJavaScript, javaScriptName)
      updateJavaScriptFile(file, javaScriptName)
      showNotification(addCustomJavaScriptNotification, alert)
      inputCustomJavaScriptElement.value = ''
    }
  }

  // Automatically save the options
  initAutoSave()
})(webExtension, document)
