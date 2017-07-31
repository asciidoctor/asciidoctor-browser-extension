const selectTheme = $('#selectTheme');
const selectJavaScript = $('#selectJavaScript');
const selectSafeMode = $('#selectSafeMode');
const inputAllowTxtExtension = $('#inputAllowTxtExtension');
const inputCustomAttributes = $('#inputCustomAttributes');
const inputCustomTheme = $('#inputCustomTheme');
const inputCustomJavaScript = $('#inputCustomJavaScript');
const inputLoadJavaScript = $('input[name=optionsLoadJavaScript]');

const addCustomThemeAlert = $('#addCustomThemeAlert');
const addCustomJavaScriptAlert = $('#addCustomJavaScriptAlert');
const saveAlert = $('#saveAlert');
const enablingLocalFileAlert = $('#enablingLocalFileAlert');
const openExtensionsPageLink = $('#openExtensionsPageLink');

let saveAction;

openExtensionsPageLink.click(openExtensionsPage);
$(document).bind('ready', restoreOptions);

function openExtensionsPage() {
  chrome.tabs.create({'url': "chrome://extensions/?id=flahcdpicipahcghebiillhbjilehfhc"});
}

function optionsChanged() {
  return localStorage['CUSTOM_ATTRIBUTES'] !== inputCustomAttributes.val() ||
    localStorage['SAFE_MODE'] !== selectSafeMode.val() ||
    localStorage['ALLOW_TXT_EXTENSION'] !== inputAllowTxtExtension.is(':checked').toString() ||
    localStorage['THEME'] !== selectTheme.val() ||
    localStorage['JS'] !== selectJavaScript.val() ||
    localStorage['JS_LOAD'] !== inputLoadJavaScript.filter(':checked').val();
}

/**
 * Saves options to localStorage.
 */
function saveOptions() {
    localStorage['CUSTOM_ATTRIBUTES'] = inputCustomAttributes.val();
    localStorage['SAFE_MODE'] = selectSafeMode.val();
    localStorage['ALLOW_TXT_EXTENSION'] = inputAllowTxtExtension.is(':checked');
    localStorage['THEME'] = selectTheme.val();
    localStorage['JS'] = selectJavaScript.val();
    localStorage['JS_LOAD'] = inputLoadJavaScript.filter(':checked').val();
    chrome.extension.getBackgroundPage().refreshOptions()
}

/**
 * Restores options to saved value from localStorage.
 */
function restoreOptions() {
  inputCustomAttributes.val(localStorage['CUSTOM_ATTRIBUTES'] || '');
  selectSafeMode.val(localStorage['SAFE_MODE'] || 'secure');
  inputAllowTxtExtension.prop('checked', localStorage['ALLOW_TXT_EXTENSION'] === 'true');
  const loadJavaScriptValue = localStorage['JS_LOAD'] || 'after';
  inputLoadJavaScript.filter(`[value=${loadJavaScriptValue}]`).prop('checked', true);

  // Themes
  const customThemeNames = JSON.parse(localStorage['CUSTOM_THEME_NAMES'] || '[]');
  if (customThemeNames.length > 0) {
    const customThemesOptGroup = getCustomThemeOptGroup();
    for (let customThemeName of customThemeNames) {
      customThemesOptGroup.append(`<option>${customThemeName}</option>`);
    }
  }
  selectTheme.val(localStorage['THEME'] || 'asciidoctor');

  // JavaScripts
  const customJavaScriptNames = JSON.parse(localStorage['CUSTOM_JS_NAMES'] || '[]');
  if (customJavaScriptNames.length > 0) {
    for (let customJavaScriptName of customJavaScriptNames) {
      selectJavaScript.append(`<option>${customJavaScriptName}</option>`);
    }
  }
  selectJavaScript.val(localStorage['JS']);
}

function initAlert(element) {
  element.find('.close').click(function () {
    element.hide();
  });
  element.hide();
}

initAlert(saveAlert);
initAlert(addCustomThemeAlert);
initAlert(addCustomJavaScriptAlert);
initAlert(enablingLocalFileAlert);
enablingLocalFileAlert.show();

inputCustomTheme.change(function () {
  resetAlert(addCustomThemeAlert);
  const hasNoFiles = this.files.length === 0;
  if (!hasNoFiles) {
    const file = this.files[0];
    const themeName = getFileNameWithoutExtension(file);
    const customThemeOptGroup = getCustomThemeOptGroup();
    const themeExists = customThemeOptGroup.find(`option:contains(${themeName})`).length === 0;
    const alert = buildAlert(themeExists, themeName, 'theme');
    if (themeExists) {
      addNewOpt(customThemeOptGroup, themeName);
    }
    selectOpt(customThemeOptGroup, themeName);
    updateThemeFile(file, themeName);
    showAlert(addCustomThemeAlert, alert);
    this.value = '';
  }
});

