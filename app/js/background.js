let enableRender = true;
const matchesTabUrl = chrome.runtime.getManifest().content_scripts[0].matches;
const renderSelectionMenuItemId = 'renderSelectionMenuItem';
let injectTabId;
let injectText;

chrome.runtime.onInstalled.addListener(function () {
  chrome.contextMenus.create({
    'id': renderSelectionMenuItemId,
    'title': 'Render selection',
    'contexts': ['selection']
  });

  chrome.contextMenus.onClicked.addListener(function (info) {
    if (info.menuItemId === renderSelectionMenuItemId) {
      const funcToInject = function () {
        const selection = window.getSelection();
        return (selection.rangeCount > 0) ? selection.toString() : '';
      };
      const jsCodeStr = `;(${funcToInject})();`;
      chrome.tabs.executeScript({
        code: jsCodeStr,
        allFrames: true
      }, function (selectedTextPerFrame) {
        if (chrome.runtime.lastError) {
          // eslint-disable-next-line no-console
          console.log('error:' + chrome.runtime.lastError.message);
        } else if (selectedTextPerFrame.length > 0 && typeof selectedTextPerFrame[0] === 'string') {
          injectText = selectedTextPerFrame[0];
          chrome.tabs.create({
            'url': chrome.extension.getURL('html/inject.html'),
            'active': true
          }, function (tab) {
            injectTabId = tab.id;
          });
        }
      });
    }
  });
});

chrome.tabs.onUpdated.addListener(function (tabId, changeInfo) {
  if (changeInfo.status === 'complete' && tabId === injectTabId) {
    const tabs = chrome.extension.getViews({type: 'tab'});
    // Get the latest tab opened
    tabs[tabs.length - 1].inject(injectText);
  }
});

function reloadTab (tab) {
  chrome.tabs.reload(tab.id);
}

function findActiveTab (callback) {
  let tabFound = false;
  for (let matchTabUrl of matchesTabUrl) {
    chrome.tabs.query({active: true, currentWindow: true, url: matchTabUrl}, function (tabs) {
      if (!tabFound && tabs.length > 0) {
        callback(tabs[0]);
        tabFound = true;
      }
    });
  }
}

function enableDisableRender () {
  // Save the status of the extension
  chrome.storage.local.set({'ENABLE_RENDER': enableRender});

  // Update the extension icon
  const iconPath = enableRender ? 'img/enabled.png' : 'img/disabled.png';
  chrome.browserAction.setIcon({path: iconPath});

  // Reload the active tab in the current windows that matches
  findActiveTab(function (activeTab) {
    reloadTab(activeTab);
  });

  // Switch the flag
  enableRender = !enableRender;
}

// eslint-disable-next-line no-unused-vars
function refreshOptions () {
  chrome.storage.local.set({
    'CUSTOM_ATTRIBUTES': localStorage['CUSTOM_ATTRIBUTES'],
    'SAFE_MODE': localStorage['SAFE_MODE'],
    'ALLOW_TXT_EXTENSION': localStorage['ALLOW_TXT_EXTENSION'],
    'THEME': localStorage['THEME'],
    'JS': localStorage['JS'],
    'JS_LOAD': localStorage['JS_LOAD']
  });
  const customThemeNames = JSON.parse(localStorage['CUSTOM_THEME_NAMES'] || '[]');
  if (customThemeNames.length > 0) {
    customThemeNames.forEach(function (themeName) {
      const themeNameKey = 'CUSTOM_THEME_' + themeName;
      const themeObj = {};
      themeObj[themeNameKey] = localStorage[themeNameKey];
      chrome.storage.local.set(themeObj);
    });
  }
  const customJavaScriptNames = JSON.parse(localStorage['CUSTOM_JS_NAMES'] || '[]');
  if (customJavaScriptNames.length > 0) {
    customJavaScriptNames.forEach(function (javaScriptName) {
      const javaScriptNameKey = 'CUSTOM_JS_' + javaScriptName;
      const javaScriptObj = {};
      javaScriptObj[javaScriptNameKey] = localStorage[javaScriptNameKey];
      chrome.storage.local.set(javaScriptObj);
    });
  }
}

chrome.browserAction.onClicked.addListener(enableDisableRender);
enableDisableRender();
