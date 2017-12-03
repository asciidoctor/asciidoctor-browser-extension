const webExtension = typeof browser === 'undefined' ? chrome : browser;

const matchesTabUrl = webExtension.runtime.getManifest().content_scripts[0].matches;
const renderSelectionMenuItemId = 'renderSelectionMenuItem';

let injectTabId;
let injectText;
webExtension.runtime.onInstalled.addListener(function () {
  if (webExtension.contextMenus) {
    webExtension.contextMenus.create({
      'id': renderSelectionMenuItemId,
      'title': 'Render selection',
      'contexts': ['selection']
    });

    webExtension.contextMenus.onClicked.addListener(function (info) {
      if (info.menuItemId === renderSelectionMenuItemId) {
        const funcToInject = function () {
          const selection = window.getSelection();
          return (selection.rangeCount > 0) ? selection.toString() : '';
        };
        const jsCodeStr = `;(${funcToInject})();`;
        webExtension.tabs.executeScript({
          code: jsCodeStr,
          allFrames: true
        }, function (selectedTextPerFrame) {
          if (webExtension.runtime.lastError) {
            // eslint-disable-next-line no-console
            console.log('error:' + webExtension.runtime.lastError.message);
          } else if (selectedTextPerFrame.length > 0 && typeof selectedTextPerFrame[0] === 'string') {
            injectText = selectedTextPerFrame[0];
            webExtension.tabs.create({
              'url': webExtension.extension.getURL('html/inject.html'),
              'active': true
            }, function (tab) {
              injectTabId = tab.id;
            });
          }
        });
      }
    });
  }
});

webExtension.tabs.onUpdated.addListener(function (tabId, changeInfo) {
  if (changeInfo.status === 'complete' && tabId === injectTabId) {
    const tabs = webExtension.extension.getViews({type: 'tab'});
    // Get the latest tab opened
    tabs[tabs.length - 1].inject(injectText);
  }
});

function reloadTab (tab) {
  webExtension.tabs.reload(tab.id);
}

function findActiveTab (callback) {
  let tabFound = false;
  for (let matchTabUrl of matchesTabUrl) {
    webExtension.tabs.query({active: true, currentWindow: true, url: matchTabUrl}, function (tabs) {
      if (!tabFound && tabs.length > 0) {
        callback(tabs[0]);
        tabFound = true;
      }
    });
  }
}

let enableRender = true;
function enableDisableRender () {
  // Save the status of the extension
  webExtension.storage.local.set({'ENABLE_RENDER': enableRender});

  // Update the extension icon
  const iconPath = enableRender ? 'img/enabled.png' : 'img/disabled.png';
  if (typeof webExtension.browserAction.setIcon === 'function') {
    webExtension.browserAction.setIcon({path: iconPath});
  } else if (typeof webExtension.browserAction.setTitle === 'function') {
    webExtension.browserAction.setTitle({'title': `Asciidoctor.js Preview (${enableRender ? '✔' : '✘'})`});
  } else {
    // eslint-disable-next-line no-console
    console.log(`Asciidoctor.js Preview (${enableRender ? 'enabled' : 'disabled'})`);
  }

  // Reload the active tab in the current windows that matches
  findActiveTab(function (activeTab) {
    reloadTab(activeTab);
  });

  // Switch the flag
  enableRender = !enableRender;
}

// eslint-disable-next-line no-unused-vars
function refreshOptions () {
  webExtension.storage.local.set({
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
      webExtension.storage.local.set(themeObj);
    });
  }
  const customJavaScriptNames = JSON.parse(localStorage['CUSTOM_JS_NAMES'] || '[]');
  if (customJavaScriptNames.length > 0) {
    customJavaScriptNames.forEach(function (javaScriptName) {
      const javaScriptNameKey = 'CUSTOM_JS_' + javaScriptName;
      const javaScriptObj = {};
      javaScriptObj[javaScriptNameKey] = localStorage[javaScriptNameKey];
      webExtension.storage.local.set(javaScriptObj);
    });
  }
}

webExtension.browserAction.onClicked.addListener(enableDisableRender);
enableDisableRender();