inputCustomJavaScript.change(function () {
  resetAlert(addCustomJavaScriptAlert);
  const hasNoFiles = this.files.length === 0;
  if (!hasNoFiles) {
    const file = this.files[0];
    const javaScriptName = getFileNameWithoutExtension(file);
    const javaScriptExists = selectJavaScript.find(`option:contains(${javaScriptName})`).length === 0;
    const alert = buildAlert(javaScriptExists, javaScriptName, 'JavaScript');
    if (javaScriptExists) {
      addNewOpt(selectJavaScript, javaScriptName);
    }
    selectOpt(selectJavaScript, javaScriptName);
    updateJavaScriptFile(file, javaScriptName);
    showAlert(addCustomJavaScriptAlert, alert);
    this.value = '';
  }
});

function addNewOpt(parentElement, name) {
  parentElement.append(`<option>${name}</option>`);
}

function getCustomThemeOptGroup() {
  let customThemesOptGroup = $("#customThemeOptGroup");
  if (customThemesOptGroup.length === 0) {
    customThemesOptGroup = $('<optgroup id="customThemeOptGroup" label="Custom"></optgroup>');
    selectTheme.append(customThemesOptGroup);
  }
  return customThemesOptGroup;
}

function updateThemeFile(themeFile, themeName) {
  const reader = new FileReader();
  reader.onload = function (evt) {
    const fileString = evt.target.result;
    const customThemeNames = JSON.parse(localStorage['CUSTOM_THEME_NAMES'] || '[]');
    if ($.inArray(themeName, customThemeNames) === -1) {
      customThemeNames.push(themeName);
      localStorage['CUSTOM_THEME_NAMES'] = JSON.stringify(customThemeNames);
    }
    localStorage['CUSTOM_THEME_' + themeName] = fileString;
    saveOptions();
  };
  reader.readAsText(themeFile);
}

function updateJavaScriptFile(javaScriptFile, javaScriptName) {
  const reader = new FileReader();
  reader.onload = function (evt) {
    const fileString = evt.target.result;
    const customJavaScriptNames = JSON.parse(localStorage['CUSTOM_JS_NAMES'] || '[]');
    if ($.inArray(javaScriptName, customJavaScriptNames) === -1) {
      customJavaScriptNames.push(javaScriptName);
      localStorage['CUSTOM_JS_NAMES'] = JSON.stringify(customJavaScriptNames);
    }
    localStorage['CUSTOM_JS_' + javaScriptName] = fileString;
    saveOptions();
  };
  reader.readAsText(javaScriptFile);
}

function getFileNameWithoutExtension(file) {
  const fileName = file.name;
  return fileName.substr(0, fileName.lastIndexOf('.')) || fileName;
}

function buildAlert(exists, name, type) {
  let alertClasses;
  let alertMessage;
  if (exists) {
    alertClasses = 'alert alert-sm alert-info';
    alertMessage = `New ${type} <b>${name}</b> has been added!`;
  } else {
    alertClasses = 'alert alert-sm alert-warning';
    alertMessage = `Existing ${type} <b>${name}</b> has been replaced!`;
  }
  return {classes: alertClasses, message: alertMessage};
}

function showAlert(element, alert) {
  element.addClass(alert.classes);
  element.find('.content').html(alert.message);
  element.show();
}

function resetAlert(element) {
  element.hide();
  element.removeClass();
}

function selectOpt(parentElement, name) {
  parentElement.find(`option:contains(${name})`).prop('selected', true);
}

function initSaveIndicators(opts, optionsChangedFunction, saveOptionsFunction) {
  const timeout = opts.timeout || 200;
  const inputsIdentifier = opts.inputsIdentifier || '.form-input';

  $('[data-save-indicator]').each(function() {
    $(this).append('<i class="save-indicator-saved fa fa-check-circle"></i>');
    $(this).append('<i class="save-indicator-saving fa fa-spinner fa-pulse"></i>');
    $(this).addClass('input-group-addon group-addon save-indicator-group-saved');
  });

  $(inputsIdentifier).on('input propertychange change', function() {
    if (optionsChangedFunction()) {
      const inputName = $(this).attr('name');
      const saveIndicatorComp = $(`[data-save-indicator='${inputName}']`);
      // Update status to let user know options are being saved.
      saveIndicatorComp.removeClass('save-indicator-group-saved');
      saveIndicatorComp.addClass('save-indicator-group-saving');
      clearTimeout(saveAction);
      saveAction = setTimeout(function () {
        saveOptionsFunction();
        // Update status to let user know options were saved.
        saveIndicatorComp.removeClass('save-indicator-group-saving');
        saveIndicatorComp.addClass('save-indicator-group-saved');
      }, timeout);
    }
  });
}

// Initialize save indicators
initSaveIndicators({}, optionsChanged, saveOptions);
