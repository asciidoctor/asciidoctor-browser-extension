import twemojiMap from './twemoji-map.js'

// Converts a hyphen-joined hex codepoint sequence (e.g. '1f9d1-200d-1f3a8') into the
// actual emoji character(s) it represents, for CDNs that key images by the raw emoji
// (e.g. https://emoji-cdn.mqrio.dev/%F0%9F%8E%89?style=google) instead of its codepoint.
function codepointToChar(codepoint) {
  return codepoint
    .split('-')
    .map((cp) => String.fromCodePoint(Number.parseInt(cp, 16)))
    .join('')
}

const htmlEscapeMap = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }
function escapeHtmlAttribute(str) {
  return str.replace(/[&<>"]/g, (ch) => htmlEscapeMap[ch])
}

function emojiInlineMacro() {
  this.named('emoji')
  this.positionalAttributes('size')

  const defaultSize = '24px'
  const sizeMap = { '1x': '17px', lg: defaultSize, '2x': '34px', '3x': '50px', '4x': '68px', '5x': '85px' }
  const defaultPattern = 'https://cdn.jsdelivr.net/npm/@discordapp/twemoji@16.0.1/dist/svg/{codepoint}.svg'

  this.process((parent, target, attrs) => {
    const sizeAttr = attrs.size
    let size
    if (sizeAttr?.trim().endsWith('px')) {
      size = sizeAttr
    } else if (sizeAttr && sizeMap[sizeAttr]) {
      size = sizeMap[sizeAttr]
    } else {
      size = defaultSize
    }
    const doc = parent.getDocument()
    const emojiUnicode = twemojiMap[target]
    if (emojiUnicode) {
      if (doc.getAttribute('emojis') === 'font') {
        const char = codepointToChar(emojiUnicode)
        return this.createInline(
          parent,
          'quoted',
          `<span class="emoji" title="${escapeHtmlAttribute(target)}" style="font-size:${size}">${char}</span>`,
        )
      }
      const pattern = doc.getAttribute('emoji-pattern', defaultPattern)
      const url = pattern
        .replaceAll('{codepoint}', emojiUnicode)
        .replaceAll('{CODEPOINT}', emojiUnicode.toUpperCase())
        .replaceAll('{codepoint_underscore}', emojiUnicode.replaceAll('-', '_'))
        .replaceAll('{emoji}', encodeURIComponent(codepointToChar(emojiUnicode)))
      return this.createInline(parent, 'image', '', {
        target: url,
        attributes: {
          alt: target,
          height: size,
          width: size,
          role: 'emoji',
        },
      })
    }
    doc.getLogger().warn(
      doc.messageWithContext(`skipping emoji inline macro, ${target} not found`, {
        source_location: parent.getSourceLocation?.() ?? null,
      }),
    )
    return this.createInline(parent, 'quoted', `emoji:${target}[] unresolved`, {
      attributes: { role: 'emoji unresolved' },
    })
  })
}

function emojiWebfontDocinfoProcessor() {
  this.process((doc) => {
    if (doc.getAttribute('emojis') !== 'font') return ''
    const webfont = doc.getAttribute('emoji-webfont')
    if (!webfont) return ''
    return `<link rel="stylesheet" href="${escapeHtmlAttribute(webfont)}">`
  })
}

export function register(registry) {
  registry.inlineMacro(emojiInlineMacro)
  registry.docinfoProcessor(emojiWebfontDocinfoProcessor)
  return registry
}
