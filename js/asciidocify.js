(function (document) {

    var ENABLE_RENDER_KEY = 'ENABLE_RENDER';

    var ASCIIDOCTOR_OPTIONS = Opal.hash2([ 'attributes' ], {
        'attributes':[ 'notitle!' ]
    });

    /**
     * AsciiDocify the content!
     */
    function asciidocify() {
        $.ajax({
            url:location.href,
            cache:false,
            complete:function (xhr) {
                chrome.storage.local.get(ENABLE_RENDER_KEY, function (items) {
                    var enabled = items[ENABLE_RENDER_KEY];
                    if (enabled) {
                        var contentType = xhr.getResponseHeader('Content-Type');
                        if (contentType && (contentType.indexOf('html') > -1)) {
                            return;
                        }
                        render();
                    }
                });
            }
        });
    }

    /**
     * Append css files
     */
    function appendStyles() {
        var bootstrapLink = document.createElement('link');
        bootstrapLink.rel = 'stylesheet';
        bootstrapLink.id = 'bootstrap-style';
        bootstrapLink.href = chrome.extension.getURL('css/bootstrap.min.css');
        document.head.appendChild(bootstrapLink);

        var asciidoctorLink = document.createElement('link');
        asciidoctorLink.rel = 'stylesheet';
        asciidoctorLink.id = 'asciidoctor-style';
        asciidoctorLink.href = chrome.extension.getURL('css/asciidoctor.css');
        document.head.appendChild(asciidoctorLink);
    }

    /**
     * Render AsciiDoc content as HTML
     */
    function render() {
        appendStyles();
        var data = document.body.innerText;
        $(document.body).html('');
        var generatedHtml = Opal.Asciidoctor.$render(data, ASCIIDOCTOR_OPTIONS);
        $(document.body).html("<div id='content'>" + generatedHtml + "</div>");
    }

    asciidocify();

}(document));
