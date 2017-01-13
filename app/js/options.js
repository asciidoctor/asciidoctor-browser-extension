'use strict';

var selectTheme = $('#selectTheme');
var selectJavaScript = $('#selectJavaScript');
var selectSafeMode = $('#selectSafeMode');
var inputAllowTxtExtension = $('#inputAllowTxtExtension');
var inputCustomAttributes = $('#inputCustomAttributes');
var inputCustomTheme = $('#inputCustomTheme');
var inputCustomJavaScript = $('#inputCustomJavaScript');
var inputLoadJavaScript = $('input[name=optionsLoadJavaScript]');

var addCustomThemeAlert = $('#addCustomThemeAlert');
var addCustomJavaScriptAlert = $('#addCustomJavaScriptAlert');
var saveAlert = $('#saveAlert');
var enablingLocalFileAlert = $('#enablingLocalFileAlert');
var openExtensionsPageLink = $('#openExtensionsPageLink');
var saveAction;

openExtensionsPageLink.click(openExtensionsPage);
$(document).bind('ready', restoreOptions);

function openExtensionsPage() {
  chrome.tabs.create({'url': "chrome://extensions/?id=flahcdpicipahcghebiillhbjilehfhc"});
}

/**
 * Returns true if options changed else false.
 */
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
  var loadJavaScriptValue = localStorage['JS_LOAD'] || 'after';
  inputLoadJavaScript.filter('[value=' + loadJavaScriptValue + ']').prop('checked', true);

  // Themes
  var customThemeNames = JSON.parse(localStorage['CUSTOM_THEME_NAMES'] || '[]');
  if (customThemeNames.length > 0) {
    var customThemesOptGroup = getCustomThemeOptGroup();
    for (let customThemeName of customThemeNames) {
      customThemesOptGroup.append('<option>' + customThemeName + '</option>');
    }
  }
  selectTheme.val(localStorage['THEME'] || 'asciidoctor');

  // JavaScripts
  var customJavaScriptNames = JSON.parse(localStorage['CUSTOM_JS_NAMES'] || '[]');
  if (customJavaScriptNames.length > 0) {
    for (let customJavaScriptName of customJavaScriptNames) {
      selectJavaScript.append('<option>' + customJavaScriptName + '</option>');
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
  var hasNoFiles = this.files.length == 0;
  if (!hasNoFiles) {
    var file = this.files[0];
    var themeName = getFileNameWithoutExtension(file);
    var customThemeOptGroup = getCustomThemeOptGroup();
    var themeExists = customThemeOptGroup.find('option:contains(' + themeName + ')').length == 0;
    var alert = buildAlert(themeExists, themeName, 'theme');
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
  var hasNoFiles = this.files.length == 0;
  if (!hasNoFiles) {
    var file = this.files[0];
    var javaScriptName = getFileNameWithoutExtension(file);
    var javaScriptExists = selectJavaScript.find('option:contains(' + javaScriptName + ')').length == 0;
    var alert = buildAlert(javaScriptExists, javaScriptName, 'JavaScript');
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
  parentElement.append('<option>' + name + '</option>');
}

function getCustomThemeOptGroup() {
  var customThemesOptGroup = $("#customThemeOptGroup");
  if (customThemesOptGroup.length == 0) {
    customThemesOptGroup = $('<optgroup id="customThemeOptGroup" label="Custom"></optgroup>');
    selectTheme.append(customThemesOptGroup);
  }
  return customThemesOptGroup;
}

function updateThemeFile(themeFile, themeName) {
  var reader = new FileReader();
  reader.onload = function (evt) {
    var fileString = evt.target.result;
    var customThemeNames = JSON.parse(localStorage['CUSTOM_THEME_NAMES'] || '[]');
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
  var reader = new FileReader();
  reader.onload = function (evt) {
    var fileString = evt.target.result;
    var customJavaScriptNames = JSON.parse(localStorage['CUSTOM_JS_NAMES'] || '[]');
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
  var fileName = file.name;
  return fileName.substr(0, fileName.lastIndexOf('.')) || fileName;
}

function buildAlert(exists, name, type) {
  var alertClasses;
  var alertMessage;
  if (exists) {
    alertClasses = 'alert alert-sm alert-info';
    alertMessage = 'New ' + type + ' <b>' + name + '</b> has been added!';
  } else {
    alertClasses = 'alert alert-sm alert-warning';
    alertMessage = 'Existing ' + type + ' <b>' + name + '</b> has been replaced!';
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
  parentElement.find('option:contains(' + name + ')').prop('selected', true);
}

function initSaveIndicators(opts, optionsChangedFunction, saveOptionsFunction) {
  var timeout = opts.timeout || 200;
  var inputsIdentifier = opts.inputsIdentifier || '.form-input';

  $('[data-save-indicator]').each(function() {
    $(this).append('<i class="save-indicator-saved fa fa-check-circle"></i>');
    $(this).append('<i class="save-indicator-saving fa fa-spinner fa-pulse"></i>');
    $(this).addClass('input-group-addon group-addon save-indicator-group-saved');
  });

  $(inputsIdentifier).on('input propertychange change', function() {
    if (optionsChangedFunction()) {
      var inputName = $(this).attr('name');
      var saveIndicatorComp = $("[data-save-indicator='" + inputName + "']");
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
