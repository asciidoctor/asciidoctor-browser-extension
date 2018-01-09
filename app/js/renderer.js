// Namespace
const processor = Asciidoctor({runtime: {platform: 'browser'}});

asciidoctor.browser.CUSTOM_ATTRIBUTES_KEY = 'CUSTOM_ATTRIBUTES';
asciidoctor.browser.SAFE_MODE_KEY = 'SAFE_MODE';
asciidoctor.browser.LIVERELOADJS_DETECTED_KEY = 'LIVERELOADJS_DETECTED';
asciidoctor.browser.LIVERELOADJS_FILENAME = 'livereload.js';
asciidoctor.browser.THEME_KEY = 'THEME';
asciidoctor.browser.CUSTOM_THEME_PREFIX = 'CUSTOM_THEME_';
asciidoctor.browser.CUSTOM_JS_PREFIX = 'CUSTOM_JS_';
asciidoctor.browser.JS_KEY = 'JS';
asciidoctor.browser.JS_LOAD_KEY = 'JS_LOAD';

/**
 * Convert AsciiDoc as HTML
 */
asciidoctor.browser.convert = function (data, callback) {
  getRenderingSettings(function (settings) {
    try {
      removeElement('mathjax-refresh-js');
      removeElement('asciidoctor-custom-js');

      const body = $(document.body);
      // Save scripts
      const scripts = body.find('script');

      detectLiveReloadJs(scripts);

      // Clear <body>
      body.html('<div id="content"></div>');

      if (settings.customJavaScriptContent) {
        const customJavaScript = createScriptElement({
          id: 'asciidoctor-custom-js',
          innerHTML: settings.customJavaScriptContent
        });
        if (settings.loadCustomJavaScript === 'before') {
          // Load the custom JavaScript...
          body.append(customJavaScript);
          // ... then update <body>
          updateBody(data, settings, scripts);
        } else {
          // Update <body>
          updateBody(data, settings, scripts);
          // ... then load the custom JavaScript
          body.append(customJavaScript);
        }
      } else {
        // No custom JavaScript defined, update <body>
        updateBody(data, settings, scripts);
      }
    } catch (e) {
      showErrorMessage(`${e.name} : ${e.message}`);
      // eslint-disable-next-line no-console
      console.error(e.stack);
    }
    typeof callback === 'function' && callback();
  });
};

/**
 * Append highlight.js script
 */
asciidoctor.browser.appendHighlightJsScript = function () {
  document.head.appendChild(createScriptElement({
    src: webExtension.extension.getURL('js/vendor/highlight.min.js')
  }));
};

/**
 * Append css files
 */
asciidoctor.browser.appendStyles = function () {
  // Theme
  getThemeNameFromSettings(function (themeName) {
    const themeNames = getDefaultThemeNames();
    // Check if the theme is packaged in the extension... if not it's a custom theme
    if (themeNames.includes(themeName)) {
      replace(document.head, createStylesheetLinkElement({
        id: 'asciidoctor-style',
        href: webExtension.extension.getURL(`css/themes/${themeName}.css`)
      }));
    } else {
      asciidoctor.browser.getSetting(asciidoctor.browser.CUSTOM_THEME_PREFIX + themeName, function (customThemeContent) {
        if (customThemeContent) {
          replace(document.head, createStylesheetLinkElement({
            id: 'asciidoctor-style',
            innerHTML: customThemeContent
          }));
        }
      });
    }
  });
  // Highlight
  const highlightTheme = 'github';
  document.head.appendChild(createStylesheetLinkElement({
    id: `${highlightTheme}-highlight-style`,
    href: webExtension.extension.getURL(`css/highlight/${highlightTheme}.css`)
  }));
};

/**
 * Append MathJax script
 */
asciidoctor.browser.appendMathJax = function () {
  document.head.appendChild(createScriptElement({
    src: webExtension.extension.getURL('vendor/MathJax/config.js')
  }));
  document.head.appendChild(createScriptElement({
    src: webExtension.extension.getURL('vendor/MathJax/MathJax.js?config=TeX-MML-AM_HTMLorMML')
  }));
};

