// Namespace
const asciidoctor = {};
asciidoctor.chrome = {};

asciidoctor.chrome.AUTO_RELOAD_INTERVAL_TIME = 2000;
asciidoctor.chrome.ENABLE_RENDER_KEY = 'ENABLE_RENDER';
asciidoctor.chrome.ALLOW_TXT_EXTENSION_KEY = 'ALLOW_TXT_EXTENSION';

asciidoctor.chrome.asciidocify = function () {
  const txtExtensionRegex = /\.txt[.|?]?.*?$/;
  if (location.href.match(txtExtensionRegex)) {
    isTxtExtAllowed(function (allowed) {
      // Extension allows txt extension
      if (allowed) {
        fetchContent();
      }
    });
  } else {
    fetchContent();
  }
};

asciidoctor.chrome.loadContent = function (data) {
  isExtensionEnabled(function (enabled) {
    // Extension is enabled
    if (enabled) {
      asciidoctor.chrome.appendStyles();
      asciidoctor.chrome.appendMathJax();
      asciidoctor.chrome.appendHighlightJsScript();
      asciidoctor.chrome.convert(data.responseText);
    }
    startAutoReload();
  });
};

function isTxtExtAllowed (callback) {
  chrome.storage.local.get(asciidoctor.chrome.ALLOW_TXT_EXTENSION_KEY, function (items) {
    const allowed = items[asciidoctor.chrome.ALLOW_TXT_EXTENSION_KEY] === 'true';
    callback(allowed);
  });
}

function isExtensionEnabled (callback) {
  chrome.storage.local.get(asciidoctor.chrome.ENABLE_RENDER_KEY, function (items) {
    const enabled = items[asciidoctor.chrome.ENABLE_RENDER_KEY];
    callback(enabled);
  });
}

function isLiveReloadDetected (callback) {
  chrome.storage.local.get(asciidoctor.chrome.LIVERELOADJS_DETECTED_KEY, function (items) {
    const liveReloadJsDetected = items[asciidoctor.chrome.LIVERELOADJS_DETECTED_KEY];
    callback(liveReloadJsDetected);
  });
}

function getMd5sum (key, callback) {
  chrome.storage.local.get(key, function (items) {
    const md5sum = items[key];
    callback(md5sum);
  });
}

function fetchContent () {
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

function reloadContent (data) {
  isLiveReloadDetected(function (liveReloadDetected) {
    // LiveReload.js has been detected
    if (!liveReloadDetected) {
      const key = 'md5' + location.href;
      getMd5sum(key, function (md5sum) {
        if (md5sum && md5sum === md5(data)) {
          return;
        }
        // Content has changed...
        isExtensionEnabled(function (enabled) {
          // Extension is enabled
          if (enabled) {
            // Convert AsciiDoc to HTML
            asciidoctor.chrome.convert(data);
          } else {
            // Display plain content
            $(document.body).html(`<pre style="word-wrap: break-word; white-space: pre-wrap;">${$(document.body).text(data).html()}</pre>`);
          }
          // Update md5sum
          const value = {};
          value[key] = md5(data);
          chrome.storage.local.set(value);
        });
      });
    }
  });
}

let autoReloadInterval;
function startAutoReload () {
  clearInterval(autoReloadInterval);
  autoReloadInterval = setInterval(function () {
    $.ajax({
      beforeSend: function (xhr) {
        if (xhr.overrideMimeType) {
          xhr.overrideMimeType('text/plain;charset=utf-8');
        }
      },
      url: location.href,
      cache: false,
      success: function (data) {
        reloadContent(data);
      }
    });
  }, asciidoctor.chrome.AUTO_RELOAD_INTERVAL_TIME);
}

/**
 * Is the content type html ?
 * @param data The data
 * @return true if the content type is html, false otherwise
 */
function isHtmlContentType (data) {
  const contentType = data.getResponseHeader('Content-Type');
  return contentType && (contentType.indexOf('html') > -1);
}
