asciidoctor.browser.loader = (webExtension, document, location, Settings, Renderer) => {
  const module = {};

  webExtension.runtime.onMessage.addListener(function handleMessage (message, sender) {
    if (sender.id === webExtension.runtime.id) {
      if (message.status === 'extension-enabled') {
        module.load();
      } else if (message.status === 'extension-disabled') {
        unloadExtension();
      }
    }
  });

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

  const executeRequest = (url) => new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    if (request.overrideMimeType) {
      request.overrideMimeType('text/plain;charset=utf-8');
    }
    request.onreadystatechange = (event) => {
      // XMLHttpRequest.DONE === 4
      if (request.readyState === XMLHttpRequest.DONE) {
        if (request.status === 200 || request.status === 0) {
          resolve(request);
          return;
        }
        reject(request);
      }
    };
    // disable cache
    request.open('GET', `${url}?_=${new Date().getTime()}`, true);
    request.send(null);
  });

  const unloadExtension = async () => {
    clearInterval(autoReloadInterval);
    const request = await executeRequest(location.href);
    if (isHtmlContentType(request)) {
      return;
    }
    displayContentAsPlainText(request.responseText);
  };

  /**
   * Display content as plain text.
   * @param text
   */
  const displayContentAsPlainText = (text) => {
    const preElement = document.createElement('pre');
    preElement.style = 'word-wrap: break-word; white-space: pre-wrap;';
    preElement.innerText = text;
    document.head.innerHTML = '';
    document.body.className = '';
    document.body.innerHTML = '';
    document.body.appendChild(preElement);
  };

  const fetchContent = async () => {
    // Check if the content is available before using an AJAX query
    if (document.body.getElementsByClassName('pre').length === 1 && document.body.childNodes.length === 1) {
      Renderer.prepare();
      Renderer.update(document.body.getElementsByClassName('pre')[0].innerText);
    } else {
      const request = await getRequest(location.href);
      if (isHtmlContentType(request)) {
        return;
      }
      module.loadContent(request);
    }
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
        Renderer.update(source);
      } else {
        displayContentAsPlainText(source);
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
    autoReloadInterval = setInterval(async () => {
      const request = await executeRequest(location.href);
      reloadContent(request.responseText);
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
