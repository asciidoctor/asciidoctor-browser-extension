/**
 * Fade between sections with keyboard up/down. <h1> and preamble are wrapped in a section.
 */
$(document).ready(
  function() {
    $('#content h1:first-child, #content #preamble').wrapAll("<span class='sect1' />");
    var sections = $('.sect1');
    $.each(sections, function(i,o) {if (i > 0) {$(o).hide()}});
    var current = 0;
    var sectionsLength = sections.length;
    $(document).keydown(function (e) {
      var origin = current;

      if (e.keyCode === 38) {
        // up
        if (current > 0) {
          current -= 1;
        }
        else {
          current = sectionsLength - 1;
        }
        e.preventDefault();
        $(sections[origin]).fadeOut(300, function() {
          $(sections[current]).fadeIn(300);
        });
      }
      else if (e.keyCode === 40) {
        // down
        if (current < sectionsLength - 1) {
          current += 1;
        }
        else {
          current = 0;
        }
        e.preventDefault();
        $(sections[origin]).fadeOut(300, function() {
          $(sections[current]).fadeIn(300);
        });
      }
    });
  }
);