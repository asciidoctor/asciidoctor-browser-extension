module.exports = function (config) {
  config.set({
    frameworks: ['jasmine'],
    files: [
      'spec/webextension-api.js',
      'app/js/vendor/highlight.min.js',
      'app/js/vendor/jquery.min.js',
      "app/js/vendor/chartist.min.js",
      "app/js/vendor/plantuml.min.js",
      'app/js/vendor/md5.js',
      'app/js/vendor/asciidoctor.js',
      'app/js/module/namespace.js',
      'app/js/module/settings.js',
      'app/js/module/dom.js',
      'app/js/module/theme.js',
      'app/js/loader.js',
      'app/js/renderer.js',
      "app/js/vendor/asciidoctor-chart-block-macro.js",
      "app/js/vendor/asciidoctor-emoji-inline-macro.js",
      "app/js/vendor/asciidoctor-plantuml-register.js",
      'spec/**/*-spec.js'
    ],
    reporters: ['progress'],
    port: 9876, // karma web server port
    colors: true,
    logLevel: config.LOG_INFO,
    browsers: ['ChromeHeadless'],
    autoWatch: false,
    singleRun: false, // Karma captures browsers, runs the tests and exits
    concurrency: Infinity
  });
};
