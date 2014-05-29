var enableRender = true;

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
                            tabs[0].inject(selectedText);
                        }
                    });
                });
            }
        });
    }
});

function enableDisableRender() {
    // Save the status of the extension
    chrome.storage.local.set({'ENABLE_RENDER':enableRender});

    // Update the extension icon
    var iconPath = enableRender ? "img/enabled.png" : "img/disabled.png";
    chrome.browserAction.setIcon({path:iconPath});

    // Switch enabled <> disabled
    enableRender = !enableRender;

    // Reload the page
    chrome.tabs.getSelected(null, function (tab) {
        var code = 'window.location.reload();';
        chrome.tabs.executeScript(tab.id, {code:code});
    });
}

function refreshOptions() {
    chrome.storage.local.set({
        'CUSTOM_ATTRIBUTES': localStorage['CUSTOM_ATTRIBUTES'],
        'SAFE_MODE': localStorage['SAFE_MODE'],
        'THEME': localStorage['THEME']
    });
}

chrome.browserAction.onClicked.addListener(enableDisableRender);
enableDisableRender();

var headerReceivedUrls = chrome.runtime.getManifest().content_scripts[0].matches;
chrome.webRequest.onHeadersReceived.addListener(function(details) {
      for (var i = 0; i < details.responseHeaders.length; ++i) {
        if (details.responseHeaders[i].name.toLowerCase() === 'content-security-policy') {
          details.responseHeaders[i].value = "default-src *; script-src 'self'; style-src 'self' 'unsafe-inline';";
          break;
        }
      }
      return {responseHeaders: details.responseHeaders};
  }, {
    urls : headerReceivedUrls
  },

  ["blocking", "responseHeaders"]
);
