var CUSTOM_ATTRIBUTES_KEY = 'CUSTOM_ATTRIBUTES';
var LIVERELOADJS_DETECTED_KEY = 'LIVERELOADJS_DETECTED';
var LIVERELOADJS_FILENAME = 'livereload.js';

/**
 * Render AsciiDoc content as HTML
 */
var render = function (data) {
    chrome.storage.local.get(CUSTOM_ATTRIBUTES_KEY, function (items) {
        var scripts = $(document.body).find('script');
        detectLiveReloadJs(scripts);
        $(document.body).html('');
        var generatedHtml = undefined;
        try {
            var asciidoctorOptions = buildAsciidoctorOptions(items);
            asciidoctorDocument = Opal.Asciidoctor.$load(data, asciidoctorOptions);
            if (asciidoctorDocument.attributes.map['icons'] == 'font') {
                appendFontAwesomeStyle();
            }
            generatedHtml = asciidoctorDocument.$render();
            console.log('generatedHtml '  + generatedHtml);
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
function buildAsciidoctorOptions(items) {
    var customAttributes = items[CUSTOM_ATTRIBUTES_KEY];
    var defaultAttributes = 'showtitle toc! toc2! icons=font@';
    if (customAttributes) {
        attributes = defaultAttributes.concat(' ').concat(customAttributes);
    } else {
        attributes = defaultAttributes;
    }
    return Opal.hash2([ 'attributes' ], {
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
 * Show error message
 * @param message The error message
 */
function showErrorMessage(message) {
    var messageText = '<p>' + message + '</p>';
    $(document.body).html('<div id="content"><h4>Error</h4>' + messageText + '</div>');
}
