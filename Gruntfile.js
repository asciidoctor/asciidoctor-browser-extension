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
            'js/opal.js',
            'js/asciidoctor.js',
            'js/jquery.min.js',
            'js/md5.js',
            'js/bootstrap.min.js',
            'js/bootstrap.min.js'
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