// exports
asciidoctor.browser.renderer = (webExtension, document, Constants, Settings, Dom, Theme) => {
  const processor = Asciidoctor({runtime: {platform: 'browser'}});

  class AsciidoctorDocument {
    constructor (doc, html) {
      this.doc = doc;
      this.html = html;
    }
  }

  const module = {};

  /**
   * Initialize the HTML document
   */
  module.prepare = () => {
    module.appendMathJax();
    module.appendHighlightJsScript();
    Dom.setViewport();
  };

  /**
   * Update the content of the HTML document
   * @param source AsciiDoc source
   * @returns {Promise<boolean>}
   */
  module.update = async (source) => {
    try {
      const settings = await Settings.getRenderingSettings();
      const asciidoctorDocument = module.convert(source, settings);

      Dom.removeElement('mathjax-refresh-js');
      Dom.removeElement('asciidoctor-custom-js');

      // Save the scripts that are present at the root of the <body> to be able to restore them after the update
      // QUESTION: Should we remove this code ? Since using livereload and this extension is not recommended!
      const scripts = document.body.querySelectorAll(':scope > script');
      detectLiveReloadJs(scripts);

      const customJavaScript = settings.customScript;
      clearBody();
      preprocessing(customJavaScript);
      await updateBody(asciidoctorDocument, scripts);
      postprocessing(customJavaScript);
      return true;
    } catch (error) {
      showErrorMessage(`${error.name} : ${error.message}`);
      // eslint-disable-next-line no-console
      console.error(error.stack);
      return false;
    }
  };

  module.convert = (source, settings) => {
    const options = buildAsciidoctorOptions(settings);
    const doc = processor.load(source, options);
    return new AsciidoctorDocument(doc, doc.convert());
  };

  /**
   * Append highlight.js script
   */
  module.appendHighlightJsScript = () => {
    document.head.appendChild(Dom.createScriptElement({
      src: webExtension.extension.getURL('js/vendor/highlight.min.js')
    }));
  };

  /**
   * Append MathJax script
   */
  module.appendMathJax = () => {
    document.head.appendChild(Dom.createScriptElement({
      src: webExtension.extension.getURL('vendor/MathJax/config.js')
    }));
    document.head.appendChild(Dom.createScriptElement({
      src: webExtension.extension.getURL('vendor/MathJax/MathJax.js?config=TeX-MML-AM_HTMLorMML')
    }));
  };

  /**
   * Append styles
   * @param doc
   */
  const appendStyles = (doc) => {
    // Theme
    return Theme.getThemeName(doc)
      .then(appendThemeStyle)
      .then(() => {
        // Highlight
        const highlightTheme = 'github';
        document.head.appendChild(Dom.createStylesheetLinkElement({
          id: `${highlightTheme}-highlight-style`,
          href: webExtension.extension.getURL(`css/highlight/${highlightTheme}.css`)
        }));
      });
  };

  /**
   * Clear <body>
   */
  const clearBody = () => {
    document.body.innerHTML = '';
  };

  /**
   * @param customJavaScript
   */
  const preprocessing = (customJavaScript) => {
    if (customJavaScript && customJavaScript.loadDirective === 'before') {
      document.body.appendChild(Dom.createScriptElement({
        id: 'asciidoctor-custom-js',
        innerHTML: customJavaScript.content
      }));
    }
  };

  /**
   * @param customJavaScript
   */
  const postprocessing = (customJavaScript) => {
    if (customJavaScript && customJavaScript.loadDirective === 'after') {
      document.body.appendChild(Dom.createScriptElement({
        id: 'asciidoctor-custom-js',
        innerHTML: customJavaScript.content
      }));
    }
  };

  const appendThemeStyle = (themeName) => {
    const themeNames = Theme.getDefaultThemeNames();
    // Check if the theme is packaged in the extension... if not it's a custom theme
    if (themeNames.includes(themeName)) {
      Dom.replace(document.head, Dom.createStylesheetLinkElement({
        id: 'asciidoctor-style',
        href: webExtension.extension.getURL(`css/themes/${themeName}.css`)
      }));
    } else {
      Settings.getSetting(Constants.CUSTOM_THEME_PREFIX + themeName, (customThemeContent) => {
        if (customThemeContent) {
          Dom.replace(document.head, Dom.createStyleElement({
            id: 'asciidoctor-style',
            innerHTML: customThemeContent
          }));
        }
      });
    }
  };

  /**
   * Update the HTML document with the Asciidoctor document
   * @param asciidoctorDocument The Asciidoctor document
   * @param scripts The scripts to restore
   */
  const updateBody = async (asciidoctorDocument, scripts) => {
    const doc = asciidoctorDocument.doc;
    if (doc.getAttribute('icons') === 'font') {
      appendFontAwesomeStyle();
    }
    await appendStyles(doc);
    appendChartistStyle();
    appendTwemojiStyle();

    const title = doc.getDoctitle({use_fallback: true});
    const doctype = doc.getDoctype();
    const maxWidth = doc.getAttribute('max-width');

    document.title = Dom.decodeEntities(title);
    document.body.className = doctype;
    if (maxWidth) {
      document.body.style.maxWidth = maxWidth;
    }
    let contentDiv = document.createElement('div');
    contentDiv.id = 'content';
    document.body.appendChild(contentDiv);
    // REMIND: We need to use the html method in order to safely eval <script> (for instance Chartist.js)
    $('#content').html(asciidoctorDocument.html);

    forceLoadDynamicObjects();
    refreshMathJax();
    appendScripts(scripts);
    syntaxHighlighting();
  };

  /**
   * Parse URL query parameters
   */
  const getAttributesFromQueryParameters = () => {
    const query = location.search.substr(1);
    const result = [];
    query.split('&').forEach((part) => {
      // part can be empty
      if (part) {
        const item = part.split('=');
        const key = item[0];
        const value = item[1];
        if (typeof value !== 'undefined') {
          const escapedValue = Dom.escape(value);
          result.push(key.concat('=').concat(escapedValue));
        } else {
          result.push(key);
        }
      }
    });
    return result;
  };

  /**
   * Build Asciidoctor options from settings
   */
  const buildAsciidoctorOptions = (settings) => {
    const attributesQueryParameters = getAttributesFromQueryParameters();
    const customAttributes = settings.customAttributes;
    const safeMode = settings.safeMode;
    // Default attributes
    const attributes = ['showtitle', 'icons=font@', 'platform=opal', 'platform-opal', 'env=browser', 'env-browser', 'chart-engine=chartist', 'data-uri!'];
    const href = window.location.href;
    const fileName = href.split('/').pop();
    let fileExtension = fileName.split('.').pop();
    if (fileExtension !== '') {
      // Remove query parameters
      fileExtension = fileExtension.split('?')[0];
      // Remove fragment identifier
      fileExtension = fileExtension.split('#')[0];
      attributes.push(`outfilesuffix=.${fileExtension}`);
    }
    if (customAttributes) {
      attributes.push(customAttributes);
    }
    if (attributesQueryParameters.length > 0) {
      Array.prototype.push.apply(attributes, attributesQueryParameters);
    }
    return {
      'safe': safeMode,
      // Force backend to html5
      'backend': 'html5',
      // Pass attributes as String
      'attributes': attributes.join(' ')
    };
  };

  /**
   * Detect LiveReload.js script to avoid multiple refreshes
   */
  const detectLiveReloadJs = (scripts) => {
    let liveReloadDetected = false;
    for (let script of scripts) {
      if (script.src.indexOf(Constants.LIVERELOADJS_FILENAME) !== -1) {
        // LiveReload.js detected!
        liveReloadDetected = true;
        break;
      }
    }
    const value = {};
    value[Constants.LIVERELOADJS_DETECTED_KEY] = liveReloadDetected;
    webExtension.storage.local.set(value);
  };

  /**
   * Append saved scripts
   */
  const appendScripts = (scripts) => {
    for (let script of scripts) {
      if (!isMathTexScript(script)) {
        document.body.appendChild(script);
      }
    }
  };

  const isMathTexScript = (script) => {
    return /math\/tex/i.test(script.type);
  };

  /**
   * Syntax highlighting
   */
  const syntaxHighlighting = () => {
    document.body.querySelectorAll('pre.highlight > code').forEach((node) => {
      const match = /language-(\S+)/.exec(node.className);
      if (match !== null && hljs.getLanguage(match[1]) !== null) {
        hljs.highlightBlock(node);
      } else {
        node.className += ' hljs';
      }
    });
  };

  /**
   *
   */
  const appendTwemojiStyle = () => {
    Dom.appendOnce(document.head, Dom.createStylesheetLinkElement({
      id: 'twemoji-awesome-style',
      href: webExtension.extension.getURL('css/twemoji-awesome.css')
    }));
  };

  /**
   *
   */
  const appendChartistStyle = () => {
    Dom.appendOnce(document.head, Dom.createStylesheetLinkElement({
      id: 'chartist-style',
      href: webExtension.extension.getURL('css/chartist.min.css')
    }));
    Dom.appendOnce(document.head, Dom.createStyleElement({
      id: 'chartist-asciidoctor-style',
      innerHTML: '.ct-chart .ct-series.ct-series-a .ct-line {stroke:#8EB33B} .ct-chart .ct-series.ct-series-b .ct-line {stroke:#72B3CC} .ct-chart .ct-series.ct-series-a .ct-point {stroke:#8EB33B} .ct-chart .ct-series.ct-series-b .ct-point {stroke:#72B3CC}'
    }));
  };

  /**
   *
   */
  const appendFontAwesomeStyle = () => {
    Dom.appendOnce(document.head, Dom.createStylesheetLinkElement({
      id: 'font-awesome-style',
      href: webExtension.extension.getURL('css/font-awesome.min.css')
    }));
  };

  /**
   *
   */
  const refreshMathJax = () => {
    document.body.appendChild(Dom.createScriptElement({
      id: 'mathjax-refresh-js',
      innerHTML: 'if (window.MathJax && window.MathJax.Hub) { window.MathJax.Hub.Typeset(); }'
    }));
  };

  /**
   * Force dynamic objects to load (iframe, script...)
   */
  const forceLoadDynamicObjects = () => {
    document.body.querySelectorAll('iframe').forEach((node) => {
      node.setAttribute('src', node.getAttribute('src'));
    });
  };

  /**
   * Show an error message
   * @param message The error message
   */
  const showErrorMessage = (message) => {
    const messageText = `<p>${message}</p>`;
    document.body.innerHTML = `<div id="content"><h4>Error</h4>${messageText}</div>`;
  };

  return module;
};
