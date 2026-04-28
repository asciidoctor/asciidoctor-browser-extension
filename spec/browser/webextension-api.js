// Define the 'browser' object available in WebExtension environment.
const _browser = {
  storage: {
    local: {
      get: () => {},
      set: () => {},
    },
  },
  runtime: {
    getURL: (path) => path,
    getManifest: () => ({ web_accessible_resources: [] }),
    onMessage: {
      addListener: () => {},
    },
    sendMessage: (_message, _callback) => {},
  },
}
