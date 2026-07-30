import sinon from '/node_modules/sinon/pkg/sinon-esm.js'
import { browser } from './webextension-api.js'

export function configureParameters(params = []) {
  sinon.spy(browser.storage.local, 'set')
  sinon.stub(browser.storage.local, 'get').resolves(params)
}

export function configureManifest(manifest) {
  sinon.stub(browser.runtime, 'getManifest').callsFake(() => {
    return manifest
  })
}

export function reset() {
  if (typeof browser.storage.local.set.restore === 'function') {
    browser.storage.local.set.restore()
    browser.storage.local.get.restore()
  }
  if (typeof browser.runtime.getManifest.restore === 'function') {
    browser.runtime.getManifest.restore()
  }
}
