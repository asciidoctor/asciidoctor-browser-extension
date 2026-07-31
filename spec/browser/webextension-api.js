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
    // Simulate the background script's handling of 'run-custom-script'
    // (normally run via chrome.scripting.executeScript in the page's MAIN
    // world) since there is no real extension context in these tests.
    sendMessage: (message, callback) => {
      if (message?.action === 'run-custom-script') {
        const url = URL.createObjectURL(
          new Blob([message.content], { type: 'text/javascript' }),
        )
        const script = document.createElement('script')
        script.id = 'asciidoctor-browser-custom-js'
        script.src = url
        script.onload = () => {
          URL.revokeObjectURL(url)
          callback?.({})
        }
        script.onerror = () => {
          URL.revokeObjectURL(url)
          callback?.({ error: 'Unable to load the custom script' })
        }
        document.head.appendChild(script)
      } else {
        callback?.({})
      }
    },
  },
}
