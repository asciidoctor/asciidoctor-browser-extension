/**
 * Fade between sections (<h1> and preamble are wrapped in a section) with keyboard up/down.
 */
$('#content h1:first-child, #content #preamble').wrapAll("<span class='sect1' />");
var sections = $('.sect1');
sections.hide();
var current = 0;
$(sections[current]).show();
var sectionsLength = sections.length;
$(document).keydown(function (e) {
  if (e.keyCode === 38) {
    // up
    if (current > 0) {
      e.preventDefault();
      current -= 1;
      $(sections[current+1]).fadeOut(300, function() {
        $(sections[current]).fadeIn(300);
      });
    }
  }
  else if (e.keyCode === 40) {
    // down
    if (current < sectionsLength - 1) {
      e.preventDefault();
      current += 1;
      $(sections[current-1]).fadeOut(300, function() {
        $(sections[current]).fadeIn(300);
      });
    }
  }
});