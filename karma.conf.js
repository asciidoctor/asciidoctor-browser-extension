module.exports = function (config) {
  config.set({
    frameworks: ['jasmine'],
    files: [
      'spec/webextension-api.js',
      'app/js/vendor/highlight.min.js',
      'app/js/vendor/jquery.min.js',
      'app/js/vendor/asciidoctor.js',
      'app/js/vendor/md5.js',
      'app/js/loader.js',
      'app/js/renderer.js',
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
