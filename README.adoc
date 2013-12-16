= asciidoctor-chrome-extension, Asciidoctor Chrome Extension
Guillaume Grossetie
:sources: https://github.com/asciidoctor/asciidoctor-chrome-extension
:license: https://github.com/asciidoctor/asciidoctor-chrome-extension/blob/master/LICENSE
:webstore: https://chrome.google.com/webstore/detail/asciidoctorjs-live-previe/iaalpfgpbocpdfblpnhhgllgbdbchmia

This project uses https://github.com/asciidoctor/asciidoctor.js[Asciidoctor.js] to render AsciiDoc as HTML inside Chrome!

== Usage

 1. Install extension from {webstore}[Chrome Web Store]
 2. Check `Allow access to file URLs` in `chrome://extensions`
 3. Open local or remote .ad, .adoc, .asc, .asciidoc file in Chrome
 4. Enjoy!

== Installation

Loading your local copy of the extension on Chrome is super easy:

 1. Check `Developer mode` in `chrome://extensions`
 2. Click `Load unpacked extension...` and select the extension root directory
 3. That's all

To see your changes, click the `Reload (Ctrl+R)` link in `chrome://extensions`.
If you want to create a `Pack extension` just make a `zip` file of the extension root directory.

== Options

The extension can be configured via an options page.

To open the options page, right-click the extension icon and choose Options on the menu. You can also go to `chrome://extensions` and click the Options link.

The options page let you add custom Asciidoctor attributes or change the theme of the AsciiDoc HTML output.

== Changelog

=== 0.3.0

 * Upgrade to Asciidoctor 1.5.0.preview.1
 * Add integration with Font Awesome 3.2.1

=== 0.2.5

 * Add configuration option for specifying custom attributes
 * Allow to change the theme of AsciiDoc HTML output

=== 0.2.4

 * Add highlight.js for syntax highlighting
 * Add context menu to send the "browser content" to the Asciidoctor Editor

=== 0.2.3

 * Auto reload, you don't need to refresh your browser anymore!
 * Shiny icon in `chrome://extensions/`
 * Support .asc file extension (thanks @mojavelinux)

== Copyright

Copyright (C) 2013 Guillaume Grossetie.
Free use of this software is granted under the terms of the MIT License.

See the {license}[LICENSE] file for details.
