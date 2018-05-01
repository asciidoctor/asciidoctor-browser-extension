describe('Theme module', () => {

  const Constants = asciidoctor.browser.constants();
  const Settings = asciidoctor.browser.settings(browser, Constants);
  const Theme = asciidoctor.browser.theme(browser, Settings, Constants);

  it('should get the default theme name', (done) => {
    helper.configureParameters();

    const processor = Asciidoctor({runtime: {platform: 'browser'}});
    const asciidoctorDocument = processor.load('= Hello world');
    Theme.getThemeName(asciidoctorDocument)
      .then((themeName) => {
        expect(themeName).toBe('asciidoctor');
        done();
      });
  });

  it('should get the default theme name when the custom stylesheet does not exist', (done) => {
    helper.configureParameters();

    const source = `= Hello world
:stylesheet: foo

== First section`
    const processor = Asciidoctor({runtime: {platform: 'browser'}});
    const asciidoctorDocument = processor.load(source);
    Theme.getThemeName(asciidoctorDocument)
      .then((themeName) => {
        expect(themeName).toBe('asciidoctor');
        done();
      });
  });

  it('should get the custom stylesheet when exists', (done) => {
    const params = [];
    params[Constants.CUSTOM_THEME_PREFIX + 'foo'] = 'h1 { color: red; }';
    helper.configureParameters(params);

    const source = `= Hello world
:stylesheet: foo

== First section`
    const processor = Asciidoctor({runtime: {platform: 'browser'}});
    const asciidoctorDocument = processor.load(source);
    Theme.getThemeName(asciidoctorDocument)
      .then((themeName) => {
        expect(themeName).toBe('foo');
        done();
      });
  });

  it('should get the stylesheet when exists', (done) => {
    helper.configureParameters();
    helper.configureManifest({
      web_accessible_resources: [
        "css/themes/asciidoctor.css",
        "css/themes/colony.css",
        "css/themes/foundation.css",
        "css/themes/foundation-lime.css",
        "css/themes/foundation-potion.css",
        "css/themes/github.css",
        "css/themes/golo.css",
        "css/themes/iconic.css",
        "css/themes/maker.css",
        "css/themes/readthedocs.css",
        "css/themes/riak.css",
        "css/themes/rocket-panda.css",
        "css/themes/rubygems.css",
      ]
    });

    const source = `= Hello world
:stylesheet: colony.css

== First section`
    const processor = Asciidoctor({runtime: {platform: 'browser'}});
    const asciidoctorDocument = processor.load(source);
    Theme.getThemeName(asciidoctorDocument)
      .then((themeName) => {
        expect(themeName).toBe('colony');
        done();
      });
  });
});
