var Processor = {};

var CUSTOM_ATTRIBUTES_KEY = 'CUSTOM_ATTRIBUTES';
var SAFE_MODE_KEY = 'SAFE_MODE';
var LIVERELOADJS_DETECTED_KEY = 'LIVERELOADJS_DETECTED';
var LIVERELOADJS_FILENAME = 'livereload.js';
var THEME_KEY = 'THEME';

/**
 * Render AsciiDoc content as HTML
 */
var render = function (data) {
  chrome.storage.local.get([CUSTOM_ATTRIBUTES_KEY, SAFE_MODE_KEY], function (settings) {
    $('#mathjax-refresh-js').remove();
    var scripts = $(document.body).find('script');
    detectLiveReloadJs(scripts);
    $(document.body).html('');
    var generatedHtml = undefined;
    var documentTitle = undefined;
    try {
      var asciidoctorOptions = buildAsciidoctorOptions(settings);
      asciidoctorDocument = Opal.Asciidoctor.$load(data, asciidoctorOptions);
      if (asciidoctorDocument.attributes.map['icons'] == 'font') {
        appendFontAwesomeStyle();
      }
      documentTitle = asciidoctorDocument.$doctitle(Opal.hash2(['sanitize'], {sanitize:true}));
      generatedHtml = asciidoctorDocument.$render();
    }
    catch (e) {
      showErrorMessage(e.name + ' : ' + e.message);
      console.error(e.stack);
      return;
    }
    document.title = documentTitle;
    $(document.body).html('<div id="content">' + generatedHtml + '</div>');
    refreshMathJax();
    appendScripts(scripts);
    syntaxHighlighting();
  });
};

/**
 * Build Asciidoctor options
 */
function buildAsciidoctorOptions(settings) {
  var customAttributes = settings[CUSTOM_ATTRIBUTES_KEY];
  var safeMode = settings[SAFE_MODE_KEY] || 'secure';
  // default attributes
  var attributes = 'showtitle icons=font@ platform=opal platform-opal env=browser env-browser';
  var href = window.location.href;
  var fileName = href.split('/').pop();
  var fileExtension = fileName.split('.').pop();
  if (fileExtension !== '') {
    attributes = attributes.concat(' ').concat('outfilesuffix=.').concat(fileExtension);
  }
  if (customAttributes) {
    attributes = attributes.concat(' ').concat(customAttributes);
  }
  var pwd = Opal.File.$dirname(href);
  Opal.ENV['$[]=']("PWD", pwd);
  return Opal.hash2(['base_dir', 'safe', 'attributes'], {
    'base_dir':pwd,
    'safe':safeMode,
    'attributes':attributes
  });
}

/**
 * Detect LiveReload.js script to avoid multiple refreshes
 */
function detectLiveReloadJs(scripts) {
  var length = scripts.length,
      script = null;
  var liveReloadDetected = false;
  for (var i = 0; i < length; i++) {
    script = scripts[i];
    if (script.src.indexOf(LIVERELOADJS_FILENAME) != -1) {
      // LiveReload.js detected!
      liveReloadDetected = true;
      break;
    }
  }
  var value = {};
  value[LIVERELOADJS_DETECTED_KEY] = liveReloadDetected;
  chrome.storage.local.set(value);
}

/**
 * Append saved scripts
 */
function appendScripts(scripts) {
  var length = scripts.length;
  for (var i = 0; i < length; i++) {
    var script = scripts[i];
    if (!isMathTexScript(script)) {
      document.body.appendChild(script);
    }
  }
}

function isMathTexScript(script) {
  return /math\/tex/i.test(script.type)
}

/**
 * Syntax highlighting
 */
function syntaxHighlighting() {
  $('pre.highlight > code').each(function (i, e) {
    if ((match = /language-(\S+)/.exec(e.className)) != null && hljs.getLanguage(match[1]) != null) {
      hljs.highlightBlock(e);
    }
    else {
      e.className += ' hljs';
    }
  });
}