/**
 * Get theme name from the settings.
 */
function getThemeNameFromSettings (callback) {
  webExtension.storage.local.get(asciidoctor.browser.THEME_KEY, function (settings) {
    const theme = settings[asciidoctor.browser.THEME_KEY] || 'asciidoctor';
    callback(theme);
  });
}

/**
 * Get user's rendering settings defined in the options page.
 */
function getRenderingSettings (callback) {
  webExtension.storage.local.get([
    asciidoctor.browser.CUSTOM_ATTRIBUTES_KEY,
    asciidoctor.browser.SAFE_MODE_KEY,
    asciidoctor.browser.JS_KEY,
    asciidoctor.browser.JS_LOAD_KEY], function (settings) {
    const result = {
      customAttributes: settings[asciidoctor.browser.CUSTOM_ATTRIBUTES_KEY],
      safeMode: settings[asciidoctor.browser.SAFE_MODE_KEY] || 'secure',
      customJavaScriptName: settings[asciidoctor.browser.JS_KEY],
      loadCustomJavaScript: settings[asciidoctor.browser.JS_LOAD_KEY]
    };
    if (result.customJavaScriptName) {
      asciidoctor.browser.getSetting(asciidoctor.browser.CUSTOM_JS_PREFIX + result.customJavaScriptName, function (customJavaScriptContent) {
        result.customJavaScriptContent = customJavaScriptContent;
        callback(result);
      });
    } else {
      callback(result);
    }
  });
}

/**
 * Update the <body> with the generated HTML
 */
function updateBody (data, settings, scripts) {
  const options = buildAsciidoctorOptions(settings);
  const doc = processor.load(data, options);
  if (doc.getAttribute('icons') === 'font') {
    appendFontAwesomeStyle();
  }
  appendChartistStyle();
  appendTwemojiStyle();
  const title = doc.getDoctitle({use_fallback: true});
  const doctype = doc.getDoctype();
  const maxWidth = doc.getAttribute('max-width');
  const generatedHtml = doc.convert();
  document.title = $(document.createElement('div')).html(title).text();
  document.body.className = doctype;
  if (maxWidth) {
    document.body.style.maxWidth = maxWidth;
  }
  $('#content').html(generatedHtml);
  forceLoadDynamicObjects();
  refreshMathJax();
  appendScripts(scripts);
  syntaxHighlighting();
}

/**
 * Parse URL query parameters
 */
function getAttributesFromQueryParameters () {
  const query = location.search.substr(1);
  const result = [];
  query.split('&').forEach(function (part) {
    // part can be empty
    if (part) {
      const item = part.split('=');
      const key = item[0];
      const value = item[1];
      if (typeof value !== 'undefined') {
        const escapedValue = $('<div/>').text(decodeURIComponent(value)).html();
        result.push(key.concat('=').concat(escapedValue));
      } else {
        result.push(key);
      }
    }
  });
  return result;
}

/**
 * Build Asciidoctor options from settings
 */
function buildAsciidoctorOptions (settings) {
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
}

/**
 * Detect LiveReload.js script to avoid multiple refreshes
 */
function detectLiveReloadJs (scripts) {
  let liveReloadDetected = false;
  for (let script of scripts) {
    if (script.src.indexOf(asciidoctor.browser.LIVERELOADJS_FILENAME) !== -1) {
      // LiveReload.js detected!
      liveReloadDetected = true;
      break;
    }
  }
  const value = {};
  value[asciidoctor.browser.LIVERELOADJS_DETECTED_KEY] = liveReloadDetected;
  webExtension.storage.local.set(value);
}

/**
 * Append saved scripts
 */
function appendScripts (scripts) {
  for (let script of scripts) {
    if (!isMathTexScript(script)) {
      document.body.appendChild(script);
    }
  }
}

function isMathTexScript (script) {
  return /math\/tex/i.test(script.type);
}

