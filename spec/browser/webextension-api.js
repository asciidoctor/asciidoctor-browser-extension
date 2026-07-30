// Define the 'browser' object available in WebExtension environment.
export const browser = {
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
