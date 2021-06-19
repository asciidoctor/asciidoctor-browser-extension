const ospath = require('path')
const fs = require('fs-extra')

const mathjaxModuleDir = ospath.join(__dirname, '..', 'node_modules', 'mathjax')
const mathjaxVersion = require(ospath.join(mathjaxModuleDir, 'package.json')).version
const mathjaxDestinationDir = ospath.join(__dirname, '..', 'app', 'vendor', `mathjax-${mathjaxVersion}`)

;(async () => {
  await fs.copy(ospath.join(mathjaxModuleDir, 'es5'), mathjaxDestinationDir)
  const files = await fs.readdir(mathjaxDestinationDir, { withFileTypes: true })
  for (const file of files) {
    const fileName = file.name
    if (fileName.endsWith('.js') && file.isFile() && fileName !== 'tex-chtml-full.js') {
      await fs.remove(ospath.join(mathjaxDestinationDir, fileName))
    }
  }
})()