function appendFontAwesomeStyle() {
  if ($('#font-awesome-style').length == 0) {
    var fontAwesomeLink = document.createElement('link');
    fontAwesomeLink.rel = 'stylesheet';
    fontAwesomeLink.id = 'font-awesome-style';
    fontAwesomeLink.href = chrome.extension.getURL('css/font-awesome.min.css');
    document.head.appendChild(fontAwesomeLink);
  }
}

/**
 * Append highlight.js script
 */
function appendHighlightJsScript() {
  var highlightJsScript = document.createElement('script');
  highlightJsScript.type = 'text/javascript';
  highlightJsScript.src = chrome.extension.getURL('js/highlight.min.js');
  document.head.appendChild(highlightJsScript);
}

/**
 * Append css files
 */
function appendStyles() {
  // Theme
  chrome.storage.local.get(THEME_KEY, function (settings) {
    var theme = settings[THEME_KEY] || 'asciidoctor';
    var themeLink = document.createElement('link');
    themeLink.rel = 'stylesheet';
    themeLink.id = 'asciidoctor-style';
    themeLink.href = chrome.extension.getURL('css/themes/' + theme + '.css');
    document.head.appendChild(themeLink);
  });
  // Highlight
  var highlightTheme = 'default';
  var highlightStylesheetLink = document.createElement('link');
  highlightStylesheetLink.rel = 'stylesheet';
  highlightStylesheetLink.id = highlightTheme + '-highlight-style';
  highlightStylesheetLink.href = chrome.extension.getURL('css/' + highlightTheme + '.min.css');
  document.head.appendChild(highlightStylesheetLink);
  // Google Fonts
  var googleFontsStylesheetLink = document.createElement('link');
  googleFontsStylesheetLink.rel = 'stylesheet';
  googleFontsStylesheetLink.href = 'https://fonts.googleapis.com/css?family=Open+Sans:300,300italic,400,400italic,600,600italic|Noto+Serif:400,400italic,700,700italic|Droid+Sans+Mono:400';
  document.head.appendChild(googleFontsStylesheetLink);
}

function appendMathJax() {
  var mathJaxJsScriptConfig = document.createElement('script');
  mathJaxJsScriptConfig.type = 'text/x-mathjax-config';
  mathJaxJsScriptConfig.text =
      'MathJax.Hub.Config({' +
          '  tex2jax: {' +
          '    inlineMath: [["\\\\(", "\\\\)"]],' +
          '    displayMath: [["\\\\[", "\\\\]"]],' +
          '    ignoreClass: "nostem|nostem|nolatexmath"' +
          '  },' +
          '  asciimath2jax: {' +
          '    delimiters: [["\\\\$", "\\\\$"]],' +
          '    ignoreClass: "nostem|nostem|noasciimath"' +
          '  }' +
          '});';
  document.head.appendChild(mathJaxJsScriptConfig);

  var mathJaxJsScript = document.createElement('script');
  mathJaxJsScript.type = 'text/javascript';
  mathJaxJsScript.src = 'https://cdnjs.cloudflare.com/ajax/libs/mathjax/2.4.0/MathJax.js?config=TeX-MML-AM_HTMLorMML';
  document.head.appendChild(mathJaxJsScript);
}

function refreshMathJax() {
  var mathJaxJsScript = document.createElement('script');
  mathJaxJsScript.id = 'mathjax-refresh-js';
  mathJaxJsScript.text =
      'if (window.MathJax) {' +
          '  window.MathJax.Hub.Typeset();' +
          '}';
  document.body.appendChild(mathJaxJsScript);
}

/**
 * Show error message
 * @param message The error message
 */
function showErrorMessage(message) {
  var messageText = '<p>' + message + '</p>';
  $(document.body).html('<div id="content"><h4>Error</h4>' + messageText + '</div>');
}
