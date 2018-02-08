const webExtension = typeof browser === 'undefined' ? chrome : browser;

(() => {
  const selectTheme = document.getElementById('selectTheme');
  const selectJavaScript = document.getElementById('selectJavaScript');
  const selectSafeMode = document.getElementById('selectSafeMode');
  const inputAllowTxtExtension = document.getElementById('inputAllowTxtExtension');
  const inputCustomAttributes = document.getElementById('inputCustomAttributes');
  const inputLoadJavaScript = Array.from(document.body.querySelectorAll('input[name=optionsLoadJavaScript]'));

  const addCustomThemeAlert = document.getElementById('addCustomThemeAlert');
  const addCustomJavaScriptAlert = document.getElementById('addCustomJavaScriptAlert');
  const saveAlert = document.getElementById('saveAlert');
  const enablingLocalFileAlert = document.getElementById('enablingLocalFileAlert');
  const openExtensionsPageLink = document.getElementById('openExtensionsPageLink');

  const showEnablingLocalFileAlert = () => {
    openExtensionsPageLink.onclick = () => webExtension.tabs.create({'url': 'chrome://extensions/?id=' + webExtension.runtime.id});
    initAlert(enablingLocalFileAlert);
    enablingLocalFileAlert.classList.remove('hidden');
  };

  const initEnablingLocalFileAlert = () => {
    // This API is currently only implemented in Firefox and Firefox Mobile.
    // Reference: https://developer.mozilla.org/en-US/Add-ons/WebExtensions/API/runtime/getBrowserInfo
    if (typeof webExtension.runtime.getBrowserInfo === 'function') {
      webExtension.runtime.getBrowserInfo().then((info) => {
        if (info.name.includes('Chrome') || info.name.includes('Opera')) {
          showEnablingLocalFileAlert();
        }
      });
    } else {
      // Assume that we are running Chrome or Opera (even if it can be Edge)
      showEnablingLocalFileAlert();
    }
  };

  const optionsChanged = () => {
    return localStorage['CUSTOM_ATTRIBUTES'] !== inputCustomAttributes.value ||
      localStorage['SAFE_MODE'] !== selectSafeMode.value ||
      localStorage['ALLOW_TXT_EXTENSION'] !== inputAllowTxtExtension.checked.toString() ||
      localStorage['THEME'] !== selectTheme.value ||
      localStorage['JS'] !== selectJavaScript.value ||
      localStorage['JS_LOAD'] !== inputLoadJavaScript.find((element) => element.checked).value;
  };

  /**
   * Saves options to localStorage.
   */
  const saveOptions = () => {
    localStorage['CUSTOM_ATTRIBUTES'] = inputCustomAttributes.value;
    localStorage['SAFE_MODE'] = selectSafeMode.value;
    localStorage['ALLOW_TXT_EXTENSION'] = inputAllowTxtExtension.checked;
    localStorage['THEME'] = selectTheme.value;
    localStorage['JS'] = selectJavaScript.value;
    localStorage['JS_LOAD'] = inputLoadJavaScript.find((element) => element.checked).value;
    webExtension.extension.getBackgroundPage().refreshOptions();
  };

  /**
   * Restores options to saved value from localStorage.
   */
  const restoreOptions = () => {
    inputCustomAttributes.value = localStorage['CUSTOM_ATTRIBUTES'] || '';
    selectSafeMode.value = localStorage['SAFE_MODE'] || 'secure';
    inputAllowTxtExtension.checked = localStorage['ALLOW_TXT_EXTENSION'] === 'true';
    const loadJavaScriptValue = ['before', 'after'].includes(localStorage['JS_LOAD']) ? localStorage['JS_LOAD'] : 'after';
    inputLoadJavaScript.find((element) => element.value === loadJavaScriptValue).checked = true;

    // Themes
    const customThemeNames = JSON.parse(localStorage['CUSTOM_THEME_NAMES'] || '[]');
    if (customThemeNames.length > 0) {
      const customThemesOptGroup = getCustomThemeOptGroup();
      for (let customThemeName of customThemeNames) {
        let optionElement = document.createElement('option');
        optionElement.value = customThemeName;
        optionElement.innerText = customThemeName;
        customThemesOptGroup.appendChild(optionElement);
      }
    }
    selectTheme.value = localStorage['THEME'] || 'asciidoctor';

    // JavaScripts
    const customJavaScriptNames = JSON.parse(localStorage['CUSTOM_JS_NAMES'] || '[]');
    if (customJavaScriptNames.length > 0) {
      for (let customJavaScriptName of customJavaScriptNames) {
        let optionElement = document.createElement('option');
        optionElement.value = customJavaScriptName;
        optionElement.innerText = customJavaScriptName;
        selectJavaScript.appendChild(optionElement);
      }
    }
    selectJavaScript.value = localStorage['JS'];
  };

  const initAlert = (element) => {
    element.getElementsByClassName('close').item(0).onclick = () => {
      element.classList.add('hidden');
    };
    element.classList.add('hidden');
  };

  const addNewOpt = (parentElement, name) => {
    const optionElement = document.createElement('option');
    optionElement.value = name;
    optionElement.innerText = name;
    parentElement.appendChild(optionElement);
  };

  const getCustomThemeOptGroup = () => {
    let optGroupElement = document.getElementById('customThemeOptGroup');
    if (optGroupElement === null) {
      optGroupElement = document.createElement('optgroup');
      optGroupElement.id = 'customThemeOptGroup';
      optGroupElement.label = 'Custom';
      selectTheme.appendChild(optGroupElement);
    }
    return optGroupElement;
  };

  const updateThemeFile = (themeFile, themeName) => {
    const reader = new FileReader();
    reader.onload = (evt) => {
      const fileString = evt.target.result;
      const customThemeNames = JSON.parse(localStorage['CUSTOM_THEME_NAMES'] || '[]');
      if (!customThemeNames.includes(themeName)) {
        customThemeNames.push(themeName);
        localStorage['CUSTOM_THEME_NAMES'] = JSON.stringify(customThemeNames);
      }
      localStorage['CUSTOM_THEME_' + themeName] = fileString;
      saveOptions();
    };
    reader.readAsText(themeFile);
  };

  const updateJavaScriptFile = (javaScriptFile, javaScriptName) => {
    const reader = new FileReader();
    reader.onload = (evt) => {
      const fileString = evt.target.result;
      const customJavaScriptNames = JSON.parse(localStorage['CUSTOM_JS_NAMES'] || '[]');
      if (!customJavaScriptNames.includes(javaScriptName)) {
        customJavaScriptNames.push(javaScriptName);
        localStorage['CUSTOM_JS_NAMES'] = JSON.stringify(customJavaScriptNames);
      }
      localStorage['CUSTOM_JS_' + javaScriptName] = fileString;
      saveOptions();
    };
    reader.readAsText(javaScriptFile);
  };

  const getFileNameWithoutExtension = (file) => {
    const fileName = file.name;
    return fileName.substr(0, fileName.lastIndexOf('.')) || fileName;
  };

  const buildAlert = (exists, name, type) => {
    let alertClasses;
    let alertMessage;
    if (!exists) {
      alertClasses = ['alert', 'alert-sm', 'alert-info'];
      alertMessage = `New ${type} <b>${name}</b> has been added!`;
    } else {
      alertClasses = ['alert', 'alert-sm', 'alert-warning'];
      alertMessage = `Existing ${type} <b>${name}</b> has been replaced!`;
    }
    return {classes: alertClasses, message: alertMessage};
  };

  const showAlert = (element, alert) => {
    element.classList.add(...alert.classes);
    element.getElementsByClassName('content').item(0).innerHTML = alert.message;
    element.classList.remove('hidden');
  };

  const resetAlert = (element) => {
    element.classList.add('hidden');
    element.classList.remove('alert', 'alert-sm', 'alert-info', 'alert-warning');
  };

  const selectOpt = (parentElement, name) => {
    parentElement.value = name;
  };

  const initSaveIndicators = (opts, optionsChangedFunction, saveOptionsFunction) => {
    const timeout = opts.timeout || 200;
    const inputsIdentifier = opts.inputsIdentifier || '.form-input';

    document.body.querySelectorAll('[data-save-indicator]').forEach((element) => {
      let iconSaved = document.createElement('i');
      iconSaved.classList.add('save-indicator-saved', 'fa', 'fa-check-circle');
      let iconSaving = document.createElement('i');
      iconSaving.classList.add('save-indicator-saving', 'fa', 'fa-spinner', 'fa-pulse');
      element.appendChild(iconSaved);
      element.appendChild(iconSaving);
      element.classList.add('input-group-addon', 'group-addon', 'save-indicator-group-saved');
    });

    let saveAction;
    document.body.querySelectorAll(inputsIdentifier).forEach((element) => {
      element.onchange = () => {
        if (optionsChangedFunction()) {
          const inputName = element.getAttribute('name');
          const saveIndicatorComp = document.body.querySelector(`[data-save-indicator='${inputName}']`);
          // Update status to let user know options are being saved.
          saveIndicatorComp.classList.remove('save-indicator-group-saved');
          saveIndicatorComp.classList.add('save-indicator-group-saving');
          clearTimeout(saveAction);
          saveAction = setTimeout(() => {
            saveOptionsFunction();
            // Update status to let user know options were saved.
            saveIndicatorComp.classList.remove('save-indicator-group-saving');
            saveIndicatorComp.classList.add('save-indicator-group-saved');
          }, timeout);
        }
      };
    });
  };

  restoreOptions();

  initAlert(saveAlert);
  initAlert(addCustomThemeAlert);
  initAlert(addCustomJavaScriptAlert);
  initEnablingLocalFileAlert();

  const inputCustomThemeElement = document.getElementById('inputCustomTheme');
  inputCustomThemeElement.onchange = () => {
    resetAlert(addCustomThemeAlert);
    const files = inputCustomThemeElement.files;
    if (files.length !== 0) {
      const file = files[0];
      const themeName = getFileNameWithoutExtension(file);
      const customThemeOptGroup = getCustomThemeOptGroup();
      const options = Array.from(customThemeOptGroup.querySelectorAll('option'));
      const maybeTheme = options.find((element) => element.value === themeName);
      const themeExists = typeof maybeTheme !== 'undefined';
      const alert = buildAlert(themeExists, themeName, 'theme');
      if (!themeExists) {
        addNewOpt(customThemeOptGroup, themeName);
      }
      selectOpt(selectTheme, themeName);
      updateThemeFile(file, themeName);
      showAlert(addCustomThemeAlert, alert);
      inputCustomThemeElement.value = '';
    }
  };

  const inputCustomJavaScriptElement = document.getElementById('inputCustomJavaScript');
  inputCustomJavaScriptElement.onchange = () => {
    resetAlert(addCustomJavaScriptAlert);
    const files = inputCustomJavaScriptElement.files;
    if (files.length !== 0) {
      const file = files[0];
      const javaScriptName = getFileNameWithoutExtension(file);
      const options = Array.from(selectJavaScript.querySelectorAll('option'));
      const maybeJavaScript = options.find((element) => element.value === javaScriptName);
      const javaScriptExists = typeof maybeJavaScript !== 'undefined';
      const alert = buildAlert(javaScriptExists, javaScriptName, 'JavaScript');
      if (!javaScriptExists) {
        addNewOpt(selectJavaScript, javaScriptName);
      }
      selectOpt(selectJavaScript, javaScriptName);
      updateJavaScriptFile(file, javaScriptName);
      showAlert(addCustomJavaScriptAlert, alert);
      inputCustomJavaScriptElement.value = '';
    }
  };

  // Initialize save indicators
  initSaveIndicators({}, optionsChanged, saveOptions);
})(webExtension, document);
