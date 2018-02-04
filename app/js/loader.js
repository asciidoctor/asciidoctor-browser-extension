asciidoctor.browser.loader = (webExtension, document, location, Settings, Renderer) => {
  const AUTO_RELOAD_INTERVAL_TIME = 2000;

  const module = {};

  module.load = () => {
    const txtExtensionRegex = /\.txt[.|?]?.*?$/;
    if (location.href.match(txtExtensionRegex)) {
      Settings.isTxtExtAllowed((allowed) => {
        // Extension allows txt extension
        if (allowed) {
          fetchContent();
        }
      });
    } else {
      fetchContent();
    }
  };

  module.loadContent = (request) => {
    Settings.isExtensionEnabled((enabled) => {
      // Extension is enabled
      if (enabled) {
        Renderer.appendMathJax();
        Renderer.appendHighlightJsScript();
        Renderer.update(request.responseText);
      }
      startAutoReload();
    });
  };

  const fetchContent = () => {
    $.ajax({
      url: location.href,
      cache: false,
      complete: (request) => {
        if (isHtmlContentType(request)) {
          return;
        }
        module.loadContent(request);
      }
    });
  };

  const reloadContent = (source) => {
    Settings.isLiveReloadDetected((liveReloadDetected) => {
      // LiveReload.js has been detected
      if (!liveReloadDetected) {
        const key = 'md5' + location.href;
        Settings.getMd5sum(key, (md5sum) => {
          if (md5sum && md5sum === md5(source)) {
            return;
          }
          // Content has changed...
          isExtensionEnabled((enabled) => {
            // Extension is enabled
            if (enabled) {
              // Update the content
              Renderer.update(source);
            } else {
              // Display plain content
              document.body.innerHTML = '';
              const preElement = document.createElement('pre');
              preElement.style = 'word-wrap: break-word; white-space: pre-wrap;';
              preElement.innerText = source;
              document.body.appendChild(preElement);
            }
            // Update md5sum
            const value = {};
            value[key] = md5(source);
            webExtension.storage.local.set(value);
          });
        });
      }
    });
  };

  let autoReloadInterval;

  const startAutoReload = () => {
    clearInterval(autoReloadInterval);
    autoReloadInterval = setInterval(() => {
      $.ajax({
        beforeSend: (xhr) => {
          if (xhr.overrideMimeType) {
            xhr.overrideMimeType('text/plain;charset=utf-8');
          }
        },
        url: location.href,
        cache: false,
        success: (source) => {
          reloadContent(source);
        }
      });
    }, AUTO_RELOAD_INTERVAL_TIME);
  };

  /**
   * Is the content type html ?
   * @param request The request
   * @return true if the content type is html, false otherwise
   */
  const isHtmlContentType = (request) => {
    const contentType = request.getResponseHeader('Content-Type');
    return contentType && (contentType.indexOf('html') > -1);
  };

  return module;
};