/**
 * Syntax highlighting
 */
function syntaxHighlighting () {
  $('pre.highlight > code').each(function (i, e) {
    const match = /language-(\S+)/.exec(e.className);
    if (match !== null && hljs.getLanguage(match[1]) !== null) {
      hljs.highlightBlock(e);
    } else {
      e.className += ' hljs';
    }
  });
}

function appendTwemojiStyle () {
  appendOnce(document.head, createStylesheetLinkElement({
    id: 'twemoji-awesome-style',
    href: webExtension.extension.getURL('css/twemoji-awesome.css')
  }));
}

function appendChartistStyle () {
  appendOnce(document.head, createStylesheetLinkElement({
    id: 'chartist-style',
    href: webExtension.extension.getURL('css/chartist.min.css')
  }));
  appendOnce(document.head, createStylesheetLinkElement({
    id: 'chartist-asciidoctor-style',
    innerHTML: '.ct-chart .ct-series.ct-series-a .ct-line {stroke:#8EB33B} .ct-chart .ct-series.ct-series-b .ct-line {stroke:#72B3CC} .ct-chart .ct-series.ct-series-a .ct-point {stroke:#8EB33B} .ct-chart .ct-series.ct-series-b .ct-point {stroke:#72B3CC}'
  }));
}

function appendFontAwesomeStyle () {
  appendOnce(document.head, createStylesheetLinkElement({
    id: 'font-awesome-style',
    href: webExtension.extension.getURL('css/font-awesome.min.css')
  }));
}

function getDefaultThemeNames () {
  const webAccessibleResources = webExtension.runtime.getManifest().web_accessible_resources;
  const themeRegexp = /^css\/themes\/(.*)\.css$/i;
  return webAccessibleResources
    .filter(item => themeRegexp.test(item))
    .map(item => item.replace(themeRegexp, '$1'));
}

function refreshMathJax () {
  document.body.appendChild(createScriptElement({
    id: 'mathjax-refresh-js',
    innerHTML: 'if (window.MathJax && window.MathJax.Hub) { window.MathJax.Hub.Typeset(); }'
  }));
}

/**
 * Force dynamic objects to be loaded (iframe, script...)
 */
function forceLoadDynamicObjects () {
  // Force iframe to be load
  $('iframe').each(function () {
    $(this).attr('src', $(this).attr('src'));
  });
}

/**
 * Show an error message
 * @param message The error message
 */
function showErrorMessage (message) {
  const messageText = `<p>${message}</p>`;
  $(document.body).html(`<div id="content"><h4>Error</h4>${messageText}</div>`);
}

// DOM

/**
 * Append a child element to the parent if the child element does not exist in the document.
 * @param parent The parent element
 * @param childElement The child element
 */
function appendOnce (parent, childElement) {
  if (document.getElementById(childElement.id) === null) {
    parent.appendChild(childElement);
  }
}

/**
 * Replace the child element in the document.
 * Effectively removing and then appending the child to the parent in the document.
 * @param parent
 * @param childElement
 */
function replace (parent, childElement) {
  removeElement(childElement.id);
  parent.appendChild(childElement);
}

/**
 * Remove a element by id from the document.
 * @param id The element's id
 */
function removeElement (id) {
  const element = document.getElementById(id);
  if (element) {
    element.parentNode.removeChild(element);
  }
}

/**
 * Create a <link rel="stylesheet"> element.
 * @param attributes The element's attributes
 * @returns {HTMLLinkElement}
 */
function createStylesheetLinkElement (attributes) {
  const stylesheetLink = document.createElement('link');
  stylesheetLink.rel = 'stylesheet';
  return Object.assign(stylesheetLink, attributes);
}

/**
 * Create a <script type="text/javascript"> element.
 * @param attributes The element's attributes
 * @returns {HTMLScriptElement}
 */
function createScriptElement (attributes) {
  const scriptElement = document.createElement('script');
  scriptElement.type = 'text/javascript';
  return Object.assign(scriptElement, attributes);
}
