/* global XMLHttpRequest, AsciidoctorKroki, processor */
(function (processor) {
  const httpGet = (uri, encoding = 'utf8') => {
    let data = ''
    let status = -1
    try {
      const xhr = new XMLHttpRequest()
      xhr.open('GET', uri, false)
      if (encoding === 'binary') {
        xhr.responseType = 'arraybuffer'
      }
      xhr.addEventListener('load', function () {
        status = this.status
        if (status === 200 || status === 0) {
          if (encoding === 'binary') {
            const arrayBuffer = xhr.response
            const byteArray = new Uint8Array(arrayBuffer)
            for (let i = 0; i < byteArray.byteLength; i++) {
              data += String.fromCharCode(byteArray[i])
            }
          } else {
            data = this.responseText
          }
        }
      })
      xhr.send()
    } catch (e) {
      throw new Error(`Error reading file: ${uri}; reason: ${e.message}`)
    }
    // assume that no data means it doesn't exist
    if (status === 404 || !data) {
      throw new Error(`No such file: ${uri}`)
    }
    return data
  }
  AsciidoctorKroki.register(processor.Extensions, {
    vfs: {
      read: (path, encoding = 'utf8') => {
        return httpGet(path, encoding)
      },
      exists: (_) => {
        return false
      },
      add: (_) => {
        // no-op
      }
    }
  })
})(processor) // processor is defined in renderer.js
