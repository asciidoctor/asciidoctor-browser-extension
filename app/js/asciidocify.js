// Namespace
var asciidoctor = asciidoctor || {};
asciidoctor.chrome = asciidoctor.chrome || {};

var autoReloadInterval;
var AUTO_RELOAD_INTERVAL_TIME = 2000;
var ENABLE_RENDER_KEY = 'ENABLE_RENDER';
var ALLOW_TXT_EXTENSION_KEY = 'ALLOW_TXT_EXTENSION';

asciidoctor.chrome.asciidocify = function () {
  txtExtensionRegex = /\.txt[.|\?]?.*?$/;
  if (location.href.match(txtExtensionRegex)) {
    chrome.storage.local.get(ALLOW_TXT_EXTENSION_KEY, function (items) {
      var allowed = items[ALLOW_TXT_EXTENSION_KEY] === 'true';
      // Extension allows txt extension
      if (allowed) {
        loadContent();
      }
    });
  } else {
    loadContent();
  }
};

function loadContent() {
  $.ajax({
    url: location.href,
    cache: false,
    complete: function (data) {
      if (isHtmlContentType(data)) {
        return;
      }
      asciidoctor.chrome.loadContent(data);
    }
  });
}

asciidoctor.chrome.loadContent = function (data) {
  chrome.storage.local.get(ENABLE_RENDER_KEY, function (items) {
    var enabled = items[ENABLE_RENDER_KEY];
    // Extension is enabled
    if (enabled) {
      appendStyles();
      appendMathJax();
      appendHighlightJsScript();
      asciidoctor.chrome.convert(data.responseText);
    }
    startAutoReload();
  });
};

function reloadContent(data) {
  chrome.storage.local.get(LIVERELOADJS_DETECTED_KEY, function (items) {
    var liveReloadJsDetected = items[LIVERELOADJS_DETECTED_KEY];
    // LiveReload.js has been detected
    if (!liveReloadJsDetected) {
      var key = 'md5' + location.href;
      chrome.storage.local.get(key, function (items) {
        var md5sum = items[key];
        if (md5sum && md5sum == md5(data)) {
          return;
        }
        // Content has changed...
        chrome.storage.local.get(ENABLE_RENDER_KEY, function (items) {
          var enabled = items[ENABLE_RENDER_KEY];
          // Extension is enabled
          if (enabled) {
            // Convert AsciiDoc to HTML
            asciidoctor.chrome.convert(data);
          } else {
            // Display plain content
            $(document.body).html('<pre style="word-wrap: break-word; white-space: pre-wrap;">' + $(document.body).text(data).html() + '</pre>');
          }
          // Update md5sum
          var value = {};
          value[key] = md5(data);
          chrome.storage.local.set(value);
        });
      });
    }
  });
}

function startAutoReload() {
  clearInterval(autoReloadInterval);
  autoReloadInterval = setInterval(function () {
    $.ajax({
      url: location.href,
      cache: false,
      success: function (data) {
        reloadContent(data);
      }
    });
  }, AUTO_RELOAD_INTERVAL_TIME);
}

/**
 * Is the content type html ?
 * @param data The data
 * @return true if the content type is html, false otherwise
 */
function isHtmlContentType(data) {
  var contentType = data.getResponseHeader('Content-Type');
  return contentType && (contentType.indexOf('html') > -1);
}

/**
 * Is the document a local file ?
 * @return true if the document is a local file, false otherwise
 */
function isLocalFile() {
  return location.protocol === 'file:';
}

(function (document) {
  asciidoctor.chrome.asciidocify();
}(document));
