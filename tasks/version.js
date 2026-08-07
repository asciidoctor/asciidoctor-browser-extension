#!/usr/bin/env node
// Bumps the version embedded in the extension manifest and the Safari
// Xcode project. package.json/package-lock.json are bumped separately via
// `npm version`, which already knows how to keep both in sync.
//
// Usage: node tasks/version.js <version>

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRootDirectory = join(import.meta.dirname, '..')

function replaceAll(path, pattern, replacement) {
  const content = readFileSync(path, 'utf8')
  const updated = content.replace(pattern, replacement)
  if (updated === content) {
    throw new Error(`No match for ${pattern} in ${path}`)
  }
  writeFileSync(path, updated)
}

export function bumpVersion(version) {
  replaceAll(
    join(projectRootDirectory, 'app', 'manifest.json'),
    /^(\s*"version":\s*")[^"]+(")/m,
    `$1${version}$2`,
  )
  replaceAll(
    join(
      projectRootDirectory,
      'safari',
      'Asciidoctor.js Live Preview',
      'Asciidoctor.js Live Preview.xcodeproj',
      'project.pbxproj',
    ),
    /MARKETING_VERSION = [^;]+;/g,
    `MARKETING_VERSION = ${version};`,
  )
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [version] = process.argv.slice(2)
  if (!version) {
    console.error('Usage: node tasks/version.js <version>')
    process.exit(1)
  }
  bumpVersion(version)
}
