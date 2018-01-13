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

class RenderingSettings {
  constructor (customAttributes, safeMode, customScript) {
    this.customAttributes = customAttributes;
    this.safeMode = safeMode || 'secure';
    this.customScript = customScript;
  }
}

class CustomJavaScript {
  constructor (content, loadDirective) {
    this.content = content;
    this.loadDirective = loadDirective || 'after';
  }

  htmlElement () {
    return createScriptElement({
      id: 'asciidoctor-custom-js',
      innerHTML: this.content
    });
  }
}

/**
 * Convert AsciiDoc as HTML
 * @param data
 * @returns {Promise<any>}
 */
asciidoctor.browser.convert = function (data) {
  return asciidoctor.browser.getRenderingSettings()
    .then((settings) => {
      removeElement('mathjax-refresh-js');
      removeElement('asciidoctor-custom-js');

      // Save the scripts that are present at the root of the <body> to be able to restore them after the update
      // QUESTION: Should we remove this code ? Since using livereload and this extension is not recommended!
      const scripts = document.body.querySelectorAll(':scope > script');
      detectLiveReloadJs(scripts);

      const customJavaScript = settings.customScript;
      clearBody();
      preprocessing(customJavaScript);
      updateBody(data, settings, scripts);
      postprocessing(customJavaScript);
    })
    .catch((error) => {
      showErrorMessage(`${error.name} : ${error.message}`);
      // eslint-disable-next-line no-console
      console.error(error.stack);
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
 * Clear <body>
 */
function clearBody () {
  document.body.innerHTML = '';
}

function preprocessing (customJavaScript) {
  if (customJavaScript && customJavaScript.loadDirective === 'before') {
    document.body.appendChild(customJavaScript.htmlElement());
  }
}

function postprocessing (customJavaScript) {
  if (customJavaScript && customJavaScript.loadDirective === 'after') {
    document.body.appendChild(customJavaScript.htmlElement());
  }
}

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
 * @returns {Promise<RenderingSettings>}
 */
asciidoctor.browser.getRenderingSettings = async () => {
  const settings = await getSettings([
    asciidoctor.browser.CUSTOM_ATTRIBUTES_KEY,
    asciidoctor.browser.SAFE_MODE_KEY,
    asciidoctor.browser.JS_KEY,
    asciidoctor.browser.JS_LOAD_KEY]);
  const customJavaScriptName = settings[asciidoctor.browser.JS_KEY];
  const customAttributes = settings[asciidoctor.browser.CUSTOM_ATTRIBUTES_KEY];
  const safeMode = settings[asciidoctor.browser.SAFE_MODE_KEY];
  const customJavaScriptContent = await getCustomScriptContent(customJavaScriptName);
  if (customJavaScriptContent) {
    const customJavaScriptLoadDirective = settings[asciidoctor.browser.JS_LOAD_KEY];
    return new RenderingSettings(
      customAttributes,
      safeMode,
      new CustomJavaScript(customJavaScriptContent, customJavaScriptLoadDirective));
  }
  return new RenderingSettings(
    customAttributes,
    safeMode);
};

const getSettings = (keys) => {
  return new Promise((resolve) => {
    webExtension.storage.local.get(keys, (settings) => {
      resolve(settings);
    });
  });
};

const getCustomScriptContent = (customJavaScriptName) => {
  return new Promise((resolve) => {
    if (customJavaScriptName) {
      asciidoctor.browser.getSetting(asciidoctor.browser.CUSTOM_JS_PREFIX + customJavaScriptName, (customJavaScriptContent) => {
        resolve(customJavaScriptContent);
      });
    } else {
      resolve(undefined);
    }
  });
};

/**
 * Convert the AsciiDoc content to HTML and update the <body>
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

  document.title = asciidoctor.browser.decodeEntities(title);
  document.body.className = doctype;
  if (maxWidth) {
    document.body.style.maxWidth = maxWidth;
  }
  let contentDiv = document.createElement('div');
  contentDiv.id = 'content';
  document.body.appendChild(contentDiv);
  // REMIND: We need to use the html method in order to safely eval <script> (for instance Chartist.js)
  $('#content').html(generatedHtml);

  forceLoadDynamicObjects();
  refreshMathJax();
  appendScripts(scripts);
  syntaxHighlighting();
}

asciidoctor.browser.decodeEntities = function (value) {
  // QUESTION: Should we use a solution that does not rely on DOM ?
  // https://github.com/mathiasbynens/he
  let div = document.createElement('div');
  div.innerHTML = value;
  return div.textContent;
};

asciidoctor.browser.escape = function (value) {
  // QUESTION: Should we use https://lodash.com/docs/4.17.4#escape ?
  let div = document.createElement('div');
  div.textContent = decodeURIComponent(value);
  return div.innerHTML;
};

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
        const escapedValue = asciidoctor.browser.escape(value);
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
  document.body.querySelectorAll('pre.highlight > code').forEach((node) => {
    const match = /language-(\S+)/.exec(node.className);
    if (match !== null && hljs.getLanguage(match[1]) !== null) {
      hljs.highlightBlock(node);
    } else {
      node.className += ' hljs';
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
  appendOnce(document.head, createStyleElement({
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
 * Force dynamic objects to load (iframe, script...)
 */
function forceLoadDynamicObjects () {
  document.body.querySelectorAll('iframe').forEach((node) => {
    node.setAttribute('src', node.getAttribute('src'));
  });
}

/**
 * Show an error message
 * @param message The error message
 */
function showErrorMessage (message) {
  const messageText = `<p>${message}</p>`;
  document.body.innerHTML = `<div id="content"><h4>Error</h4>${messageText}</div>`;
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
 * Create a <style type="text/css"> element.
 * @param attributes
 */
function createStyleElement (attributes) {
  const style = document.createElement('style');
  style.type = 'text/css';
  return Object.assign(style, attributes);
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
