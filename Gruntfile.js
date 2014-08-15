module.exports = function (grunt) {

  var config = {
    app: 'app',
    dist: 'dist',
    js: 'js',
    vendor: 'vendor'
  };

  var paths = {
    app: config.app,
    js: config.app + '/' + config.js,
    vendor: config.app + '/' + config.js + '/' + config.vendor,
    dist: config.dist,
    img: config.app + '/img',
    fonts: config.app + '/fonts',
    css: config.app + '/css',
    html: config.app + '/html'
  };

  grunt.initConfig({

    pkg: grunt.file.readJSON('package.json'),

    config: config,

    paths: paths,

    clean: {
      dist: ['dist']
    },

    jasmine: {
      customTemplate: {
        src: [paths.js + '/asciidocify.js', paths.js + '/renderer.js'],
        options: {
          specs: 'spec/*spec.js',
          vendor: [
            paths.vendor + '/opal.js',
            paths.vendor + '/asciidoctor.js',
            paths.vendor + '/jquery.min.js',
            paths.vendor + '/md5.js',
            paths.vendor + '/bootstrap.min.js'
          ]
        }
      }
    },

    compress: {
      main: {
        options: {
          archive: paths.dist + '/asciidoctor-chrome-extension.zip'
        },
        files: [
          {expand: true, cwd: paths.app, src: '**'},
          {expand: true, src: ['LICENSE', 'README.adoc']}
        ]
      }
    }
  });

  grunt.loadNpmTasks('grunt-contrib-clean');
  grunt.loadNpmTasks('grunt-contrib-jasmine');
  grunt.loadNpmTasks('grunt-contrib-compress');

  grunt.registerTask('default', ['dist']);
  grunt.registerTask('dist', ['clean', 'test', 'compress']);
  grunt.registerTask('test', ['jasmine']);
};