let alreadyRun = false;

// eslint-disable-next-line no-unused-vars
function inject (data) {
  if (!alreadyRun) {
    appendStyles();
    asciidoctor.browser.convert(data);
    alreadyRun = true;
  }
}

document.getElementById('content').innerHTML += 'Rendering...';
