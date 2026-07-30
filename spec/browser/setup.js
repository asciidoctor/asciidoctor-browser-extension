import sinon from '/node_modules/sinon/pkg/sinon-esm.js'
import * as helper from './helper.js'
import { browser } from './webextension-api.js'

window.sinon = sinon
window.browser = browser
window.helper = helper
