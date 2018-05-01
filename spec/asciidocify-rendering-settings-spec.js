describe('Retrieve the rendering settings', () => {

  const Constants = asciidoctor.browser.constants();
  const Settings = asciidoctor.browser.settings(browser, Constants);

  it('should return the configured settings', (done) => {
    const params = [];
    params[Constants.CUSTOM_ATTRIBUTES_KEY] = 'foo=bar';
    params[Constants.SAFE_MODE_KEY] = 'server';
    helper.configureParameters(params);

    Settings.getRenderingSettings()
      .then((renderingSettings) => {
        expect(renderingSettings.customAttributes).toBe('foo=bar');
        expect(renderingSettings.safeMode).toBe('server');
        done();
      });
  });

  it('should return \'secure\' if the safe mode is undefined', (done) => {
    helper.configureParameters();

    Settings.getRenderingSettings()
      .then((renderingSettings) => {
        expect(renderingSettings.safeMode).toBe('secure');
        done();
      });
  });

  describe('Retrieve the custom script', () => {
    it('should return undefined if the name is undefined', (done) => {
      helper.configureParameters();

      Settings.getRenderingSettings()
        .then((renderingSettings) => {
          expect(renderingSettings.customScript).toBeUndefined();
          done();
        });
    });

    it('should return undefined if the name is defined but the content is undefined', (done) => {
      const params = [];
      params[Constants.JS_KEY] = 'alert';
      helper.configureParameters(params);

      Settings.getRenderingSettings()
        .then((renderingSettings) => {
          expect(renderingSettings.customScript).toBeUndefined();
          done();
        });
    });

    it('should return \'after\' if the load directive is undefined', (done) => {
      const params = [];
      params[Constants.JS_KEY] = 'alert';
      params[Constants.CUSTOM_JS_PREFIX + 'alert'] = 'alert();';
      helper.configureParameters(params);

      Settings.getRenderingSettings()
        .then((renderingSettings) => {
          expect(renderingSettings.customScript.content).toBe('alert();');
          expect(renderingSettings.customScript.loadDirective).toBe('after');
          done();
        });
    });

    it('should return the configured custom script', (done) => {
      const params = [];
      params[Constants.JS_KEY] = 'alert';
      params[Constants.CUSTOM_JS_PREFIX + 'alert'] = 'alert();';
      params[Constants.JS_LOAD_KEY] = 'before';
      helper.configureParameters(params);

      Settings.getRenderingSettings()
        .then((renderingSettings) => {
          expect(renderingSettings.customScript.content).toBe('alert();');
          expect(renderingSettings.customScript.loadDirective).toBe('before');
          done();
        });
    });
  });
});
