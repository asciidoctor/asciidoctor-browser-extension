describe('Retrieve the rendering settings', () => {

  const Constants = asciidoctor.browser.constants();
  const Settings = asciidoctor.browser.settings(browser, Constants);

  it('should return the configured settings', (done) => {
    // Given
    spyOn(browser.storage.local, 'get').and.callFake((name, callback) => {
      const values = [];
      values[Constants.CUSTOM_ATTRIBUTES_KEY] = 'foo=bar';
      values[Constants.SAFE_MODE_KEY] = 'server';
      callback(values);
    });
    // When
    Settings.getRenderingSettings()
      .then((renderingSettings) => {
        expect(renderingSettings.customAttributes).toBe('foo=bar');
        expect(renderingSettings.safeMode).toBe('server');
        done();
      });
  });

  it('should return \'secure\' if the safe mode is undefined', (done) => {
    // Given
    spyOn(browser.storage.local, 'get').and.callFake((name, callback) => {
      const values = [];
      callback(values);
    });
    // When
    Settings.getRenderingSettings()
      .then((renderingSettings) => {
        expect(renderingSettings.safeMode).toBe('secure');
        done();
      });
  });

  describe('Retrieve the custom script', () => {
    it('should return undefined if the name is undefined', (done) => {
      // Given
      spyOn(browser.storage.local, 'get').and.callFake((name, callback) => {
        const values = [];
        callback(values);
      });
      // When
      Settings.getRenderingSettings()
        .then((renderingSettings) => {
          expect(renderingSettings.customScript).toBeUndefined();
          done();
        });
    });

    it('should return undefined if the name is defined but the content is undefined', (done) => {
      // Given
      spyOn(browser.storage.local, 'get').and.callFake((name, callback) => {
        const values = [];
        values[Constants.JS_KEY] = 'alert';
        callback(values);
      });
      // When
      Settings.getRenderingSettings()
        .then((renderingSettings) => {
          expect(renderingSettings.customScript).toBeUndefined();
          done();
        });
    });

    it('should return \'after\' if the load directive is undefined', (done) => {
      // Given
      spyOn(browser.storage.local, 'get').and.callFake((name, callback) => {
        const values = [];
        values[Constants.JS_KEY] = 'alert';
        values[Constants.CUSTOM_JS_PREFIX + 'alert'] = 'alert();';
        callback(values);
      });
      // When
      Settings.getRenderingSettings()
        .then((renderingSettings) => {
          expect(renderingSettings.customScript.content).toBe('alert();');
          expect(renderingSettings.customScript.loadDirective).toBe('after');
          done();
        });
    });

    it('should return the configured custom script', (done) => {
      // Given
      spyOn(browser.storage.local, 'get').and.callFake((name, callback) => {
        const values = [];
        values[Constants.JS_KEY] = 'alert';
        values[Constants.CUSTOM_JS_PREFIX + 'alert'] = 'alert();';
        values[Constants.JS_LOAD_KEY] = 'before';
        callback(values);
      });
      // When
      Settings.getRenderingSettings()
        .then((renderingSettings) => {
          expect(renderingSettings.customScript.content).toBe('alert();');
          expect(renderingSettings.customScript.loadDirective).toBe('before');
          done();
        });
    });
  });
});
