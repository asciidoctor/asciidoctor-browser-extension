// Saves options to localStorage.
function save_options() {
  var inputCustomAttributes = document.getElementById('inputCustomAttributes');
  localStorage['CUSTOM_ATTRIBUTES'] = inputCustomAttributes.value;

  var selectSafeMode = document.getElementById('selectSafeMode');
  localStorage['SAFE_MODE'] = selectSafeMode.value;

  var selectTheme = document.getElementById('selectTheme');
  localStorage['THEME'] = selectTheme.value;

  // Update status to let user know options were saved.
  var alert = '<div class="alert alert-success alert-dismissable fade in"><button type="button" class="close" data-dismiss="alert" aria-hidden="true">&times;</button><b>{{message}}</b></div>';
  var html = alert.replace('{{message}}', 'Options saved!');
  $('#status').html(html);
  chrome.extension.getBackgroundPage().refreshOptions()
}

// Restores options to saved value from localStorage.
function restore_options() {
  var customAttributes = localStorage['CUSTOM_ATTRIBUTES'];
  if (customAttributes) {
    var inputCustomAttributes = document.getElementById('inputCustomAttributes');
    inputCustomAttributes.value = customAttributes;
  }

  var safeMode = localStorage['SAFE_MODE'] || 'secure';
  var selectSafeMode = document.getElementById('selectSafeMode');
  selectSafeMode.value = safeMode;

  var theme = localStorage['THEME'] || 'asciidoctor';
  var selectTheme = document.getElementById('selectTheme');
  selectTheme.value = theme;

  var customThemes = localStorage['CUSTOM_THEMES'];

  if (customThemes) {
    var customThemesOptGroup = document.createElement('optgroup');
    customThemesOptGroup.label = 'Custom';
    for (var index in customThemes) {
      var customTheme = customThemes[index];
      var option = document.createElement('option');
      option.innerText = customTheme;
      customThemesOptGroup.appendChild(option);
    }
    document.getElementById('selectTheme').appendChild(customThemesOptGroup);
  }
}

var addCustomCSSBtn = $('#addCustomCSS');
var addCustomJavaScriptBtn = $('#addCustomJavaScript');
addCustomCSSBtn.hide();
addCustomJavaScriptBtn.hide();

$('#inputCustomTheme').change(function () {
  var hasNoFiles = this.files.length == 0;
  if (hasNoFiles) {
    addCustomCSSBtn.hide();
  } else {
    // TODO Check extension
    addCustomCSSBtn.show();
  }
});

$('#inputCustomJavaScript').change(function () {
  var hasNoFiles = this.files.length == 0;
  if (hasNoFiles) {
    addCustomJavaScriptBtn.hide();
  } else {
    // TODO Check extension
    addCustomJavaScriptBtn.show();
  }
});

document.addEventListener('DOMContentLoaded', restore_options);
document.querySelector('#save').addEventListener('click', save_options);
