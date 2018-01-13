describe('Escape characters', () => {
  it('should escape characters', () => {
    expect(asciidoctor.browser.escape('<script>alert();</script>')).toBe('&lt;script&gt;alert();&lt;/script&gt;');
  });
});
