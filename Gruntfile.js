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
    html: config.app + '/html',
    node_module: 'node_modules'
  };

  grunt.initConfig({

    pkg: grunt.file.readJSON('package.json'),

    config: config,

    paths: paths,

    clean: {
      dist: ['dist']
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
    },

    copy: {
      main: {
        files: [
          // copies vendor JavaScript files
          {
            expand: true,
            src: [
              paths.node_modules + "/asciidoctor.js/dist/asciidoctor.js",
              paths.node_modules + "/jquery/dist/jquery.min.js",
              paths.node_modules + "/bootstrap/dist/js/bootstrap.min.js",
              paths.node_modules + "/chartist/dist/chartist.min.js"
            ],
            dest: 'app/js/vendor/',
            flatten: true
          },
          // copies vendor style sheet files
          {
            expand: true,
            src: paths.bower + "/asciidoctor.js/dist/css/asciidoctor.css",
            dest: 'app/css/themes/',
            flatten: true
          },
          {
            expand: true,
            src: [
                  paths.bower + "/bootstrap/dist/css/bootstrap.min.css",
                  paths.bower + "/font-awesome/css/font-awesome.min.css"
            ],
            dest: 'app/css/',
            flatten: true
          },
          // copies vendor fonts files
          {
            expand: true,
            src: paths.bower + "/font-awesome/fonts/*.woff2",
            dest: 'app/fonts/',
            flatten: true
          }
        ]
      }
    }
  });

  grunt.loadNpmTasks('grunt-contrib-clean');
  grunt.loadNpmTasks('grunt-contrib-compress');
  grunt.loadNpmTasks('grunt-contrib-copy');

  grunt.registerTask('default', ['dist']);
  grunt.registerTask('dist', ['clean', 'copy', 'compress']);
  grunt.registerTask('publish', ['clean', 'compress']);
};
