var alreadyRun = false;
function inject(data){
    if (!alreadyRun) {
        render(data);
        alreadyRun = true; 
    }
}
document.getElementById("content").innerHTML += "Rendering...";