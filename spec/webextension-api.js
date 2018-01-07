// Define the 'browser' object available in WebExtension environment.
const browser = {
  storage: {
    local: {
      get: function () {
      },
      set: function () {
      }
    }
  },
  extension: {
    getURL: function (path) {
      return path;
    }
  },
  runtime: {
    getManifest: function () {
      return {web_accessible_resources: []};
    }
  }
};
