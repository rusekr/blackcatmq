module.exports = function(grunt) {


  var config = {
    pkg: grunt.file.readJSON('package.json'),
    banner: '',

    jshint: {
      all: [
        'lib/**/*.js',
	'blackcatmq.js',
        'Gruntfile.js'
      ]
    },

    clean: {
      files: ['built/*']
    },

    copy: {
      main: {
        files: [
          {
            expand: true,
            src: ['blackcatmq.js','lib/'],
            dest: 'built/'
          }
        ]
      }
    },

    replace: {
      main: {
        src: ['built/**/*.js', 'built/**/*.json'],
        overwrite: true,
        replacements: grunt.file.readJSON('package.json').replacements
      }
    }

  };

  console.log('Building version', config.pkg.version);

  grunt.config.init(config);

  // Load the plugin that provides needed tasks.
  grunt.loadNpmTasks('grunt-contrib-clean');
  grunt.loadNpmTasks('grunt-contrib-copy');
  grunt.loadNpmTasks('grunt-contrib-jshint');
  grunt.loadNpmTasks('grunt-text-replace');

  // Our tasks.
  grunt.registerTask('check', ['jshint']);

  grunt.registerTask('build', ['clean', 'copy:main', 'replace:main']);

  grunt.registerTask('default', ['check']);
};
