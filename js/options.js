// Saves options to localStorage.
function save_options() {
    var input = document.getElementById("inputCustomAttributes");
    localStorage["CUSTOM_ATTRIBUTES"] = input.value;

    // Update status to let user know options were saved.
    var alert = '<div class="alert alert-success alert-dismissable fade in"><button type="button" class="close" data-dismiss="alert" aria-hidden="true">&times;</button><b>{{message}}</b></div>';
    var html = alert.replace("{{message}}", "Options saved!");
    $("#status").html(html);
    chrome.extension.getBackgroundPage().refreshOptions()
}

// Restores select box state to saved value from localStorage.
function restore_options() {
    var customAttributes = localStorage["CUSTOM_ATTRIBUTES"];
    if (!customAttributes) {
        return;
    }
    var input = document.getElementById("inputCustomAttributes");
    input.value = customAttributes;
}

document.addEventListener('DOMContentLoaded', restore_options);
document.querySelector('#save').addEventListener('click', save_options);
