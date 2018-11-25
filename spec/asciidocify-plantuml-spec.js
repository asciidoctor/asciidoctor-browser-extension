describe('Render a PlantUML diagram', () => {

  const Constants = asciidoctor.browser.constants();
  const Dom = asciidoctor.browser.dom(document);
  const Settings = asciidoctor.browser.settings(browser, Constants);
  const Theme = asciidoctor.browser.theme(browser, Settings, Constants);
  const Renderer = asciidoctor.browser.renderer(browser, document, Constants, Settings, Dom, Theme);

  it('should render a PlantUML diagram', (done) => {
    const params = [];
    params[Constants.CUSTOM_ATTRIBUTES_KEY] = '';
    params[Constants.SAFE_MODE_KEY] = 'safe';
    helper.configureParameters(params);

    const source = `
[plantuml]
----
Bob -> Alice : hello
----
`;

    Renderer.update(source)
      .then(() => {
        const plantumlDiv = document.body.getElementsByClassName('plantuml')[0];
        expect(plantumlDiv).toBeDefined();
        const plantumlImg = plantumlDiv.getElementsByTagName('img')[0];
        expect(plantumlImg.getAttribute('src')).toBe('http://www.plantuml.com/plantuml/png/SoWkIImgAStDuNBAJrBGjLDmpCbCJbMmKiX8pSd9vt98pKi1IW80');
        done();
      })
      .catch((error) => {
        fail(error);
      })
  });
});
