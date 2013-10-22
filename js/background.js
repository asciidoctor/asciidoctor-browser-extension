var enableRender = true;

function sendUrlToAsciidoctorEditor(info, tab) {
    // Send tab.url to Asciidoctor Editor App
    chrome.runtime.sendMessage("jcafjdafpaomnmpffgphdalkdhnnggln", tab.url)
}
chrome.contextMenus.create({"title":"Send to Asciidoctor Editor", "onclick":sendUrlToAsciidoctorEditor});

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
    var customAttributes = localStorage.getItem("CUSTOM_ATTRIBUTES");
    chrome.storage.local.set({'CUSTOM_ATTRIBUTES':customAttributes});
}

chrome.browserAction.onClicked.addListener(enableDisableRender);
enableDisableRender();