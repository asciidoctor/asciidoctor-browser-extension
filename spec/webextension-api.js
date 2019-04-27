// Define the 'browser' object available in WebExtension environment.
// eslint-disable-next-line no-unused-vars
const browser = {
  storage: {
    local: {
      get: () => {
      },
      set: () => {
      }
    }
  },
  extension: {
    getURL: path => path
  },
  runtime: {
    getManifest: () => ({ web_accessible_resources: [] }),
    onMessage: {
      addListener: () => {
      }
    }
  }
}
