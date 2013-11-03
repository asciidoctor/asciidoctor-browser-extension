(function (document) {

    var autoReloadInterval;
    var AUTO_RELOAD_INTERVAL_TIME = 2000;
    var ENABLE_RENDER_KEY = 'ENABLE_RENDER';
    var CUSTOM_ATTRIBUTES_KEY = 'CUSTOM_ATTRIBUTES';
    var THEME_KEY = 'THEME';
    var LIVERELOADJS_DETECTED_KEY = 'LIVERELOADJS_DETECTED';
    var LIVERELOADJS_FILENAME = "livereload.js";

    /**
     * AsciiDocify the content!
     */
    function asciidocify() {
        $.ajax({
            url:location.href,
            cache:false,
            complete:function (data) {
                loadContent(data);
            }
        });
    }

    function loadContent(data) {
        if (isHtmlContentType(data)) {
            return;
        }
        chrome.storage.local.get(ENABLE_RENDER_KEY, function (items) {
            var enabled = items[ENABLE_RENDER_KEY];
            // Extension is enabled
            if (enabled) {
                appendStyles();
                appendHighlightJsScript();
                render(document.body.innerText);
            }
            startAutoReload();
        });
    }

    function reloadContent(data) {
        chrome.storage.local.get(LIVERELOADJS_DETECTED_KEY, function (items) {
            var liveReloadJsDetected = items[LIVERELOADJS_DETECTED_KEY];
            // LiveReload.js has been detected
            if (!liveReloadJsDetected) {
                var key = 'md5' + location.href;
                chrome.storage.local.get(key, function (items) {
                    var md5sum = items[key];
                    if (md5sum && md5sum == md5(data)) {
                        return;
                    }
                    // Content has changed...
                    chrome.storage.local.get(ENABLE_RENDER_KEY, function (items) {
                        var enabled = items[ENABLE_RENDER_KEY];
                        // Extension is enabled
                        if (enabled) {
                            // Render Asciidoc in html
                            render(data);
                        } else {
                            // Display plain content
                            $(document.body).html("<pre style='word-wrap: break-word; white-space: pre-wrap;'>" + $(document.body).text(data).html() + "</pre>");
                        }
                        // Update md5sum
                        var value = {};
                        value[key] = md5(data);
                        chrome.storage.local.set(value);
                    });
                });
            }
        });
    }

    function startAutoReload() {
        clearInterval(autoReloadInterval);
        autoReloadInterval = setInterval(function () {
            $.ajax({
                url:location.href,
                cache:false,
                success:function (data) {
                    reloadContent(data);
                }
            });
        }, AUTO_RELOAD_INTERVAL_TIME);
    }

    /**
     * Is the content type html ?
     * @param data The data
     * @return true if the content type is html, false otherwise
     */
    function isHtmlContentType(data) {
        var contentType = data.getResponseHeader('Content-Type');
        return contentType && (contentType.indexOf('html') > -1);
    }

    /**
     * Render AsciiDoc content as HTML
     */
    function render(data) {
        chrome.storage.local.get(CUSTOM_ATTRIBUTES_KEY, function (items) {
            var scripts = $(document.body).find("script");
            detectLiveReloadJs(scripts);
            $(document.body).html('');
            var generatedHtml = undefined;
            try {
                var asciidoctorOptions = buildAsciidoctorOptions(items);
                generatedHtml = Opal.Asciidoctor.$render(data, asciidoctorOptions);
            }
            catch (e) {
                showErrorMessage(e.name + " : " + e.message);
                return;
            }
            $(document.body).html("<div id='content'>" + generatedHtml + "</div>");
            appendScripts(scripts);
            syntaxHighlighting();
        });
    }

    /**
     * Build Asciidoctor options
     */
    function buildAsciidoctorOptions(items) {
        var customAttributes = items[CUSTOM_ATTRIBUTES_KEY];
        var defaultAttributes = "notitle!";
        if (customAttributes) {
            attributes = defaultAttributes.concat(" ").concat(customAttributes);
        } else {
            attributes = defaultAttributes;
        }
        return Opal.hash2([ 'attributes' ], {
            'attributes': attributes.split(/[ ]+/)
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
        chrome.storage.local.get(THEME_KEY, function (items) {
            var theme = items[THEME_KEY];
            console.log("theme !");
            if (!theme) {
                // Default theme
                theme = "asciidoctor";
            }
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
        var messageText = "<p>" + message + "</p>";
        $(document.body).html("<div id='content'><h4>Error</h4>" + messageText + "</div>");
    }

    asciidocify();

}(document));
