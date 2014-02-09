var alreadyRun = false;
function inject(data){
    if (!alreadyRun) {
        appendStyles();
        render(data);
        alreadyRun = true; 
    }
}
document.getElementById("content").innerHTML += "Rendering...";