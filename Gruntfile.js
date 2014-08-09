module.exports = function (grunt) {
  grunt.initConfig({
    pkg:grunt.file.readJSON('package.json'),

    clean:{
      dist:['dist']
    },

    jasmine:{
      customTemplate:{
        src:['js/asciidocify.js', 'js/renderer.js'],
        options:{
          specs:'spec/*spec.js',
          vendor:[
            'js/vendor/opal.js',
            'js/vendor/asciidoctor.js',
            'js/vendor/jquery.min.js',
            'js/vendor/md5.js',
            'js/vendor/bootstrap.min.js'
          ]
        }
      }
    },

    compress:{
      main:{
        options:{
          archive:'dist/asciidoctor-chrome-extension.zip'
        },
        files:[
          {
            expand:true,
            src:[
              'js/**',
              'img/**',
              'html/**',
              'fonts/**',
              'css/**',
              'LICENSE',
              'options.html',
              'manifest.json',
              'README.adoc'
            ]
          }
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