// Define the 'browser' object available in WebExtension environment.
const browser = {
  storage: {
    local: {
      get: function () {
      }
    }
  },
  extension: {
    getURL: function (path) {
    }
  },
  runtime: {
    getManifest: function () {
      return {web_accessible_resources: []};
    }
  }
};
