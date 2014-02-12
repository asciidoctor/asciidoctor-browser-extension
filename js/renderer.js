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
        var scripts = $(document.body).find('script');
        detectLiveReloadJs(scripts);
        $(document.body).html('');
        var generatedHtml = undefined;
        try {
            var asciidoctorOptions = buildAsciidoctorOptions(settings);
            asciidoctorDocument = Opal.Asciidoctor.$load(data, asciidoctorOptions);
            if (asciidoctorDocument.attributes.map['icons'] == 'font') {
                appendFontAwesomeStyle();
            }
            generatedHtml = asciidoctorDocument.$render();
        }
        catch (e) {
            showErrorMessage(e.name + ' : ' + e.message);
            return;
        }
        $(document.body).html('<div id="content">' + generatedHtml + '</div>');
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
    var defaultAttributes = 'showtitle toc! toc2! icons=font@';
    if (customAttributes) {
        attributes = defaultAttributes.concat(' ').concat(customAttributes);
    } else {
        attributes = defaultAttributes;
    }
    // prevent include directives from being processed regardless of safe mode for now
    attributes = attributes.concat(' max-include-depth=0');
    return Opal.hash2(['base_dir', 'safe', 'attributes'], {
        'base_dir': window.location.href.replace(/\/[^\/]+$/, ''),
        'safe': safeMode,
        'attributes': attributes
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
        document.body.appendChild(scripts[i]);
    }
}

/**
 * Syntax highlighting
 */
function syntaxHighlighting() {
    $('pre > code').each(function (i, e) {
        hljs.highlightBlock(e);
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
    chrome.storage.local.get(THEME_KEY, function (settings) {
        var theme = settings[THEME_KEY] || 'asciidoctor';
        var themeLink = document.createElement('link');
        themeLink.rel = 'stylesheet';
        themeLink.id = 'asciidoctor-style';
        themeLink.href = chrome.extension.getURL('css/themes/' + theme + '.css');
        document.head.appendChild(themeLink);
    });
    var githubHighlightLink = document.createElement('link');
    githubHighlightLink.rel = 'stylesheet';
    githubHighlightLink.id = 'github-highlight-style';
    githubHighlightLink.href = chrome.extension.getURL('css/github.min.css');
    document.head.appendChild(githubHighlightLink);
}

/**
 * Show error message
 * @param message The error message
 */
function showErrorMessage(message) {
    var messageText = '<p>' + message + '</p>';
    $(document.body).html('<div id="content"><h4>Error</h4>' + messageText + '</div>');
}
