#!/usr/bin/env node
// Changelog automation for the release workflow.
//
// Usage:
//   node tasks/changelog.js release <version>   Roll the "== Unreleased" section into a dated
//                                                "== <version> (YYYY-MM-DD)" section and start a
//                                                fresh, empty "== Unreleased" section.
//   node tasks/changelog.js notes <version>      Print the "== <version>" section to stdout as
//                                                Markdown (used as the GitHub release notes).
//
// changelog.adoc's entries are flat bullet lists using only backtick monospace and "(#123)"
// issue references, both already valid Markdown as-is -- the only AsciiDoc-specific construct
// that needs converting is the occasional xref:page.adoc[] link to another doc page.

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRootDirectory = join(import.meta.dirname, '..')
const changelogPath = join(projectRootDirectory, 'changelog.adoc')
const docsBaseUrl = 'https://docs.asciidoctor.org/browser-extension'

export function convertEntryToMarkdown(entry) {
  return entry.replace(
    /xref:([\w-]+)\.adoc(?:#[\w-]+)?\[([^\]]*)\]/g,
    (_, target, text) => `[${text || target}](${docsBaseUrl}/${target}/)`,
  )
}

export function rollUnreleased(content, version, releaseDate) {
  return content.replace(
    /^== Unreleased$/m,
    `== Unreleased\n\n== ${version} (${releaseDate})`,
  )
}

export function extractReleaseNotes(content, version) {
  const section = content
    .split(/^== /m)
    .slice(1)
    .find((s) => s.startsWith(`${version} (`))
  if (!section) {
    throw new Error(`Section "== ${version}" not found in changelog.adoc`)
  }
  const body = section.slice(section.indexOf('\n') + 1)
  return body.trim().split('\n').map(convertEntryToMarkdown).join('\n')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, version] = process.argv.slice(2)
  if (!version || !['release', 'notes'].includes(command)) {
    console.error('Usage: node tasks/changelog.js <release|notes> <version>')
    process.exit(1)
  }
  const content = readFileSync(changelogPath, 'utf8')
  if (command === 'release') {
    const releaseDate = new Date().toISOString().slice(0, 10)
    writeFileSync(changelogPath, rollUnreleased(content, version, releaseDate))
  } else {
    process.stdout.write(`${extractReleaseNotes(content, version)}\n`)
  }
}
