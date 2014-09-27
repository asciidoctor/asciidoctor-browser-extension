/**
 * Scroll to the next/previous section (<h2>) with keyboard up/down.
 */
var headings = $('h1, h2, h3, h4, h5').not('.float');
var current = 0;
var headingsLength = headings.length;
$(document).keydown(function (e) {
  if (e.keyCode === 38) {
    // up
    if (current > 0) {
      e.preventDefault();
      current -= 1;
      $('html, body').animate({scrollTop: headings[current].offsetTop}, 1000);
    }
  }
  else if (e.keyCode === 40) {
    // down
    if (current < headingsLength - 1) {
      e.preventDefault();
      current += 1;
      $('html, body').animate({scrollTop: headings[current].offsetTop}, 1000);
    }
  }
});