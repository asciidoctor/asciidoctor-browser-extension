var enableRender = true;
var matchesTabUrl = chrome.runtime.getManifest().content_scripts[0].matches;

chrome.contextMenus.create({
  "title":"Render selection",
  "contexts":["selection"], "onclick":function (info, tab) {
    var funcToInject = function () {
      var selection = window.getSelection();
      return (selection.rangeCount > 0) ? selection.toString() : '';
    };
    var jsCodeStr = ';(' + funcToInject + ')();';
    chrome.tabs.executeScript({
      code:jsCodeStr,
      allFrames:true
    }, function (selectedTextPerFrame) {
      if (chrome.runtime.lastError) {
        console.log('error:' + chrome.runtime.lastError.message);
      } else if ((selectedTextPerFrame.length > 0) && (typeof(selectedTextPerFrame[0]) === 'string')) {
        var selectedText = selectedTextPerFrame[0];
        chrome.tabs.create({
          'url':chrome.extension.getURL("html/inject.html"),
          'active':true
        }, function (tab) {
          var selfTabId = tab.id;
          chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
            if (changeInfo.status == "complete" && tabId == selfTabId) {
              var tabs = chrome.extension.getViews({type:"tab"});
              // Get the latest tab opened
              tabs[tabs.length - 1].inject(selectedText);
            }
          });
        });
      }
    });
  }
});

function refreshTab(tab) {
  var code = 'window.location.reload();';
  chrome.tabs.executeScript(tab.id, {code:code});
}

function enableDisableRender() {
  // Save the status of the extension
  chrome.storage.local.set({'ENABLE_RENDER':enableRender});

  // Update the extension icon
  var iconPath = enableRender ? "img/enabled.png" : "img/disabled.png";
  chrome.browserAction.setIcon({path:iconPath});

  // Switch enabled <> disabled
  enableRender = !enableRender;

  // Reload the active tab in the current windows that matches
  var tabFound = false;
  for (var i = 0; i < matchesTabUrl.length; i++) {
    var matchTabUrl = matchesTabUrl[i];
    chrome.tabs.query({active:true, currentWindow:true, url:matchTabUrl}, function (tabs) {
      if (!tabFound && tabs.length > 0) {
        refreshTab(tabs[0]);
        tabFound = true;
      }
    });
  }
}

function refreshOptions() {
  chrome.storage.local.set({
    'CUSTOM_ATTRIBUTES':localStorage['CUSTOM_ATTRIBUTES'],
    'SAFE_MODE':localStorage['SAFE_MODE'],
    'ALLOW_TXT_EXTENSION':localStorage['ALLOW_TXT_EXTENSION'],
    'THEME':localStorage['THEME'],
    'JS':localStorage['JS'],
    'JS_LOAD':localStorage['JS_LOAD']
  });
  var customThemeNames = JSON.parse(localStorage['CUSTOM_THEME_NAMES'] || '[]');
  if (customThemeNames.length > 0) {
    for (var i in customThemeNames) {
      var themeName = customThemeNames[i];
      var themeNameKey = 'CUSTOM_THEME_' + themeName;
      var themeObj = {};
      themeObj[themeNameKey] = localStorage[themeNameKey];
      chrome.storage.local.set(themeObj);
    }
  }
  var customJavaScriptNames = JSON.parse(localStorage['CUSTOM_JS_NAMES'] || '[]');
    if (customJavaScriptNames.length > 0) {
      for (var j in customJavaScriptNames) {
        var javaScriptName = customJavaScriptNames[j];
        var javaScriptNameKey = 'CUSTOM_JS_' + javaScriptName;
        var javaScriptObj = {};
        javaScriptObj[javaScriptNameKey] = localStorage[javaScriptNameKey];
        chrome.storage.local.set(javaScriptObj);
      }
    }
}

chrome.browserAction.onClicked.addListener(enableDisableRender);
enableDisableRender();
