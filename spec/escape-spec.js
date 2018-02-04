describe('Escape characters', () => {

  const Dom = asciidoctor.browser.dom(document);

  it('should escape characters', () => {
    expect(Dom.escape('<script>alert();</script>')).toBe('&lt;script&gt;alert();&lt;/script&gt;');
  });
});
