describe('escape', function () {
  it('should escape', function () {
     expect(asciidoctor.browser.escape('<script>alert();</script>')).toBe('&lt;script&gt;alert();&lt;/script&gt;');
  });
});
