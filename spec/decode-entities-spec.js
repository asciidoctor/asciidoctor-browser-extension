describe('Decode entities', () => {

  const Dom = asciidoctor.browser.dom(document);

  it('should decode entities', () => {
    expect(Dom.decodeEntities('Hansel et Gretel')).toBe('Hansel et Gretel');
    expect(Dom.decodeEntities('Hansel & Gretel')).toBe('Hansel & Gretel');
    expect(Dom.decodeEntities('Hansel &amp; Gretel')).toBe('Hansel & Gretel');
    expect(Dom.decodeEntities('Hansel&#x20&amp;&#x20Gretel')).toBe('Hansel & Gretel');
  });
});
