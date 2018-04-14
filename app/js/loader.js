asciidoctor.browser.loader = (webExtension, document, location, Settings, Renderer) => {
  const module = {};

  module.load = async () => {
    const txtExtensionRegex = /\.txt[.|?]?.*?$/;
    if (location.href.match(txtExtensionRegex)) {
      // .txt extension should be allowed ?
      if (await Settings.isTxtExtAllowed()) {
        fetchContent();
      }
    } else {
      fetchContent();
    }
  };

  module.loadContent = async (request) => {
    // Extension is enabled ?
    if (await Settings.isExtensionEnabled()) {
      Renderer.prepare();
      Renderer.update(request.responseText);
    }
    startAutoReload();
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

  const reloadContent = async (source) => {
    const liveReloadDetected = await Settings.isLiveReloadDetected();
    // LiveReload.js has been detected
    if (!liveReloadDetected) {
      const md5key = 'md5' + location.href;
      const md5sum = await Settings.getSetting(md5key);
      if (md5sum && md5sum === md5(source)) {
        return;
      }
      // Content has changed...
      if (await Settings.isExtensionEnabled()) {
        // Update the content
        Renderer.update(source);
      } else {
        // Display the content in plain text
        document.body.innerHTML = '';
        const preElement = document.createElement('pre');
        preElement.style = 'word-wrap: break-word; white-space: pre-wrap;';
        preElement.innerText = source;
        document.body.appendChild(preElement);
      }
      // Update md5sum
      const value = {};
      value[md5key] = md5(source);
      webExtension.storage.local.set(value);
    }
  };

  let autoReloadInterval;

  const startAutoReload = async () => {
    const href = location.href;
    const remoteFile = (href.startsWith('http://') || href.startsWith('https://'));
    const pollFrequency = remoteFile ? await Settings.getRemotePollFrequency() : await Settings.getLocalPollFrequency();
    clearInterval(autoReloadInterval);
    if (pollFrequency === 0) {
      // Poll is disabled!
      return;
    }
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
    }, pollFrequency * 1000);
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
