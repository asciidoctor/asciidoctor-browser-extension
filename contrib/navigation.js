// Scroll to the next/previous section with keyboard up/down.
(function () {
  var headings = Array.from(document.getElementsByTagName('h1'))
    .concat(Array.from(document.getElementsByTagName('h2')))
    .concat(Array.from(document.getElementsByTagName('h3')))
    .concat(Array.from(document.getElementsByTagName('h4')))
    .concat(Array.from(document.getElementsByTagName('h5')))
    .filter(function (heading) {
      return !Array.from(heading.classList).includes('float')
    });
  var current = 0;
  var headingsLength = headings.length;

  window.addEventListener("keydown", function (e) {
    if (e.key === 'ArrowUp') {
      // up
      if (current > 0) {
        e.preventDefault();
        current -= 1;
        window.scrollTo({
          top: headings[current].offsetTop,
          behavior: "smooth"
        });
      }
    }
    else if (e.key === 'ArrowDown') {
      // down
      if (current < headingsLength - 1) {
        e.preventDefault();
        current += 1;
        window.scrollTo({
          top: headings[current].offsetTop,
          behavior: "smooth"
        });
      }
    }
  });
})();
