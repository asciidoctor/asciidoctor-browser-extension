// Fade between sections with keyboard up/down. <h1> and preamble are wrapped in a section.
(function () {
  const fadeIn = (el, time) => {
    el.style.opacity = 0;
    el.style.display = 'block';
    var last = +new Date();
    var tick = function () {
      el.style.opacity = +el.style.opacity + (new Date() - last) / time;
      last = +new Date();
      if (+el.style.opacity < 1) {
        (window.requestAnimationFrame && requestAnimationFrame(tick)) || setTimeout(tick, 16);
      }
    };
    tick();
  }
  const fadeOut = (el, time, callback) => {
    el.style.opacity = 1;
    var last = +new Date();
    var tick = function () {
      el.style.opacity = +el.style.opacity - (new Date() - last) / time;
      last = +new Date();
      if (+el.style.opacity > 0) {
        (window.requestAnimationFrame && requestAnimationFrame(tick)) || setTimeout(tick, 16);
      } else {
        el.style.display = 'none';
        callback();
      }
    };
    tick();
  }

  const firstSectionElements = [];
  const preambleElement = document.getElementById('preamble');
  if (preambleElement) {
    firstSectionElements.push(preambleElement);
  }
  const documentTitleElement = document.body.querySelectorAll('#content > h1:first-child');
  if (documentTitleElement) {
    firstSectionElements.push(documentTitleElement.item(0));
  }
  const firstSectionDiv = document.createElement('div');
  firstSectionDiv.className = 'sect1';
  firstSectionElements.forEach(function (element) {
    firstSectionDiv.appendChild(element);
  });
  const sections = Array.from(document.getElementsByClassName('sect1'));
  sections.forEach(function (section, index) {
    if (index > 0) {
      section.style.display = 'none';
    }
  });
  var current = 0;
  var sectionsLength = sections.length;
  window.addEventListener("keydown", function (e) {
    var origin = current;
    if (e.key === 'ArrowUp') {
      // up
      if (current > 0) {
        current -= 1;
      }
      else {
        current = sectionsLength - 1;
      }
      e.preventDefault();
      fadeOut(sections[origin], 300, () => {
        fadeIn(sections[current], 300);
      });
    }
    else if (e.key === 'ArrowDown') {
      // down
      if (current < sectionsLength - 1) {
        current += 1;
      }
      else {
        current = 0;
      }
      e.preventDefault();
      fadeOut(sections[origin], 300, () => {
        fadeIn(sections[current], 300);
      });
    }
  });
})();
