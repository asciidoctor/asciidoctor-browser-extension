(function (document) {

    var ASCIIDOCTOR_OPTIONS = Opal.hash2([ 'attributes' ], {
        'attributes':[ 'notitle!' ]
    });

    /**
     * Render AsciiDoc content
     */
    function render() {
        $.ajax({
            url:location.href,
            cache:false,
            complete:function() {
                var data = document.body.innerText;
                $(document.body).html('');
                var generatedHtml = Opal.Asciidoctor.$render(data, ASCIIDOCTOR_OPTIONS);
                $(document.body).html("<div id='content'>" + generatedHtml + "</div>");
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

    appendStyles();

    render();

}(document));
