let alreadyRun = false;

// eslint-disable-next-line no-unused-vars
function inject (source) {
  if (!alreadyRun) {
    appendStyles();
    asciidoctor.browser.update(source);
    alreadyRun = true;
  }
}

document.getElementById('content').innerHTML += 'Rendering...';
