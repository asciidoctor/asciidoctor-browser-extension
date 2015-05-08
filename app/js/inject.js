var alreadyRun = false;
function inject(data) {
  if (!alreadyRun) {
    appendStyles();
    asciidoctor.chrome.convert(data);
    alreadyRun = true;
  }
}
document.getElementById("content").innerHTML += "Rendering...";