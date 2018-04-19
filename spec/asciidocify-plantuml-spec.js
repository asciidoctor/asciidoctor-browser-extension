describe('Render a PlantUML diagram', () => {

  const Constants = asciidoctor.browser.constants();
  const Dom = asciidoctor.browser.dom(document);
  const Theme = asciidoctor.browser.theme(browser, Constants);
  const Settings = asciidoctor.browser.settings(browser, Constants);
  const Renderer = asciidoctor.browser.renderer(browser, document, Constants, Settings, Dom, Theme);

  it('should render a PlantUML diagram', (done) => {
    // Given
    const source = `
[plantuml]
----
Bob -> Alice : hello
----
`;
    spyOn(browser.storage.local, 'set').and.callFake(() => {
      // noop
    });
    spyOn(browser.storage.local, 'get').and.callFake((name, callback) => {
      const values = [];
      values[Constants.CUSTOM_ATTRIBUTES_KEY] = '';
      values[Constants.SAFE_MODE_KEY] = 'safe';
      callback(values);
    });
    // When
    Renderer.update(source)
      .then(() => {
        const plantumlDiv = document.body.getElementsByClassName('plantuml')[0];
        expect(plantumlDiv).toBeDefined();
        const plantumlImg = plantumlDiv.getElementsByTagName('img')[0];
        expect(plantumlImg.getAttribute('src')).toBe('http://www.plantuml.com/plantuml/png/SyfFKj2rKt3CoKnELR1Io4ZDoSa70000');
        done();
      })
      .catch((error) => {
        fail(error);
      })
  });
});
