var version = "4.0.8";
const packageJson = {
	version: version};

// ESM conversion of rx.rb
// A collection of regular expression constants used by the parser.
//
// Ruby → JavaScript regex engine differences handled here:
//
//   Ruby \p{Alpha}  → JS \p{Alphabetic}  (Unicode Binary Property, requires 'u' flag)
//   Ruby \p{Alnum}  → JS \p{Alphabetic}\p{N}   (inside […]) or [\p{Alphabetic}\p{N}]
//   Ruby \p{Word}   → JS \p{Alphabetic}\p{N}\p{Pc}  (Letter + Number + Connector Punct)
//   Ruby \p{Blank}  → JS \p{Zs}\t  (Unicode Space_Separator + tab)
//   Ruby CC_ALL (. with /m)  → [\s\S]  (no 's' flag needed)
//   Ruby CC_ANY (.)          → .
//   Ruby ^ / $               → always line anchors in Ruby; in JS only with 'm' flag
//   Ruby \A / \Z             → ^ / $ in JS (string anchors, no 'm' flag)
//
// IMPORTANT – 'u' flag and unset back-references:
//   Without 'u': \n to an unset group matches the empty string (Ruby-compatible).
//   With    'u': \n to an unset group fails (stricter).
//   → InlineLinkRx is intentionally kept WITHOUT the 'u' flag because it relies on
//     the (?!\2) trick (negative lookahead of an unset back-reference) to guard the
//     angle-bracket branch.  All other patterns use 'u'.

// ── Character class string constants ─────────────────────────────────────────
// CC_* → raw content for insertion INSIDE a character class: [${CC_WORD}]
// CG_* → complete character class GROUP for standalone use:  ${CG_WORD}
//
// These are runtime strings whose value contains real regex syntax (single
// backslashes) so that String.raw`…${CC_WORD}…` produces correct regex source.

const CC_ALL = '[\\s\\S]'; // any char including newlines (Ruby . with /m flag)
const CC_ANY = '.'; // any char except newlines

// \p{Alphabetic} ≈ Ruby \p{Alpha} – all Unicode alphabetic characters
const CC_ALPHA = '\\p{Alphabetic}'; // inside [...]
const CG_ALPHA = '\\p{Alphabetic}'; // standalone (unary property, no brackets needed)

// \p{Alphabetic}\p{N} ≈ Ruby \p{Alnum} – alphabetics + all Unicode numbers
const CC_ALNUM = '\\p{Alphabetic}\\p{N}'; // inside [...]
const CG_ALNUM = '[\\p{Alphabetic}\\p{N}]'; // standalone group

// \p{Alphabetic}\p{N}\p{Pc} ≈ Ruby \p{Word}
// Letter + Number + Connector Punctuation (underscore, undertie, …)
const CC_WORD = '\\p{Alphabetic}\\p{N}\\p{Pc}'; // inside [...]
const CG_WORD = '[\\p{Alphabetic}\\p{N}\\p{Pc}]'; // standalone group

// Attribute list pattern fragment: \[([^\[\]]+)\]
// Ruby: QuoteAttributeListRxt = %(\\[([^\\[\\]]+)\\])
const QuoteAttributeListRxt = '\\[([^\\[\\]]+)\\]';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a regex with the Unicode flag ('u'), enabling \p{…} property escapes.
 * @param {string} src        - Regex source string (use String.raw for easy authoring).
 * @param {string} extraFlags - Additional flags, e.g. 'm' for multiline ^ / $
 */
const ru$1 = (src, extraFlags = '') => new RegExp(src, `u${extraFlags}`);

/**
 * Escape all regex metacharacters in str (equivalent to Regexp.escape in Ruby).
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Build a lazy-initialised regex map, mirroring Ruby's Hash.new { |h,k| h[k] = … }.
 * Accessing map[key] creates and caches the regex for that key.
 */
function makeLazyRxMap(buildFn) {
  const cache = new Map();
  return new Proxy(Object.create(null), {
    get(_target, key) {
      if (typeof key !== 'string') return undefined
      if (!cache.has(key)) cache.set(key, buildFn(key));
      return cache.get(key)
    },
  })
}

// ── Document header ───────────────────────────────────────────────────────────

/**
 * Matches the author info line immediately following the document title.
 * @example
 * Doc Writer <doc@example.com>
 * Mary_Sue Brontë
 */
const AuthorInfoLineRx = ru$1(
  String.raw`^(${CG_WORD}[${CC_WORD}\-'.]*)(?: +(${CG_WORD}[${CC_WORD}\-'.]*))?` +
    String.raw`(?: +(${CG_WORD}[${CC_WORD}\-'.]*))?(?:[ ]+<([^>]+)>)?$`
);

/**
 * Matches the delimiter that separates multiple authors.
 * @example
 * Doc Writer; Junior Writer
 */
const AuthorDelimiterRx = /;(?: |$)/;

/**
 * Matches the revision info line immediately following the author info line.
 * @example
 * v1.0
 * 2013-01-01
 * v1.0, 2013-01-01: Ring in the new year release
 */
const RevisionInfoLineRx =
  /^(?:[^\d{]*(.*?),)? *(?!:)(.*?)(?: *(?!^),?: *(.*))?$/;

/**
 * Matches the title and volnum in the manpage doctype.
 * @example
 * = asciidoctor(1)
 * = asciidoctor ( 1 )
 */
const ManpageTitleVolnumRx = /^(.+?) *\( *(.+?) *\)$/;

/**
 * Matches the name and purpose in the manpage doctype.
 * @example
 * asciidoctor - converts AsciiDoc source files to HTML, DocBook and other formats
 */
const ManpageNamePurposeRx = /^(.+?) +- +(.+)$/;

// ── Preprocessor directives ───────────────────────────────────────────────────

/**
 * Matches a conditional preprocessor directive (ifdef, ifndef, ifeval, endif).
 * @example
 * ifdef::basebackend-html[]
 * ifeval::["{asciidoctor-version}" >= "0.1.0"]
 * endif::[]
 */
const ConditionalDirectiveRx =
  /^(\\)?(ifdef|ifndef|ifeval|endif)::(\S*?(?:([,+])\S*?)?)\[(.+)?\]$/;

/**
 * Matches a restricted (safe) eval expression.
 * @example
 * "{asciidoctor-version}" >= "0.1.0"
 */
const EvalExpressionRx = /^(.+?) *([=!><]=|[><]) *(.+)$/;

/**
 * Matches an include preprocessor directive.
 * @example
 * include::chapter1.ad[]
 * include::example.txt[lines=1;2;5..10]
 */
const IncludeDirectiveRx =
  /^(\\)?include::([^\s[](?:[^[]*[^\s[])?)\[(.+)?\]$/;

/**
 * Matches a trailing tag directive in an include file.
 *
 * NOTE: 'm' flag required so that $ matches end-of-line (not only end-of-string) in JS.
 * NOTE: accounts for \r in Windows line endings.
 * @example
 * // tag::try-catch[]
 * // end::try-catch[]
 */
const TagDirectiveRx = /\b(?:tag|(e)nd)::(\S+?)\[\](?=$|[ \r])/m;

// ── Attribute entries and references ─────────────────────────────────────────

/**
 * Matches a document attribute entry.
 * @example
 * :foo: bar
 * :First Name: Dan
 * :sectnums!:
 */
const AttributeEntryRx = ru$1(
  String.raw`^:(!?${CG_WORD}[^:]*):(?:[ \t]+(.*))?$`
);

/** Matches invalid characters in an attribute name. */
const InvalidAttributeNameCharsRx = ru$1(String.raw`[^${CC_WORD}\-]`);

/**
 * Matches a pass inline macro surrounding an attribute entry value.
 *
 * NOTE: ^ / $ are string anchors here (no 'm' flag). [\s\S]* allows multi-line values.
 * @example
 * pass:[text]
 * pass:a[{a} {b} {c}]
 */
const AttributeEntryPassMacroRx =
  /^pass:([a-z]+(?:,[a-z-]+)*)?\[([\s\S]*)\]$/;

/**
 * Matches an inline attribute reference.
 * @example
 * {foobar}
 * {counter:sequence-name:1}
 * {set:foo:bar}
 */
const AttributeReferenceRx = ru$1(
  String.raw`(\\)?\{(${CG_WORD}[${CC_WORD}\-]*|(set|counter2?):.*?)(\\)?\}`
);

// ── Paragraphs and delimited blocks ──────────────────────────────────────────

/**
 * Matches an anchor (id + optional reference text) on a line above a block.
 * @example
 * [[idname]]
 * [[idname,Reference Text]]
 */
const BlockAnchorRx = ru$1(
  String.raw`^\[\[(?:|([${CC_ALPHA}_:][${CC_WORD}\-:.]*)(?:, *(.+))?)\]\]$`
);

/**
 * Matches an attribute list above a block element.
 * @example
 * [quote, Adam Smith, Wealth of Nations]
 * [{lead}]
 */
const BlockAttributeListRx = ru$1(
  String.raw`^\[(|[${CC_WORD}.#%{,"'].*)\]$`
);

/** Combined pattern matching either a block anchor or a block attribute list. */
const BlockAttributeLineRx = ru$1(
  String.raw`^\[(?:|[${CC_WORD}.#%{,"'].*|\[(?:|[${CC_ALPHA}_:][${CC_WORD}\-:.]*(?:, *.+)?)\])\]$`
);

/**
 * Matches a title above a block.
 * @example
 * .Title goes here
 */
const BlockTitleRx = /^\.(\.?[^ \t.].*)$/;

/**
 * Matches an admonition label at the start of a paragraph.
 * @example
 * NOTE: Just a little note.
 * TIP: Don't forget!
 */
const AdmonitionParagraphRx =
  /^(NOTE|TIP|IMPORTANT|WARNING|CAUTION):[ \t]+/;

/**
 * Matches a literal paragraph (line preceded by at least one space or tab).
 * @example
 * <SPACE>Foo
 * <TAB>Foo
 */
const LiteralParagraphRx = /^([ \t]+.*)$/;

/** Extended Atx section title supporting the Markdown variant (#). */
const ExtAtxSectionTitleRx =
  /^(=={0,5}|##{0,5})[ \t]+(.+?)(?:[ \t]+\1)?$/;

/**
 * Matches the first line of a Setext (two-line) section title.
 * Must not start with '.' and must contain at least one alphanumeric character.
 */
const SetextSectionTitleRx = ru$1(String.raw`^((?!\.).*?${CG_ALNUM}.*)$`);

/**
 * Matches an anchor inside a section title.
 * @example
 * Section Title [[idname]]
 * Section Title [[idname,Reference Text]]
 */
const InlineSectionAnchorRx = ru$1(
  String.raw` (\\)?\[\[([${CC_ALPHA}_:][${CC_WORD}\-:.]*)(?:, *(.+?))?\]\]$`
);

/**
 * Matches invalid ID characters in a section title.
 * NOTE: Uppercase excluded; expression is run only on a lowercase string.
 */
const InvalidSectionIdCharsRx = ru$1(
  String.raw`<[^>]+>|&(?:[a-z][a-z]+\d{0,2}|#\d\d\d{0,4}|#x[\da-f][\da-f][\da-f]{0,3});|[^ ${CC_WORD}\-.]+?`
);

/** Matches an explicit section level style like sect1. */
const SectionLevelStyleRx = /^sect\d$/;

// ── Lists ─────────────────────────────────────────────────────────────────────

/**
 * Detects the start of any list item.
 *
 * NOTE: Check only up to the blank character since non-whitespace follows.
 * IMPORTANT: Must agree with the per-list-type regexps or the parser will hang.
 */
const AnyListRx =
  /^(?:[ \t]*(?:-|\*\**|\.\.*|\u2022|\d+\.|[a-zA-Z]\.|[IVXivx]+\))[ \t]|(?!\/\/[^/])[ \t]*[^ \t].*?(?::::{0,2}|;;)(?:$|[ \t])|<(?:\d+|\.)>[ \t])/;

/**
 * Matches an unordered list item.
 * @example
 * * Foo
 * - Foo
 */
const UnorderedListRx = /^[ \t]*(-|\*\**|\u2022)[ \t]+([\s\S]*)$/;

/**
 * Matches an ordered list item.
 * @example
 * . Foo    1. Foo    a. Foo    I. Foo
 */
const OrderedListRx =
  /^[ \t]*(\.\.*|\d+\.|[a-zA-Z]\.|[IVXivx]+\))[ \t]+([\s\S]*)$/;

/** Ordinal pattern for each ordered list type. */
const OrderedListMarkerRxMap = {
  arabic: /\d+\./,
  loweralpha: /[a-z]\./,
  lowerroman: /[ivx]+\)/,
  upperalpha: /[A-Z]\./,
  upperroman: /[IVX]+\)/,
};

/**
 * Matches a description list entry.
 * @example
 * foo::
 * foo:: The metasyntactic variable …
 */
const DescriptionListRx =
  /^(?!\/\/[^/])[ \t]*([^ \t].*?)(:::{0,2}|;;)(?:$|[ \t]+([\s\S]*)$)/;

/** Matches a sibling description list item (excluding the delimiter given by key). */
const DescriptionListSiblingRx = {
  '::': /^(?!\/\/[^/])[ \t]*([^ \t].*?[^:]|[^ \t:])(::)(?:$|[ \t]+([\s\S]*)$)/,
  ':::':
    /^(?!\/\/[^/])[ \t]*([^ \t].*?[^:]|[^ \t:])(:::)(?:$|[ \t]+([\s\S]*)$)/,
  '::::':
    /^(?!\/\/[^/])[ \t]*([^ \t].*?[^:]|[^ \t:])(::::)(?:$|[ \t]+([\s\S]*)$)/,
  ';;': /^(?!\/\/[^/])[ \t]*([^ \t].*?)(;;)(?:$|[ \t]+([\s\S]*)$)/,
};

/**
 * Matches a callout list item.
 * @example
 * <1> Explanation
 * <.> Explanation with automatic number
 */
const CalloutListRx = /^<(\d+|\.)>[ \t]+([\s\S]*)$/;

/**
 * Matches a callout reference inside literal text (applied line-by-line).
 *
 * Group layout:
 *   1 – optional line-comment prefix (//  #  --  ;;)
 *   2 – backslash escape
 *   3 – optional XML comment delimiter (--)
 *   4 – callout number or dot
 */
const CalloutExtractRx =
  /((?:\/\/|#|--|;;) ?)?(\\)?<!?(|--)(\d+|\.)\3>(?=(?: ?\\?<!?\3(?:\d+|\.)\3>)*$)/m;

/**
 * Template string for CalloutExtractRxMap entries.
 * Runtime value: (\\)?<()(\d+|\.)>(?=(?: ?\\?<(?:\d+|\.)>)*$)
 * Note: 'm' flag added so $ matches end-of-line (Ruby regex default behaviour).
 */
const CalloutExtractRxt =
  '(\\\\)?<()([\\d]+|\\.)>(?=(?: ?\\\\?<(?:\\d+|\\.)>)*$)';

/**
 * Lazy map: line-comment string → callout-extract regex.
 * Mirrors Ruby: Hash.new { |h,k| h[k] = /(prefix)?#{CalloutExtractRxt}/ }
 */
const CalloutExtractRxMap = makeLazyRxMap((key) => {
  const prefix = key ? `(${escapeRegex(key)} ?)?` : '()?';
  return new RegExp(`${prefix}${CalloutExtractRxt}`, 'm')
});

/** Matches a callout reference when scanning source (special chars NOT yet replaced). */
const CalloutScanRx =
  /\\?<!?(|--)(\d+|\.)\1>(?=(?: ?\\?<!?\1(?:\d+|\.)\1>)*$)/m;

/**
 * Matches a callout reference in HTML output (special chars already replaced).
 *
 * Group layout mirrors CalloutExtractRx.
 * Note: 'm' flag so $ matches end-of-line, matching Ruby regex semantics.
 */
const CalloutSourceRx =
  /((?:\/\/|#|--|;;) ?)?(\\)?&lt;!?(|--)(\d+|\.)\3&gt;(?=(?: ?\\?&lt;!?\3(?:\d+|\.)\3&gt;)*$)/m;

/**
 * Template string for CalloutSourceRxMap entries.
 * Runtime value: (\\)?&lt;()(\d+|\.)&gt;(?=(?: ?\\?&lt;(?:\d+|\.)&gt;)*$)
 */
const CalloutSourceRxt =
  '(\\\\)?&lt;()([\\d]+|\\.)&gt;(?=(?: ?\\\\?&lt;(?:\\d+|\\.)&gt;)*$)';

/** Lazy map: line-comment string → callout-source regex. */
const CalloutSourceRxMap = makeLazyRxMap((key) => {
  const prefix = key ? `(${escapeRegex(key)} ?)?` : '()?';
  return new RegExp(`${prefix}${CalloutSourceRxt}`, 'm')
});

/** Dynamic map from list context to its regex. */
const ListRxMap = {
  ulist: UnorderedListRx,
  olist: OrderedListRx,
  dlist: DescriptionListRx,
  colist: CalloutListRx,
};

// ── Tables ────────────────────────────────────────────────────────────────────

/**
 * Parses the column test (colspec) for a table.
 * @example
 * 1*h,2*,^3e
 */
const ColumnSpecRx =
  /^(?:(\d+)\*)?([<^>](?:\.[<^>]?)?|(?:[<^>]?\.)?[<^>])?(\d+%?|~)?([a-z])?$/;

/**
 * Parses the start of a cell test.
 * @example
 * 2.3+<.>m
 */
const CellSpecStartRx =
  /^[ \t]*(?:(\d+(?:\.\d*)?|(?:\d*\.)?\d+)([*+]))?([<^>](?:\.[<^>]?)?|(?:[<^>]?\.)?[<^>])?([a-z])?$/;

/** Parses the end of a cell test. */
const CellSpecEndRx =
  /[ \t]+(?:(\d+(?:\.\d*)?|(?:\d*\.)?\d+)([*+]))?([<^>](?:\.[<^>]?)?|(?:[<^>]?\.)?[<^>])?([a-z])?$/;

// ── Block macros ──────────────────────────────────────────────────────────────

/**
 * Matches the custom block macro pattern.
 * @example
 * gist::123456[]
 */
const CustomBlockMacroRx = ru$1(
  String.raw`^(${CG_WORD}[${CC_WORD}\-]*)::(|\S|\S.*?\S)\[(.+)?\]$`
);

/**
 * Matches an image, video or audio block macro.
 * @example
 * image::filename.png[Caption]
 * video::http://youtube.com/12345[Cats vs Dogs]
 */
const BlockMediaMacroRx = /^(image|video|audio)::(\S|\S.*?\S)\[(.+)?\]$/;

/**
 * Matches the TOC block macro.
 * @example
 * toc::[]
 * toc::[levels=2]
 */
const BlockTocMacroRx = /^toc::\[(.+)?\]$/;

// ── Inline macros ─────────────────────────────────────────────────────────────

/**
 * Matches an anchor (id + optional reference text) in the flow of text.
 *
 * Group layout:
 *   1 – backslash escape
 *   2 – id  (double-bracket form)
 *   3 – reftext  (double-bracket form)
 *   4 – id  (anchor: macro form)
 *   5 – reftext  (anchor: macro form)
 * @example
 * [[idname]]
 * [[idname,Reference Text]]
 * anchor:idname[]
 * anchor:idname[Reference Text]
 */
const InlineAnchorRx = ru$1(
  String.raw`(\\)?(?:\[\[([${CC_ALPHA}_:][${CC_WORD}\-:.]*)(?:, *(.+?))? ?\]\]` +
    String.raw`|anchor:([${CC_ALPHA}_:][${CC_WORD}\-:.]*)\[(?:\]|([\s\S]*?[^\\])\]))`
);

/** Scans for a non-escaped anchor in the flow of text. */
const InlineAnchorScanRx = ru$1(
  String.raw`(?:^|[^\\\[])\[\[([${CC_ALPHA}_:][${CC_WORD}\-:.]*)(?:, *(.+?))? ?\]\]` +
    String.raw`|(?:^|[^\\])anchor:([${CC_ALPHA}_:][${CC_WORD}\-:.]*)\[(?:\]|(.*?[^\\])\])`
);

/** Scans for a leading, non-escaped anchor. */
const LeadingInlineAnchorRx = ru$1(
  String.raw`^\[\[([${CC_ALPHA}_:][${CC_WORD}\-:.]*)(?:, *(.+?))?\]\]`
);

/**
 * Matches a bibliography anchor at the start of a list item.
 * @example
 * [[[Fowler_1997]]] Fowler M. ...
 */
const InlineBiblioAnchorRx = ru$1(
  String.raw`^\[\[\[([${CC_ALPHA}_:][${CC_WORD}\-:.]*)(?:, *(.+?))?\]\]\]`
);

/**
 * Matches an inline e-mail address.
 * @example
 * doc.writer@example.com
 */
const InlineEmailRx = ru$1(
  String.raw`([\\>:/])?${CG_WORD}(?:&amp;|[${CC_WORD}\-.%+])*` +
    String.raw`@${CG_ALNUM}[${CC_ALNUM}_\-.]*\.[a-zA-Z]{2,5}\b`
);

/**
 * Matches an inline footnote macro (may span multiple lines).
 *
 * NOTE: [\s\S]*? allows multiline content (Ruby /m + CC_ALL).
 * NOTE: (?!</a>) avoids matching inside an anchor tag.
 * @example
 * footnote:[text]
 * footnote:id[text]
 * footnoteref:[id,text]  (legacy)
 */
const InlineFootnoteMacroRx = ru$1(
  String.raw`\\?footnote(?:(ref):|:([${CC_WORD}\-]+)?)\[(?:|([\s\S]*?[^\\]))\](?!</a>)`
);

/**
 * Matches an image or icon inline macro (may span multiple lines).
 * @example
 * image:filename.png[Alt Text]
 * icon:github[large]
 */
const InlineImageMacroRx =
  /\\?i(?:mage|con):([^:\s[](?:[^\n[]*[^\s[])?)\[(|[\s\S]*?[^\\])\]/;

/**
 * Matches an indexterm inline macro (may span multiple lines).
 * @example
 * indexterm:[Tigers,Big cats]
 * (((Tigers,Big cats)))
 * ((Tigers))
 */
const InlineIndextermMacroRx =
  /\\?(?:(indexterm2?):\[([\s\S]*?[^\\])\]|\(\(([\s\S]+?)\)\)(?!\)))/;

/**
 * Matches either the kbd or btn inline macro (may span multiple lines).
 * @example
 * kbd:[F3]     kbd:[Ctrl+Shift+T]     btn:[Save]
 */
const InlineKbdBtnMacroRx = /(\\)?(kbd|btn):\[([\s\S]*?[^\\])\]/;

/**
 * Matches an implicit link and the link inline macro.
 *
 * NOTE: This is the Opal/JS variant of the pattern.
 *   Group 2 captures ':' inside a lookahead from the &lt;<protocol> branch.
 *   (?!\2) then guards the &gt;-terminated branch: when group 2 IS ':',
 *   the guard prevents matching '://' at the start of the path; when group 2
 *   is UNSET (other prefix branches), (?!\2) expands to (?!"") which ALWAYS
 *   FAILS – correctly preventing the &gt; branch for non-&lt; prefixes.
 *
 * *** NO 'u' FLAG: the (?!\2) guard relies on unset back-references matching
 *     the empty string, which only holds in non-Unicode mode. ***
 *
 * Group layout:
 *   1 – prefix (^, link:, blank, \\?&lt; or punctuation)
 *   2 – ':' captured by lookahead  (only when prefix is \\?&lt;)
 *   3 – URL scheme + ://
 *   4 – target before [   (formal macro)
 *   5 – attrlist           (formal macro, may be empty)
 *   6 – target before &gt; (angle-bracket autolink, requires &lt; prefix)
 *   7 – target             (bare autolink)
 *   8 – last non-terminating char of bare target
 * @example
 * https://github.com
 * https://github.com[GitHub]
 * <https://github.com>
 * link:https://github.com[]
 */
const InlineLinkRx =
  /(^|link:|[ \t\u00a0]|\\?&lt;(?=\\?(?:https?|file|ftp|irc)(:))|[>()[\];"'])(\\?(?:https?|file|ftp|irc):\/\/)(?:([^\s[\]]+)\[(|[\s\S]*?[^\\])\]|(?!\2)([^\s]+?)&gt;|([^\s[\]<]*([^\s,.?![\]<)])))/m;

/**
 * Matches a link or e-mail inline macro (may span multiple lines).
 * @example
 * link:path[label]
 * mailto:doc.writer@example.com[]
 */
const InlineLinkMacroRx =
  /\\?(?:link|(mailto)):(|[^:\s[][^\s[]*)\[(|[\s\S]*?[^\\])\]/;

/** Matches the name of a macro. */
const MacroNameRx = ru$1(String.raw`^${CG_WORD}[${CC_WORD}\-]*$`);

/**
 * Matches a stem (and alternatives) inline macro (may span multiple lines).
 * @example
 * stem:[x != 0]
 * latexmath:[\sqrt{4} = 2]
 */
const InlineStemMacroRx =
  /\\?(stem|(?:latex|ascii)math):([a-z]+(?:,[a-z-]+)*)?\[([\s\S]*?[^\\])\]/;

/**
 * Matches a menu inline macro (may span multiple lines).
 * @example
 * menu:File[Save As...]
 * menu:View[Page Style > No Style]
 */
const InlineMenuMacroRx = ru$1(
  String.raw`\\?menu:(${CG_WORD}|[${CC_WORD}&][^\n\[]*[^\s\[])` +
    String.raw`\[ *(?:|([\s\S]*?[^\\]))\]`
);

/**
 * Matches an implicit menu inline macro.
 * @example
 * "File > New..."
 */
const InlineMenuRx = ru$1(
  String.raw`\\?"([${CC_WORD}&][^"]*?[ \n]+&gt;[ \n]+[^"]*)"`
);

/**
 * Matches an inline passthrough (may span multiple lines).
 *
 * Group layout (false / non-compat):
 *   1 – preceding context or escape boundary
 *   2 – '[' captured by lookahead (back-reference trick for attribute list detection)
 *   3 – x- / 'attrlist x-' content
 *   4 – QuoteAttributeListRxt content
 *   5 – optional backslash before opening delimiter
 *   6 – full quoted span (including delimiters)
 *   7 – opening/closing delimiter (+ or `)
 *   8 – span content
 *
 * Group layout (true / compat):
 *   1 – preceding char or start-of-line
 *   2 – ($) end-of-string sentinel  (never matches in inline text, preserves group count)
 *   3 – empty group paired with sentinel
 *   4 – QuoteAttributeListRxt content
 *   5 – optional backslash before opening delimiter
 *   6 – full quoted span
 *   7 – opening/closing delimiter (`)
 *   8 – span content
 *
 * NOTE: 'u' flag used, but the 'm' flag is also set so that ^ is a line anchor.
 *   Unset optional back-references (\5?) with 'u' flag: the '?' quantifier
 *   allows 0 occurrences, so the match continues even when the group is unset.
 * @example
 * +text+
 * [x-]+text+
 * `text`  (compat only)
 */
const InlinePassRx = {
  false: [
    '+',
    '-]',
    ru$1(
      String.raw`((?:^|[^${CC_WORD};:\\])(?=(\[)|\+)|\\(?=\[)|(?=\\\+))` +
        String.raw`(?:\2(x-|[^\[\]]+ x-)\]|(?:` +
        QuoteAttributeListRxt +
        String.raw`)?(?=(\\)?\+))` +
        String.raw`(\5?(\+|` +
        '`' +
        String.raw`)(\S|\S` +
        CC_ALL +
        String.raw`*?\S)\7)(?!${CG_WORD})`,
      'm'
    ),
  ],
  true: [
    '`',
    null,
    ru$1(
      String.raw`(^|[^` +
        '`' +
        String.raw`${CC_WORD}])(?:($)()|(?:` +
        QuoteAttributeListRxt +
        String.raw`)(?=(\\?)))?` +
        String.raw`(\5?(` +
        '`' +
        String.raw`)([^` +
        '`' +
        String.raw`\s]|[^` +
        '`' +
        String.raw`\s]` +
        CC_ALL +
        String.raw`*?\S)\7)(?![` +
        '`' +
        String.raw`${CC_WORD}])`,
      'm'
    ),
  ],
};

/**
 * Matches several variants of the passthrough inline macro (may span multiple lines).
 *
 * Group layout:
 *   1 – optional backslash before attribute list
 *   2 – attribute list content  (QuoteAttributeListRxt)
 *   3 – backslash(es) before delimiter  (0–2)
 *   4 – delimiter: +++, ++, or $$
 *   5 – content between delimiters  (\4 closes)
 *   6 – backslash before pass: macro
 *   7 – subs list after pass:
 *   8 – content inside pass:[…]
 * @example
 * +++text+++
 * $$text$$
 * pass:quotes[text]
 * pass:[]
 */
const InlinePassMacroRx = new RegExp(
  `(?:(?:(\\\\?)${QuoteAttributeListRxt})?(\\\\{0,2})(\\+\\+\\+?|\\$\\$)([\\s\\S]*?)\\4|(\\\\?)pass:([a-z]+(?:,[a-z-]+)*)?\\[(|[\\s\\S]*?[^\\\\])\\])`
);

/**
 * Matches an xref (cross-reference) inline macro (may span multiple lines).
 *
 * NOTE: { included to support targets beginning with an attribute reference.
 * NOTE: Special characters are already entity-encoded in the matched text.
 *
 * Group layout:
 *   1 – target of <<…>> form
 *   2 – target of xref:…[] form
 *   3 – link text inside xref:…[…]
 * @example
 * <<id,reftext>>
 * xref:id[reftext]
 */
const InlineXrefMacroRx = ru$1(
  String.raw`\\?(?:&lt;&lt;([${CC_WORD}#/.:{]` +
    CC_ALL +
    String.raw`*?)&gt;&gt;` +
    String.raw`|xref:([${CC_WORD}#/.:{]` +
    CC_ALL +
    String.raw`*?)\[(?:\]|(` +
    CC_ALL +
    String.raw`*?[^\\])\]))`
);

// ── Layout ────────────────────────────────────────────────────────────────────

/**
 * Matches a trailing + preceded by at least one space, forcing a hard line break.
 *
 * NOTE: 'm' flag required so that ^ / $ are line anchors (not string anchors) in JS.
 * @example
 * Humpty Dumpty sat on a wall, +
 * Humpty Dumpty had a great fall.
 */
const HardLineBreakRx = /^(.*) \+$/m;

/**
 * Matches a Markdown horizontal rule.
 * @example
 * --- or - - -
 * *** or * * *
 * ___ or _ _ _
 */
const MarkdownThematicBreakRx = /^ {0,3}([-*_])( *)\1\2\1$/;

/**
 * Matches an AsciiDoc or Markdown horizontal rule, or an AsciiDoc page break.
 * @example
 * '''  <<<  ---  ***  ___
 */
const ExtLayoutBreakRx = /^(?:'{3,}|<{3,}|([-*_])( *)\1\2\1)$/;

// ── General ───────────────────────────────────────────────────────────────────

/** Matches consecutive blank lines. */
const BlankLineRx = /\n{2,}/;

/**
 * Matches whitespace escaped by a backslash.
 * @example
 * three\ blind\ mice
 */
const EscapedSpaceRx = /\\([ \t\n])/g;

/** Detects text that may contain replaceable characters. */
const ReplaceableTextRx = /[&']|--|\.\.\.|\([CRT]M?\)/;

/**
 * Matches a whitespace delimiter (space, tab, newline).
 * Replicates the parsing rules of Ruby %w strings.
 *
 * TODO: Replace with /(?<!\\)[ \t\n]+/ when lookbehind is universally available.
 */
const SpaceDelimiterRx = /([^\\])[ \t\n]+/g;

/** Matches a + or - modifier in a subs list. */
const SubModifierSniffRx = /[+-]/;

/**
 * Matches one or more consecutive digits at the end of a line.
 * @example
 * docbook5   html5
 */
const TrailingDigitsRx = /\d+$/;

/**
 * Detects strings that resemble URIs.
 *
 * NOTE: ^ is used as a string-start anchor (no 'm' flag), equivalent to Ruby \A.
 * NOTE: Does NOT match Windows paths like c:/sample.adoc or c:\sample.adoc.
 * @example
 * http://domain    https://domain    file:///path    data:info
 */
const UriSniffRx = ru$1(String.raw`^${CG_ALPHA}[${CC_ALNUM}.+\-]+:\/{0,2}`);

/** Detects XML tags. */
const XmlSanitizeRx = /<[^>]+>/;

// ESM conversion of lib/asciidoctor.rb
//
// Defines all module-level constants and re-exports every regex constant from
// rx.js so that other modules can import everything from this single file.
//
// Omissions vs. the Ruby source
//   - Ruby-encoding constants (UTF_8, BOM_BYTES_*) – JS strings are always UTF-16.
//   - File-mode strings (FILE_READ_MODE, …) – Ruby open(2) semantics, no JS equivalent.
//   - ROOT_DIR / LIB_DIR / DATA_DIR / USER_HOME – computed via import.meta.url below
//     for Node.js; silently empty in environments where the URL API is unavailable.
//   - const_missing / autoload – Ruby metaprogramming, not applicable in JS.
//   - Compliance – defined in ./compliance.js (imported separately by substitutors.js).
//   - RUBY_ENGINE / RUBY_ENGINE_OPAL – not applicable in JS.


// Local helper – same as the one inside rx.js (not exported there).
const ru = (src, flags = '') => new RegExp(src, `u${flags}`);

// ── SafeMode ─────────────────────────────────────────────────────────────────
// Mirrors the Asciidoctor::SafeMode Ruby module.
const _safeModeNamesByValue = {
  0: 'unsafe',
  1: 'safe',
  10: 'server',
  20: 'secure',
};

const SafeMode = {
  /**
   * A safe mode level that disables any of the security features enforced
   * by Asciidoctor (Node is still subject to its own restrictions).
   */
  UNSAFE: 0,
  /**
   * A safe mode level that closely parallels safe mode in AsciiDoc. This value
   * prevents access to files which reside outside the parent directory of
   * the source file and disables any macro other than the `include::[]` directive.
   */
  SAFE: 1,
  /**
   * A safe mode level that disallows the document from setting attributes
   * that would affect the conversion of the document, in addition to all the
   * security features of {@link SafeMode.SAFE}. For instance, this level forbids
   * changing the backend or source-highlighter using an attribute defined
   * in the source document header. This is the most fundamental level of
   * security for server deployments (hence the name).
   */
  SERVER: 10,
  /**
   * A safe mode level that disallows the document from attempting to read
   * files from the file system and including the contents of them into the
   * document, in additional to all the security features of {@link SafeMode.SERVER}.
   * For instance, this level disallows use of the `include::[]` directive and the
   * embedding of binary content (data uri), stylesheets and JavaScripts
   * referenced by the document. (Asciidoctor and trusted extensions may still
   * be allowed to embed trusted content into the document).
   *
   * Since Asciidoctor is aiming for wide adoption, this level is the default
   * and is recommended for server deployments.
   */
  SECURE: 20,

  /**
   * Returns the numeric value for a safe-mode name string, or undefined.
   * @param {string} name
   * @returns {number|undefined}
   */
  valueForName(name) {
    const key = String(name).toUpperCase();
    const v = SafeMode[key];
    return typeof v === 'number' ? v : undefined
  },

  /**
   * @param {string} name
   * @returns {number|undefined}
   */
  getValueForName(name) {
    return this.valueForName(name)
  },

  /**
   * Returns the lowercase name for a numeric safe-mode value, or undefined.
   * @param {number} value
   * @returns {string|undefined}
   */
  nameForValue(value) {
    return _safeModeNamesByValue[value]
  },

  /**
   * @param {number} value
   * @returns {string|undefined}
   */
  getNameForValue(value) {
    return this.nameForValue(value)
  },

  /**
   * Returns all safe-mode names in ascending value order.
   * @returns {string[]}
   */
  names() {
    return Object.values(_safeModeNamesByValue)
  },

  /**
   * @returns {string[]}
   */
  getNames() {
    return this.names()
  },
};

/**
 * Named constants for the `contentModel` property on {@link AbstractBlock}.
 *
 * The content model controls what kind of content a block accepts and how it
 * is converted.
 *
 * @example
 * import { ContentModel } from '@asciidoctor/core'
 * const verbatimBlocks = doc.findBy({}, (b) => b.contentModel === ContentModel.VERBATIM || 'reject')
 */
const ContentModel = {
  /** The block contains other blocks (sections, sidebars, admonitions, …). */
  COMPOUND: 'compound',
  /** The block holds a paragraph of prose that receives normal substitutions. */
  SIMPLE: 'simple',
  /** The block holds verbatim text displayed as-is with verbatim substitutions (listing, literal). */
  VERBATIM: 'verbatim',
  /** The block holds unprocessed content passed directly to output with no substitutions (pass). */
  RAW: 'raw',
  /** The block has no content (e.g. image, thematic break). */
  EMPTY: 'empty',
};

// ── File-system paths (Node.js only) ─────────────────────────────────────────
// In a browser / Deno / Opal-compiled context these will be empty strings.
let ROOT_DIR = '';
let LIB_DIR = '';
let DATA_DIR = '';
let USER_HOME = '';
try {
  LIB_DIR = new URL('.', import.meta.url).pathname.replace(/\/$/, '');
  ROOT_DIR = new URL('../../', import.meta.url).pathname.replace(/\/$/, '');
  DATA_DIR = new URL('../../data', import.meta.url).pathname;
  // Prefer $HOME; fall back to $USERPROFILE (Windows) then process.cwd()
  if (typeof process !== 'undefined') {
    USER_HOME =
      process.env.HOME ||
      process.env.USERPROFILE ||
      (process.cwd ? process.cwd() : '');
  }
} catch {}

// ── Primitive constants ───────────────────────────────────────────────────────
// The newline character used for output.
const LF$1 = '\n';

// The null character used as an internal separator for attribute values.
const NULL = '\0';

// Maximum safe integer (= Number.MAX_SAFE_INTEGER).
const MAX_INT = 9007199254740991;

// ── Document defaults ─────────────────────────────────────────────────────────
const DEFAULT_DOCTYPE = 'article';
const DEFAULT_BACKEND = 'html5';

const DEFAULT_STYLESHEET_KEYS = new Set(['', 'DEFAULT']);
const DEFAULT_STYLESHEET_NAME = 'asciidoctor.css';

// Maps legacy backend aliases to the canonical backend name.
const BACKEND_ALIASES = {
  html: 'html5',
  docbook: 'docbook5',
};

// Default page widths (points) used when computing absolute column widths.
const DEFAULT_PAGE_WIDTHS = { docbook: 425 };

// Default output file extensions per base backend.
const DEFAULT_EXTENSIONS = {
  html: '.html',
  docbook: '.xml',
  pdf: '.pdf',
  epub: '.epub',
  manpage: '.man',
  asciidoc: '.adoc',
};

// File extensions that are recognized as AsciiDoc documents.
// TODO: .txt should be deprecated
const ASCIIDOC_EXTENSIONS = {
  '.adoc': true,
  '.asciidoc': true,
  '.asc': true,
  '.ad': true,
  '.txt': true,
};

// ── Section titles ────────────────────────────────────────────────────────────
// Maps setext underline characters to section levels.
const SETEXT_SECTION_LEVELS = {
  '=': 0,
  '-': 1,
  '~': 2,
  '^': 3,
  '+': 4,
};

// ── Admonition ───────────────────────────────────────────────────────────────
const ADMONITION_STYLES = new Set([
  'NOTE',
  'TIP',
  'IMPORTANT',
  'WARNING',
  'CAUTION',
]);
const ADMONITION_STYLE_HEADS = new Set(
  [...ADMONITION_STYLES].map((s) => s[0])
);

// ── Block styles ──────────────────────────────────────────────────────────────
const PARAGRAPH_STYLES = new Set([
  'comment',
  'example',
  'literal',
  'listing',
  'normal',
  'open',
  'pass',
  'quote',
  'sidebar',
  'source',
  'verse',
  'abstract',
  'partintro',
]);

const VERBATIM_STYLES = new Set([
  'literal',
  'listing',
  'source',
  'verse',
]);

// ── Delimited blocks ──────────────────────────────────────────────────────────
// Maps delimiter string → [context, Set of alternative styles].
// Ruby symbols are represented as plain strings.
const DELIMITED_BLOCKS = {
  '--': [
    'open',
    new Set([
      'comment',
      'example',
      'literal',
      'listing',
      'pass',
      'quote',
      'sidebar',
      'source',
      'verse',
      'admonition',
      'abstract',
      'partintro',
    ]),
  ],
  '----': ['listing', new Set(['literal', 'source'])],
  '....': ['literal', new Set(['listing', 'source'])],
  '====': ['example', new Set(['admonition'])],
  '****': ['sidebar', new Set()],
  ____: ['quote', new Set(['verse'])],
  '++++': ['pass', new Set(['stem', 'latexmath', 'asciimath'])],
  '|===': ['table', new Set()],
  ',===': ['table', new Set()],
  ':===': ['table', new Set()],
  '!===': ['table', new Set()],
  '~~~~': ['open', new Set(['abstract', 'partintro'])],
  '////': ['comment', new Set()],
  '```': ['fenced_code', new Set()],
};

// First 2 characters of each delimiter → true (used for fast sniff).
const DELIMITED_BLOCK_HEADS = Object.fromEntries(
  Object.keys(DELIMITED_BLOCKS).map((k) => [k.slice(0, 2), true])
);

// 4-character delimiters only: delimiter → last character (used for tail matching).
const DELIMITED_BLOCK_TAILS = Object.fromEntries(
  Object.keys(DELIMITED_BLOCKS)
    .filter((k) => k.length === 4)
    .map((k) => [k, k[k.length - 1]])
);

// ── Captions ──────────────────────────────────────────────────────────────────
// Maps block context to the document attribute that holds its caption prefix.
// NOTE: 'figure' key is a string for historical reasons (used by image blocks).
const CAPTION_ATTRIBUTE_NAMES = {
  example: 'example-caption',
  figure: 'figure-caption',
  listing: 'listing-caption',
  table: 'table-caption',
};

// ── Layout breaks ─────────────────────────────────────────────────────────────
const LAYOUT_BREAK_CHARS = {
  "'": 'thematic_break',
  '<': 'page_break',
};

const MARKDOWN_THEMATIC_BREAK_CHARS = {
  '-': 'thematic_break',
  '*': 'thematic_break',
  _: 'thematic_break',
};

const HYBRID_LAYOUT_BREAK_CHARS = {
  ...LAYOUT_BREAK_CHARS,
  ...MARKDOWN_THEMATIC_BREAK_CHARS,
};

// ── Lists ─────────────────────────────────────────────────────────────────────
const NESTABLE_LIST_CONTEXTS = ['ulist', 'olist', 'dlist'];

// Ordered list style names, in selection priority order.
const ORDERED_LIST_STYLES = [
  'arabic',
  'loweralpha',
  'lowerroman',
  'upperalpha',
  'upperroman',
];

// Maps an ordered list style name to its CSS list-style-type keyword.
const ORDERED_LIST_KEYWORDS = {
  loweralpha: 'a',
  lowerroman: 'i',
  upperalpha: 'A',
  upperroman: 'I',
};

// ── Inline markers ────────────────────────────────────────────────────────────
const ATTR_REF_HEAD = '{';
const LIST_CONTINUATION = '+';
// NOTE AsciiDoc.py allows + to be preceded by TAB; Asciidoctor does not
const HARD_LINE_BREAK = ' +';
const LINE_CONTINUATION = ' \\';
const LINE_CONTINUATION_LEGACY = ' +';

// ── Math / STEM ───────────────────────────────────────────────────────────────
const BLOCK_MATH_DELIMITERS = {
  asciimath: ['\\$', '\\$'],
  latexmath: ['\\[', '\\]'],
};

const INLINE_MATH_DELIMITERS = {
  latexmath: ['\\(', '\\)'],
};

// Maps STEM type aliases to canonical type names.
// Accessing an unknown key returns 'asciimath' (mirrors Ruby Hash#default).
const STEM_TYPE_ALIASES = new Proxy(
  { latexmath: 'latexmath', latex: 'latexmath', tex: 'latexmath' },
  {
    get: (target, key) =>
      Object.hasOwn(target, key) ? target[key] : 'asciimath',
  }
);

// ── Third-party library versions ──────────────────────────────────────────────
const FONT_AWESOME_VERSION = '4.7.0';
const HIGHLIGHT_JS_VERSION = '9.18.3';
const MATHJAX_VERSION = '2.7.9';

// ── Default document attributes ───────────────────────────────────────────────
const DEFAULT_ATTRIBUTES = {
  'appendix-caption': 'Appendix',
  'appendix-refsig': 'Appendix',
  'caution-caption': 'Caution',
  'chapter-refsig': 'Chapter',
  'example-caption': 'Example',
  'figure-caption': 'Figure',
  'important-caption': 'Important',
  'last-update-label': 'Last updated',
  'note-caption': 'Note',
  'part-refsig': 'Part',
  prewrap: '',
  sectids: '',
  'section-refsig': 'Section',
  'table-caption': 'Table',
  'tip-caption': 'Tip',
  'toc-placement': 'auto',
  'toc-title': 'Table of Contents',
  'untitled-label': 'Untitled',
  'version-label': 'Version',
  'warning-caption': 'Warning',
};

// Attributes that may be changed mid-document (e.g. sectnums toggling).
const FLEXIBLE_ATTRIBUTES = ['sectnums'];

// Predefined (intrinsic) attribute substitutions.
const INTRINSIC_ATTRIBUTES = {
  startsb: '[',
  endsb: ']',
  vbar: '|',
  caret: '^',
  asterisk: '*',
  tilde: '~',
  plus: '&#43;',
  backslash: '\\',
  backtick: '`',
  blank: '',
  empty: '',
  sp: ' ',
  'two-colons': '::',
  'two-semicolons': ';;',
  nbsp: '&#160;',
  deg: '&#176;',
  zwsp: '&#8203;',
  quot: '&#34;',
  apos: '&#39;',
  lsquo: '&#8216;',
  rsquo: '&#8217;',
  ldquo: '&#8220;',
  rdquo: '&#8221;',
  wj: '&#8288;',
  brvbar: '&#166;',
  pp: '&#43;&#43;',
  cpp: 'C&#43;&#43;',
  cxx: 'C&#43;&#43;',
  amp: '&',
  lt: '<',
  gt: '>',
};

// ── Quote substitutions ───────────────────────────────────────────────────────
// Each entry is a triple: [type, scope, RegExp].
// type  – string matching a Ruby symbol (e.g. 'strong', 'emphasis', …)
// scope – 'unconstrained' | 'constrained'
//
// Ruby regex flag notes
//   /m in Ruby = dotAll (.  matches \n); handled by CC_ALL = '[\\s\\S]' → no 's' flag needed.
//   ^ / $ are always line anchors in Ruby → need JS 'm' flag when ^ or $ appears.
//   \p{…} Unicode properties require JS 'u' flag (provided by the ru() helper).
//
// Backtick character (U+0060) cannot appear literally inside a JS template literal,
// so it is injected via the BT variable in template expressions.
const BT = '\x60'; // U+0060 GRAVE ACCENT / backtick

const _normalQuoteSubs = [
  // **strong**
  [
    'strong',
    'unconstrained',
    ru(String.raw`\\?(?:${QuoteAttributeListRxt})?\*\*(${CC_ALL}+?)\*\*`),
  ],
  // *strong*
  [
    'strong',
    'constrained',
    ru(
      String.raw`(^|[^${CC_WORD};:}])(?:${QuoteAttributeListRxt})?\*(\S|\S${CC_ALL}*?\S)\*(?!${CG_WORD})`,
      'm'
    ),
  ],
  // "`double-quoted`"
  [
    'double',
    'constrained',
    ru(
      String.raw`(^|[^${CC_WORD};:}])(?:${QuoteAttributeListRxt})?"${BT}(\S|\S${CC_ALL}*?\S)${BT}"(?!${CG_WORD})`,
      'm'
    ),
  ],
  // '`single-quoted`'
  [
    'single',
    'constrained',
    ru(
      String.raw`(^|[^${CC_WORD};:${BT}}])(?:${QuoteAttributeListRxt})?'${BT}(\S|\S${CC_ALL}*?\S)${BT}'(?!${CG_WORD})`,
      'm'
    ),
  ],
  // ``monospaced``
  [
    'monospaced',
    'unconstrained',
    ru(
      String.raw`\\?(?:${QuoteAttributeListRxt})?${BT}${BT}(${CC_ALL}+?)${BT}${BT}`
    ),
  ],
  // `monospaced`
  [
    'monospaced',
    'constrained',
    ru(
      String.raw`(^|[^${CC_WORD};:"'${BT}}])(?:${QuoteAttributeListRxt})?${BT}(\S|\S${CC_ALL}*?\S)${BT}(?![${CC_WORD}"'${BT}])`,
      'm'
    ),
  ],
  // __emphasis__
  [
    'emphasis',
    'unconstrained',
    ru(String.raw`\\?(?:${QuoteAttributeListRxt})?__(${CC_ALL}+?)__`),
  ],
  // _emphasis_
  [
    'emphasis',
    'constrained',
    ru(
      String.raw`(^|[^${CC_WORD};:}])(?:${QuoteAttributeListRxt})?_(\S|\S${CC_ALL}*?\S)_(?!${CG_WORD})`,
      'm'
    ),
  ],
  // ##mark##
  [
    'mark',
    'unconstrained',
    ru(String.raw`\\?(?:${QuoteAttributeListRxt})?##(${CC_ALL}+?)##`),
  ],
  // #mark#
  [
    'mark',
    'constrained',
    ru(
      String.raw`(^|[^${CC_WORD}&;:}])(?:${QuoteAttributeListRxt})?#(\S|\S${CC_ALL}*?\S)#(?!${CG_WORD})`,
      'm'
    ),
  ],
  // ^superscript^
  [
    'superscript',
    'unconstrained',
    ru(String.raw`\\?(?:${QuoteAttributeListRxt})?\^(\S+?)\^`),
  ],
  // ~subscript~
  [
    'subscript',
    'unconstrained',
    ru(String.raw`\\?(?:${QuoteAttributeListRxt})?~(\S+?)~`),
  ],
];

// Compatibility mode overrides (entries replaced / inserted relative to normal).
const _compatQuoteSubs = [..._normalQuoteSubs];
// ``quoted''
_compatQuoteSubs[2] = [
  'double',
  'constrained',
  ru(
    String.raw`(^|[^${CC_WORD};:}])(?:${QuoteAttributeListRxt})?${BT}${BT}(\S|\S${CC_ALL}*?\S)''(?!${CG_WORD})`,
    'm'
  ),
];
// `quoted'
_compatQuoteSubs[3] = [
  'single',
  'constrained',
  ru(
    String.raw`(^|[^${CC_WORD};:}])(?:${QuoteAttributeListRxt})?${BT}(\S|\S${CC_ALL}*?\S)'(?!${CG_WORD})`,
    'm'
  ),
];
// ++monospaced++
_compatQuoteSubs[4] = [
  'monospaced',
  'unconstrained',
  ru(String.raw`\\?(?:${QuoteAttributeListRxt})?\+\+(${CC_ALL}+?)\+\+`),
];
// +monospaced+
_compatQuoteSubs[5] = [
  'monospaced',
  'constrained',
  ru(
    String.raw`(^|[^${CC_WORD};:}])(?:${QuoteAttributeListRxt})?\+(\S|\S${CC_ALL}*?\S)\+(?!${CG_WORD})`,
    'm'
  ),
];
// 'emphasis'  – inserted before original index 3 (single-quoted)
_compatQuoteSubs.splice(3, 0, [
  'emphasis',
  'constrained',
  ru(
    String.raw`(^|[^${CC_WORD};:}])(?:${QuoteAttributeListRxt})?'(\S|\S${CC_ALL}*?\S)'(?!${CG_WORD})`,
    'm'
  ),
]);

// Keyed by boolean compat mode (false = normal, true = compat).
// JS object keys are always strings, so QUOTE_SUBS[false] coerces to QUOTE_SUBS['false'].
const QUOTE_SUBS = { false: _normalQuoteSubs, true: _compatQuoteSubs };

// ── Text replacements ─────────────────────────────────────────────────────────
// Each entry is a triple: [RegExp, replacement String, position hint].
// position hints: 'none' | 'leading' | 'bounding'
//
// NOTE: order of replacements is significant.
const REPLACEMENTS = [
  // (C)
  [/\\?\(C\)/, '&#169;', 'none'],
  // (R)
  [/\\?\(R\)/, '&#174;', 'none'],
  // (TM)
  [/\\?\(TM\)/, '&#8482;', 'none'],
  // foo -- bar  (either space may be a newline; ^ / $ are line anchors → 'm' flag)
  [/(?: |\n|^|\\)--(?: |\n|$)/m, '&#8201;&#8212;&#8201;', 'none'],
  // foo--bar
  [
    ru(String.raw`(${CG_WORD})\\?--(?=${CG_WORD})`),
    '&#8212;&#8203;',
    'leading',
  ],
  // ellipsis
  [/\\?\.\.\./, '&#8230;&#8203;', 'none'],
  // right single quote
  [/\\?`'/, '&#8217;', 'none'],
  // apostrophe (inside a word)
  [ru(String.raw`(${CG_ALNUM})\\?'(?=${CG_ALPHA})`), '&#8217;', 'leading'],
  // right arrow ->
  [/\\?-&gt;/, '&#8594;', 'none'],
  // right double arrow =>
  [/\\?=&gt;/, '&#8658;', 'none'],
  // left arrow <-
  [/\\?&lt;-/, '&#8592;', 'none'],
  // left double arrow <=
  [/\\?&lt;=/, '&#8656;', 'none'],
  // restore entities
  [
    /\\?(&)amp;((?:[a-zA-Z][a-zA-Z]+\d{0,2}|#\d\d\d{0,4}|#x[\da-fA-F][\da-fA-F][\da-fA-F]{0,3});)/,
    '',
    'bounding',
  ],
];

const BASIC_SUBS = Object.freeze(['specialcharacters']);
const NORMAL_SUBS = Object.freeze([
  'specialcharacters',
  'quotes',
  'attributes',
  'replacements',
  'macros',
  'post_replacements',
]);

// ESM conversion of logging.rb
//
// Ruby-to-JavaScript notes:
//   - Ruby's Logger hierarchy (Logger, MemoryLogger, NullLogger) is reimplemented
//     without inheriting from a stdlib Logger class.
//   - Severity levels mirror Ruby's Logger::Severity constants.
//   - Logger.BasicFormatter formats messages as "asciidoctor: SEVERITY: text\n".
//   - Logger.AutoFormattingMessage is an interface for objects that carry both
//     text and source_location; in JS it is a plain object with a custom
//     toString / inspect method attached.
//   - LoggerManager is a module-level singleton object (not a class instance).
//   - The Logging mixin is applied via applyLogging(prototype) which installs
//     `logger` and `messageWithContext` on the target prototype.
//   - In JS there is no $stderr; the default pipe is console.error.

// ── Severity levels (mirrors Ruby Logger::Severity) ──────────────────────────
const Severity = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  FATAL: 4,
  UNKNOWN: 5,
};

const SEVERITY_LABEL = ['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL', 'ANY'];
const SEVERITY_LABEL_SUBSTITUTES = { WARN: 'WARNING', FATAL: 'FAILED' };

/**
 * Convert a string or nullable severity value to a numeric Severity constant.
 * @param {number|string|null|undefined} severity
 * @returns {number}
 * @internal
 */
function resolveSeverity(severity) {
  if (typeof severity === 'number') return severity
  if (typeof severity === 'string')
    return Severity[severity.toUpperCase()] ?? Severity.UNKNOWN
  return severity ?? Severity.UNKNOWN
}

// ── Per-execution logger context ─────────────────────────────────────────────

// Holds an AsyncLocalStorage instance once it is lazily initialised.
// Allows per-execution logger isolation without mutating the global singleton,
// making concurrent test execution (e.g. Deno's node:test) safe.
let _loggerStore = null;

// Promise singleton — ensures AsyncLocalStorage is initialised at most once.
let _loggerStorePromise = null;

/**
 * Lazily initialise an AsyncLocalStorage for per-execution logger context.
 * Falls back to null in environments that do not support node:async_hooks (e.g. browsers).
 * @returns {Promise<import('node:async_hooks').AsyncLocalStorage|null>}
 */
async function _ensureLoggerStore() {
  if (_loggerStorePromise === null) {
    _loggerStorePromise = import('node:async_hooks')
      .then(({ AsyncLocalStorage }) => {
        const store = new AsyncLocalStorage();
        _loggerStore = store;
        return store
      })
      .catch(() => null);
  }
  return _loggerStorePromise
}

/** @internal — returns the logger bound to the current async context, or null */
function getContextLogger() {
  return _loggerStore?.getStore() ?? null
}

/**
 * Run fn() within an async-local logger context so that all log calls via
 * `this.logger` (from applyLogging) automatically route to the provided logger
 * for the duration of the async execution chain.
 *
 * Falls back to global mutation in environments without node:async_hooks (e.g. browsers).
 *
 * @param {Logger|MemoryLogger|NullLogger} logger - The logger to activate.
 * @param {() => any} fn - The function to execute within the logger context.
 * @returns {Promise<any>}
 */
async function withLogger(logger, fn) {
  const store = await _ensureLoggerStore();
  if (store) {
    return store.run(logger, fn)
  }
  // Fallback for environments without node:async_hooks (browsers).
  const prev = LoggerManager.logger;
  if (logger !== prev) LoggerManager.logger = logger;
  try {
    return await fn()
  } finally {
    if (logger !== prev) LoggerManager.logger = prev;
  }
}

/**
 * A logger-compatible object: any of the built-in Logger implementations, or the
 * global `console` (used as a fallback when no document/logger is available).
 * @typedef {Logger|MemoryLogger|NullLogger|Console} LoggerLike
 */

// ── Logger ────────────────────────────────────────────────────────────────────

/** Standard logger that writes formatted messages to stderr or a custom pipe. */
class Logger {
  /**
   * @param {Object} [opts]
   * @param {string} [opts.progname]
   * @param {number} [opts.level]
   * @param {{call: Function}} [opts.formatter]
   * @param {{write: (line: string) => void}|((line: string, severity: number) => void)|null} [opts.pipe] -
   *   Destination for formatted output lines, mirroring Ruby's `Logger.new(logdev)`.
   *   Accepts anything with a `write(line)` method (e.g. a Node stream), or a plain
   *   function called as `(line, severity)` — the numeric severity lets a function-style
   *   pipe route by level (e.g. console.error for ERROR+, console.warn for WARN) without
   *   overriding add(). Defaults to `process.stderr`/`console.error` when omitted.
   */
  constructor(opts = {}) {
    this.progname = opts.progname ?? 'asciidoctor';
    this.level = opts.level ?? Severity.WARN;
    /** @internal */
    this._maxSeverity = null;
    /** @internal */
    this._formatter = opts.formatter ?? new Logger.BasicFormatter();
    /** @internal */
    this._pipe = opts.pipe ?? null; // null → write via default _writeln destination
  }

  /** getter/setter so custom logger impls can access this.formatter */
  get formatter() {
    return this._formatter
  }
  set formatter(f) {
    this._formatter = f;
  }

  /**
   * @returns {number|null} The highest severity level logged so far.
   */
  get maxSeverity() {
    return this._maxSeverity
  }

  // Fluent getters/setters (used by the public API consumed by tests)
  getLevel() {
    return this.level
  }
  setLevel(n) {
    this.level = n;
  }
  getFormatter() {
    return this._formatter
  }
  setFormatter(f) {
    this._formatter = f;
  }
  getProgramName() {
    return this.progname
  }
  setProgramName(n) {
    this.progname = n;
  }
  getMaxSeverity() {
    return this._maxSeverity
  }

  /**
   * @returns {boolean} Whether DEBUG-level messages will be logged.
   */
  isDebugEnabled() {
    return this.level <= Severity.DEBUG
  }

  /**
   * @returns {boolean} Whether INFO-level messages will be logged.
   */
  isInfoEnabled() {
    return this.level <= Severity.INFO
  }

  /**
   * @returns {boolean} Whether WARN-level messages will be logged.
   */
  isWarnEnabled() {
    return this.level <= Severity.WARN
  }

  /**
   * @returns {boolean} Whether ERROR-level messages will be logged.
   */
  isErrorEnabled() {
    return this.level <= Severity.ERROR
  }

  /**
   * @returns {boolean} Whether FATAL-level messages will be logged.
   */
  isFatalEnabled() {
    return this.level <= Severity.FATAL
  }

  // Kept for internal compatibility
  isDebug() {
    return this.level <= Severity.DEBUG
  }
  isInfo() {
    return this.level <= Severity.INFO
  }

  /**
   * Log a message at the given severity level.
   * @param {number|string} severity - Severity level (numeric constant or string name).
   * @param {string|{inspect?(): string}|null} [message=null] - The message to log.
   * @param {string|Function|null} [progname=null] - Program name or message supplier function.
   * @returns {boolean}
   */
  add(severity, message = null, progname = null) {
    severity = resolveSeverity(severity);
    if (this._maxSeverity === null || severity > this._maxSeverity) {
      this._maxSeverity = severity;
    }
    if (severity < this.level) return true
    const text =
      message ?? (typeof progname === 'function' ? progname() : progname);
    const label = SEVERITY_LABEL[severity] ?? 'ANY';
    const line = this._formatter.call(label, null, this.progname, text);
    this._writeln(line, severity);
    return true
  }

  /**
   * Alias for {@link add} (Ruby Logger API).
   * @param {number|string} severity
   * @param {string|{inspect?(): string}|null} [message=null]
   * @param {string|Function|null} [progname=null]
   * @returns {boolean}
   */
  log(severity, message, progname) {
    return this.add(severity, message, progname)
  }

  /**
   * @param {string|{inspect?(): string}|null} [msg=null]
   * @param {string|Function|null} [progname=null]
   * @returns {boolean}
   */
  debug(msg, progname) {
    return this.add(Severity.DEBUG, msg, progname)
  }
  /**
   * @param {string|{inspect?(): string}|null} [msg=null]
   * @param {string|Function|null} [progname=null]
   * @returns {boolean}
   */
  info(msg, progname) {
    return this.add(Severity.INFO, msg, progname)
  }
  /**
   * @param {string|{inspect?(): string}|null} [msg=null]
   * @param {string|Function|null} [progname=null]
   * @returns {boolean}
   */
  warn(msg, progname) {
    return this.add(Severity.WARN, msg, progname)
  }
  /**
   * @param {string|{inspect?(): string}|null} [msg=null]
   * @param {string|Function|null} [progname=null]
   * @returns {boolean}
   */
  error(msg, progname) {
    return this.add(Severity.ERROR, msg, progname)
  }
  /**
   * @param {string|{inspect?(): string}|null} [msg=null]
   * @param {string|Function|null} [progname=null]
   * @returns {boolean}
   */
  fatal(msg, progname) {
    return this.add(Severity.FATAL, msg, progname)
  }
  /**
   * @param {string|{inspect?(): string}|null} [msg=null]
   * @param {string|Function|null} [progname=null]
   * @returns {boolean}
   */
  unknown(msg, progname) {
    return this.add(Severity.UNKNOWN, msg, progname)
  }

  /**
   * Write a formatted line to the configured pipe, or fall back to stderr/console.error.
   * @param {string} line
   * @param {number} severity - Numeric severity, forwarded to a function-style pipe so
   *   it can route by level (e.g. console.error vs console.warn) without overriding add().
   *   Not passed to an object-style pipe's write(), to stay compatible with Node's
   *   Writable#write(chunk, encoding) signature.
   * @internal
   */
  _writeln(line, severity) {
    if (this._pipe) {
      typeof this._pipe.write === 'function'
        ? this._pipe.write(line)
        : this._pipe(line, severity);
    } else if (typeof process !== 'undefined' && process.stderr?.write) {
      process.stderr.write(line);
    } else {
      // Unlike stream.write(), console.error() appends its own line terminator,
      // so the formatter's trailing \n must be stripped to avoid a blank line.
      console.error(line.replace(/\n$/, ''));
    }
  }
}

Logger.BasicFormatter = class {
  /**
   * Format a log entry as "progname: SEVERITY: message\n".
   * @param {number|string} severity
   * @param {null} _time
   * @param {string} progname
   * @param {string|{inspect?(): string}} msg
   * @returns {string}
   */
  call(severity, _time, progname, msg) {
    // severity may be numeric (from newLogger impls) or a string label
    const label =
      typeof severity === 'number'
        ? (SEVERITY_LABEL[severity] ?? 'ANY')
        : severity;
    const substituted = SEVERITY_LABEL_SUBSTITUTES[label] ?? label;
    const text =
      typeof msg === 'string' ? msg : (msg?.inspect?.() ?? String(msg));
    return `${progname}: ${substituted}: ${text}\n`
  }
};

Logger.AutoFormattingMessage = {
  /**
   * Attach auto-formatting to any plain object carrying
   * { text, source_location, include_location }.
   *
   * The location(s) are rendered only by inspect()/toString() (used when a
   * stderr Logger formats the line); the structured `source_location` /
   * `include_location` remain on the object so a MemoryLogger can record them
   * on the resulting LogMessage without duplicating them inside `text`.
   * @param {{text: string, source_location?: any, include_location?: any}} obj
   * @returns {typeof obj} The same object with inspect() and toString() added.
   */
  attach(obj) {
    obj.inspect = function () {
      const sloc = this.source_location;
      const iloc = this.include_location;
      let text = sloc ? `${sloc}: ${this.text}` : this.text;
      if (iloc) text += ` (${iloc})`;
      return text
    };
    obj.toString = obj.inspect;
    return obj
  },
};

// ── LogMessage ────────────────────────────────────────────────────────────────

/** Wrapper stored by MemoryLogger; provides getSeverity/getText/getSourceLocation. */
class LogMessage {
  /**
   * @param {string} severity - Severity label, e.g. 'ERROR'.
   * @param {string|{text: string, source_location?: import('./reader.js').Cursor}|null} message
   */
  constructor(severity, message) {
    this.message = message;
    /** @type {string} */
    this.severity = severity; // string label, e.g. 'ERROR'
    // AutoFormattingMessage objects carry { text, source_location }
    if (message !== null && typeof message === 'object' && 'text' in message) {
      /** @type {string} */
      this.text = message.text;
      /** @type {import('./reader.js').Cursor|null} */
      this.sourceLocation = message.source_location ?? null;
    } else {
      this.text = message != null ? String(message) : '';
      this.sourceLocation = null;
    }
  }

  /**
   * @returns {string} The severity label, e.g. 'ERROR'.
   */
  getSeverity() {
    return this.severity
  }

  /**
   * @returns {string} The message text.
   */
  getText() {
    return this.text
  }

  /**
   * @returns {import('./reader.js').Cursor|undefined} The source location, if any.
   */
  getSourceLocation() {
    return this.sourceLocation ?? undefined
  }
}

// ── MemoryLogger ──────────────────────────────────────────────────────────────

/** In-memory logger that stores all log messages for later inspection. */
class MemoryLogger {
  constructor() {
    // Default level is UNKNOWN (highest) so isDebug() returns false by default,
    // matching Ruby's MemoryLogger (level: UNKNOWN). The add() method stores all
    // messages unconditionally — level is only used by the isDebug() guard.
    this.level = Severity.UNKNOWN;
    /** @type {LogMessage[]} */
    this.messages = [];
  }

  static create() {
    return new MemoryLogger()
  }

  /**
   * @returns {LogMessage[]} The log messages recorded so far, in order.
   */
  getMessages() {
    return this.messages
  }

  getMaxSeverity() {
    if (this.messages.length === 0) return null
    return Math.max(
      ...this.messages.map((m) => Severity[m.getSeverity()] ?? Severity.UNKNOWN)
    )
  }

  add(severity, message = null, progname = null) {
    const sev = resolveSeverity(severity);
    const msg =
      message ?? (typeof progname === 'function' ? progname() : progname);
    const severityName = SEVERITY_LABEL[sev] ?? 'UNKNOWN';
    this.messages.push(new LogMessage(severityName, msg));
    return true
  }

  /**
   * @param {string|{inspect?(): string}|null} [msg=null]
   * @param {string|Function|null} [pn=null]
   * @returns {boolean}
   */
  debug(msg, pn) {
    return this.add(Severity.DEBUG, msg, pn)
  }
  /**
   * @param {string|{inspect?(): string}|null} [msg=null]
   * @param {string|Function|null} [pn=null]
   * @returns {boolean}
   */
  info(msg, pn) {
    return this.add(Severity.INFO, msg, pn)
  }
  /**
   * @param {string|{inspect?(): string}|null} [msg=null]
   * @param {string|Function|null} [pn=null]
   * @returns {boolean}
   */
  warn(msg, pn) {
    return this.add(Severity.WARN, msg, pn)
  }
  /**
   * @param {string|{inspect?(): string}|null} [msg=null]
   * @param {string|Function|null} [pn=null]
   * @returns {boolean}
   */
  error(msg, pn) {
    return this.add(Severity.ERROR, msg, pn)
  }
  /**
   * @param {string|{inspect?(): string}|null} [msg=null]
   * @param {string|Function|null} [pn=null]
   * @returns {boolean}
   */
  fatal(msg, pn) {
    return this.add(Severity.FATAL, msg, pn)
  }
  /**
   * @param {string|{inspect?(): string}|null} [msg=null]
   * @param {string|Function|null} [pn=null]
   * @returns {boolean}
   */
  unknown(msg, pn) {
    return this.add(Severity.UNKNOWN, msg, pn)
  }

  /**
   * @param {number|string} severity
   * @param {string|{inspect?(): string}|null} [message=null]
   * @param {string|Function|null} [progname=null]
   * @returns {boolean}
   */
  log(severity, message, progname) {
    return this.add(severity, message, progname)
  }

  isDebug() {
    return this.level <= Severity.DEBUG
  }
  isInfo() {
    return this.level <= Severity.INFO
  }

  /**
   * Write a string at INFO level (trailing newline stripped).
   * Allows MemoryLogger to be used with Timings.printReport().
   * @param {string} s
   * @returns {boolean}
   */
  write(s) {
    return this.info(s.replace(/\n$/, ''))
  }

  clear() {
    this.messages.length = 0;
  }
  empty() {
    return this.messages.length === 0
  }
}

// ── NullLogger ────────────────────────────────────────────────────────────────

/** Logger that discards all messages but still tracks the maximum severity. */
class NullLogger extends Logger {
  constructor() {
    super();
    this.level = Severity.UNKNOWN;
    this._maxSeverity = null;
  }

  static create() {
    return new NullLogger()
  }

  get maxSeverity() {
    return this._maxSeverity
  }
  getMaxSeverity() {
    return this._maxSeverity
  }

  add(severity) {
    const sev = resolveSeverity(severity);
    if (this._maxSeverity === null || sev > this._maxSeverity)
      this._maxSeverity = sev;
    return true
  }

  log(severity) {
    return this.add(severity)
  }

  debug() {
    return this.add(Severity.DEBUG)
  }
  info() {
    return this.add(Severity.INFO)
  }
  warn() {
    return this.add(Severity.WARN)
  }
  error() {
    return this.add(Severity.ERROR)
  }
  fatal() {
    return this.add(Severity.FATAL)
  }
  unknown() {
    return this.add(Severity.UNKNOWN)
  }
}

// ── LoggerManager ─────────────────────────────────────────────────────────────

/**
 * Module-level singleton — the active logger is stored here and can be
 * replaced by callers (e.g. the load function).
 */
const LoggerManager = (() => {
  let _loggerClass = Logger;
  let _logger = null;

  return {
    get loggerClass() {
      return _loggerClass
    },
    set loggerClass(cls) {
      _loggerClass = cls;
    },

    get logger() {
      if (!_logger) _logger = new _loggerClass();
      return _logger
    },
    set logger(newLogger) {
      _logger = newLogger ?? new _loggerClass();
    },

    // Public API (mirrors Ruby LoggerManager)
    getLogger() {
      return this.logger
    },
    setLogger(newLogger) {
      this.logger = newLogger;
    },

    /**
     * Create a new formatter whose call() delegates to the provided impl.
     * @param {string} _name
     * @param {{call: Function}} impl
     * @returns {{call: Function}}
     */
    newFormatter(_name, impl) {
      return { call: impl.call.bind(impl) }
    },

    /**
     * Create a new Logger instance with custom behaviour supplied via impl.
     * @param {string} _name
     * @param {{add?: (severity: number, message: any, progname: any) => boolean, postConstruct?: (this: Logger) => void}} impl
     *   - `add(severity, message, progname)` — overrides the default add method; severity is always numeric.
     *   - `postConstruct()` — called once after the instance is created (`this` is the logger instance).
     * @returns {Logger}
     */
    newLogger(_name, impl) {
      const inst = new Logger();
      if (impl.add) {
        const customAdd = impl.add;
        inst.add = function (severity, message = null, progname = null) {
          const sev = resolveSeverity(severity);
          if (this._maxSeverity === null || sev > this._maxSeverity) {
            this._maxSeverity = sev;
          }
          return customAdd.call(this, sev, message, progname)
        };
        // Re-bind shorthand methods so they resolve through the custom add
        for (const [meth, sev] of [
          ['debug', Severity.DEBUG],
          ['info', Severity.INFO],
          ['warn', Severity.WARN],
          ['error', Severity.ERROR],
          ['fatal', Severity.FATAL],
          ['unknown', Severity.UNKNOWN],
        ]) {
          inst[meth] = (msg, pn) => inst.add(sev, msg, pn);
        }
        inst.log = (severity, msg, pn) => inst.add(severity, msg, pn);
      }
      if (impl.postConstruct) impl.postConstruct.call(inst);
      return inst
    },
  }
})();

// ── Logging mixin ─────────────────────────────────────────────────────────────

/**
 * Apply the Logging mixin to a class prototype.
 *
 * Installs the following on proto:
 * - `logger` getter — returns `LoggerManager.logger`
 * - `getLogger()` — method alias for the logger getter
 * - `messageWithContext(text, context)` — builds an auto-formatting message object
 * - `createLogMessage(text, context)` — alias for messageWithContext (used in extensions)
 *
 * @param {Object} proto - The prototype object (e.g. MyClass.prototype) to augment.
 */
function applyLogging(proto) {
  Object.defineProperty(proto, 'logger', {
    get() {
      return _loggerStore?.getStore() ?? LoggerManager.logger
    },
    configurable: true,
  });

  proto.getLogger = function () {
    return this.logger
  };

  proto.messageWithContext = (text, context = {}) =>
    Logger.AutoFormattingMessage.attach({ text, ...context });

  proto.createLogMessage = proto.messageWithContext;
}

// ESM conversion of helpers.rb
// Internal helper functions used by the Asciidoctor parser.
//
// Ruby-to-JavaScript notes:
//   - require_library / require_open_uri have no JS equivalent and are omitted.
//   - resolve_class / class_for_name are Ruby-specific and are omitted.
//   - BOM detection uses the Unicode BOM codepoint U+FEFF instead of raw bytes,
//     since JS strings are always UTF-16 and never carry an encoding tag.
//   - File.basename / File.extname are reimplemented without the Node `path` module
//     so this module works in browser (Opal) and Node environments alike.
//   - mkdir_p delegates to Node's fs.mkdirSync with { recursive: true }.
//   - String#succ (nextval) is implemented for the ASCII alphanumeric subset
//     used by Asciidoctor list-numbering sequences.


// ── BOM ──────────────────────────────────────────────────────────────────────
// Unicode byte-order mark (U+FEFF). In a JS string (already decoded to UTF-16)
// this is the single character that corresponds to all three BOM byte patterns:
//   UTF-8  BOM  0xEF 0xBB 0xBF → U+FEFF
//   UTF-16 LE   0xFF 0xFE      → U+FEFF
//   UTF-16 BE   0xFE 0xFF      → U+FEFF
const BOM = '﻿';

/** Trim trailing ASCII whitespace only (not Unicode line separators U+2028/U+2029). */
const rstrip = (line) => line.replace(/[ \t\r\n\f\v]+$/, '');

/**
 * Prepare the source data Array for parsing.
 *
 * Strips a leading BOM from the first element if present, then trims trailing
 * whitespace (trimEnd = true) or only the trailing newline (trimEnd = false)
 * from every line.
 *
 * @param {string[]} data - the source data Array to prepare (no null/undefined entries allowed)
 * @param {boolean} [trimEnd=true] - whether to strip all trailing whitespace (true) or only \n (false)
 * @returns {string[]} Array of prepared lines
 */
function prepareSourceArray(data, trimEnd = true) {
  if (!data.length) return []
  if (data[0].startsWith(BOM)) {
    data[0] = data[0].slice(1);
  } else if (
    data[0].charCodeAt(0) === 0xef &&
    data[0].charCodeAt(1) === 0xbb &&
    data[0].charCodeAt(2) === 0xbf
  ) {
    // Strip UTF-8 BOM encoded as three raw characters (ï»¿ / \xEF\xBB\xBF) if not already decoded to U+FEFF
    data[0] = data[0].slice(3);
  }
  // Strip trailing \r to normalize Windows CRLF line endings (lines were split on \n, leaving \r).
  return trimEnd
    ? data.map(rstrip)
    : data.map((line) => line.replace(/\r?\n$/, '').replace(/\r$/, ''))
}

/**
 * Prepare the source data String for parsing.
 *
 * Strips a leading BOM if present, splits into an array, and trims trailing
 * whitespace (trimEnd = true) or only the trailing newline (trimEnd = false)
 * from every line.
 *
 * @param {string} data - the source data String to prepare
 * @param {boolean} [trimEnd=true] - whether to strip all trailing whitespace (true) or only \n (false)
 * @returns {string[]} Array of prepared lines
 */
function prepareSourceString(data, trimEnd = true) {
  if (!data) return []
  if (data.startsWith(BOM)) {
    data = data.slice(1);
  } else if (
    data.charCodeAt(0) === 0xef &&
    data.charCodeAt(1) === 0xbb &&
    data.charCodeAt(2) === 0xbf
  ) {
    // Strip UTF-8 BOM encoded as three raw characters (ï»¿ / \xEF\xBB\xBF) if not already decoded to U+FEFF
    data = data.slice(3);
  }
  // Normalize Windows CRLF to LF so that split('\n') does not leave trailing \r on each line.
  if (data.includes('\r'))
    data = data.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  // Ruby's each_line does not produce an empty trailing element when the string
  // ends with \n, but JS split('\n') does. Remove the trailing empty element
  // to match Ruby behaviour.
  if (data.endsWith('\n')) data = data.slice(0, -1);
  const lines = data.split('\n');
  return trimEnd ? lines.map(rstrip) : lines
}

/**
 * Efficiently check whether the specified String resembles a URI.
 *
 * Uses UriSniffRx to check whether the String begins with a URI prefix (e.g.
 * http://). No validation of the URI is performed.
 *
 * @param {string} str - the String to check
 * @returns {boolean} true if the String resembles a URI, false otherwise
 */
function isUriish(str) {
  return str.includes(':') && UriSniffRx.test(str)
}

/**
 * Encode a URI component String for safe inclusion in a URI.
 *
 * Encodes all characters that are not unreserved per RFC-3986. Specifically,
 * encodeURIComponent leaves !, ', (, ), and * unencoded; this function encodes
 * those as well so the result matches CGI.escapeURIComponent (Ruby ≥ 3.2) /
 * CGI.escape + gsub('+', '%20').
 *
 * @param {string} str - the URI component String to encode
 * @returns {string} the encoded String
 */
function encodeUriComponent(str) {
  return encodeURIComponent(str).replace(
    /[!'()*]/g,
    (m) => `%${m.charCodeAt(0).toString(16)}`
  )
}

/**
 * Replace spaces with %20 in a URI path.
 *
 * @param {string} str - the String to encode
 * @returns {string} the String with all spaces replaced with %20
 */
function encodeSpacesInUri(str) {
  return str.includes(' ') ? str.replaceAll(' ', '%20') : str
}

/**
 * Remove the file extension from a filename and return the result.
 *
 * The filename is expected to be a POSIX path. The extension is only stripped
 * when no path separator follows the last dot, so paths like
 * "dir.with.dots/file" are returned unchanged.
 *
 * @param {string} filename - the String file name to process
 * @returns {string} the String filename with the file extension removed
 *
 * @example
 * rootname('part1/chapter1.adoc')
 * // => "part1/chapter1"
 */
function rootname(filename) {
  const lastDotIdx = filename.lastIndexOf('.');
  if (lastDotIdx < 0) return filename
  return filename.indexOf('/', lastDotIdx) >= 0
    ? filename
    : filename.slice(0, lastDotIdx)
}

/**
 * Retrieve the basename of a filename, optionally removing the extension.
 *
 * @param {string} filename - the String file name to process
 * @param {boolean|string|null} [dropExt=null] - a Boolean flag or an explicit String extension to drop
 * @returns {string} the String filename with leading directories removed and, optionally, the extension removed
 *
 * @example
 * basename('images/tiger.png', true)
 * // => "tiger"
 *
 * basename('images/tiger.png', '.png')
 * // => "tiger"
 */
function basename(filename, dropExt = null) {
  // Split on both POSIX and Windows separators, take the last non-empty segment.
  const base =
    filename
      .replace(/[/\\]+$/, '')
      .split(/[/\\]/)
      .pop() ?? filename;
  if (!dropExt) return base
  const ext = dropExt === true ? extname(base) : dropExt;
  return ext && base.endsWith(ext) ? base.slice(0, -ext.length) : base
}

/**
 * Return whether this path has a file extension.
 *
 * @param {string} path - the path String to check (expects a POSIX path)
 * @returns {boolean} true if the path has a file extension, false otherwise
 */
function isExtname(path) {
  const lastDotIdx = path.lastIndexOf('.');
  return lastDotIdx >= 0 && path.indexOf('/', lastDotIdx) < 0
}

/**
 * Retrieve the file extension of the specified path.
 *
 * The file extension is the portion of the last path segment starting from
 * the last period. Differs from Node's path.extname in that the fallback value
 * is configurable.
 *
 * @param {string} path - the path String in which to look for a file extension
 * @param {string} [fallback=''] - the fallback String to return if no file extension is present
 * @returns {string} the String file extension (with the leading dot) or fallback
 */
function extname(path, fallback = '') {
  const lastDotIdx = path.lastIndexOf('.');
  if (lastDotIdx < 0) return fallback
  // treat both '/' and '\\' as path separators (Windows support)
  if (path.indexOf('/', lastDotIdx) >= 0 || path.indexOf('\\', lastDotIdx) >= 0)
    return fallback
  return path.slice(lastDotIdx)
}

/**
 * Async-aware string replacement using matchAll.
 *
 * The replacer may return a string or a Promise<string>.
 * The regex is treated as global regardless of its flags.
 *
 * @param {string} str - the String to perform replacements on
 * @param {RegExp} regex - the RegExp pattern to match
 * @param {Function} replacer - an async function receiving the same arguments as String#replace callbacks
 * @returns {Promise<string>} the String with all matches replaced
 */
async function asyncReplace(str, regex, replacer) {
  const gRegex = regex.flags.includes('g')
    ? regex
    : new RegExp(regex.source, `${regex.flags}g`);
  const matches = [...str.matchAll(gRegex)];
  if (matches.length === 0) return str
  const parts = [];
  let lastIndex = 0;
  for (const match of matches) {
    parts.push(str.slice(lastIndex, match.index));
    // Process replacements sequentially so state mutations (e.g. footnote registration)
    // are visible to subsequent replacements in the same string.
    parts.push(await replacer(...match, match.index, str));
    lastIndex = match.index + match[0].length;
  }
  parts.push(str.slice(lastIndex));
  return parts.join('')
}

/**
 * Make a directory, creating all missing parent directories.
 *
 * @param {string} dir - the String path of the directory to create
 * @returns {Promise<void>} Throws if the path cannot be created
 */
async function mkdirP(dir) {
  const { mkdir } = await import('node:fs/promises');
  await mkdir(dir, { recursive: true });
}

// ── Roman numeral helpers ─────────────────────────────────────────────────────

const ROMAN_NUMERALS_WITH_REDUCERS = [
  ['M', 1000],
  ['CM', 900],
  ['D', 500],
  ['CD', 400],
  ['C', 100],
  ['XC', 90],
  ['L', 50],
  ['XL', 40],
  ['X', 10],
  ['IX', 9],
  ['V', 5],
  ['IV', 4],
  ['I', 1],
];

const ROMAN_NUMERALS = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };

/**
 * Convert an integer to a Roman numeral.
 *
 * @param {number} val - the integer value to convert
 * @returns {string} the String Roman numeral
 */
function intToRoman(val) {
  let result = '';
  for (const [l, i] of ROMAN_NUMERALS_WITH_REDUCERS) {
    const repeat = Math.floor(val / i);
    val %= i;
    result += l.repeat(repeat);
  }
  return result
}

/**
 * Convert an uppercase Roman numeral to an integer.
 *
 * @param {string} val - the String Roman numeral in uppercase to convert
 * @returns {number} the integer value
 */
function romanToInt(val) {
  const valmap = [...val].map((c) => ROMAN_NUMERALS[c]);
  let result = 0;
  for (let idx = 0; idx < valmap.length; idx++) {
    const v = valmap[idx];
    const succ = valmap[idx + 1];
    result += succ && succ > v ? -v : v;
  }
  return result
}

/**
 * Get the next value in a sequence.
 *
 * Handles integer sequences (numeric increment) and alphabetic sequences
 * (ASCII letter increment with carry, matching Ruby's String#succ for the
 * alphanumeric subset used by Asciidoctor list labels).
 *
 * @param {string|number} current - the value to increment
 * @returns {string|number} the next value in the sequence
 */
function nextval(current) {
  if (typeof current === 'number') return current + 1
  const intval = parseInt(current, 10);
  if (String(intval) === String(current)) return intval + 1
  // Mirrors Ruby's String#succ for single- and multi-character strings.
  // Strategy: find the rightmost ASCII-alphanumeric character and increment it
  // with carry.  If NO alphanumeric character exists, increment the rightmost
  // character's Unicode code point instead.
  const chars = [...current]; // split by Unicode code point (handles surrogate pairs)
  let hasAlnum = false;
  for (let i = chars.length - 1; i >= 0; i--) {
    const code = chars[i].codePointAt(0);
    const isLower = code >= 97 && code <= 122;
    const isUpper = code >= 65 && code <= 90;
    const isDigit = code >= 48 && code <= 57;
    if (!isLower && !isUpper && !isDigit) continue
    hasAlnum = true;
    const atEnd =
      (isLower && code === 122) ||
      (isUpper && code === 90) ||
      (isDigit && code === 57);
    if (!atEnd) {
      chars[i] = String.fromCodePoint(code + 1);
      return chars.join('')
    }
    // Carry: wrap this char and continue to the next alphanumeric to the left.
    chars[i] = isLower ? 'a' : isUpper ? 'A' : '0';
    // Find next alphanumeric to carry into.
    let carried = false;
    for (let j = i - 1; j >= 0; j--) {
      const c2 = chars[j].codePointAt(0);
      const l2 = c2 >= 97 && c2 <= 122;
      const u2 = c2 >= 65 && c2 <= 90;
      const d2 = c2 >= 48 && c2 <= 57;
      if (!l2 && !u2 && !d2) continue
      const end2 = (l2 && c2 === 122) || (u2 && c2 === 90) || (d2 && c2 === 57);
      if (!end2) {
        chars[j] = String.fromCodePoint(c2 + 1);
        carried = true;
        break
      }
      chars[j] = l2 ? 'a' : u2 ? 'A' : '0';
    }
    if (!carried) {
      // All alphanumeric characters wrapped — prepend carry character.
      const carry = isLower ? 'a' : isUpper ? 'A' : '1';
      return carry + chars.join('')
    }
    return chars.join('')
  }
  if (!hasAlnum) {
    // No alphanumeric chars: increment the rightmost character's code point.
    const last = chars.length - 1;
    const code = chars[last].codePointAt(0);
    chars[last] = String.fromCodePoint(code + 1);
    return chars.join('')
  }
  return current
}

// HTTP cache system for URI fetching.
//
// Provides a pluggable caching layer for all HTTP(S) fetches performed during
// document conversion (includes, images, readContents). Mirrors the behaviour
// of Ruby's open-uri/cached mechanism activated by the `cache-uri` attribute.
//
// When `cache-uri` is set on the document:
//   - If a cache has been registered via HttpCacheManager.setCache(), it is used.
//   - Otherwise an ephemeral MemoryHttpCache is created for the duration of the
//     conversion (keyed by Document instance via a WeakMap, GC'd with the doc).
//
// To implement a custom cache, extend HttpCache and override read(uri).

/**
 * Base HTTP cache class.
 *
 * The default implementation delegates directly to fetch() with no caching.
 * Subclasses override read() to add caching behaviour.
 */
class HttpCache {
  /**
   * Fetch content from a URI, optionally from a cache.
   * @param {string} uri
   * @returns {Promise<Response>}
   */
  async read(uri) {
    return fetch(uri)
  }
}

/**
 * In-memory HTTP cache.
 *
 * Stores successful responses as ArrayBuffers keyed by URI. On a cache hit
 * a synthetic Response is reconstructed from the stored data without touching
 * the network. Non-OK responses (4xx, 5xx) are never cached.
 *
 * Safe as an ephemeral per-conversion cache or as a longer-lived process-level
 * cache when registered via HttpCacheManager.setCache().
 */
class MemoryHttpCache extends HttpCache {
  /** @type {Map<string, {buffer: ArrayBuffer, status: number, statusText: string, headers: Record<string,string>}>} */
  #cache = new Map()

  async read(uri) {
    const entry = this.#cache.get(uri);
    if (entry) {
      return new Response(entry.buffer.slice(0), {
        status: entry.status,
        statusText: entry.statusText,
        headers: entry.headers,
      })
    }
    const response = await fetch(uri);
    if (response.ok) {
      const buffer = await response.arrayBuffer();
      const headers = Object.fromEntries(response.headers.entries());
      this.#cache.set(uri, {
        buffer,
        status: response.status,
        statusText: response.statusText,
        headers,
      });
      return new Response(buffer.slice(0), {
        status: response.status,
        statusText: response.statusText,
        headers,
      })
    }
    return response
  }
}

/** @type {WeakMap<object, MemoryHttpCache>} */
const _ephemeralCaches = new WeakMap();

/**
 * Singleton manager for the HTTP cache.
 *
 * Register a process-level cache:
 *   HttpCacheManager.setCache(new MemoryHttpCache())
 *   HttpCacheManager.setCache(new MyFileSystemCache('./cache'))
 *   HttpCacheManager.setCache(null)  // revert to default ephemeral behaviour
 *
 * When no cache is registered and `cache-uri` is set, an ephemeral
 * MemoryHttpCache is created per Document instance.
 */
const HttpCacheManager = {
  /** @type {HttpCache|null} */
  _cache: null,

  /**
   * Register a cache to use for all conversions.
   * Pass null to unregister and revert to the ephemeral default.
   * @param {HttpCache|null} cache
   */
  setCache(cache) {
    this._cache = cache;
  },

  /**
   * Return the registered process-level cache, or null if none is registered.
   * @returns {HttpCache|null}
   */
  getCache() {
    return this._cache
  },

  /**
   * Return the cache to use for a specific document conversion.
   *
   * Returns the registered cache if one exists; otherwise creates (or reuses)
   * an ephemeral MemoryHttpCache scoped to the document's lifetime via a WeakMap.
   * @param {object} doc - the current Document instance
   * @returns {HttpCache}
   */
  getCacheForDocument(doc) {
    if (this._cache) return this._cache
    let cache = _ephemeralCaches.get(doc);
    if (!cache) {
      cache = new MemoryHttpCache();
      _ephemeralCaches.set(doc, cache);
    }
    return cache
  },
};

/**
 * Fetch a URI, routing through the HTTP cache when `cache-uri` is set on the document.
 * @param {string} uri
 * @param {object} doc - the current Document instance
 * @returns {Promise<Response>}
 */
function fetchUri(uri, doc) {
  if (doc.hasAttribute('cache-uri')) {
    return HttpCacheManager.getCacheForDocument(doc).read(uri)
  }
  return fetch(uri)
}

// ESM conversion of abstract_node.rb
//
// Ruby-to-JavaScript notes:
//   - Ruby symbols (:document, :context) are represented as plain strings.
//   - attr_reader / attr_accessor are implemented as plain instance properties;
//     cases where the setter has side effects use JS get/set pairs.
//   - Ruby methods ending in ? are renamed: attr? → hasAttr, block? → isBlock,
//     inline? → isInline, role? → hasRoleAttribute, has_role? → hasRole,
//     option? → hasOption, reftext? → hasReftext.
//   - Ruby methods ending in = that have side effects use JS set accessors:
//     parent= → set parent(), role= → set role().
//   - snake_case method/property names are converted to camelCase:
//     node_name → nodeName, set_attr → setAttr, etc.
//   - The Logging mixin (logger getter) is provided as a default on AbstractNode;
//     it falls back to the document's logger or the global console.
//   - The Substitutors mixin is applied via Object.assign(AbstractNode.prototype, Substitutors)
//     after both modules are loaded (see the bottom of substitutors.js).
//   - File I/O in generateDataUri / readAsset uses node:fs/promises async APIs.
//     When the resolved path is an HTTP URI (browser: docdir is a URL), readAsset
//     delegates to browser/asset.js (Fetch API) instead of using the filesystem.
//   - generateDataUriFromUri and readContents use the Fetch API and are async;
//     imageUri and readContents must be awaited when the data-uri + allow-uri-read
//     combination is active.
//   - Ruby's Set is represented as a JavaScript Set.


// ── Node.js fs (lazy, optional) ───────────────────────────────────────────────
// Loaded on first use in Node.js; silently absent in browser/WebWorker environments.
let _fsp$1; // undefined = not tried, null = unavailable, object = available
let _fsConstants$1; // node:fs constants (R_OK etc.) — not on node:fs/promises

async function _requireFsp$1() {
  if (_fsp$1 !== undefined) return
  try {
    _fsp$1 = await import('node:fs/promises');
    _fsConstants$1 = (await import('node:fs')).constants;
  } catch {
    _fsp$1 = null;
  }
}

async function isReadable(path) {
  await _requireFsp$1();
  if (!_fsp$1) return false
  try {
    await _fsp$1.access(path, _fsConstants$1.R_OK);
    return true
  } catch {
    return false
  }
}

/**
 * An abstract base class that provides state and methods for managing a node of AsciiDoc content.
 * The state and methods on this class are common to all content segments in an AsciiDoc document.
 * @abstract
 */
class AbstractNode {
  /**
   * @type {string|null|undefined}
   * @internal
   */
  _convertedReftext

  /**
   * @param {AbstractNode} parent
   * @param {string} context
   * @param {object} [opts={}]
   */
  constructor(parent, context, opts = {}) {
    // document is a special case – should refer to itself
    if (context === 'document') {
      /** @type {Document} */
      this.document = /** @type {Document} */ this;
    } else if (parent) {
      /** @internal */
      this._parent = parent;
      /** @type {Document} */
      this.document = parent.document;
    }
    this.context = context;
    this.nodeName = String(context);
    this.id = null;
    // NOTE the value of the attributes option may be undefined on an Inline node
    const attrs = opts.attributes;
    this.attributes = attrs ? { ...attrs } : {};
    this.passthroughs = [];
  }

  /**
   * Alias for {@link getParent}.
   * @see {getParent}
   */
  get parent() {
    return this._parent
  }

  /**
   * Alias for {@link setParent}.
   * @see {setParent}
   */
  set parent(parent) {
    this._parent = parent;
    this.document = parent.document;
  }

  /**
   * Alias for {@link getRole}.
   * @see {getRole}
   */
  get role() {
    return this.attributes.role
  }

  /**
   * Set the value of the role attribute on this node.
   *
   * Accepts a single role name, a space-separated String, or an Array.
   *
   * @param {string|string[]} names - A single role name, a space-separated String, or an Array.
   */
  set role(names) {
    this.attributes.role = Array.isArray(names) ? names.join(' ') : names;
  }

  /**
   * Alias for {@link getRoles}.
   * @see {getRoles}
   */
  get roles() {
    const val = this.attributes.role;
    return val ? val.split(' ') : []
  }

  /**
   * @returns {boolean} true if this AbstractNode is an instance of Block.
   * @throws {Error} Subclasses must override this method.
   */
  isBlock() {
    throw new Error('NotImplementedError')
  }

  /**
   * @returns {boolean} true if this AbstractNode is an instance of Inline.
   * @throws {Error} Subclasses must override this method.
   */
  isInline() {
    throw new Error('NotImplementedError')
  }

  /**
   * Alias for {@link getConverter}.
   * @see {getConverter}
   * @returns {object} the converter instance.
   */
  get converter() {
    return this.document.converter
  }

  /**
   * Get the value of the specified attribute.
   *
   * Looks for the attribute on this node first. If not found and `fallbackName` is
   * set, and this node is not the Document node, look for that attribute on the
   * Document node. Otherwise, return `defaultValue`.
   *
   * @param {string} name - The attribute name to resolve.
   * @param {*} [defaultValue=null] - The value to return if the attribute is not found.
   * @param {string|boolean|null} [fallbackName=null] - When truthy, also checks the Document's
   *   attributes. Pass `true` to fall back using the same name, or a string to use a different name.
   * @returns {*} the attribute value or defaultValue.
   *
   * @example <caption>Simple lookup</caption>
   * block.getAttribute('language')           // → 'ruby' or null
   *
   * @example <caption>With default</caption>
   * block.getAttribute('linenums', false)    // → false if not set
   *
   * @example <caption>Inherit from document if absent on block</caption>
   * block.getAttribute('source-highlighter', null, true)    // → falls back to doc attribute of same name
   * block.getAttribute('linenums', null, 'source-linenums') // → falls back to 'source-linenums' on doc
   */
  getAttribute(name, defaultValue = null, fallbackName = null) {
    const key = String(name);
    const val = this.attributes[key];
    if (val != null) return val
    if (fallbackName && this._parent) {
      const fallbackKey = String(fallbackName === true ? name : fallbackName);
      const docVal = this.document.attributes[fallbackKey];
      if (docVal != null) return docVal
    }
    return defaultValue
  }

  /**
   * Check if the specified attribute is defined on this node, with optional
   * value match and document-level fallback.
   *
   * @param {string} name - The attribute name.
   * @param {*} [expectedValue=null] - When truthy, also checks that the resolved value equals this.
   * @param {string|boolean|null} [fallbackName=null] - When truthy, also checks the Document's
   *   attributes. Pass `true` to use the same name, or a string for a different fallback name.
   * @returns {boolean}
   *
   * @example <caption>Presence check</caption>
   * block.hasAttribute('linenums')                       // → true/false
   *
   * @example <caption>Value match</caption>
   * block.hasAttribute('language', 'ruby')               // → true only when language === 'ruby'
   *
   * @example <caption>Inherit presence from document</caption>
   * block.hasAttribute('source-highlighter', null, true) // → also checks doc-level attribute
   */
  hasAttribute(name, expectedValue = null, fallbackName = null) {
    const key = String(name);
    if (expectedValue) {
      const val =
        this.attributes[key] ??
        (fallbackName && this._parent
          ? this.document.attributes[
              String(fallbackName === true ? name : fallbackName)
            ]
          : null);
      return expectedValue === val
    }
    return (
      key in this.attributes ||
      !!(
        fallbackName &&
        this._parent &&
        String(fallbackName === true ? name : fallbackName) in
          this.document.attributes
      )
    )
  }

  /**
   * Set the value of the specified attribute on this node.
   *
   * @param {string} name - The attribute name to assign.
   * @param {*} [value=''] - The value to assign.
   * @param {boolean} [overwrite=true] - When `false`, does nothing if the attribute already exists.
   * @returns {string|boolean|null} `true` if the attribute was set, `false` if blocked by `overwrite=false`.
   *   Subclasses (e.g. `Document`) may return the resolved value string or `null` when the attribute is locked.
   */
  setAttribute(name, value = '', overwrite = true) {
    if (overwrite === false && name in this.attributes) return false
    this.attributes[name] = value;
    return true
  }

  /**
   * Check if the specified attribute is defined with an optional value match.
   * Alias for {@link hasAttribute}.
   * @see {hasAttribute}
   */
  isAttribute(name, expectedValue = null) {
    if (expectedValue != null) return this.getAttribute(name) === expectedValue
    return name in this.attributes
  }

  /**
   * Remove the attribute from this node.
   *
   * @param {string} name - The attribute name to remove.
   * @returns {*} the previous value, or `undefined` if the attribute was not present.
   */
  removeAttribute(name) {
    const val = this.attributes[name];
    delete this.attributes[name];
    return val
  }

  /**
   * Check if the specified option attribute is enabled on this node.
   * This method checks whether the `<name>-option` attribute is set.
   *
   * @param {string} name - The String or Symbol name of the option.
   * @returns {boolean} true if the option is enabled, false otherwise.
   */
  hasOption(name) {
    return `${name}-option` in this.attributes
  }

  /**
   * Set the specified option on this node by setting the `<name>-option` attribute.
   *
   * @param {string} name - The String name of the option.
   */
  setOption(name) {
    this.attributes[`${name}-option`] = '';
  }

  /**
   * Retrieve the Set of option names that are enabled on this node.
   *
   * @returns {Set<string>} a Set of option name strings.
   */
  enabledOptions() {
    const result = new Set();
    for (const k of Object.keys(this.attributes)) {
      if (k.endsWith('-option')) result.add(k.slice(0, k.length - 7));
    }
    return result
  }

  /**
   * Update the attributes of this node with the new values.
   *
   * @param {Object} newAttributes - A plain object of additional attributes to assign.
   * @returns {Object} the updated attributes object on this node.
   */
  updateAttributes(newAttributes) {
    return Object.assign(this.attributes, newAttributes)
  }

  /**
   * Check if the `role` attribute is set on this node, optionally matching an exact value.
   *
   * Unlike {@link hasRole}, which checks for an individual role name within a
   * space-separated list, this method tests the raw `role` attribute string as a whole.
   *
   * @param {string|null} [expectedValue=null] - When provided, checks that the `role`
   *   attribute equals this string exactly.
   * @returns {boolean}
   *
   * @example
   * node.hasRoleAttribute()         // → true if role attribute is set at all
   * node.hasRoleAttribute('lead')   // → true only when role === 'lead' (not 'lead primary')
   */
  hasRoleAttribute(expectedValue = null) {
    if (expectedValue != null) return expectedValue === this.attributes.role
    return 'role' in this.attributes
  }

  /**
   * Check if the specified role name is present in this node's role list.
   *
   * @param {string} name - The String role name to find.
   * @returns {boolean}
   */
  hasRole(name) {
    const val = this.attributes.role;
    return val ? ` ${val} `.includes(` ${name} `) : false
  }

  /**
   * Add the given role directly to this node.
   *
   * @param {string} name - The String role name to add.
   * @returns {boolean} true if the role was added, false if it was already present.
   */
  addRole(name) {
    const val = this.attributes.role;
    if (val) {
      if (` ${val} `.includes(` ${name} `)) return false
      this.attributes.role = `${val} ${name}`;
      return true
    }
    this.attributes.role = name;
    return true
  }

  /**
   * Remove the given role directly from this node.
   *
   * @param {string} name - The String role name to remove.
   * @returns {boolean} true if the role was removed, false if it was not present.
   */
  removeRole(name) {
    const val = this.attributes.role;
    if (!val) return false
    const roles = val.split(' ');
    const idx = roles.indexOf(name);
    if (idx < 0) return false
    roles.splice(idx, 1);
    if (roles.length === 0) {
      delete this.attributes.role;
    } else {
      this.attributes.role = roles.join(' ');
    }
    return true
  }

  /**
   * Get the value of the reftext attribute with substitutions applied.
   * The result is pre-computed during Document.parse() via {@link precomputeReftext}.
   * Falls back to the raw reftext attribute if precomputeReftext() has not been called yet.
   *
   * @returns {string|null} the String reftext or null if not set.
   */
  get reftext() {
    if (this._convertedReftext !== undefined) return this._convertedReftext
    const val = this.attributes.reftext;
    return val ?? null
  }

  /**
   * Pre-compute the reftext with substitutions applied asynchronously.
   * Called during Document.parse() so the synchronous getter works during conversion.
   *
   * @returns {Promise<void>}
   */
  async precomputeReftext() {
    const val = this.attributes.reftext;
    this._convertedReftext =
      val != null ? await this.applyReftextSubs(val) : null;
  }

  /**
   * Check if the reftext attribute is defined.
   *
   * @returns {boolean}
   */
  hasReftext() {
    return 'reftext' in this.attributes
  }

  /**
   * Check whether this node has reftext — either an explicit 'reftext' attribute
   * or a title that can serve as the cross-reference text.
   * Mirrors Ruby's AbstractNode#reftext?
   * @returns {boolean}
   */
  isReftext() {
    return this.hasAttribute('reftext') || !!this.title
  }

  /**
   * Construct a reference or data URI to an icon image for the given name.
   *
   * If the 'icon' attribute is set on this node the name is ignored and the
   * attribute value is used as the target path. Otherwise the icon path is built
   * from 'iconsdir', the name, and 'icontype' (default: 'png').
   *
   * @param {string} name - The String name of the icon.
   * @returns {Promise<string>} a Promise resolving to a String reference or data URI for the icon image.
   */
  async iconUri(name) {
    let icon;
    if (this.hasAttribute('icon')) {
      icon = this.getAttribute('icon');
      if (!isExtname(icon))
        icon = `${icon}.${this.document.getAttribute('icontype', 'png')}`;
    } else {
      icon = `${name}.${this.document.getAttribute('icontype', 'png')}`;
    }
    return this.imageUri(icon, 'iconsdir')
  }

  /**
   * Construct a URI reference or data URI to the target image.
   *
   * If the target image is already a URI it is left untouched (unless data-uri
   * conversion is requested). If the target image is a data URI, then it is
   * already an embedded image, so it is returned as-is. The image is resolved
   * relative to the directory named by assetDirKey. When data-uri is enabled and
   * the safe level permits, the image is embedded as a Base64 data URI.
   *
   * NOTE: When the document has both 'data-uri' and 'allow-uri-read' enabled
   * and the resolved image URL is a remote URI, this method returns a Promise
   * rather than a String. Await the result when that combination may be active.
   *
   * @param {string} targetImage - A String path to the target image.
   * @param {string} [assetDirKey='imagesdir'] - The String attribute key for the image directory.
   * @returns {Promise<string>} a Promise resolving to a String reference or data URI.
   */
  async imageUri(targetImage, assetDirKey = 'imagesdir') {
    // A data URI is already an embedded image, so use it as-is (aside from space
    // encoding, which normalizeWebPath would otherwise apply) rather than reading
    // or re-encoding it.
    if (targetImage.startsWith('data:')) return encodeSpacesInUri(targetImage)
    const doc = this.document;
    if (doc.safe < SafeMode.SECURE && doc.hasAttribute('data-uri')) {
      let imagesBase;
      if (
        (isUriish(targetImage) &&
          (targetImage = encodeSpacesInUri(targetImage))) ||
        (assetDirKey &&
          (imagesBase = this.getAttribute(assetDirKey, null, true)) &&
          isUriish(imagesBase) &&
          (targetImage = this.normalizeWebPath(targetImage, imagesBase, false)))
      ) {
        return doc.hasAttribute('allow-uri-read')
          ? this.generateDataUriFromUri(targetImage)
          : targetImage
      }
      return this.generateDataUri(targetImage, assetDirKey)
    }
    return this.normalizeWebPath(
      targetImage,
      assetDirKey ? this.getAttribute(assetDirKey, null, true) : null
    )
  }

  /**
   * Construct a URI reference to the target media.
   *
   * @param {string} target - A String reference to the target media.
   * @param {string} [assetDirKey='imagesdir'] - The String attribute key for the media directory.
   * @returns {string} a String reference for the target media.
   */
  mediaUri(target, assetDirKey = 'imagesdir') {
    return this.normalizeWebPath(
      target,
      assetDirKey ? this.getAttribute(assetDirKey, null, true) : null
    )
  }

  /**
   * Generate a data URI that embeds the image at the given local path.
   *
   * The image path is cleaned to prevent access outside the jail when the
   * document safe level is SafeMode.SAFE or higher. The image data is read
   * and Base64-encoded. In non-Node environments this method returns an empty
   * data URI with a warning.
   *
   * @param {string} targetImage - A String path to the target image.
   * @param {string|null} [assetDirKey=null] - The String attribute key for the image directory.
   * @returns {Promise<string>} a Promise resolving to a String data URI.
   */
  async generateDataUri(targetImage, assetDirKey = null) {
    const ext = extname(targetImage, null);
    const mimetype = ext
      ? ext === '.svg'
        ? 'image/svg+xml'
        : `image/${ext.slice(1)}`
      : 'application/octet-stream';
    const imagePath = assetDirKey
      ? this.normalizeSystemPath(
          targetImage,
          this.getAttribute(assetDirKey, null, true),
          null,
          { targetName: 'image' }
        )
      : this.normalizeSystemPath(targetImage);
    if (isUriish(imagePath)) {
      return await this.generateDataUriFromUri(imagePath)
    }
    if (await isReadable(imagePath)) {
      const data = await _fsp$1.readFile(imagePath);
      return `data:${mimetype};base64,${data.toString('base64')}`
    }
    this.logger.warn(`image to embed not found or not readable: ${imagePath}`);
    return `data:${mimetype};base64,`
  }

  /**
   * Read the image data from the specified URI and generate a data URI.
   *
   * The image data is fetched and Base64-encoded. The MIME type is taken from
   * the Content-Type response header.
   *
   * NOTE: This method is async in JS (the Fetch API is async). When called from
   * imageUri, the caller must await the returned Promise.
   *
   * @param {string} imageUri - The URI from which to read the image data (http/https/ftp).
   * @returns {Promise<string>} a Promise resolving to a String data URI.
   */
  async generateDataUriFromUri(imageUri) {
    try {
      const doc = this.document;
      const response = await fetchUri(imageUri, doc);
      if (response.ok) {
        const mimetype = (
          response.headers.get('content-type') || 'application/octet-stream'
        )
          .split(';')[0]
          .trim();
        const buffer = await response.arrayBuffer();
        const base64 = btoa(
          Array.from(new Uint8Array(buffer), (b) =>
            String.fromCharCode(b)
          ).join('')
        );
        return `data:${mimetype};base64,${base64}`
      } else {
        const ext = extname(imageUri, null);
        const mimetype = ext
          ? ext === '.svg'
            ? 'image/svg+xml'
            : `image/${ext.slice(1)}`
          : 'application/octet-stream';
        this.logger.warn(
          `image to embed not found or not readable: ${imageUri}`
        );
        return `data:${mimetype};base64,`
      }
    } catch {
      this.logger.warn(`could not retrieve image data from URI: ${imageUri}`);
      return imageUri
    }
  }

  /**
   * Normalize the asset file or directory to a concrete and rinsed path.
   *
   * Delegates to {@link normalizeSystemPath} with start set to document.baseDir.
   *
   * @param {string} assetRef - The String asset reference to normalize.
   * @param {string} [assetName='path'] - The String label for the asset used in messages.
   * @param {boolean} [autocorrect=true] - A Boolean indicating whether to recover from an illegal path.
   * @returns {string} the normalized String path.
   */
  normalizeAssetPath(assetRef, assetName = 'path', autocorrect = true) {
    return this.normalizeSystemPath(assetRef, this.document.baseDir, null, {
      targetName: assetName,
      recover: autocorrect,
    })
  }

  /**
   * Resolve and normalize a secure path from the target and start paths.
   *
   * Prevents resolving a path outside the jail (defaulting to document.baseDir)
   * when the document safe level is SafeMode.SAFE or higher.
   *
   * @param {string} target - The String target path.
   * @param {string|null} [start=null] - The String start (parent) path.
   * @param {string|null} [jail=null] - The String jail path.
   * @param {Object} [opts={}] - A plain object of options:
   *   - `recover` {boolean} - Whether to automatically recover for illegal paths.
   *   - `targetName` {string} - Label used in messages for the path being resolved.
   * @throws {Error} if a jail is specified and the resolved path is outside it.
   * @returns {string} the resolved String path.
   */
  normalizeSystemPath(target, start = null, jail = null, opts = {}) {
    const doc = this.document;
    if (doc.safe < SafeMode.SAFE) {
      if (start) {
        if (!doc.pathResolver.root(start)) start = `${doc.baseDir}/${start}`;
      } else {
        start = doc.baseDir;
      }
    } else {
      start = start ?? doc.baseDir;
      jail = jail ?? doc.baseDir;
    }
    return doc.pathResolver.systemPath(target, start, jail, opts)
  }

  /**
   * Normalize the web path using the PathResolver.
   *
   * @param {string} target - The String target path.
   * @param {string|null} [start=null] - The String start (parent) path.
   * @param {boolean} [preserveUriTarget=true] - Whether a URI target should be preserved as-is.
   * @returns {string} the resolved String path.
   */
  normalizeWebPath(target, start = null, preserveUriTarget = true) {
    if (preserveUriTarget && isUriish(target)) return encodeSpacesInUri(target)
    return this.document.pathResolver.webPath(target, start)
  }

  /**
   * Read the contents of the file at the specified path.
   *
   * This method checks that the file is readable before attempting to read it.
   *
   * @param {string} path - The String path from which to read the contents.
   * @param {Object} [opts={}] - A plain object of options:
   *   - `warnOnFailure` {boolean} - Whether a warning is issued when the file cannot be read (default: false).
   *   - `normalize` {boolean} - Whether lines are normalized and coerced to UTF-8 (default: false).
   *   - `label` {string} - Label for the file used in warning messages.
   * @returns {Promise<string|null>} a Promise resolving to the file content, or null if not readable.
   */
  async readAsset(path, opts = {}) {
    // remap opts for backwards compatibility (boolean shorthand)
    if (typeof opts !== 'object' || opts === null)
      opts = { warnOnFailure: opts !== false };
    if (isUriish(path)) {
      // Browser: docdir is a URL so the resolved path is an HTTP URI; use fetch instead of fs.
      const { readBrowserAsset } = await Promise.resolve().then(function () { return asset; });
      const text = await readBrowserAsset(path);
      if (text != null)
        return opts.normalize ? prepareSourceString(text).join(LF$1) : text
      if (opts.warnOnFailure) {
        const docfile = this.getAttribute('docfile') || '<stdin>';
        const label = opts.label || 'file';
        this.logger.warn(
          `${docfile}: ${label} does not exist or cannot be read: ${path}`
        );
      }
      return null
    }
    if (await isReadable(path)) {
      if (opts.normalize) {
        return prepareSourceString(await _fsp$1.readFile(path, 'utf8')).join(LF$1)
      }
      return _fsp$1.readFile(path, 'utf8')
    }
    if (opts.warnOnFailure) {
      const docfile = this.getAttribute('docfile') || '<stdin>';
      const label = opts.label || 'file';
      this.logger.warn(
        `${docfile}: ${label} does not exist or cannot be read: ${path}`
      );
    }
    return null
  }

  /**
   * Resolve the URI or system path to the target, then read and return its contents.
   *
   * When the resolved path is a URI and allow-uri-read is enabled, the content is
   * fetched via the Fetch API (async). When it is a local path, the file is read
   * via {@link readAsset}.
   *
   * @param {string} target - The URI or local path String from which to read the data.
   * @param {Object} [opts={}] - A plain object of options:
   *   - `label` {string} - Label used in warning messages (default: 'asset').
   *   - `normalize` {boolean} - Whether the data should be normalized (default: false).
   *   - `start` {string} - Relative base path for resolving the target.
   *   - `warnOnFailure` {boolean} - Whether warnings are issued on failure (default: true).
   *   - `warnIfEmpty` {boolean} - Whether a warning is issued when the target contents are empty (default: false).
   * @returns {Promise<string|null>} a Promise resolving to the content, or null on failure.
   */
  async readContents(target, opts = {}) {
    const doc = this.document;
    const label = opts.label || 'asset';
    let contents;
    let resolvedTarget = target;
    const start = opts.start;
    const warnOnFailure = opts.warnOnFailure !== false;

    if (
      isUriish(target) ||
      (start &&
        isUriish(start) &&
        (resolvedTarget = doc.pathResolver.webPath(target, start)))
    ) {
      if (doc.hasAttribute('allow-uri-read')) {
        try {
          const response = await fetchUri(resolvedTarget, doc);
          const text = await response.text();
          contents = opts.normalize ? prepareSourceString(text).join(LF$1) : text;
        } catch {
          if (warnOnFailure)
            this.logger.warn(
              `could not retrieve contents of ${label} at URI: ${resolvedTarget}`
            );
        }
      } else if (warnOnFailure) {
        this.logger.warn(
          `cannot retrieve contents of ${label} at URI: ${resolvedTarget} (allow-uri-read attribute not enabled)`
        );
      }
    } else {
      resolvedTarget = this.normalizeSystemPath(target, opts.start, null, {
        targetName: label,
      });
      contents = await this.readAsset(resolvedTarget, {
        normalize: opts.normalize,
        warnOnFailure,
        label,
      });
    }

    if (contents != null && opts.warnIfEmpty && contents.length === 0) {
      this.logger.warn(`contents of ${label} is empty: ${resolvedTarget}`);
    }
    return contents
  }

  /**
   * @deprecated Use `isUriish` from helpers.js instead.
   * @param {string} str
   * @returns {boolean}
   */
  isUri(str) {
    return isUriish(str)
  }

  /**
   * Provide a default logger.
   * The Logging mixin (logging.js) overrides this getter on the prototype.
   * @returns {import('./logging.js').LoggerLike}
   */
  get logger() {
    return this.document?.logger ?? console
  }

  // ── JavaScript-style accessors ────────────────────────────────────────────────

  /**
   * Get the logger for this node.
   * @returns {import('./logging.js').LoggerLike} the logger instance.
   */
  getLogger() {
    return this.logger
  }

  /**
   * Retrieve the space-separated String role for this node.
   *
   * @returns {string|undefined} the role as a space-separated String.
   */
  getRole() {
    return this.role
  }

  /**
   * Set the value of the role attribute on this node.
   *
   * Accepts a single role name, a space-separated String, an Array, or spread arguments.
   *
   * @param {...string|string[]} names - A single role name, a space-separated String, an Array,
   *   or multiple role names as spread arguments.
   * @returns {string} the value of the role attribute.
   */
  setRole(...names) {
    this.role = names.length === 1 ? names[0] : names;
    return this.attributes.role
  }

  /**
   * Retrieve the String role names for this node as an Array.
   *
   * @returns {string[]} the role names as a String Array, empty if the role attribute is absent.
   */
  getRoles() {
    return this.roles
  }

  /**
   * Get the attributes hash for this node.
   *
   * @returns {Object} a plain Object of attributes.
   */
  getAttributes() {
    return this.attributes
  }

  /**
   * Get the document to which this node belongs.
   *
   * @returns {Document} the Document.
   */
  getDocument() {
    return this.document
  }

  /**
   * Get the parent node of this node.
   *
   * @returns {AbstractNode|undefined} the parent AbstractNode, or undefined for the root document.
   */
  getParent() {
    return this._parent
  }

  /**
   * Set the parent of this node.
   * Also updates the document reference.
   */
  setParent(parent) {
    this._parent = parent;
    this.document = parent.document;
  }

  /**
   * Get the String name of this node.
   *
   * @returns {string} the node name.
   */
  getNodeName() {
    return this.nodeName
  }

  /**
   * Get the String id for this node.
   *
   * @returns {string|undefined} the id, or undefined if not set.
   */
  getId() {
    return this.id ?? undefined
  }

  /**
   * Set the String id for this node.
   *
   * @param {string} id - The String id to assign.
   */
  setId(id) {
    this.id = id;
  }

  /**
   * Get the context name for this node.
   *
   * @returns {string} the context name.
   */
  getContext() {
    return this.context
  }

  /**
   * Get the {Converter} instance being used to convert the current {Document}.
   *
   * @returns {object} the converter instance.
   */
  getConverter() {
    return this.converter
  }

  /**
   * Get the icon URI for the named icon.
   *
   * @param {string} name - The String icon name.
   * @returns {Promise<string>} a Promise resolving to a String URI.
   */
  getIconUri(name) {
    return this.iconUri(name)
  }

  /**
   * Get the media URI for the target.
   *
   * @param {string} target - The String target path or URL.
   * @param {string} [assetDirKey='imagesdir'] - The String asset directory attribute key.
   * @returns {string} a String URI.
   */
  getMediaUri(target, assetDirKey = 'imagesdir') {
    return this.mediaUri(target, assetDirKey)
  }

  /**
   * Get the image URI for the target image.
   *
   * @param {string} targetImage - The String target image path or URL.
   * @param {string|null} [assetDirKey=null] - The String asset directory attribute key.
   * @returns {Promise<string>} a Promise resolving to a String URI.
   */
  getImageUri(targetImage, assetDirKey = null) {
    return this.imageUri(targetImage, assetDirKey)
  }

  /**
   * Get the value of the reftext attribute with substitutions applied.
   *
   * @returns {string|undefined} the reftext value, or undefined if not set.
   */
  getReftext() {
    return this.reftext ?? undefined
  }
}

/** @import { Cursor } from './reader.js' */


/** Used as a sentinel to abort findBy traversal early (mirrors Ruby StopIteration). */
class StopIteration extends Error {}

/**
 * @template {string | any[]} [TContent=string]
 * @abstract
 */
class AbstractBlock extends AbstractNode {
  /** @type {string|null} */
  #title = null
  /** @type {string|null} */
  #convertedTitle = null
  /** @type {string|null} */
  #caption = null
  /** @type {string[]} */
  subs
  /** @type {string[]|null} */
  defaultSubs
  /** @type {string|number|null} */
  numeral
  /** @type {Cursor|null} */
  sourceLocation
  /** @internal */
  _nextSectionIndex
  /** @internal */
  _nextSectionOrdinal

  /**
   * @param {AbstractBlock} parent
   * @param {string} context
   * @param {object} [opts={}]
   */
  constructor(parent, context, opts = {}) {
    super(parent, context, opts);
    /**
     * Describes the type of content this block accepts and how it should be converted. Acceptable values are:
     *  - `compound` - this block contains other blocks
     *  - `simple` - this block holds a paragraph of prose that receives normal substitutions
     *  - `verbatim` - this block holds verbatim text (displayed "as is") that receives verbatim substitutions
     *  - `raw` - this block holds unprocessed content passed directly to the output with no substitutions applied
     *  - `empty` - this block has no content
     * @type {string}
     */
    this.contentModel = 'compound';
    /**
     * Array of {@link AbstractBlock} child blocks for this block. Only applies if content model is `compound`.
     * @type {AbstractBlock[]}
     */
    this.blocks = [];
    this.subs = [];
    this.#title = null;
    this.#caption = null;
    this.numeral = null;
    this.style = null;
    this.defaultSubs = null;
    this.sourceLocation = null;
    if (context === 'document' || context === 'section') {
      this.level = 0;
      this._nextSectionIndex = 0;
      this._nextSectionOrdinal = 1;
    } else if (parent instanceof AbstractBlock) {
      this.level = parent.level;
    } else {
      this.level = null;
    }
  }

  isBlock() {
    return true
  }
  isInline() {
    return false
  }

  /**
   * Get the String title of this block with title substitutions applied.
   * The result is pre-computed during Document.parse() via precomputeTitle().
   * Falls back to applyHeaderSubs (sync) if precomputeTitle() has not been called yet
   * (e.g. when a title is set via the API after parsing).
   * @returns {string|null} the converted String title, or null if the source title is falsy.
   */
  get title() {
    if (this.#convertedTitle != null) return this.#convertedTitle
    if (this.#title == null) return null
    // Pre-computation hasn't run (title set after parse, or parse not yet done).
    // Apply the synchronous header subs (specialcharacters + attributes) as a best-effort.
    return this.applyHeaderSubs(this.#title)
  }

  /**
   * Pre-compute the converted title asynchronously.
   * Called during Document.parse() so the synchronous getter works during conversion.
   * Re-entrant calls (circular title references) are detected via _computingTitle and
   * silently skipped so that {@link Section.xreftext()} can return null (→ "[refid]" fallback).
   * @returns {Promise<void>}
   */
  async precomputeTitle() {
    if (this.#title && this.#convertedTitle == null && !this._computingTitle) {
      this._computingTitle = true;
      try {
        this.#convertedTitle = await this.applyTitleSubs(this.#title);
      } finally {
        this._computingTitle = false;
      }
    }
  }

  /**
   * @internal Get the raw (unsubstituted) title as set by the parser.
   * @returns {string|null}
   */
  get rawTitle() {
    return this.#title
  }

  /**
   * @internal Get the title with only attribute substitutions applied (no specialchars).
   * @note no longer used for section ID generation (parser now calls applyTitleSubs to match
   * Ruby's behaviour). Kept for other callers that need a lightweight sync substitution.
   * @returns {string|null}
   */
  get attrSubstitutedTitle() {
    const raw = this.#title;
    if (raw == null) return null
    return raw.includes('{') ? this.subAttributes(raw) : raw
  }

  /**
   * Set the String block title (clears the memoised converted title).
   * @param {string|null} val
   */
  set title(val) {
    this.#convertedTitle = null;
    this.#title = val;
  }

  /**
   * Check whether the title of this block is defined.
   * @returns {boolean}
   */
  hasTitle() {
    return !!this.#title
  }

  /**
   * Get the caption for this block.
   * For admonition blocks, returns the 'textlabel' attribute instead.
   * @returns {string|null}
   */
  get caption() {
    return this.context === 'admonition'
      ? this.attributes.textlabel
      : this.#caption
  }

  /**
   * Set the caption for this block.
   * @param {string|null} val
   */
  set caption(val) {
    this.#caption = val;
  }

  /**
   * Get the source file where this block started.
   * @returns {string|null}
   */
  get file() {
    return this.sourceLocation?.file
  }

  /**
   * Get the source line number where this block started.
   * @returns {number|null}
   */
  get lineno() {
    return this.sourceLocation?.lineno
  }

  /**
   * Update the context of this block, also updating the node name.
   * @param {string} context - The String context to assign to this block.
   */
  setContext(context) {
    this.context = context;
    this.nodeName = String(context);
  }

  /**
   * @deprecated Get/set the numeral of this section as an integer when possible.
   * @returns {number|string}
   */
  get number() {
    const n = parseInt(this.numeral, 10);
    return String(n) === String(this.numeral) ? n : this.numeral
  }

  /**
   * @deprecated
   * @param {number|string} val
   */
  set number(val) {
    this.numeral = String(val);
  }

  /**
   * Convert this block and return the converted String content.
   * @returns {Promise<string>} the result of the converter.
   */
  async convert() {
    this.document.playbackAttributes(this.attributes);
    return this.converter.convert(this)
  }

  /** @deprecated Use convert() instead. */
  render() {
    return this.convert()
  }

  /**
   * Get the converted result of all child blocks joined with a newline.
   * @returns {Promise<TContent>}
   */
  async content() {
    const results = [];
    for (const b of this.blocks) results.push(await b.convert());
    return results.join(LF$1)
  }

  /**
   * Alias for the content method — mirrors the core API.
   * @returns {Promise<TContent>}
   */
  getContent() {
    return this.content()
  }

  /**
   * Append a content block to this block's list of blocks.
   * @param {AbstractBlock} block - The new child block.
   * @returns {AbstractBlock} this block (enables chaining).
   */
  append(block) {
    if (block.getParent() !== this) block.parent = this;
    this.blocks.push(block);
    return this
  }

  /**
   * Determine whether this block contains block content.
   * @returns {boolean}
   */
  hasBlocks() {
    return this.blocks.length > 0
  }

  /**
   * Check whether this block has any child Section objects.
   * Overridden by Document and Section.
   * @returns {boolean}
   */
  hasSections() {
    return false
  }

  /**
   * Get the child Section objects of this block.
   * Only applies to Document and Section instances.
   * @returns {AbstractBlock[]} array of Section objects (may be empty).
   */
  sections() {
    return this.blocks.filter((b) => b.context === 'section')
  }

  /**
   * Get the converted alt text for this block image.
   * @returns {string} string with XML special character and replacement substitutions applied.
   */
  alt() {
    const text = this.attributes.alt;
    if (text) {
      if (text === this.attributes['default-alt'])
        return this.subSpecialchars(text)
      const escaped = this.subSpecialchars(text);
      return ReplaceableTextRx.test(escaped)
        ? this.subReplacements(escaped)
        : escaped
    }
    return ''
  }

  /**
   * Get the converted alt text for this block image (alias of alt).
   * @returns {string}
   */
  getAlt() {
    return this.alt()
  }

  /**
   * Get the converted title prefixed with the caption.
   * @returns {string} the captioned title.
   */
  captionedTitle() {
    return `${this.caption || ''}${this.title || ''}`
  }

  /**
   * Get the list marker keyword for the specified list type.
   * @param {string|null} [listType=null] - The String list type (default: this.style).
   * @returns {string|undefined} the single-character String keyword for the list marker.
   */
  listMarkerKeyword(listType = null) {
    return ORDERED_LIST_KEYWORDS[listType || this.style]
  }

  /**
   * Check whether the specified substitution is enabled for this block.
   * @param {string} name - The String substitution name.
   * @returns {boolean}
   */
  hasSub(name) {
    return this.subs.includes(name)
  }

  /**
   * Remove a substitution from this block.
   * @param {string} name - The String substitution name to remove.
   */
  removeSub(name) {
    const idx = this.subs.indexOf(name);
    if (idx >= 0) this.subs.splice(idx, 1);
  }

  /**
   * Alias for {@link getXrefText}.
   * @param {string|null} [xrefstyle=null] - Optional String style: 'full', 'short', or 'basic'.
   * @returns {Promise<string|null>} the xreftext, or null.
   * @see {getXrefText}
   */
  async xreftext(xrefstyle = null) {
    const val = this.reftext;
    if (val && val.length > 0) return val
    if (xrefstyle && this.#title && this.#caption) {
      if (xrefstyle === 'full') {
        const quoteTemplate = this.document.compatMode ? "``%s''" : '"`%s`"';
        const quotedTitle = this.subPlaceholder(
          await this.subQuotes(quoteTemplate),
          this.title
        );
        if (this.numeral) {
          const captionAttrName = CAPTION_ATTRIBUTE_NAMES[this.context];
          if (captionAttrName) {
            const prefix = this.document.attributes[captionAttrName];
            if (prefix) return `${prefix} ${this.numeral}, ${quotedTitle}`
          }
        }
        const cap = this.#caption;
        return `${cap.endsWith('. ') ? cap.slice(0, -2) : cap}, ${quotedTitle}`
      } else if (xrefstyle === 'short') {
        if (this.numeral) {
          const captionAttrName = CAPTION_ATTRIBUTE_NAMES[this.context];
          if (captionAttrName) {
            const prefix = this.document.attributes[captionAttrName];
            if (prefix) return `${prefix} ${this.numeral}`
          }
        }
        const cap = this.#caption;
        return cap.endsWith('. ') ? cap.slice(0, -2) : cap
      }
    }
    return this.title
  }

  /**
   * Generate and assign a caption to this block if not already assigned.
   * If the block has a title and a caption prefix is available, builds a caption
   * from the prefix and a counter, then stores it.
   * @param {string|null} [value=null] - The String caption to assign, or null to derive from document attributes.
   * @param {string} [captionContext=this.context] - The String context used to look up caption attributes.
   */
  assignCaption(value = null, captionContext = this.context) {
    // In Ruby, empty string is truthy; use != null to replicate that semantics.
    if (this.#caption != null || !this.#title) return
    const globalCaption = this.document.attributes.caption;
    // Explicit value (even '') or a global :caption: attribute (even empty) takes precedence and
    // suppresses auto-numbering, matching Ruby's behaviour where any truthy assignment wins.
    if (value != null || globalCaption != null) {
      this.#caption = value != null ? value : globalCaption;
    } else {
      const attrName = CAPTION_ATTRIBUTE_NAMES[captionContext];
      if (attrName) {
        const prefix = this.document.attributes[attrName];
        if (prefix) {
          this.numeral = this.document.incrementAndStoreCounter(
            `${captionContext}-number`,
            this
          );
          this.#caption = `${prefix} ${this.numeral}. `;
        }
      }
    }
  }

  /**
   * @internal Assign the next index (0-based) and numeral (1-based) to the section.
   * @param {AbstractBlock} section - The Section to which to assign the next index and numeral.
   */
  assignNumeral(section) {
    section.index = this._nextSectionIndex;
    this._nextSectionIndex = section.index + 1;
    const like = section.numbered;
    if (like) {
      const sectname = section.sectname;
      if (sectname === 'appendix') {
        section.numeral = this.document.counter('appendix-number', 'A');
        const captionAttr = this.document.attributes['appendix-caption'];
        section.caption = captionAttr
          ? `${captionAttr} ${section.numeral}: `
          : `${section.numeral}. `;
      } else if (sectname === 'chapter' || like === 'chapter') {
        section.numeral = String(this.document.counter('chapter-number', 1));
      } else {
        section.numeral =
          sectname === 'part'
            ? intToRoman(this._nextSectionOrdinal)
            : String(this._nextSectionOrdinal);
        this._nextSectionOrdinal++;
      }
    }
  }

  /**
   * @internal Reassign 0-based section indexes for all descendant sections.
   * Must be called after removing child sections to keep internal counters correct.
   */
  reindexSections() {
    this._nextSectionIndex = 0;
    this._nextSectionOrdinal = 1;
    for (const block of this.blocks) {
      if (block.context === 'section') {
        this.assignNumeral(block);
        block.reindexSections();
      }
    }
  }

  /**
   * Selector criteria accepted by {@link AbstractBlock#findBy}.
   * @typedef {Object} FindBySelector
   * @property {string} [context] - node context (e.g. `'section'`, `'listing'`, `'paragraph'`, `'image'`)
   * @property {string} [style] - block style (e.g. `'source'`, `'NOTE'`)
   * @property {string} [role] - a CSS role that must appear in the node's role list
   * @property {string} [id] - exact node id; stops traversal after the first match
   * @property {boolean} [traverseDocuments] - when `true`, recurse into AsciiDoc table cells
   */

  /**
   * Filter callback passed to {@link AbstractBlock#findBy}.
   * @callback FindByFilter
   * @param {AbstractBlock} node - the candidate block-level node being visited
   * @returns {boolean|string} a truthy value to include the node; `'prune'`, `'reject'` or `'stop'` to control traversal
   */

  /**
   * Walk the document tree and find all block-level nodes that match
   * the selector and optional filter function.
   *
   * The selector is a plain object whose keys narrow the search:
   * - `context` {string} — node context (e.g. `'section'`, `'listing'`, `'paragraph'`, `'image'`)
   * - `style` {string} — block style (e.g. `'source'`, `'NOTE'`)
   * - `role` {string} — a CSS role that must appear in the node's role list
   * - `id` {string} — exact node id; stops traversal after the first match
   * - `traverseDocuments` {boolean} — when `true`, recurse into AsciiDoc table cells
   *
   * The optional filter function receives each candidate node and must return:
   * - a truthy value (or `true`) → include the node
   * - `'prune'` → include the node but do **not** recurse into its children
   * - `'reject'` → skip the node and its children
   * - `'stop'` → include the node (if it matched) and stop the entire traversal
   *
   * @param {FindBySelector|FindByFilter} [selector={}] - Selector criteria object, or a filter callback when called as `findBy(callback)`.
   * @param {FindByFilter|null} [filter=null] - Per-node filter callback; receives each candidate {@link AbstractBlock}.
   * @returns {AbstractBlock[]} array of matching block-level nodes.
   *
   * @example <caption>All source listing blocks</caption>
   * const listings = doc.findBy({ context: 'listing', style: 'source' })
   *
   * @example <caption>All sections up to level 2</caption>
   * const sections = doc.findBy({ context: 'section' }, (node) => node.level <= 2 || 'prune')
   *
   * @example <caption>Find a block by id</caption>
   * const [block] = doc.findBy({ id: 'my-anchor' })
   *
   * @example <caption>All image blocks including those inside AsciiDoc table cells</caption>
   * const images = doc.findBy({ context: 'image', traverseDocuments: true })
   *
   * @example <caption>Filter-only shorthand (no selector)</caption>
   * const verbatim = doc.findBy((b) => b.contentModel === ContentModel.VERBATIM)
   */
  findBy(selector = {}, filter = null) {
    const result = [];
    // Normalise: if selector is not a plain object, treat it as an empty selector.
    const normSelector =
      selector && typeof selector === 'object' && !Array.isArray(selector)
        ? selector
        : {};
    // Normalise: support findBy(callback) shorthand — selector is the filter when it's a function.
    const normFilter =
      typeof filter === 'function'
        ? filter
        : typeof selector === 'function'
          ? selector
          : null;
    try {
      this.#findByInternal(normSelector, result, normFilter);
    } catch (e) {
      if (!(e instanceof StopIteration)) throw e
    }
    return result
  }

  /**
   * Alias for {@link findBy}.
   * @param {FindBySelector|FindByFilter} [selector={}] - Selector criteria object, or a filter callback when called as `query(callback)`.
   * @param {FindByFilter|null} [filter=null] - Per-node filter callback; receives each candidate {@link AbstractBlock}.
   * @returns {AbstractBlock[]} array of matching block-level nodes.
   */
  query(selector = {}, filter = null) {
    return this.findBy(selector, filter)
  }

  /**
   * Move to the next adjacent block in document order.
   * If the current block is the last item in a list, returns the following
   * sibling of the list block.
   * @returns {AbstractBlock|null} the next AbstractBlock, or null.
   */
  nextAdjacentBlock() {
    if (this.context === 'document') return null
    const p = this.getParent();
    if (p.context === 'dlist' && this.context === 'list_item') {
      const idx = p
        .getItems()
        .findIndex(([terms, desc]) => terms.includes(this) || desc === this);
      const sib = p.getItems()[idx + 1];
      return sib ? sib : p.nextAdjacentBlock()
    }
    const idx = p.blocks.indexOf(this);
    const sib = p.blocks[idx + 1];
    return sib ? sib : p.nextAdjacentBlock()
  }

  /** @private Core traversal logic for findBy. Throws StopIteration for early exit. */
  #findByInternal(selector, result, filter) {
    const contextSelector = selector.context ?? null;
    const anyContext = !contextSelector;
    const styleSelector = selector.style ?? null;
    const roleSelector = selector.role ?? null;
    const idSelector = selector.id ?? null;

    if (
      (anyContext || contextSelector === this.context) &&
      (!styleSelector || styleSelector === this.style) &&
      (!roleSelector || this.hasRole(roleSelector)) &&
      (!idSelector || idSelector === this.id)
    ) {
      if (filter) {
        const verdict = filter(this);
        if (verdict) {
          if (verdict === 'prune') {
            result.push(this);
            if (idSelector) throw new StopIteration()
            return result
          } else if (verdict === 'reject') {
            if (idSelector) throw new StopIteration()
            return result
          } else if (verdict === 'stop') {
            throw new StopIteration()
          } else {
            result.push(this);
            if (idSelector) throw new StopIteration()
          }
        } else if (idSelector) {
          throw new StopIteration()
        }
      } else {
        result.push(this);
        if (idSelector) throw new StopIteration()
      }
    }

    if (this.context === 'document') {
      if (contextSelector !== 'document') {
        // Process document header as a section if present
        if (
          this.hasHeader?.() &&
          (anyContext || contextSelector === 'section')
        ) {
          this.header.#findByInternal(selector, result, filter);
        }
        for (const b of this.blocks) {
          if (contextSelector === 'section' && b.context !== 'section') continue // optimisation
          b.#findByInternal(selector, result, filter);
        }
      }
    } else if (this.context === 'dlist') {
      if (anyContext || contextSelector !== 'section') {
        // optimisation
        // NOTE dlist items can be null
        for (const b of this.blocks.flat(Infinity)) {
          if (b) b.#findByInternal(selector, result, filter);
        }
      }
    } else if (this.context === 'table') {
      if (selector.traverseDocuments) {
        for (const r of this.rows.head)
          for (const c of r) c.#findByInternal(selector, result, filter);
        const innerSelector =
          contextSelector === 'inner_document'
            ? { ...selector, context: 'document' }
            : selector;
        for (const r of [...this.rows.body, ...this.rows.foot]) {
          for (const c of r) {
            c.#findByInternal(innerSelector, result, filter);
            if (c.style === 'asciidoc')
              c.innerDocument.#findByInternal(innerSelector, result, filter);
          }
        }
      } else {
        for (const r of [
          ...this.rows.head,
          ...this.rows.body,
          ...this.rows.foot,
        ]) {
          for (const c of r) c.#findByInternal(selector, result, filter);
        }
      }
    } else {
      for (const b of this.blocks) {
        if (contextSelector === 'section' && b.context !== 'section') continue // optimisation
        b.#findByInternal(selector, result, filter);
      }
    }

    return result
  }

  // ── JavaScript-style accessors ────────────────────────────────────────────────

  /**
   * Get the context (node type) of this block.
   * @returns {string}
   */
  getContext() {
    return this.context
  }

  /**
   * Get the content model of this block.
   * @returns {string}
   */
  getContentModel() {
    return this.contentModel
  }

  /**
   * Set the content model of this block.
   * @param {string} val
   */
  setContentModel(val) {
    this.contentModel = val;
  }

  /**
   * Get the node name of this block.
   * @returns {string}
   */
  getNodeName() {
    return this.nodeName
  }

  /**
   * Get the child blocks of this block.
   * @returns {AbstractBlock[]}
   */
  getBlocks() {
    return this.blocks
  }

  /**
   * Get the child Section blocks of this block.
   * @returns {AbstractBlock[]}
   */
  getSections() {
    return this.sections()
  }

  /**
   * Get the title of this block with substitutions applied.
   * @returns {string|null}
   */
  getTitle() {
    return this.title
  }

  /**
   * Set the raw title of this block.
   * @param {string|null} val
   */
  setTitle(val) {
    this.title = val ?? null;
  }

  /**
   * Get the caption of this block.
   * @returns {string|undefined}
   */
  getCaption() {
    return this.caption ?? undefined
  }

  /**
   * Set the caption of this block.
   * @param {string|null} val
   */
  setCaption(val) {
    this.caption = val;
  }

  /**
   * Get the captioned title of this block.
   * @returns {string}
   */
  getCaptionedTitle() {
    return this.captionedTitle()
  }

  /**
   * Get the style of this block.
   * @returns {string|null}
   */
  getStyle() {
    return this.style
  }

  /**
   * Set the style of this block.
   * @param {string|null} val
   */
  setStyle(val) {
    this.style = val;
  }

  /**
   * Get the level of this block.
   * @returns {number|null}
   */
  getLevel() {
    return this.level
  }

  /**
   * Set the level of this block.
   * @param {number|null} val
   */
  setLevel(val) {
    this.level = val;
  }

  /**
   * Get the source file where this block started.
   * @returns {string|undefined} the file path, or undefined when sourcemap is disabled.
   */
  getFile() {
    return this.file ?? undefined
  }

  /**
   * Get the source line number where this block started.
   * @returns {number|undefined} line number, or undefined when sourcemap is disabled.
   */
  getLineNumber() {
    return this.lineno ?? undefined
  }

  /**
   * Generate cross-reference text (xreftext) used to refer to this block.
   * Uses the explicit reftext if set. For sections or captioned blocks (blocks
   * with both a title and a caption), formats the text according to xrefstyle.
   * Falls back to the title, or null if no title is available.
   * @param {string|null} [xrefstyle=null] - Optional String style: 'full', 'short', or 'basic'.
   * @returns {Promise<string|null>} the xreftext, or null.
   */
  async getXrefText(xrefstyle = null) {
    return this.xreftext(xrefstyle)
  }

  /**
   * Get the source location of this block.
   * @returns {Cursor|undefined} the Cursor source location object, or undefined when sourcemap is disabled.
   */
  getSourceLocation() {
    return this.sourceLocation ?? undefined
  }

  /**
   * Get the list of substitutions enabled for this block.
   * @returns {string[]}
   */
  getSubstitutions() {
    return this.subs
  }

  /**
   * Check whether the specified substitution is enabled for this block.
   * @param {string} name
   * @returns {boolean}
   */
  hasSubstitution(name) {
    return this.hasSub(name)
  }

  /**
   * Add the specified substitution to this block's substitutions list.
   * @param {string} name
   */
  addSubstitution(name) {
    if (!this.subs.includes(name)) this.subs.push(name);
  }

  /**
   * Remove the specified substitution from this block's substitutions list.
   * @param {string} name
   */
  removeSubstitution(name) {
    this.removeSub(name);
  }
}

// ESM conversion of the Compliance module (defined inside asciidoctor.rb).
//
// Ruby-to-JavaScript notes:
//   - The Ruby module uses dynamic attr_accessor generation via `define`.
//     In JS each flag is a plain enumerable property on the exported object.
//   - The `keys` Set is retained so callers can enumerate all known flags
//     (used e.g. by the options-merging code in Document).
//   - All default values match the Asciidoctor defaults (not the "AsciiDoc
//     compliance values" documented in comments — those differ intentionally).

const Compliance = {
  /** AsciiDoc does not parse paragraphs with a verbatim style as verbatim content. Compliance value: false (Asciidoctor default: true) */
  strictVerbatimParagraphs: true,

  /** AsciiDoc drops lines that contain references to missing attributes. Possible values: 'skip', 'drop', 'drop-line', 'warn'. Compliance value: 'drop-line' (Asciidoctor default: 'skip') */
  attributeMissing: 'skip',

  /** AsciiDoc drops lines that contain an attribute unassignment. Compliance value: 'drop-line' */
  attributeUndefined: 'drop-line',

  /** Shorthand syntax for id, role and options on blocks (e.g. #id.role%opt). Compliance value: false (Asciidoctor default: true) */
  shorthandPropertySyntax: true,

  /** Starting counter when generating a unique id on conflict. Compliance value: 2 */
  uniqueIdStartIndex: 2};

// ESM conversion of section.rb


/**
 * Methods for managing sections of AsciiDoc content in a document.
 */
class Section extends AbstractBlock {
  /**
   * Create a new Section — mirrors the core Section.create() API.
   * @param {AbstractBlock|null} [parent=null]
   * @param {number|null} [level=null]
   * @param {boolean} [numbered=false]
   * @param {Object} [opts={}]
   * @returns {Section}
   */
  static create(parent = null, level = null, numbered = false, opts = {}) {
    return new Section(parent, level, numbered, opts)
  }

  /**
   * Initialize an Asciidoctor Section object.
   * @param {AbstractBlock|null} [parent=null] - The parent AbstractBlock (Document or Section), or null.
   * @param {number|null} [level=null] - The Integer level of this section (default: parent.level + 1 or 1).
   * @param {boolean} [numbered=false] - Boolean indicating whether numbering is enabled.
   * @param {Object} [opts={}] - An optional plain object of options.
   */
  constructor(parent = null, level = null, numbered = false, opts = {}) {
    super(parent, 'section', opts);
    if (parent instanceof Section) {
      this.level = level ?? parent.level + 1;
      this.special = parent.special;
    } else {
      this.level = level ?? 1;
      this.special = false;
    }
    this.numbered = numbered;
    this.index = 0;
    this.sectname = null;
  }

  /**
   * The name of this section — alias for title.
   * @returns {string|null}
   */
  get name() {
    return this.title
  }

  /**
   * Check whether this section has any child Section objects.
   * @returns {boolean}
   */
  hasSections() {
    return this._nextSectionIndex > 0
  }

  /**
   * Generate a String ID from the title of this section.
   * This sync convenience method is only called outside of parsing (e.g. extensions).
   * At that point #convertedTitle is already set, so this.title returns the fully-substituted
   * HTML title — matching Ruby's behaviour where section.title calls apply_title_subs.
   * @returns {string}
   */
  generateId() {
    return Section.generateId(this.title, this.document)
  }

  /**
   * Get the section number for the current Section as a dot-separated String.
   * @param {string} [delimiter='.'] - The separator between numerals.
   * @param {string|false|null} [append=null] - String appended at the end, or false to omit trailing delimiter
   *   (default: null → same as delimiter).
   * @returns {string} the section number String.
   */
  sectnum(delimiter = '.', append = null) {
    const suffix =
      append !== null ? (append === false ? '' : append) : delimiter;
    if (this.level > 1 && this.getParent() instanceof Section) {
      return `${this.getParent().sectnum(delimiter, delimiter)}${this.numeral ?? ''}${suffix}`
    }
    return `${this.numeral ?? ''}${suffix}`
  }

  /**
   * Generate cross-reference text for this section.
   * Respects an explicit reftext if set; otherwise formats the section title
   * according to xrefstyle ('full', 'short', or 'basic').
   * @param {string|null} [xrefstyle=null]
   * @returns {Promise<string|null>}
   */
  async xreftext(xrefstyle = null) {
    const val = this.reftext;
    if (val && val.length > 0) return val

    // If the title is currently being computed (circular reference), return null so that
    // the caller (convert_inline_anchor) falls back to the "[refid]" placeholder.
    if (this._computingTitle) return null

    // Compute the title now using the current catalog state if not already done.
    // This ensures that forward xrefs in a section title are not resolved when the
    // xreftext is first requested during parsing (before the target is registered).
    await this.precomputeTitle();

    if (xrefstyle) {
      if (this.numbered) {
        const type = this.sectname;
        switch (xrefstyle) {
          case 'full': {
            let quotedTitle;
            if (type === 'chapter' || type === 'appendix') {
              quotedTitle = this.subPlaceholder(
                await this.subQuotes('_%s_'),
                this.title
              );
            } else {
              const q = this.document.compatMode ? "``%s''" : '"`%s`"';
              quotedTitle = this.subPlaceholder(
                await this.subQuotes(q),
                this.title
              );
            }
            const signifier = this.document.attributes[`${type}-refsig`];
            return signifier
              ? `${signifier} ${this.sectnum('.', ',')} ${quotedTitle}`
              : `${this.sectnum('.', ',')} ${quotedTitle}`
          }
          case 'short': {
            const signifier =
              this.document.attributes[`${this.sectname}-refsig`];
            return signifier
              ? `${signifier} ${this.sectnum('.', '')}`
              : this.sectnum('.', '')
          }
          default: {
            // 'basic'
            const t = this.sectname;
            return t === 'chapter' || t === 'appendix'
              ? this.subPlaceholder(await this.subQuotes('_%s_'), this.title)
              : this.title
          }
        }
      } else {
        // apply basic styling
        const t = this.sectname;
        return t === 'chapter' || t === 'appendix'
          ? this.subPlaceholder(await this.subQuotes('_%s_'), this.title)
          : this.title
      }
    }
    return this.title
  }

  /**
   * Append a content block to this block's list of blocks.
   * If the child block is a Section, assign an index/numeral to it.
   * @param {AbstractBlock} block - The child Block to append.
   * @returns {this}
   */
  append(block) {
    if (block.context === 'section') this.assignNumeral(block);
    return super.append(block)
  }

  // ── JavaScript-style accessors ────────────────────────────────────────────────

  /**
   * Get the section title (alias of title).
   * @returns {string|null}
   */
  getName() {
    return this.name
  }

  /**
   * Get the section name (e.g. 'section', 'appendix').
   * @returns {string|null}
   */
  getSectionName() {
    return this.sectname ?? undefined
  }

  /**
   * Set the section name (e.g. 'section', 'appendix').
   * @param {string|null} val
   */
  setSectionName(val) {
    this.sectname = val;
  }

  /**
   * Get the 0-based index of this section within the parent block.
   * @returns {number}
   */
  getIndex() {
    return this.index
  }

  /**
   * Set the 0-based index of this section within the parent block.
   * @param {number} val
   */
  setIndex(val) {
    this.index = val;
  }

  /**
   * Get whether this section is numbered.
   * @returns {boolean}
   */
  isNumbered() {
    return this.numbered
  }

  /**
   * Get whether this section is a special section.
   * @returns {boolean}
   */
  isSpecial() {
    return this.special
  }

  /**
   * Set whether this section is a special section.
   * @param {boolean} val
   */
  setSpecial(val) {
    this.special = val;
  }

  /**
   * Get the section numeral string.
   * @returns {string|null}
   */
  getNumeral() {
    return this.numeral
  }

  /**
   * Set the section numeral string.
   * @param {string|null} val
   */
  setNumeral(val) {
    this.numeral = val;
  }

  /**
   * Get the section number string (dot-separated).
   * @returns {string}
   */
  getSectionNumeral() {
    return this.sectnum()
  }

  /**
   * Get the section number string (alias of getSectionNumeral).
   * @returns {string}
   */
  getSectionNumber() {
    return this.sectnum()
  }

  toString() {
    if (this._title) {
      const formalTitle = this.numbered
        ? `${this.sectnum()} ${this._title}`
        : this._title;
      return `#<Section {level: ${this.level}, title: ${JSON.stringify(formalTitle)}, blocks: ${this.blocks.length}}>`
    }
    return super.toString()
  }

  /**
   * Generate a String ID from the given section title.
   * @param {string} title - The String title.
   * @param {object} document - The Document.
   * @returns {string} the generated String ID.
   */
  static generateId(title, document) {
    const attrs = document.attributes;
    const pre = attrs.idprefix ?? '_';
    let sep, sepSub, noSep;

    const rawSep = attrs.idseparator;
    if (rawSep !== undefined && rawSep !== null) {
      if (rawSep.length === 0) {
        noSep = true;
        sep = '';
        sepSub = null;
      } else {
        // Use only first character if multi-character
        sep = rawSep.length === 1 ? rawSep : (attrs.idseparator = rawSep[0]);
        if (sep === '-' || sep === '.') {
          sepSub = ' .-';
        } else {
          sepSub = ` ${sep}.-`;
        }
      }
    } else {
      sep = '_';
      sepSub = ' _.-';
    }

    let genId = `${pre}${title.toLowerCase().replace(new RegExp(InvalidSectionIdCharsRx.source, 'gu'), '')}`;

    if (noSep) {
      genId = genId.replace(/ /g, '');
    } else {
      // Replace chars in sepSub with sep and squeeze consecutive sep chars
      genId = _trS(genId, sepSub, sep);
      if (genId.endsWith(sep)) genId = genId.slice(0, -sep.length);
      // Ensure id doesn't begin with idseparator if idprefix is empty
      if (pre === '' && genId.startsWith(sep)) genId = genId.slice(sep.length);
    }

    const refs = document.catalog?.refs;
    if (refs && genId in refs) {
      let cnt = Compliance.uniqueIdStartIndex;
      let candidate;
      do {
        candidate = `${genId}${sep}${cnt}`;
        cnt++;
      } while (candidate in refs)
      return candidate
    }
    return genId
  }
}

/**
 * @internal Translate every character in `fromChars` to `toChar` and squeeze
 * consecutive runs of the translated character (mirrors Ruby's String#tr_s).
 * @param {string} str
 * @param {string} fromChars
 * @param {string} toChar
 * @returns {string}
 */
function _trS(str, fromChars, toChar) {
  const set = new Set([...fromChars]);
  let result = '';
  let prevWasSep = false;
  for (const ch of str) {
    if (set.has(ch)) {
      if (!prevWasSep) result += toChar;
      prevWasSep = true;
    } else {
      result += ch;
      prevWasSep = false;
    }
  }
  return result
}

// ESM conversion of inline.rb


/**
 * Represents an inline element in an AsciiDoc document.
 */
class Inline extends AbstractNode {
  /** @type {string|null} */
  id
  /** @type {string|null} */
  type
  /** @type {string|null} */
  target
  /** @type {string|null} */
  text

  /**
   * @param {AbstractNode} parent
   * @param {string} context
   * @param {string|null} [text=null] - The String text of this inline element.
   * @param {Object} [opts={}] - A plain object of options:
   *   id     - The String id of this inline element.
   *   type   - The String type qualifier (e.g. 'ref', 'bibref').
   *   target - The String target (e.g. a URI).
   */
  constructor(parent, context, text = null, opts = {}) {
    super(parent, context, opts);
    this.nodeName = `inline_${context}`;
    this.text = text;
    this.id = opts.id ?? null;
    this.type = opts.type ?? null;
    this.target = opts.target ?? null;
  }

  isBlock() {
    return false
  }
  isInline() {
    return true
  }

  /**
   * Convert this inline element using the document's converter.
   * @returns {Promise<string>}
   */
  async convert() {
    return this.converter.convert(this)
  }

  /** @deprecated Use convert() instead. */
  render() {
    return this.convert()
  }

  /**
   * Get the converted content (alias for text).
   * @returns {string|null}
   */
  content() {
    return this.text
  }

  /**
   * Alias for {@link getAlt}.
   * @see {getAlt}
   */
  get alt() {
    return this.getAttribute('alt') || ''
  }

  /**
   * Check whether this inline node has reftext.
   * For ref and bibref nodes the text acts as the reftext.
   * @returns {boolean}
   */
  hasReftext() {
    return !!(this.text && (this.type === 'ref' || this.type === 'bibref'))
  }

  /**
   * Get the reftext for this inline node with substitutions applied.
   * The result is pre-computed during Document.parse() via precomputeReftext().
   * Falls back to the raw text if precomputeReftext() has not been called yet.
   * @returns {string|null}
   */
  get reftext() {
    if (this._convertedReftext !== undefined) return this._convertedReftext
    return this.text ?? null
  }

  /**
   * @internal
   * Pre-compute the reftext with substitutions applied asynchronously.
   * Called during Document.parse() so the synchronous getter works during conversion.
   * @returns {Promise<void>}
   */
  async precomputeReftext() {
    const val = this.text;
    this._convertedReftext =
      val != null ? await this.applyReftextSubs(val) : null;
  }

  /**
   * Generate cross-reference text (xreftext) that can be used to refer to this inline node.
   *
   * Uses the explicit reftext for this inline node, if specified, retrieved by calling the
   * reftext method. Otherwise, returns null.
   *
   * @param {string|null} [_xrefstyle=null] - Not currently used.
   * @returns {string|null} the reftext to refer to this inline node, or null if no reftext is defined.
   */
  xreftext(_xrefstyle = null) {
    return this.reftext
  }

  // ── JavaScript-style accessors ────────────────────────────────────────────────

  /**
   * Return the text of this inline node.
   * @returns {string|null}
   */
  getText() {
    return this.text
  }

  /**
   * Return the type qualifier of this inline node (e.g. 'ref', 'bibref').
   * @returns {string|null}
   */
  getType() {
    return this.type
  }

  /**
   * Return the target (e.g. URI or anchor) of this inline node.
   * @returns {string|null}
   */
  getTarget() {
    return this.target
  }

  /**
   * Get the alt text for this inline image.
   * @returns {string} the value of the alt attribute, or ''.
   */
  getAlt() {
    return this.alt
  }

  /**
   * Get the reftext for this inline node with substitutions applied.
   * @returns {string|null}
   */
  getReftext() {
    return this.reftext
  }
}

// ESM conversion of callouts.rb

/** Maintains a catalog of callouts and their associations. */
class Callouts {
  constructor() {
    /** @internal */
    this._lists = [];
    /** @internal */
    this._listIndex = 0;
    this.nextList();
  }

  /**
   * Register a new callout for the given list item ordinal.
   * @param {number} liOrdinal - The 1-based ordinal of the list item.
   * @returns {string} The unique id of this callout (e.g. 'CO1-1').
   */
  register(liOrdinal) {
    const id = this._generateNextCalloutId();
    this.getCurrentList().push({ ordinal: parseInt(liOrdinal, 10), id });
    this._coIndex++;
    return id
  }

  /**
   * Get the next callout id in document order (used during conversion).
   * @returns {string|null} The unique id of the next callout, or null.
   */
  readNextId() {
    const list = this.getCurrentList();
    const id = this._coIndex <= list.length ? list[this._coIndex - 1].id : null;
    this._coIndex++;
    return id
  }

  /**
   * Get a space-separated list of callout ids for the given list item.
   * @param {number} liOrdinal - The 1-based ordinal of the list item.
   * @returns {string} Space-separated callout ids.
   */
  getCalloutIds(liOrdinal) {
    const list = this.getCurrentList();
    return list
      .filter((item) => item.ordinal === liOrdinal)
      .map((item) => item.id)
      .join(' ')
  }

  /** @returns {Array<{ordinal: number, id: string}>} The callout objects at the current list index. */
  getCurrentList() {
    return this._lists[this._listIndex - 1]
  }

  /** @returns {Array<Array<{ordinal: number, id: string}>>} All callout lists in the document. */
  getLists() {
    return this._lists
  }

  /** @returns {number} The 1-based index of the current callout list. */
  getListIndex() {
    return this._listIndex
  }

  /** Advance to the next callout list in the document. */
  nextList() {
    this._listIndex++;
    if (this._lists.length < this._listIndex) this._lists.push([]);
    /** @internal */
    this._coIndex = 1;
  }

  /** Rewind the list pointer to the beginning (switching parse → convert). */
  rewind() {
    this._listIndex = 1;
    this._coIndex = 1;
  }

  /**
   * @internal
   * @private
   */
  _generateNextCalloutId() {
    return `CO${this._listIndex}-${this._coIndex}`
  }
}

// ESM conversion of path_resolver.rb
//
// Ruby-to-JavaScript notes:
//   - Ruby's File::ALT_SEPARATOR / File::SEPARATOR / Dir.pwd → process.cwd() on Node.js.
//   - Ruby's Pathname#relative_path_from → manual relative-path computation.
//   - Ruby's require 'pathname' is not needed; logic is inlined.
//   - The Opal / JRuby conditional root? overloads are omitted (Node.js only).
//   - Logging mixin is applied via applyLogging() after class definition.


const DOT = '.';
const DOT_DOT = '..';
const DOT_SLASH = './';
const SLASH = '/';
const BACKSLASH$1 = '\\';
const DOUBLE_SLASH = '//';
const URI_CLASSLOADER = 'uri:classloader:';
const WINDOWS_ROOT_RX = /^(?:[a-zA-Z]:)?[\\/]/;

/** Handles all operations for resolving, cleaning and joining paths. */
class PathResolver {
  /**
   * Construct a new PathResolver.
   * @param {string|null} fileSeparator - The file separator (default: '/' or '\\' on Windows).
   * @param {string|null} workingDir - The working directory (default: process.cwd()).
   */
  constructor(fileSeparator = null, workingDir = null) {
    this.fileSeparator = fileSeparator ?? _platformSeparator();
    if (workingDir) {
      this.workingDir = this.root(workingDir)
        ? this.posixify(workingDir)
        : _expandPath$1(workingDir);
    } else {
      this.workingDir = typeof process !== 'undefined' ? process.cwd() : '/';
    }
    this._partitionPathSys = {};
    this._partitionPathWeb = {};
  }

  /**
   * Check whether the specified path is an absolute path.
   * @param {string} path
   * @returns {boolean}
   */
  absolutePath(path) {
    return (
      path.startsWith(SLASH) ||
      (this.fileSeparator === BACKSLASH$1 && WINDOWS_ROOT_RX.test(path)) ||
      UriSniffRx.test(path)
    )
  }

  /**
   * Check if the specified path is an absolute root path.
   * @param {string} path
   * @returns {boolean}
   */
  root(path) {
    return this.absolutePath(path)
  }

  /**
   * Determine if the path is a UNC (root) path.
   * @param {string} path
   * @returns {boolean}
   */
  unc(path) {
    return path.startsWith(DOUBLE_SLASH)
  }

  /**
   * Determine if the path is an absolute (root) web path.
   * @param {string} path
   * @returns {boolean}
   */
  webRoot(path) {
    return path.startsWith(SLASH)
  }

  /**
   * Determine whether path descends from base.
   * @param {string} path
   * @param {string} base
   * @returns {number|false} Offset if path descends from base, false otherwise.
   */
  descendsFrom(path, base) {
    if (base === path) return 0
    if (base === SLASH) return path.startsWith(SLASH) ? 1 : false
    return path.startsWith(base + SLASH) ? base.length + 1 : false
  }

  /**
   * Calculate the relative path to this absolute path from the specified base directory.
   * @param {string} path
   * @param {string} base
   * @returns {string} Relative path, or the original path if it cannot be made relative.
   */
  relativePath(path, base) {
    if (this.root(path)) {
      const posixBase = this.posixify(base);
      const offset = this.descendsFrom(path, posixBase);
      if (offset !== false) return path.slice(offset)
      try {
        return _computeRelativePath(path, posixBase)
      } catch {
        return path
      }
    }
    return path
  }

  /**
   * Normalize path by converting backslashes to forward slashes.
   * @param {string} path
   * @returns {string} The posixified path.
   */
  posixify(path) {
    if (!path) return ''
    return this.fileSeparator === BACKSLASH$1 && path.includes(BACKSLASH$1)
      ? path.replace(/\\/g, SLASH)
      : path
  }

  /**
   * Expand the path by resolving parent references (..) and removing self references (.).
   * @param {string} path
   * @returns {string} The expanded path.
   */
  expandPath(path) {
    const [pathSegments, pathRoot] = this.partitionPath(path);
    if (path.includes(DOT_DOT)) {
      const resolved = [];
      for (const seg of pathSegments) {
        seg === DOT_DOT ? resolved.pop() : resolved.push(seg);
      }
      return this.joinPath(resolved, pathRoot)
    }
    return this.joinPath(pathSegments, pathRoot)
  }

  /**
   * Partition the path into segments and a root prefix.
   * @param {string} path - The path to partition.
   * @param {boolean} [web=false] - Treat as web path.
   * @returns {[string[], string|null]} A 2-item array [segments, root] where root may be null.
   */
  partitionPath(path, web = false) {
    const cache = web ? this._partitionPathWeb : this._partitionPathSys;
    if (cache[path]) return cache[path]

    const posixPath = this.posixify(path);
    let root = null;

    if (web) {
      if (this.webRoot(posixPath)) {
        root = SLASH;
      } else if (posixPath.startsWith(DOT_SLASH)) {
        root = DOT_SLASH;
      }
    } else if (this.root(posixPath)) {
      if (this.unc(posixPath)) {
        root = DOUBLE_SLASH;
      } else if (posixPath.startsWith(SLASH)) {
        root = SLASH;
      } else if (posixPath.startsWith(URI_CLASSLOADER)) {
        root = URI_CLASSLOADER;
      } else {
        const extracted = this._extractUriPrefix(posixPath);
        root = Array.isArray(extracted)
          ? extracted[1] // URL scheme, e.g. 'http://'
          : posixPath.slice(0, posixPath.indexOf(SLASH) + 1); // Windows drive, e.g. 'C:/'
      }
    } else if (posixPath.startsWith(DOT_SLASH)) {
      root = DOT_SLASH;
    }

    const relative = root ? posixPath.slice(root.length) : posixPath;
    // Mirror Ruby's String#split('/'), which drops only *trailing* empty
    // strings. A leading empty segment must be kept: it's what reconstructs
    // the missing slash for URI roots that under-consume it, e.g. root
    // "file://" + relative "/Users/foo" (from "file:///Users/foo") needs
    // that leading '' so joinPath() rebuilds "file:///Users/foo" and not
    // "file://Users/foo".
    const segments = relative.split(SLASH).filter((s) => s !== DOT);
    while (segments.length && segments[segments.length - 1] === '') {
      segments.pop();
    }

    const result = [segments, root];
    cache[path] = result;
    return result
  }

  /**
   * Join segments with posix separator, prepending root if provided.
   * @param {string[]} segments
   * @param {string|null} [root=null]
   * @returns {string} The joined path.
   */
  joinPath(segments, root = null) {
    return root ? `${root}${segments.join(SLASH)}` : segments.join(SLASH)
  }

  /**
   * Securely resolve a system path.
   * @param {string} target - The target path.
   * @param {string|null} [start=null] - The start path.
   * @param {string|null} [jail=null] - The jail path.
   * @param {Object} [opts={}] - Options.
   * @param {boolean} [opts.recover=true] - Recover from jail escapes instead of throwing.
   * @param {string} [opts.targetName='path'] - Name used in error messages.
   * @returns {string} An absolute posix path.
   */
  systemPath(target, start = null, jail = null, opts = {}) {
    const recover = opts.recover !== false;
    const targetName = opts.targetName ?? opts.target_name ?? 'path';

    if (jail) {
      if (!this.root(jail))
        throw new Error(`Jail is not an absolute path: ${jail}`)
      jail = this.posixify(jail);
    }

    let targetSegments;
    if (target) {
      if (this.root(target)) {
        const targetPath = this.expandPath(target);
        if (jail && this.descendsFrom(targetPath, jail) === false) {
          if (!recover)
            throw new SecurityError(
              `${targetName} ${target} is outside of jail: ${jail} (disallowed in safe mode)`
            )
          this.logger.warn(
            `${targetName} is outside of jail; recovering automatically`
          );
          const [ts] = this.partitionPath(targetPath);
          const [js, jr] = this.partitionPath(jail);
          return this.joinPath(js.concat(ts), jr)
        }
        return targetPath
      }
[targetSegments] = this.partitionPath(target);
    } else {
      targetSegments = [];
    }

    let startSegments, jailRoot, recheck;

    if (targetSegments.length === 0) {
      if (!start) {
        return jail ?? this.workingDir
      } else if (this.root(start)) {
        if (!jail) return this.expandPath(start)
        start = this.posixify(start);
      } else {
[targetSegments] = this.partitionPath(start);
        start = jail ?? this.workingDir;
      }
    } else if (!start) {
      start = jail ?? this.workingDir;
    } else if (this.root(start)) {
      if (jail) start = this.posixify(start);
    } else {
      start = `${(jail ?? this.workingDir).replace(/\/$/, '')}/${start}`;
    }

    // Check if start is within jail
    if (
      jail &&
      (recheck = this.descendsFrom(start, jail) === false) &&
      this.fileSeparator === BACKSLASH$1
    ) {
      const [ss, sr] = this.partitionPath(start);
      const [js, jr] = this.partitionPath(jail);
      if (sr !== jr) {
        if (!recover)
          throw new SecurityError(
            `start path for ${targetName} ${start} refers to location outside jail root: ${jail} (disallowed in safe mode)`
          )
        this.logger.warn(
          `start path for ${targetName} is outside of jail root; recovering automatically`
        );
        startSegments = js;
        jailRoot = jr;
        recheck = false;
      } else {
[startSegments, jailRoot] = [ss, sr];
      }
    } else {
[startSegments, jailRoot] = this.partitionPath(start);
    }

    let resolvedSegments = startSegments.concat(targetSegments);

    if (resolvedSegments.includes(DOT_DOT)) {
      const unresolved = resolvedSegments;
      resolvedSegments = [];

      if (jail) {
        let jailSegments
        ;[jailSegments] = this.partitionPath(jail);
        let warned = false;
        for (const seg of unresolved) {
          if (seg === DOT_DOT) {
            if (resolvedSegments.length > jailSegments.length) {
              resolvedSegments.pop();
            } else if (recover) {
              if (!warned) {
                this.logger.warn(
                  `${targetName} has illegal reference to ancestor of jail; recovering automatically`
                );
                warned = true;
              }
            } else {
              throw new SecurityError(
                `${targetName} ${target} refers to location outside jail: ${jail} (disallowed in safe mode)`
              )
            }
          } else {
            resolvedSegments.push(seg);
          }
        }
      } else {
        for (const seg of unresolved) {
          seg === DOT_DOT ? resolvedSegments.pop() : resolvedSegments.push(seg);
        }
      }
    }

    if (recheck) {
      const targetPath = this.joinPath(resolvedSegments, jailRoot);
      if (this.descendsFrom(targetPath, jail) !== false) {
        return targetPath
      } else if (recover) {
        this.logger.warn(
          `${targetName} is outside of jail; recovering automatically`
        );
        const [jailSegments] = this.partitionPath(jail);
        return this.joinPath(jailSegments.concat(targetSegments), jailRoot)
      } else {
        throw new SecurityError(
          `${targetName} ${target} is outside of jail: ${jail} (disallowed in safe mode)`
        )
      }
    }

    return this.joinPath(resolvedSegments, jailRoot)
  }

  /**
   * Resolve a web path from the target and start paths.
   * @param {string} target - The target path.
   * @param {string|null} [start=null] - The start (parent) path.
   * @returns {string} Path with parent references resolved and self references removed.
   */
  webPath(target, start = null) {
    target = this.posixify(target);
    start = this.posixify(start);

    let uriPrefix = null;
    if (start && !this.webRoot(target)) {
      const combined = `${start}${start.endsWith(SLASH) ? '' : SLASH}${target}`;
      const extracted = this._extractUriPrefix(combined);
      if (Array.isArray(extracted)) {
[target, uriPrefix] = extracted;
      } else {
        target = extracted;
      }
    }

    const [targetSegments, targetRoot] = this.partitionPath(target, true);
    const resolved = [];
    for (const seg of targetSegments) {
      if (seg === DOT_DOT) {
        if (resolved.length === 0) {
          if (!targetRoot || targetRoot === DOT_SLASH) resolved.push(seg);
        } else if (resolved[resolved.length - 1] === DOT_DOT) {
          resolved.push(seg);
        } else {
          resolved.pop();
        }
      } else {
        resolved.push(seg);
      }
    }

    let resolvedPath = this.joinPath(resolved, targetRoot);
    if (resolvedPath.includes(' '))
      resolvedPath = resolvedPath.replace(/ /g, '%20');

    return uriPrefix ? `${uriPrefix}${resolvedPath}` : resolvedPath
  }

  /**
   * Extract the URI prefix from a string if it is a URI.
   * @param {string} str
   * @returns {[string, string]|string} [string_without_prefix, prefix] if URI, or the original string.
   * @internal
   */
  _extractUriPrefix(str) {
    if (str.includes(':')) {
      const m = str.match(UriSniffRx);
      if (m) return [str.slice(m[0].length), m[0]]
    }
    return str
  }

  // ── Logging mixin ───────────────────────────────────────────────────────────
  // Declared here (in addition to being installed by applyLogging() below) so
  // that generated .d.ts declarations expose them — applyLogging() mutates the
  // prototype after the class body closes, which tsc's declaration emit can't see.

  /**
   * The logger for this path resolver.
   * The Logging mixin (logging.js) overrides this getter on the prototype.
   * @returns {import('./logging.js').LoggerLike}
   */
  get logger() {
    return LoggerManager.logger
  }

  /** @returns {import('./logging.js').LoggerLike} */
  getLogger() {
    return this.logger
  }

  /**
   * Build an auto-formatting log message that carries structured source_location
   * (rather than baking it into the text), for use with `this.logger.warn(...)`.
   * @param {string} text
   * @param {{source_location?: any, include_location?: any}} [context={}]
   * @returns {{text: string, source_location?: any, include_location?: any, inspect(): string, toString(): string}}
   */
  messageWithContext(text, context = {}) {
    return Logger.AutoFormattingMessage.attach({ text, ...context })
  }

  /** Alias for {@link messageWithContext} (used in extensions). */
  createLogMessage(text, context = {}) {
    return this.messageWithContext(text, context)
  }
}

applyLogging(PathResolver.prototype);

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * @returns {string}
 * @internal
 */
function _platformSeparator() {
  if (typeof process !== 'undefined' && process.platform === 'win32')
    return '\\'
  return '/'
}

/**
 * @param {string} p
 * @returns {string}
 * @internal
 */
function _expandPath$1(p) {
  if (typeof process === 'undefined') return p
  const cwd = process.cwd().replace(/\\/g, '/');
  const full = `${cwd}/${p.replace(/\\/g, '/')}`;
  let root, rest;
  if (full.startsWith('//')) {
    root = '//';
    rest = full.slice(2);
  } else if (full.startsWith('/')) {
    root = '/';
    rest = full.slice(1);
  } else {
    const slash = full.indexOf('/');
    root = full.slice(0, slash + 1);
    rest = full.slice(slash + 1);
  }
  const resolved = [];
  for (const seg of rest.split('/')) {
    if (seg === '..') resolved.pop();
    else if (seg && seg !== '.') resolved.push(seg);
  }
  return root + resolved.join('/')
}

/**
 * @param {string} target
 * @param {string} base
 * @returns {string}
 * @internal
 */
function _computeRelativePath(target, base) {
  const targetParts = target.split('/').filter(Boolean);
  const baseParts = base.split('/').filter(Boolean);
  let common = 0;
  while (
    common < targetParts.length &&
    common < baseParts.length &&
    targetParts[common] === baseParts[common]
  ) {
    common++;
  }
  const up = baseParts.length - common;
  const down = targetParts.slice(common);
  return [...Array(up).fill('..'), ...down].join('/') || '.'
}

// Simple SecurityError class (Ruby raises SecurityError).
class SecurityError extends Error {
  constructor(msg) {
    super(msg);
    this.name = 'SecurityError';
  }
}

/** @import { AbstractNode } from './abstract_node.js' */


// ── BackendTraits mixin ───────────────────────────────────────────────────────

/**
 * Apply the BackendTraits mixin to a converter instance to give it
 * basebackend/filetype/htmlsyntax/outfilesuffix helpers.
 *
 * @param {object} instance - the converter instance to augment
 */
function applyBackendTraits(instance) {
  instance._backendTraits = null;

  // Install a Ruby-style trait accessor method, but never clobber a flat string
  // property the converter already declared (convention #2). Overwriting e.g.
  // `converter.outfilesuffix = '.html'` with a method would silently turn the
  // author's string into a function; the backend traits stay reachable through
  // `_getBackendTraits()` instead.
  const defineTraitAccessor = (name, fn) => {
    const existing = Object.getOwnPropertyDescriptor(instance, name);
    if (existing && typeof existing.value !== 'function') return
    instance[name] = fn;
  };

  defineTraitAccessor('basebackend', function (value = null) {
    if (value) {
      const traits = (this._backendTraits ??= {});
      traits.basebackend = value;
      // Derive filetype/outfilesuffix/htmlsyntax from the new basebackend when not already set
      // (mirrors Ruby's Converter::Base#derive_backend_traits behaviour)
      const derived = deriveBackendTraits(value);
      if (!traits.outfilesuffix) traits.outfilesuffix = derived.outfilesuffix;
      if (!traits.filetype) traits.filetype = derived.filetype;
      if (derived.htmlsyntax && !traits.htmlsyntax)
        traits.htmlsyntax = derived.htmlsyntax;
      return value
    }
    return this._getBackendTraits().basebackend
  });
  defineTraitAccessor('filetype', function (value = null) {
    if (value) return (this._getBackendTraits().filetype = value)
    return this._getBackendTraits().filetype
  });
  defineTraitAccessor('htmlsyntax', function (value = null) {
    if (value) return (this._getBackendTraits().htmlsyntax = value)
    return this._getBackendTraits().htmlsyntax
  });
  defineTraitAccessor('outfilesuffix', function (value = null) {
    if (value) return (this._getBackendTraits().outfilesuffix = value)
    return this._getBackendTraits().outfilesuffix
  });
  instance.supportsTemplates = function (value = true) {
    this._getBackendTraits().supportsTemplates = value;
  };
  instance.supportsTemplates.call = (value = true) =>
    instance.supportsTemplates(value);
  instance.hasSupportsTemplates = function () {
    return !!this._getBackendTraits().supportsTemplates
  };
  instance.initBackendTraits = function (value = null) {
    this._backendTraits = value ?? {};
  };
  instance._getBackendTraits = function (basebackend = null) {
    return (this._backendTraits ??= deriveBackendTraits(
      this.backend,
      basebackend
    ))
  };
  instance.backendInfo = instance._getBackendTraits;
}

// ── Converter.derive_backend_traits ──────────────────────────────────────────

/**
 * Derive the backend traits object from a backend name.
 *
 * @param {string} backend - the backend name (e.g. 'html5', 'docbook5')
 * @param {string|null} [basebackend=null] - optional explicit base backend
 * @returns {{ basebackend: string, filetype: string, outfilesuffix: string, htmlsyntax?: string }}
 */
function deriveBackendTraits(backend, basebackend = null) {
  if (!backend) return {}
  const base = basebackend ?? backend.replace(TrailingDigitsRx, '');
  let outfilesuffix = DEFAULT_EXTENSIONS[base];
  let filetype;
  if (outfilesuffix) {
    filetype = outfilesuffix.slice(1);
  } else {
    filetype = base;
    outfilesuffix = `.${filetype}`;
  }
  const traits = { basebackend: base, filetype, outfilesuffix };
  if (filetype === 'html') traits.htmlsyntax = 'html';
  return traits
}

// ── normalizeConverter ────────────────────────────────────────────────────────

/**
 * Bridge a user-registered converter instance into the interface expected by
 * Document._updateBackendAttributes, which requires _getBackendTraits().
 *
 * Supports three conventions used by user converters:
 *   1. `converter.backendTraits = { basebackend, outfilesuffix, filetype, htmlsyntax }`
 *   2. Plain properties: `converter.basebackend`, `converter.outfilesuffix`, …
 *   3. Already has `_getBackendTraits()` (e.g. extends ConverterBase) — returned as-is.
 *
 * @param {object} converter - the converter to normalise
 * @param {string} backend - the backend name
 * @returns {object} the normalised converter
 */
function normalizeConverter(converter, backend) {
  if (!converter || typeof converter._getBackendTraits === 'function')
    return converter

  let traits = null;
  if (converter.backendTraits && typeof converter.backendTraits === 'object') {
    traits = { ...converter.backendTraits };
  } else {
    const hasPlain =
      converter.basebackend ||
      converter.outfilesuffix ||
      converter.filetype ||
      converter.htmlsyntax;
    if (hasPlain) {
      traits = {};
      if (converter.basebackend) traits.basebackend = converter.basebackend;
      if (converter.outfilesuffix)
        traits.outfilesuffix = converter.outfilesuffix;
      if (converter.filetype) traits.filetype = converter.filetype;
      if (converter.htmlsyntax) traits.htmlsyntax = converter.htmlsyntax;
    }
  }

  // Apply the BackendTraits mixin so Document can read traits via
  // _getBackendTraits(). Flat string properties (convention #2) are preserved:
  // applyBackendTraits does not overwrite an existing same-named data property.
  applyBackendTraits(converter);
  if (traits) {
    converter._backendTraits = traits;
  } else if (backend && !('backend' in converter)) {
    // Converter has no explicit traits and no backend property: derive traits
    // from the backend name so that filetype/outfilesuffix are not left empty.
    converter._backendTraits = deriveBackendTraits(backend);
  }
  return converter
}

// ── CustomFactory ─────────────────────────────────────────────────────────────

/**
 * A factory that maps backend names to converter classes or instances.
 * Use the global {@link Converter} instance (DefaultFactory) for typical use.
 */
let CustomFactory$1 = class CustomFactory {
  constructor(seedRegistry = null) {
    this._registry = {};
    this._catchAll = null;
    if (seedRegistry) {
      const star = seedRegistry['*'];
      delete seedRegistry['*'];
      if (star) this._catchAll = star;
      Object.assign(this._registry, seedRegistry);
    }
  }

  /**
   * Register a converter class for one or more backend names.
   * Backends may be passed as individual strings or as a single Array.
   *
   * @param {Function|object} converter - the converter class or instance
   * @param {...string} backends - backend names; use `'*'` as a catch-all
   */
  register(converter, ...backends) {
    if (backends.length === 1 && Array.isArray(backends[0]))
      backends = backends[0];
    for (const backend of backends) {
      if (backend === '*') this._catchAll = converter;
      else this._registry[backend] = converter;
    }
  }

  /**
   * Retrieve the converter class registered for the given backend.
   * Returns `undefined` (not null) when no match is found, mirroring the core API.
   *
   * @param {string} backend - the backend name
   * @returns {Function|object|undefined}
   */
  for(backend) {
    return this._registry[backend] ?? this._catchAll ?? undefined
  }

  /**
   * Create a new converter instance for the given backend (synchronous).
   * Requires the converter class to already be registered; does not support template dirs.
   *
   * @param {string} backend - the backend name
   * @param {object} [opts={}] - options passed to the converter constructor
   * @returns {object|null} the converter instance, or null if not registered
   */
  createSync(backend, opts = {}) {
    let converter = this.for(backend);
    if (!converter) return null
    if (typeof converter === 'function' && converter.prototype)
      converter = new converter(backend, opts);
    return normalizeConverter(converter, backend)
  }

  /**
   * Create a new converter instance for the given backend.
   *
   * @param {string} backend - the backend name
   * @param {object} [opts={}] - options passed to the converter constructor
   * @returns {Promise<object|null>} the converter instance, or null if not registered
   */
  async create(backend, opts = {}) {
    let converter = this.for(backend);
    if (converter) {
      if (typeof converter === 'function' && converter.prototype) {
        converter = new converter(backend, opts);
      }
      const templateDirs = opts.template_dirs;
      if (
        templateDirs &&
        typeof converter.hasSupportsTemplates === 'function' &&
        converter.hasSupportsTemplates()
      ) {
        const { CompositeConverter } = await Promise.resolve().then(function () { return composite; });
        const { TemplateConverter } = await Promise.resolve().then(function () { return _browser_templateConverter; });
        return new CompositeConverter(
          backend,
          await TemplateConverter.create(backend, templateDirs, opts),
          converter,
          { backendTraitsSource: converter }
        )
      }
      return converter
    }
    const templateDirs = opts.template_dirs;
    if (templateDirs) {
      const delegateBackend = opts.delegate_backend;
      if (delegateBackend) {
        let delegateConverter = this.for(delegateBackend);
        if (delegateConverter) {
          if (
            typeof delegateConverter === 'function' &&
            delegateConverter.prototype
          ) {
            delegateConverter = new delegateConverter(delegateBackend, opts);
          }
          const { CompositeConverter } = await Promise.resolve().then(function () { return composite; });
          const { TemplateConverter } = await Promise.resolve().then(function () { return _browser_templateConverter; });
          return new CompositeConverter(
            backend,
            await TemplateConverter.create(backend, templateDirs, opts),
            delegateConverter,
            { backendTraitsSource: delegateConverter }
          )
        }
      }
      const { TemplateConverter } = await Promise.resolve().then(function () { return _browser_templateConverter; });
      return await TemplateConverter.create(backend, templateDirs, opts)
    }
    return null
  }

  /**
   * Get the registered converters map.
   *
   * @returns {object} a shallow copy of the registry
   */
  converters() {
    return { ...this._registry }
  }

  /**
   * Unregister all converters.
   */
  unregisterAll() {
    this._registry = {};
    this._catchAll = null;
  }
};

// ── DefaultFactory ────────────────────────────────────────────────────────────
// Global registry of built-in + statically registered converters.

// Static per-backend imports allow bundlers (Rollup/Vite) to inline each module.
async function _importBuiltinConverter(backend) {
  if (backend === 'html5') return Promise.resolve().then(function () { return html5; })
  if (backend === 'docbook5') return Promise.resolve().then(function () { return docbook5; })
  if (backend === 'manpage') return Promise.resolve().then(function () { return manpage; })
  return null
}

let DefaultFactory$1 = class DefaultFactory extends CustomFactory$1 {
  constructor() {
    super();
    this._defaultRegistry = {}; // separate from CustomFactory._registry (for unregisterAll)
  }

  register(converter, ...backends) {
    // User registrations go into _registry (CustomFactory layer) so that unregisterAll()
    // can remove them without touching the lazy-loaded built-in entries in _defaultRegistry.
    // backends may be passed as individual strings or as a single Array.
    if (backends.length === 1 && Array.isArray(backends[0]))
      backends = backends[0];
    for (const backend of backends) {
      if (backend === '*') this._catchAll = converter;
      else this._registry[backend] = converter;
    }
  }

  for(backend) {
    // User registrations first (_registry), then lazy-loaded built-ins (_defaultRegistry),
    // then catch-all.  Returns undefined when no match is found, mirroring the core API.
    return (
      this._registry[backend] ??
      this._defaultRegistry[backend] ??
      this._catchAll ??
      undefined
    )
  }

  /**
   * Return the combined registry (built-in + user-registered entries).
   *
   * @returns {object}
   */
  getRegistry() {
    return { ...this._defaultRegistry, ...this._registry }
  }

  /**
   * Return this factory (mirrors the core ConverterFactory.getDefault() API).
   *
   * @returns {DefaultFactory}
   */
  getDefault() {
    return this
  }

  createSync(backend, opts = {}) {
    let converter =
      this._registry[backend] ??
      this._defaultRegistry[backend] ??
      this._catchAll;
    if (!converter) return null
    if (typeof converter === 'function' && converter.prototype)
      converter = new converter(backend, opts);
    return normalizeConverter(converter, backend)
  }

  async create(backend, opts = {}) {
    let converter = this._registry[backend] ?? this._defaultRegistry[backend];
    if (!converter) {
      const mod = await _importBuiltinConverter(backend);
      if (mod) {
        converter = mod.default ?? Object.values(mod)[0];
        if (converter) this._defaultRegistry[backend] = converter;
      }
    }
    if (!converter) converter = this._catchAll;
    if (!converter) {
      const templateDirs = opts.template_dirs;
      if (templateDirs) {
        const { TemplateConverter } = await Promise.resolve().then(function () { return _browser_templateConverter; });
        return await TemplateConverter.create(backend, templateDirs, opts)
      }
      return null
    }
    if (typeof converter === 'function' && converter.prototype) {
      converter = new converter(backend, opts);
    }
    const templateDirs = opts.template_dirs;
    if (
      templateDirs &&
      typeof converter.hasSupportsTemplates === 'function' &&
      converter.hasSupportsTemplates()
    ) {
      const { CompositeConverter } = await Promise.resolve().then(function () { return composite; });
      const { TemplateConverter } = await Promise.resolve().then(function () { return _browser_templateConverter; });
      return new CompositeConverter(
        backend,
        await TemplateConverter.create(backend, templateDirs, opts),
        converter,
        { backendTraitsSource: converter }
      )
    }
    return converter
  }

  unregisterAll() {
    // Keep built-in entries; clear only custom and catch-all
    this._registry = {};
    this._catchAll = null;
  }
};

// ── The global Converter registry ─────────────────────────────────────────────

const Converter = new DefaultFactory$1();

// Attach derive_backend_traits as a property for compatibility
Converter.deriveBackendTraits = deriveBackendTraits;

// ── Converter.Base ────────────────────────────────────────────────────────────

/**
 * Base class for all Asciidoctor converters.
 *
 * Subclass ConverterBase and implement `convert_<nodeName>` methods to handle
 * specific node types. Register the subclass with the global registry via
 * {@link ConverterBase.registerFor}.
 */
class ConverterBase {
  constructor(backend, opts = {}) {
    this.backend = backend;
    applyBackendTraits(this);
    applyLogging(this);
  }

  // ── Logging mixin ───────────────────────────────────────────────────────────
  // Declared here (in addition to being installed by applyLogging(this) above)
  // so that generated .d.ts declarations expose them — applyLogging() assigns
  // own properties at construction time, which tsc's declaration emit can't see.

  /**
   * The logger for this converter.
   * The Logging mixin (logging.js) overrides this getter on the instance.
   * @returns {import('./logging.js').LoggerLike}
   */
  get logger() {
    return LoggerManager.logger
  }

  /** @returns {import('./logging.js').LoggerLike} */
  getLogger() {
    return this.logger
  }

  /**
   * Build an auto-formatting log message that carries structured source_location
   * (rather than baking it into the text), for use with `this.logger.warn(...)`.
   * @param {string} text
   * @param {{source_location?: any, include_location?: any}} [context={}]
   * @returns {{text: string, source_location?: any, include_location?: any, inspect(): string, toString(): string}}
   */
  messageWithContext(text, context = {}) {
    return Logger.AutoFormattingMessage.attach({ text, ...context })
  }

  /** Alias for {@link messageWithContext} (used in extensions). */
  createLogMessage(text, context = {}) {
    return this.messageWithContext(text, context)
  }

  /**
   * Convert a node by dispatching to a `convert_<transform>` method.
   *
   * @param {AbstractNode} node - the AbstractNode to convert
   * @param {string|null=} transform - hint for which method to call (default: node.nodeName)
   * @param {object|null=} opts - optional hints
   * @returns {Promise<unknown>|unknown} the result of the `convert_<transform>` handler; the actual type depends on the implementation
   */
  convert(node, transform = null, opts = null) {
    const method = `convert_${transform ?? node.nodeName}`;
    if (typeof this[method] === 'function') {
      return opts ? this[method](node, opts) : this[method](node)
    }
    this.logger.warn(
      `missing convert handler for ${transform ?? node.nodeName} node in ${this.backend} backend (${this.constructor.name})`
    );
    return null
  }

  /**
   * Report whether this converter can handle the given transform.
   *
   * @param {string} transform - the transform name
   * @returns {boolean}
   */
  handles(transform) {
    return typeof this[`convert_${transform}`] === 'function'
  }

  /**
   * Convert using only content (no wrapping).
   *
   * @param {object} node - the node whose content to return
   * @returns {Promise<string>}
   */
  async contentOnly(node) {
    return node.content()
  }

  /** Skip conversion (no-op). */
  skip(_node) {}

  /**
   * Register this converter class with the global registry.
   *
   * @param {...string} backends - backend names to register for
   */
  static registerFor(...backends) {
    Converter.register(this, ...backends.map(String));
  }
}

/** @import { Block } from './block.js' */

// ESM conversion of syntax_highlighter.rb
//
// Ruby-to-JavaScript notes:
//   - Ruby module SyntaxHighlighter used as mixin → SyntaxHighlighterBase class.
//   - Ruby module Factory → mixed into CustomFactory and DefaultFactory classes.
//   - Ruby @@registry class var → module-level _defaultRegistry Map for DefaultFactory.
//   - Ruby Mutex thread-safety → not needed in single-threaded JS.
//   - Ruby lazy require (PROVIDED map) → async dynamic import() in DefaultFactory.
//   - Ruby DefaultFactoryProxy (overrides #for with custom-first lookup) → DefaultFactory
//     already handles this with _registry (custom) checked before _defaultRegistry (built-in).
//   - Ruby module Config / register_for static helper → static registerFor() on each subclass.
//   - Ruby :symbol keys → plain strings throughout.
//   - highlightjs is always registered; coderay/pygments/rouge are Ruby-only (not ported).

// ── SyntaxHighlighterBase ─────────────────────────────────────────────────────

/**
 * Base class for syntax highlighter adapters.
 *
 * Subclasses should override the methods they need. Two usage patterns:
 * 1. Server-side highlighting: override `handlesHighlighting()` → true and `highlight()`.
 * 2. Client-side highlighting: override `hasDocinfo()` → true and `docinfo()`.
 *
 * Both patterns may also override `format()`.
 */
class SyntaxHighlighterBase {
  /**
   * @param {string} name - the name identifying this adapter
   * @param {string} [backend='html5'] - the backend name
   * @param {Object} [opts={}] - options
   */
  constructor(name, backend = 'html5', opts = {}) {
    this.name = name;
    this._preClass = name;
  }

  /**
   * Indicates whether this highlighter has docinfo markup to insert at the specified location.
   *
   * @param {string} location - the location slot ('head' or 'footer')
   * @returns {boolean} false by default; subclasses return true to enable {@link docinfo}
   */
  hasDocinfo(location) {
    return false
  }

  /**
   * Generates docinfo markup to insert at the specified location in the output document.
   *
   * @param {string} location - the location slot ('head' or 'footer')
   * @param {Document} doc - the Document in which this highlighter is used
   * @param {Object} opts - options
   * @param {boolean} [opts.linkcss] - link stylesheet instead of embedding
   * @param {string} [opts.cdn_base_url] - base URL for CDN assets
   * @param {string} [opts.self_closing_tag_slash] - '/' for self-closing tags
   * @returns {string} the markup to insert
   */
  docinfo(location, doc, opts) {
    throw new Error(
      `${this.constructor.name} must implement docinfo() since hasDocinfo() returns true`
    )
  }

  /**
   * Indicates whether highlighting is handled server-side by this highlighter.
   *
   * @returns {boolean} false by default; subclasses return true to enable {@link highlight}
   */
  handlesHighlighting() {
    return false
  }

  /**
   * Highlights the specified source when this source block is being converted.
   *
   * If the source contains callout marks, the caller assumes the source remains on the same
   * lines and no closing tags are added to the end of each line. If the source gets shifted
   * by one or more lines, return a tuple of the highlighted source and the line offset.
   *
   * @param {Block} node - the source Block to highlight
   * @param {string} source - the raw source text
   * @param {string} lang - the source language (e.g. 'ruby')
   * @param {Object} opts - options
   * @param {Object} [opts.callouts] - callouts indexed by line number
   * @param {string} [opts.css_mode] - CSS mode ('class' or 'inline')
   * @param {number[]} [opts.highlight_lines] - 1-based line numbers to emphasize
   * @param {string} [opts.number_lines] - 'table' or 'inline' if lines should be numbered
   * @param {number} [opts.start_line_number] - starting line number (default: 1)
   * @param {string} [opts.style] - theme name
   * @returns {string|[string, number]} the highlighted source, or a tuple with a line offset
   */
  highlight(node, source, lang, opts) {
    throw new Error(
      `${this.constructor.name} must implement highlight() since handlesHighlighting() returns true`
    )
  }

  /**
   * Formats the highlighted source for inclusion in an HTML document.
   *
   * @param {Block} node - the source Block being processed
   * @param {string} lang - the source language (e.g. 'ruby')
   * @param {Object} opts - options
   * @param {boolean} [opts.nowrap] - disable line wrapping
   * @param {Function} [opts.transform] - called with (pre, code) attribute objects before building tags
   * @returns {Promise<string>|string} the highlighted source wrapped in &lt;pre&gt;&lt;code&gt; tags.
   *   Subclasses may return a plain `string` — the caller always `await`s the result.
   */
  format(node, lang, opts) {
    const classAttrVal = opts.nowrap
      ? `${this._preClass} highlight nowrap`
      : `${this._preClass} highlight`;
    return node.content().then((content) => {
      const transform = opts.transform;
      if (transform) {
        const pre = { class: classAttrVal };
        const code = lang ? { 'data-lang': lang } : {};
        transform(pre, code);
        // NOTE keep data-lang as the last attribute on <code> to match Ruby 1.5.x behaviour
        const dataLang = code['data-lang'];
        delete code['data-lang'];
        if (dataLang) code['data-lang'] = dataLang;
        const preAttrs = Object.entries(pre)
          .map(([k, v]) => ` ${k}="${v}"`)
          .join('');
        const codeAttrs = Object.entries(code)
          .map(([k, v]) => ` ${k}="${v}"`)
          .join('');
        return `<pre${preAttrs}><code${codeAttrs}>${content}</code></pre>`
      }
      return `<pre class="${classAttrVal}"><code${lang ? ` data-lang="${lang}"` : ''}>${content}</code></pre>`
    })
  }

  /**
   * Indicates whether this highlighter wants to write a stylesheet to disk.
   *
   * @param {Document} doc - the Document in which this highlighter is being used
   * @returns {boolean} false by default; subclasses return true to enable {@link writeStylesheetToDisk}
   */
  writeStylesheet(doc) {
    return false
  }

  /**
   * Writes the stylesheet to disk.
   *
   * @param {Document} doc - the Document in which this highlighter is used
   * @param {string} toDir - the absolute path of the output directory
   */
  writeStylesheetToDisk(doc, toDir) {
    throw new Error(
      `${this.constructor.name} must implement writeStylesheetToDisk() since writeStylesheet() returns true`
    )
  }
}

// ── CustomFactory ─────────────────────────────────────────────────────────────

/**
 * A syntax highlighter factory backed by a caller-supplied registry.
 */
class CustomFactory {
  /**
   * @param {Object|null} [seedRegistry=null] - initial registry entries
   */
  constructor(seedRegistry = null) {
    this._registry = seedRegistry ? { ...seedRegistry } : {};
  }

  /**
   * Associates a syntax highlighter class or instance with one or more names.
   *
   * @param {Function|SyntaxHighlighterBase} syntaxHighlighter - the class or instance to register
   * @param {...string} names - one or more names to associate
   */
  register(syntaxHighlighter, ...names) {
    for (const name of names) {
      this._registry[name] = syntaxHighlighter;
    }
  }

  /**
   * Retrieves the syntax highlighter class or instance registered for the given name.
   *
   * @param {string} name - the name to look up
   * @returns {Function|SyntaxHighlighterBase|null} the registered class or instance, or null
   */
  for(name) {
    return this._registry[name] ?? null
  }

  /**
   * Resolves a name to a syntax highlighter instance.
   *
   * @param {string} name - the name of the syntax highlighter
   * @param {string} [backend='html5'] - the backend name
   * @param {Object} [opts={}] - options passed to the constructor
   * @returns {SyntaxHighlighterBase|null} a highlighter instance, or null if not registered
   */
  create(name, backend = 'html5', opts = {}) {
    let syntaxHl = this.for(name);
    if (!syntaxHl) return null
    if (typeof syntaxHl === 'function' && syntaxHl.prototype) {
      syntaxHl = new syntaxHl(name, backend, opts);
    }
    if (!syntaxHl.name) {
      throw new Error(
        `${syntaxHl.constructor.name} must specify a value for 'name'`
      )
    }
    return syntaxHl
  }
}

// ── DefaultFactoryProxy ───────────────────────────────────────────────────────

// Wraps a `syntax_highlighters` hash (per-load overrides) and falls back to a
// delegate factory (typically the global SyntaxHighlighter singleton) for names
// not present in the overrides. Setting a name to null disables that highlighter.

class DefaultFactoryProxy extends CustomFactory {
  /**
   * @param {Object} overrides - map of name → class/instance/null
   * @param {CustomFactory} fallback - factory to delegate to when name is not overridden
   */
  constructor(overrides, fallback) {
    super(overrides);
    this._fallback = fallback;
  }

  for(name) {
    // Use hasOwnProperty so that null (disabled) is returned as-is
    if (Object.hasOwn(this._registry, name)) {
      return this._registry[name]
    }
    return this._fallback.for(name)
  }
}

// ── DefaultFactory ────────────────────────────────────────────────────────────

// Global registry that distinguishes built-in adapters (registered by the
// adapters themselves via self-registration) from custom adapters (registered
// by user code). unregisterAll() clears only the custom layer so built-ins
// remain available after a reset, mirroring Ruby's DefaultFactory behaviour.

class DefaultFactory extends CustomFactory {
  constructor() {
    super();
    // _registry (inherited) → custom registrations
    // _defaultRegistry      → built-in registrations (populated by adapters)
    this._defaultRegistry = {};
  }

  // Register into the built-in layer (called by built-in adapters).
  register(syntaxHighlighter, ...names) {
    for (const name of names) {
      this._defaultRegistry[name] = syntaxHighlighter;
    }
  }

  // Custom registrations shadow built-ins.
  for(name) {
    return this._registry[name] ?? this._defaultRegistry[name] ?? null
  }

  /**
   * Retrieves the syntax highlighter class or instance registered for the given name.
   *
   * @param {string} name - the name of the syntax highlighter to retrieve
   * @returns {Function|SyntaxHighlighterBase|undefined} the registered class or instance, or undefined
   */
  get(name) {
    return this.for(name) ?? undefined
  }

  create(name, backend = 'html5', opts = {}) {
    let syntaxHl = this.for(name);
    if (!syntaxHl) return null
    if (typeof syntaxHl === 'function' && syntaxHl.prototype) {
      syntaxHl = new syntaxHl(name, backend, opts);
    }
    if (!syntaxHl.name) {
      throw new Error(
        `${syntaxHl.constructor.name} must specify a value for 'name'`
      )
    }
    return syntaxHl
  }

  /**
   * Clears all custom (user) registrations; built-in adapters are preserved.
   */
  unregisterAll() {
    this._registry = {};
  }
}

// ── The global SyntaxHighlighter registry ─────────────────────────────────────

const SyntaxHighlighter = new DefaultFactory();

// Browser-specific include path resolution for PreprocessorReader.
//
// This module implements the logic described in docs/modules/test/pages/browser-include-test.adoc
// and mirrors packages/core/lib/asciidoctor/js/asciidoctor_ext/browser/reader.rb.
//
// This logic is specific to Asciidoctor.js and has no equivalent in the upstream Ruby asciidoctor
// implementation. It handles the case where the document is loaded in a browser environment
// where paths can be file:// or http(s):// URIs.
//
// The key behavioural differences from the standard file-system resolver:
//   - Relative targets are resolved by string concatenation against a URI context dir,
//     not via OS path normalisation.
//   - Absolute paths (e.g. /foo/bar) are rewritten to file:///foo/bar.
//   - All resolved includes are fetched via the Fetch API (targetType 'uri').
//
// Public API
// ----------
// resolveBrowserIncludePath(reader, target, attrlist)
//   reader   - a PreprocessorReader instance (provides _document, includeStack, _dir,
//              replaceNextLine)
//   target   - the raw include target string
//   attrlist - the raw attribute list string (used for error-message link construction)
//
//   Returns [incPath, relpath] on success, where:
//     incPath  - the absolute URI to fetch
//     relpath  - the path relative to the document base dir (used for include tracking)
//   Returns true/false when the include directive line has already been consumed/replaced
//   (mirrors the Boolean return convention used by _resolveIncludePath in reader.js).


/**
 * Build the `link:...[...]` replacement text for a disallowed include.
 * @param {object} reader
 * @param {string} target
 * @param {string|null} attrlist
 * @returns {string}
 * @internal
 */
function _linkReplacement(reader, target, attrlist) {
  const doc = reader._document;
  const lt = target.includes(' ') ? `pass:c[${target}]` : target;
  const la = doc.hasAttribute('compat-mode')
    ? (attrlist ?? '')
    : `role=include${attrlist ? `,${attrlist}` : ''}`;
  return `link:${lt}[${la}]`
}

/**
 * Resolve an include path in a browser (URI-based) environment.
 *
 * Implements the rules from the browser-include-test, in the same order:
 *
 * Top-level include (includeStack is empty):
 * 1. target starts with file:// → inc_path = relpath = target
 * 2. target is a URI → must descend from baseDir or allow-uri-read; else → link
 * 3. target is an absolute OS path → prepend file:// (or file:///)
 * 4. baseDir == '.' → inc_path = relpath = target  (resolved by fetch)
 * 5. baseDir starts with file:// OR baseDir is not a URI → inc_path = baseDir/target; relpath = target
 * 6. baseDir is an absolute URL → inc_path = baseDir/target; relpath = target
 *
 * Nested include (includeStack is non-empty):
 * Rules 1–3 same as top-level.
 * 4. parentDir == '.' → inc_path = relpath = target
 * 5. parentDir starts with file:// OR parentDir is not a URI
 *      → inc_path = parentDir/target
 *      → relpath = inc_path if baseDir=='.' or inc_path not under baseDir, else path difference
 * 6. parentDir is an absolute URL
 *      → must descend from baseDir or allow-uri-read; else → link
 *      → inc_path = parentDir/target
 *      → relpath = path difference if parentDir descends from baseDir, else target
 * @param {object} reader - a PreprocessorReader instance
 * @param {string} target - the raw include target string
 * @param {string|null} attrlist - the raw attribute list string
 * @returns {[string, string]|boolean} [incPath, relpath] on success, or boolean when the line was consumed.
 */
function resolveBrowserIncludePath(reader, target, attrlist) {
  const doc = reader._document;
  const pathResolver = doc.pathResolver;
  // Normalise backslashes (Ruby: PathResolver.new('\\').posixify target)
  const pTarget = target.replace(/\\/g, '/');
  const baseDir = doc.baseDir;
  const topLevel = reader.includeStack.length === 0;
  const ctxDir = topLevel ? baseDir : reader._dir;

  let incPath, relpath;

  // ── Rule 1: target starts with file:// ────────────────────────────────────
  if (pTarget.startsWith('file://')) {
    incPath = relpath = pTarget;

    // ── Rule 2: target is an absolute URL (http:// / https:// / …) ───────────
  } else if (isUriish(pTarget)) {
    const descends = pathResolver.descendsFrom(pTarget, baseDir);
    if (descends === false && !doc.hasAttribute('allow-uri-read')) {
      return reader.replaceNextLine(_linkReplacement(reader, target, attrlist))
    }
    incPath = relpath = pTarget;

    // ── Rule 3: target is an absolute OS path ─────────────────────────────────
  } else if (pathResolver.absolutePath(pTarget)) {
    incPath = relpath = `file://${pTarget.startsWith('/') ? '' : '/'}${pTarget}`;

    // ── Rule 4: context dir is '.' ────────────────────────────────────────────
    // Relative path resolved by fetch relative to window.location / request origin.
  } else if (ctxDir === '.') {
    incPath = relpath = pTarget;

    // ── Rule 5: context dir is file:// OR a non-URI (regular OS path) ─────────
  } else if (ctxDir.startsWith('file://') || !isUriish(ctxDir)) {
    incPath = `${ctxDir}/${pTarget}`;
    if (topLevel) {
      relpath = pTarget;
    } else {
      const offset = pathResolver.descendsFrom(incPath, baseDir);
      if (baseDir === '.' || offset === false) {
        relpath = incPath;
      } else {
        relpath = incPath.slice(offset);
      }
    }

    // ── Rule 6: context dir is an absolute URL ────────────────────────────────
  } else if (topLevel) {
    incPath = `${ctxDir}/${(relpath = pTarget)}`;
  } else {
    // Nested include: context dir is an absolute URL.
    const ctxDescends = pathResolver.descendsFrom(ctxDir, baseDir);
    if (ctxDescends !== false || doc.hasAttribute('allow-uri-read')) {
      incPath = `${ctxDir}/${pTarget}`;
      relpath = ctxDescends !== false ? incPath.slice(ctxDescends) : pTarget;
    } else {
      return reader.replaceNextLine(_linkReplacement(reader, target, attrlist))
    }
  }

  return [incPath, relpath]
}

// ESM conversion of reader.rb
//
// Ruby-to-JavaScript notes:
//   - @lines is an Array used as a reversed stack: @lines[-1] is the next line.
//     In JS: this._lines[this._lines.length - 1] / this._lines.pop() / push().
//   - Ruby private methods called by subclasses (shift, unshift, unshift_all,
//     process_line, prepare_lines, skip_front_matter) use the _ prefix convention
//     rather than JS # private, because PreprocessorReader must be able to
//     override/call them — including prepare_lines' call into skip_front_matter,
//     which runs via super() before PreprocessorReader's own # fields exist.
//   - JS # private fields/methods are used for state that is only ever touched
//     within the declaring class itself (never overridden, never read by the
//     other class or by external modules): Reader's cursor mark, and
//     PreprocessorReader's include/conditional-directive bookkeeping.
//   - Fields shared with the subclass (or read by browser/reader.js for include
//     resolution) keep the _ prefix and are typed via @internal JSDoc so they are
//     stripped from the generated public .d.ts without changing runtime access.
//   - PreprocessorReader overrides _shift() to strip the backslash from escaped
//     directives, mirroring the Ruby `def shift` override.
//   - PreprocessorReader overrides _prepareLines() to add front-matter handling
//     and indentation adjustment (mirrors `def prepare_lines`).
//   - The Logging mixin is implemented with inline helper methods; the logger
//     defaults to this._document?.logger ?? console.
//   - File I/O uses node:fs/promises async APIs (unavailable in browsers).
//   - URI-based includes use the async Fetch API.
//   - Compliance.attribute_missing defaults to 'skip' until compliance.js exists.
//   - Parser.adjustIndentation is referenced but forwarded as a TODO.
//   - RUBY_ENGINE_OPAL branches are omitted.
//   - JRuby-specific unshift_all variant is omitted; the standard branch is used.


// ── Node.js fs (lazy, optional) ───────────────────────────────────────────────
// Loaded on first use in Node.js; silently absent in browser/WebWorker environments.
let _fsp; // undefined = not tried, null = unavailable, object = available
let _fsConstants; // node:fs constants (F_OK etc.) — not on node:fs/promises

async function _requireFsp() {
  if (_fsp !== undefined) return
  try {
    _fsp = await import('node:fs/promises');
    _fsConstants = (await import('node:fs')).constants;
  } catch {
    _fsp = null;
  }
}

// ── path helpers (no node:path dependency) ───────────────────────────────────
function fsdirname(p) {
  if (!p) return '.'
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return idx < 0 ? '.' : idx === 0 ? '/' : p.slice(0, idx)
}
function fsbasename(p) {
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return p ? p.slice(idx + 1) : ''
}
async function fileExists(path) {
  await _requireFsp();
  if (!_fsp) return false
  try {
    await _fsp.access(path, _fsConstants.F_OK);
    return true
  } catch {
    return false
  }
}

// ── adjustIndentation ─────────────────────────────────────────────────────────
// Port of Parser.adjust_indentation! from Ruby.
// Mutates `lines` in place to remove block indent, then optionally re-indent.
function _adjustIndentation(lines, indentSize, tabSize = 0) {
  if (lines.length === 0) return
  // Determine block indent (minimum leading spaces of non-blank lines)
  let blockIndent = null;
  for (const line of lines) {
    if (line === '') continue
    const lineIndent = line.length - line.trimStart().length;
    if (lineIndent === 0) {
      blockIndent = null;
      break
    }
    if (blockIndent === null || lineIndent < blockIndent)
      blockIndent = lineIndent;
  }
  if (indentSize === 0) {
    if (blockIndent) {
      for (let i = 0; i < lines.length; i++) {
        if (lines[i] !== '') lines[i] = lines[i].slice(blockIndent);
      }
    }
  } else {
    const newIndent = ' '.repeat(indentSize);
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] !== '') {
        lines[i] = blockIndent
          ? newIndent + lines[i].slice(blockIndent)
          : newIndent + lines[i];
      }
    }
  }
}

/**
 * Snapshot captured by {@link Reader#save}/{@link PreprocessorReader#save} and
 * consumed by the matching restoreSave().
 * @typedef {Object} ReaderSaveState
 * @property {string|null} file
 * @property {string} dir
 * @property {string} path
 * @property {number} lineno
 * @property {string[]} lines
 * @property {[string|null, string, string, number]|null} mark
 * @property {number} lookAhead
 * @property {boolean} processLines
 * @property {boolean} unescapeNextLine
 * @property {boolean|null} unterminated
 * @property {MaxDepth|null} [maxdepth]
 * @property {boolean} [skipping]
 * @property {ConditionalStackEntry[]} [conditionalStack]
 * @property {Array} [includeStack]
 */

/**
 * @typedef {Object} MaxDepth
 * @property {number} abs
 * @property {number} curr
 * @property {number} rel
 */

/**
 * An entry on the preprocessor conditional directive stack (ifdef/ifndef/ifeval).
 * @typedef {Object} ConditionalStackEntry
 * @property {string} name
 * @property {string} [target]
 * @property {string} [expr]
 * @property {boolean} [skip]
 * @property {boolean} skipping
 * @property {Cursor|null} sourceLocation
 */

// ── Cursor ────────────────────────────────────────────────────────────────────

class Cursor {
  constructor(file, dir = null, path = null, lineno = 1) {
    this.file = file;
    this.dir = dir;
    this.path = path;
    this.lineno = lineno;
  }

  advance(num) {
    this.lineno += num;
  }
  get lineInfo() {
    return `${this.path}: line ${this.lineno}`
  }
  toString() {
    return this.lineInfo
  }

  // Public API (mirrors Ruby Asciidoctor::Reader::Cursor)
  getLineNumber() {
    return this.lineno
  }
  getFile() {
    return this.file ?? undefined
  }
  getDirectory() {
    return this.dir
  }
  getPath() {
    return this.path
  }

  /**
   * Get the line info string for this cursor (e.g. "path/to/file.adoc: line 42").
   * @returns {string}
   */
  getLineInfo() {
    return this.lineInfo
  }
}

// ── Reader ────────────────────────────────────────────────────────────────────

class Reader {
  /**
   * Directory containing the current source. Read and reassigned by
   * {@link PreprocessorReader} when pushing/popping include contexts.
   * @internal
   * @type {string}
   */
  _dir

  /**
   * The document this reader belongs to, when created for one (e.g. via
   * {@link PreprocessorReader}). Also read by browser/reader.js include resolution.
   * @internal
   * @type {import('./document.js').Document|undefined}
   */
  _document

  /**
   * Remaining lines, stored as a reversed stack (last element is the next line).
   * @internal
   * @type {string[]}
   */
  _lines

  /**
   * Number of already-visited lines (via {@link processLine}) not yet consumed.
   * @internal
   * @type {number}
   */
  _lookAhead

  /**
   * When true, the next line shifted off the stack has its leading backslash stripped.
   * @internal
   * @type {boolean}
   */
  _unescapeNextLine

  /**
   * Snapshot captured by {@link save}, consumed by {@link restoreSave}.
   * @internal
   * @type {ReaderSaveState|null}
   */
  _saved

  /**
   * Cursor mark captured by {@link mark}, as [file, dir, path, lineno].
   * @type {[string|null, string, string, number]|null}
   */
  #mark = null

  constructor(data = null, cursor = null, opts = {}) {
    if (!cursor) {
      this.file = null;
      this._dir = '.';
      this.path = '<stdin>';
      this.lineno = 1;
    } else if (typeof cursor === 'string') {
      this.file = cursor;
      this._dir = fsdirname(cursor);
      this.path = fsbasename(cursor);
      this.lineno = 1;
    } else {
      if ((this.file = cursor.file)) {
        this._dir = cursor.dir || fsdirname(this.file);
        this.path = cursor.path || fsbasename(this.file);
      } else {
        this._dir = cursor.dir || '.';
        this.path = cursor.path || '<stdin>';
      }
      this.lineno = cursor.lineno || 1;
    }
    if (opts.document) this._document = opts.document;
    this.sourceLines = this._prepareLines(data, opts);
    this._lines = this.sourceLines.slice().reverse();
    this._lookAhead = 0;
    this.processLines = true;
    this._unescapeNextLine = false;
    this.unterminated = null;
    this._saved = null;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /** @returns {boolean | Promise<boolean>} */
  hasMoreLines() {
    if (this._lines.length === 0) {
      this._lookAhead = 0;
      return false
    }
    return true
  }

  /** @returns {boolean | Promise<boolean>} */
  empty() {
    if (this._lines.length === 0) {
      this._lookAhead = 0;
      return true
    }
    return false
  }

  /** @returns {boolean | Promise<boolean>} */
  eof() {
    return this.empty()
  }

  async nextLineEmpty() {
    const l = await this.peekLine();
    return !l
  }
  async isNextLineEmpty() {
    return await this.nextLineEmpty()
  }

  /**
   * Peek at the next line without consuming it.
   * @param {boolean} [direct=false] - When true, bypass processLine and return the raw stack top.
   * @returns {Promise<string|undefined>} The next line, or undefined if there are no more lines.
   */
  async peekLine(direct = false) {
    while (true) {
      const nextLine = this._lines[this._lines.length - 1];
      if (direct || this._lookAhead > 0) {
        return this._unescapeNextLine ? nextLine.slice(1) : nextLine
      }
      if (nextLine !== undefined) {
        const line = await this.processLine(nextLine);
        if (line !== null && line !== undefined) return line
      } else {
        this._lookAhead = 0;
        return undefined
      }
    }
  }

  /**
   * Peek at the next num lines without consuming them.
   * @param {number|null} [num=null]
   * @param {boolean} [direct=false]
   * @returns {Promise<string[]>}
   */
  async peekLines(num = null, direct = false) {
    const oldLookAhead = this._lookAhead;
    const result = [];
    const limit = num != null ? num : MAX_INT;
    for (let i = 0; i < limit; i++) {
      const line = direct ? this._shift() : await this.readLine();
      if (line !== undefined) {
        result.push(line);
      } else {
        if (direct) this.lineno--;
        break
      }
    }
    if (result.length > 0) {
      this._unshiftAll(result);
      if (direct) this._lookAhead = oldLookAhead;
    }
    return result
  }

  async readLine() {
    return this._lookAhead > 0 || (await this.hasMoreLines())
      ? this._shift()
      : undefined
  }

  async readLines() {
    const lines = [];
    while (await this.hasMoreLines()) lines.push(this._shift());
    return lines
  }
  async readlines() {
    return await this.readLines()
  }

  async read() {
    return (await this.readLines()).join(LF$1)
  }

  async advance() {
    return this._shift() !== undefined
  }

  unshiftLine(lineToRestore) {
    this._unshift(lineToRestore);
  }
  restoreLine(lineToRestore) {
    this._unshift(lineToRestore);
  }

  unshiftLines(linesToRestore) {
    this._unshiftAll(linesToRestore);
  }
  restoreLines(linesToRestore) {
    this._unshiftAll(linesToRestore);
  }

  replaceNextLine(replacement) {
    this._shift();
    this._unshift(replacement);
    return true
  }
  replaceLine(replacement) {
    return this.replaceNextLine(replacement)
  }

  async skipBlankLines() {
    if (await this.empty()) return undefined
    let numSkipped = 0;
    let nextLine;
    while ((nextLine = await this.peekLine()) !== undefined) {
      if (String(nextLine) !== '') return numSkipped
      this._shift();
      numSkipped++;
    }
    return undefined
  }

  async skipCommentLines() {
    if (await this.empty()) return
    let nextLine;
    while (
      (nextLine = await this.peekLine()) !== undefined &&
      nextLine !== ''
    ) {
      if (!nextLine.startsWith('//')) break
      if (nextLine.startsWith('///')) {
        const ll = nextLine.length;
        if (!(ll > 3 && nextLine === '/'.repeat(ll))) break
        await this.readLinesUntil({
          terminator: nextLine,
          skipFirstLine: true,
          readLastLine: true,
          skipProcessing: true,
          context: 'comment',
        });
      } else {
        this._shift();
      }
    }
  }

  async skipLineComments() {
    if (await this.empty()) return []
    const commentLines = [];
    let nextLine;
    while (
      (nextLine = await this.peekLine()) !== undefined &&
      nextLine !== ''
    ) {
      if (!nextLine.startsWith('//')) break
      commentLines.push(this._shift());
    }
    return commentLines
  }

  terminate() {
    this.lineno += this._lines.length;
    this._lines.length = 0;
    this._lookAhead = 0;
  }

  /**
   * Read lines until a termination condition is met.
   * @param {Object} [options={}]
   * @param {string} [options.terminator] - Line at which to stop.
   * @param {boolean} [options.breakOnBlankLines] - Stop on blank lines.
   * @param {boolean} [options.breakOnListContinuation] - Stop on a list continuation (+).
   * @param {boolean} [options.skipFirstLine] - Skip the first line before scanning.
   * @param {boolean} [options.preserveLastLine] - Push the terminating line back.
   * @param {boolean} [options.readLastLine] - Include the terminating line in result.
   * @param {boolean} [options.skipLineComments] - Skip line comments.
   * @param {boolean} [options.skipProcessing] - Disable line preprocessing for this call.
   * @param {string} [options.context] - Name used in unterminated-block warnings.
   * @param {Cursor} [options.cursor] - Starting cursor for unterminated-block warnings.
   * @param {Function|null} [filter=null] - Optional function(line) returning true to break.
   * @returns {Promise<string[]>}
   */
  async readLinesUntil(options = {}, filter = null) {
    const result = [];
    let restoreProcessLines = false;
    if (
      this.processLines &&
      (options.skipProcessing || options.skip_processing)
    ) {
      this.processLines = false;
      restoreProcessLines = true;
    }

    const terminator = options.terminator ?? null;
    let startCursor, breakOnBlankLines, breakOnListContinuation;
    if (terminator) {
      startCursor = options.cursor || this.cursor;
      breakOnBlankLines = false;
      breakOnListContinuation = false;
    } else {
      breakOnBlankLines =
        options.breakOnBlankLines || options.break_on_blank_lines || false;
      breakOnListContinuation =
        options.breakOnListContinuation ||
        options.break_on_list_continuation ||
        false;
    }

    const skipComments =
      options.skipLineComments || options.skip_line_comments || false;
    let lineRead = false;
    let lineRestored = false;
    let line;

    if (options.skipFirstLine || options.skip_first_line) this._shift();

    while ((line = await this.readLine()) !== undefined) {
      let shouldBreak = false;
      if (terminator) {
        shouldBreak = line === terminator;
      } else {
        if (breakOnBlankLines && line === '') {
          shouldBreak = true;
        } else if (
          breakOnListContinuation &&
          lineRead &&
          line === LIST_CONTINUATION
        ) {
          options.preserveLastLine = options.preserve_last_line = true;
          shouldBreak = true;
        } else if (filter?.(line)) {
          shouldBreak = true;
        }
      }

      if (shouldBreak) {
        if (options.readLastLine || options.read_last_line) result.push(line);
        if (options.preserveLastLine || options.preserve_last_line) {
          this._unshift(line);
          lineRestored = true;
        }
        break
      }

      if (!(skipComments && line.startsWith('//') && !line.startsWith('///'))) {
        result.push(line);
        lineRead = true;
      }
    }

    if (restoreProcessLines) {
      this.processLines = true;
      if (lineRestored && !terminator) this._lookAhead--;
    }

    if (terminator && terminator !== line) {
      const context = 'context' in options ? options.context : terminator;
      if (context) {
        const sc = startCursor === 'at_mark' ? this.cursorAtMark() : startCursor;
        this._logWarn(`unterminated ${context} block`, { sourceLocation: sc });
        this.unterminated = true;
      }
    }

    return result
  }

  // ── Cursor helpers ──────────────────────────────────────────────────────────

  get cursor() {
    return new Cursor(this.file, this._dir, this.path, this.lineno)
  }
  cursorAtLine(lineno) {
    return new Cursor(this.file, this._dir, this.path, lineno)
  }
  cursorAtMark() {
    return this.#mark ? new Cursor(...this.#mark) : this.cursor
  }
  cursorBeforeMark() {
    if (this.#mark) {
      const [mFile, mDir, mPath, mLineno] = this.#mark;
      return new Cursor(mFile, mDir, mPath, mLineno - 1)
    }
    return new Cursor(this.file, this._dir, this.path, this.lineno - 1)
  }
  cursorAtPrevLine() {
    return new Cursor(this.file, this._dir, this.path, this.lineno - 1)
  }

  mark() {
    this.#mark = [this.file, this._dir, this.path, this.lineno];
  }

  lineInfo() {
    return `${this.path}: line ${this.lineno}`
  }

  /**
   * Returns the remaining lines in forward order (first remaining line at index 0).
   * The returned object is a mutable proxy so that element assignments like
   * `reader.lines[i] = newValue` are reflected back into the internal reversed stack.
   * @returns {string[]}
   */
  get lines() {
    const _l = this._lines;
    const fwd = _l.slice().reverse();
    return new Proxy(fwd, {
      set(target, prop, value) {
        target[prop] = value;
        const idx = parseInt(prop, 10);
        if (!Number.isNaN(idx) && idx >= 0 && idx < _l.length) {
          _l[_l.length - 1 - idx] = value;
        }
        return true
      },
    })
  }

  string() {
    return this._lines.slice().reverse().join(LF$1)
  }
  source() {
    return this.sourceLines.join(LF$1)
  }

  // ── Save / restore ──────────────────────────────────────────────────────────

  /** @returns {void} */
  save() {
    this._saved = {
      file: this.file,
      dir: this._dir,
      path: this.path,
      lineno: this.lineno,
      lines: [...this._lines],
      mark: this.#mark,
      lookAhead: this._lookAhead,
      processLines: this.processLines,
      unescapeNextLine: this._unescapeNextLine,
      unterminated: this.unterminated,
    };
  }

  /** @returns {void} */
  restoreSave() {
    if (!this._saved) return
    const s = this._saved;
    this.file = s.file;
    this._dir = s.dir;
    this.path = s.path;
    this.lineno = s.lineno;
    this._lines = s.lines;
    this.#mark = s.mark;
    this._lookAhead = s.lookAhead;
    this.processLines = s.processLines;
    this._unescapeNextLine = s.unescapeNextLine;
    this.unterminated = s.unterminated;
    this._saved = null;
  }

  discardSave() {
    this._saved = null;
  }

  toString() {
    return `#<Reader {path: ${JSON.stringify(this.path)}, line: ${this.lineno}}>`
  }

  // ── Internal (inheritable) ──────────────────────────────────────────────────

  /**
   * Shift the top line off the stack and increment lineno.
   * Subclasses may override to post-process consumed lines (see PreprocessorReader).
   * @returns {string|undefined}
   * @internal
   */
  _shift() {
    this.lineno++;
    if (this._lookAhead > 0) this._lookAhead--;
    return this._lines.pop()
  }

  /**
   * Push a line onto the stack and decrement lineno.
   * @param {string} line
   * @internal
   */
  _unshift(line) {
    this.lineno--;
    this._lookAhead++;
    this._lines.push(line);
  }

  /**
   * Restore multiple lines onto the stack.
   * @param {string[]} linesToRestore
   * @internal
   */
  _unshiftAll(linesToRestore) {
    this.lineno -= linesToRestore.length;
    this._lookAhead += linesToRestore.length;
    this._lines.push(...linesToRestore.slice().reverse());
  }

  /**
   * Process a line on first visit. Returns the line unmodified by default;
   * subclasses override to evaluate preprocessor directives.
   * @param {string} line
   * @returns {string}
   * @internal
   */
  processLine(line) {
    if (this.processLines) this._lookAhead++;
    return line
  }

  /**
   * Prepare the source data into a String Array.
   * Subclasses override to add front-matter / indentation handling.
   * @param {string|string[]|null} data
   * @param {Object} [opts={}]
   * @returns {string[]}
   * @internal
   */
  _prepareLines(data, opts = {}) {
    const normalize = opts.normalize;
    if (normalize) {
      const trimEnd = normalize !== 'chomp';
      return Array.isArray(data)
        ? prepareSourceArray(data, trimEnd)
        : prepareSourceString(data != null ? String(data) : '', trimEnd)
    }
    if (Array.isArray(data)) return [...data]
    if (data != null) {
      let s = String(data);
      if (s.includes('\r')) s = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      return s.replace(/\n$/, '').split('\n')
    }
    return []
  }

  // ── Public API (mirrors Ruby Asciidoctor::Reader) ───────────────────────────

  getCursor() {
    return this.cursor
  }
  getLines() {
    return this.sourceLines
  }
  getString() {
    return this.source()
  }
  /** @returns {import('./logging.js').LoggerLike} */
  getLogger() {
    return this._document?.logger ?? LoggerManager.logger
  }
  /**
   * @param {string} text
   * @param {{sourceLocation?: Cursor, includeLocation?: Cursor}} [context={}]
   * @returns {{text: string, source_location?: Cursor, include_location?: Cursor, inspect(): string, toString(): string}}
   */
  createLogMessage(text, context = {}) {
    return Logger.AutoFormattingMessage.attach({ text, ...context })
  }

  // ── Logging helpers ─────────────────────────────────────────────────────────

  /** @returns {import('./logging.js').LoggerLike} */
  get logger() {
    return this._document?.logger ?? console
  }

  /** @param {string} msg @param {{ sourceLocation?: any, includeLocation?: any }} [opts] */
  _logWarn(msg, opts = {}) {
    this.logger.warn(this._messageWithContext(msg, opts));
  }
  _logError(msg, opts = {}) {
    this.logger.error(this._messageWithContext(msg, opts));
  }
  /** @param {string} msg @param {{ sourceLocation?: any }} [opts] */
  _logInfo(msg, opts = {}) {
    this.logger.info(this._messageWithContext(msg, opts));
  }

  /**
   * Build an auto-formatting message that keeps the cursor as a structured
   * source_location (rather than baking it into the text). When displayed by a
   * stderr Logger the location is rendered as a "<path>: line <N>: " prefix, but
   * a MemoryLogger records it separately on the LogMessage so consumers can call
   * getSourceLocation(). Mirrors Ruby's Logging#message_with_context.
   * @param {string} msg
   * @param {{ sourceLocation?: any, includeLocation?: any }} [opts]
   * @internal
   */
  _messageWithContext(msg, { sourceLocation, includeLocation } = {}) {
    if (!sourceLocation && !includeLocation) return msg
    return Logger.AutoFormattingMessage.attach({
      text: msg,
      source_location: sourceLocation ?? null,
      include_location: includeLocation ?? null,
    })
  }
}

// ── PreprocessorReader ────────────────────────────────────────────────────────

class PreprocessorReader extends Reader {
  /** @type {boolean} */
  #sourcemap

  /** @type {MaxDepth|null} */
  #maxdepth

  /** Maps an include's rootname to whether it was fully (true) or partially (null) included. @type {Object<string, boolean|null>} */
  #includes

  /** @type {boolean} */
  #skipping

  /** @type {ConditionalStackEntry[]} */
  #conditionalStack

  /** Cached result of `document.extensions.includeProcessors()`; `false` once resolved as absent. @type {Array|false|null} */
  #includeProcessorExtensions

  constructor(document, data = null, cursor = null, opts = {}) {
    if (
      'skip-front-matter' in document.attributes &&
      !('skipFrontMatter' in opts)
    ) {
      opts = { ...opts, skipFrontMatter: true };
    }
    // Pass document in opts so that _prepareLines (called from super) can access it.
    if (!opts.document) opts = { ...opts, document };
    super(data, cursor, opts);
    this._document = document;
    this.#sourcemap = document.sourcemap;
    const defaultDepth = parseInt(
      document.attributes['max-include-depth'] ?? 64,
      10
    );
    this.#maxdepth =
      defaultDepth > 0
        ? { abs: defaultDepth, curr: defaultDepth, rel: defaultDepth }
        : null;
    this.includeStack = [];
    this.#includes = document.catalog.includes;
    this.#skipping = false;
    this.#conditionalStack = [];
    this.#includeProcessorExtensions = null;
  }

  /** @returns {import('./logging.js').LoggerLike} */
  get logger() {
    return this._document?.logger ?? console
  }

  /**
   * Drain conditional stack at EOS; treat blank lines as lines (not as EOF).
   * `peekLine()` returns undefined only at true EOF; '' for blank lines.
   * @returns {Promise<boolean>}
   */
  async hasMoreLines() {
    return (await this.peekLine()) !== undefined
  }
  async empty() {
    return (await this.peekLine()) === undefined
  }
  async eof() {
    return await this.empty()
  }

  async peekLine(direct = false) {
    const line = await super.peekLine(direct);
    if (line !== undefined) return line
    if (this.includeStack.length === 0) {
      let endCursor = null;
      this.#conditionalStack = this.#conditionalStack.filter((cond) => {
        const loc =
          cond.sourceLocation || (endCursor ??= this.cursorAtPrevLine());
        this._logError(
          `detected unterminated preprocessor conditional directive: ${cond.name}::${cond.target || ''}[${cond.expr || ''}]`,
          { sourceLocation: loc }
        );
        return false
      });
      return undefined
    }
    this.#popInclude();
    return await this.peekLine(direct)
  }

  /**
   * Strip leading backslash from escaped directives.
   * @returns {string|undefined}
   */
  _shift() {
    if (this._unescapeNextLine) {
      this._unescapeNextLine = false;
      const line = super._shift();
      return line.slice(1)
    }
    return super._shift()
  }

  /**
   * Push new source onto the reader, switching the include context.
   * @param {string|string[]} data
   * @param {string|null} [file=null]
   * @param {string|null} [path=null]
   * @param {number} [lineno=1]
   * @param {Object} [attributes={}]
   * @returns {this}
   */
  pushInclude(data, file = null, path = null, lineno = 1, attributes = {}) {
    this.includeStack.push([
      this._lines,
      this.file,
      this._dir,
      this.path,
      this.lineno,
      this.#maxdepth,
      this.processLines,
    ]);

    if ((this.file = file)) {
      this._dir = fsdirname(String(file));
      this.path = path || fsbasename(String(file));
      const fileStr = String(file);
      if (
        (this.processLines = Object.keys(ASCIIDOC_EXTENSIONS).some((ext) =>
          fileStr.endsWith(ext)
        ))
      ) {
        const key = this.path.slice(0, this.path.lastIndexOf('.'));
        this.#includes[key] ??= 'partial-option' in attributes ? null : true;
      }
    } else {
      this._dir = '.';
      this.processLines = true;
      if ((this.path = path)) {
        this.#includes[rootname(this.path)] ??=
          'partial-option' in attributes ? null : true;
      } else {
        this.path = '<stdin>';
      }
    }

    this.lineno = lineno;

    if (this.#maxdepth && 'depth' in attributes) {
      const relMaxdepth = parseInt(attributes.depth, 10);
      if (relMaxdepth > 0) {
        const absMaxdepth = this.#maxdepth.abs;
        let currMaxdepth = this.includeStack.length + relMaxdepth;
        let effRel = relMaxdepth;
        if (currMaxdepth > absMaxdepth) currMaxdepth = effRel = absMaxdepth;
        this.#maxdepth = { abs: absMaxdepth, curr: currMaxdepth, rel: effRel };
      } else {
        this.#maxdepth = {
          abs: this.#maxdepth.abs,
          curr: this.includeStack.length,
          rel: 0,
        };
      }
    }

    this._lines = this._prepareLines(data, {
      include: true,
      normalize: this.processLines || 'chomp',
      indent: attributes.indent,
      skipFrontMatter: 'skip-front-matter-option' in attributes,
    });

    if (this._lines.length === 0) {
      this.#popInclude();
    } else if ('leveloffset' in attributes) {
      const leveloffset = this._document.getAttribute('leveloffset');
      const resetLine = leveloffset
        ? `:leveloffset: ${leveloffset}`
        : ':leveloffset!:';
      const setLine = `:leveloffset: ${attributes.leveloffset}`;
      // Build stack-order array: setLine at end (read first), resetLine at start (read last)
      this._lines = [
        resetLine,
        '',
        ...this._lines.slice().reverse(),
        '',
        setLine,
      ];
      this.lineno -= 2;
    } else {
      this._lines.reverse();
    }
    this._lookAhead = 0;
    return this
  }

  get includeDepth() {
    return this.includeStack.length
  }

  exceedsMaxDepth() {
    return (
      this.#maxdepth &&
      this.includeStack.length >= this.#maxdepth.curr &&
      this.#maxdepth.rel
    )
  }
  exceededMaxDepth() {
    return this.exceedsMaxDepth()
  }

  hasIncludeProcessors() {
    if (this.#includeProcessorExtensions === null) {
      const exts = this._document.extensions;
      if (
        exts &&
        (this.#includeProcessorExtensions = exts.includeProcessors?.())
      )
        return true
      this.#includeProcessorExtensions = false;
    }
    return this.#includeProcessorExtensions !== false
  }

  createIncludeCursor(file, path, lineno) {
    return new Cursor(String(file), fsdirname(String(file)), path, lineno)
  }

  toString() {
    return `#<PreprocessorReader {path: ${JSON.stringify(this.path)}, line: ${this.lineno}, include depth: ${this.includeStack.length}}>`
  }

  /** Save PreprocessorReader-specific fields in addition to Reader fields. */
  save() {
    super.save();
    Object.assign(this._saved, {
      maxdepth: this.#maxdepth,
      skipping: this.#skipping,
      conditionalStack: this.#conditionalStack.map((e) => ({ ...e })),
      includeStack: [...this.includeStack],
    });
  }

  /** Also restore PreprocessorReader-specific fields. */
  restoreSave() {
    if (!this._saved) return
    this.#maxdepth = this._saved.maxdepth;
    this.#skipping = this._saved.skipping;
    this.#conditionalStack = this._saved.conditionalStack;
    this.includeStack = this._saved.includeStack;
    super.restoreSave();
  }

  /**
   * Add front-matter stripping and indentation adjustment.
   * @param {string|string[]|null} data
   * @param {Object} [opts={}]
   * @returns {string[]}
   */
  _prepareLines(data, opts = {}) {
    const result = super._prepareLines(data, opts);

    if (opts.skipFrontMatter) {
      const frontMatter = this._skipFrontMatter(result);
      if (frontMatter !== null && !opts.include) {
        this._document.attributes['front-matter'] = frontMatter.join(LF$1);
      }
    }

    if (opts.include) {
      if (opts.indent != null) {
        const indentVal = parseInt(opts.indent, 10) || 0;
        const tabsize = parseInt(
          this._document.getAttribute('tabsize') ?? 0,
          10
        );
        _adjustIndentation(result, indentVal, tabsize);
      }
    } else {
      while (result.length > 0 && result[result.length - 1] === '') result.pop();
    }

    return result
  }

  /**
   * Evaluate preprocessor directives as lines are visited.
   * @param {string} line
   * @returns {Promise<string|undefined>}
   */
  async processLine(line) {
    if (!this.processLines) return line

    if (line === '') {
      if (this.#skipping) {
        super._shift();
        return undefined
      }
      this._lookAhead++;
      return line
    }

    if (line.endsWith(']') && !line.startsWith('[') && line.includes('::')) {
      if (line.includes('if')) {
        const m = ConditionalDirectiveRx.exec(line);
        if (m) {
          const [, esc, name, target, delimiter, text] = m;
          if (esc === '\\') {
            this._unescapeNextLine = true;
            this._lookAhead++;
            return line.slice(1)
          }
          if (
            this.#preprocessConditionalDirective(
              name,
              target || '',
              delimiter || null,
              text || null
            )
          ) {
            super._shift();
            return undefined
          }
          this._lookAhead++;
          return line
        }
      }
      if (this.#skipping) {
        super._shift();
        return undefined
      }
      if (line.startsWith('inc') || line.startsWith('\\inc')) {
        const m = IncludeDirectiveRx.exec(line);
        if (m) {
          const [, esc, target, attrlist] = m;
          if (esc === '\\') {
            this._unescapeNextLine = true;
            this._lookAhead++;
            return line.slice(1)
          }
          if (await this.#preprocessIncludeDirective(target, attrlist ?? null))
            return undefined
          this._lookAhead++;
          return line
        }
      }
      this._lookAhead++;
      return line
    }

    if (this.#skipping) {
      super._shift();
      return undefined
    }
    this._lookAhead++;
    return line
  }

  // ── Private preprocessor logic ──────────────────────────────────────────────

  /**
   * Evaluate a conditional directive (ifdef/ifndef/ifeval/endif).
   * @param {string} name
   * @param {string} target
   * @param {string|null} delimiter
   * @param {string|null} text
   * @returns {boolean} True if the cursor should advance past this line.
   * @internal
   */
  #preprocessConditionalDirective(name, target, delimiter, text) {
    const noTarget = target === '';
    if (!noTarget) target = target.toLowerCase();

    if (name === 'endif') {
      if (text) {
        this._logError(
          `malformed preprocessor directive - text not permitted: endif::${target}[${text}]`,
          { sourceLocation: this.cursor }
        );
      } else if (this.#conditionalStack.length === 0) {
        this._logError(`unmatched preprocessor directive: endif::${target}[]`, {
          sourceLocation: this.cursor,
        });
      } else {
        const top = this.#conditionalStack[this.#conditionalStack.length - 1];
        if (noTarget || target === top.target) {
          this.#conditionalStack.pop();
          this.#skipping =
            this.#conditionalStack.length === 0
              ? false
              : this.#conditionalStack[this.#conditionalStack.length - 1]
                  .skipping;
        } else {
          this._logError(
            `mismatched preprocessor directive: endif::${target}[], expected endif::${top.target || ''}[]`,
            { sourceLocation: this.cursor }
          );
        }
      }
      return true
    }

    let skip;
    if (this.#skipping) {
      if (name === 'ifeval') {
        if (!(noTarget && text && EvalExpressionRx.test(text.trim())))
          return true
      } else if (noTarget) {
        return true
      }
      skip = false;
    } else {
      const attrs = this._document.attributes;
      if (name === 'ifdef') {
        if (noTarget) {
          this._logError(
            `malformed preprocessor directive - missing target: ifdef::[${text}]`,
            { sourceLocation: this.cursor }
          );
          return true
        }
        skip =
          delimiter === ','
            ? !target.split(',').some((a) => a in attrs)
            : delimiter === '+'
              ? target.split('+').some((a) => !(a in attrs))
              : !(target in attrs);
      } else if (name === 'ifndef') {
        if (noTarget) {
          this._logError(
            `malformed preprocessor directive - missing target: ifndef::[${text}]`,
            { sourceLocation: this.cursor }
          );
          return true
        }
        skip =
          delimiter === ','
            ? target.split(',').some((a) => a in attrs)
            : delimiter === '+'
              ? target.split('+').every((a) => a in attrs)
              : target in attrs;
      } else if (name === 'ifeval') {
        if (!noTarget) {
          this._logError(
            `malformed preprocessor directive - target not permitted: ifeval::${target}[${text}]`,
            { sourceLocation: this.cursor }
          );
          return true
        }
        const m = text && EvalExpressionRx.exec(text.trim());
        if (m) {
          try {
            skip = !this.#evalOp(
              this.#resolveExprVal(m[1]),
              m[2],
              this.#resolveExprVal(m[3])
            );
          } catch {
            skip = true;
          }
        } else {
          this._logError(
            `malformed preprocessor directive - ${text ? 'invalid expression' : 'missing expression'}: ifeval::[${text}]`,
            { sourceLocation: this.cursor }
          );
          return true
        }
      }
    }

    if (name === 'ifeval') {
      if (skip) this.#skipping = true;
      this.#conditionalStack.push({
        name,
        expr: text,
        skip,
        skipping: this.#skipping,
        sourceLocation: this.#sourcemap ? this.cursor : null,
      });
    } else if (text) {
      if (!this.#skipping && !skip) {
        this.replaceNextLine(text.trimEnd());
        // Push a dummy line to stand in for the opening conditional directive
        this._lines.push('');
        if (text.startsWith('include::')) this._lookAhead--;
      }
    } else {
      if (skip) this.#skipping = true;
      this.#conditionalStack.push({
        name,
        target,
        skip,
        skipping: this.#skipping,
        sourceLocation: this.#sourcemap ? this.cursor : null,
      });
    }

    return true
  }

  /**
   * Evaluate a conditional include directive.
   * @param {string} target
   * @param {string|null} attrlist
   * @returns {Promise<boolean|undefined>} True if the line under the cursor was consumed or changed.
   * @internal
   */
  async #preprocessIncludeDirective(target, attrlist) {
    await _requireFsp();
    const doc = this._document;
    let expandedTarget = target;

    if (expandedTarget.includes(ATTR_REF_HEAD)) {
      const attrMissing =
        doc.attributes['attribute-missing'] || Compliance.attribute_missing;
      expandedTarget = doc.subAttributes(target, {
        attributeMissing: attrMissing === 'warn' ? 'drop-line' : attrMissing,
      });
      if (expandedTarget === '') {
        const parsedAttrs = attrlist
          ? await doc.parseAttributes(attrlist, [], { subInput: true })
          : {};
        if ('optional-option' in parsedAttrs) {
          this._logInfo(
            `optional include dropped because resolved target is blank: include::${target}[${attrlist ?? ''}]`,
            { sourceLocation: this.cursor }
          );
          super._shift();
          return true
        }
        if (attrMissing === 'drop-line') {
          this._logInfo(
            `include dropped due to missing attribute: include::${target}[${attrlist ?? ''}]`,
            { sourceLocation: this.cursor }
          );
          super._shift();
          return true
        }
        this._logWarn(
          `include dropped because resolved target is blank: include::${target}[${attrlist ?? ''}]`,
          { sourceLocation: this.cursor }
        );
        return this.replaceNextLine(
          `Unresolved directive in ${this.path} - include::${target}[${attrlist ?? ''}]`
        )
      }
    }

    if (this.hasIncludeProcessors()) {
      const ext = this.#includeProcessorExtensions.find((c) =>
        c.instance.handles(doc, expandedTarget)
      );
      if (ext) {
        super._shift();
        const pa = attrlist
          ? await doc.parseAttributes(attrlist, [], { subInput: true })
          : {};
        await ext.processMethod(doc, this, expandedTarget, pa);
        return true
      }
    }

    if (doc.safe >= SafeMode.SECURE) {
      const lt = expandedTarget.includes(' ')
        ? `pass:c[${expandedTarget}]`
        : expandedTarget;
      const la = doc.hasAttribute('compat-mode')
        ? (attrlist ?? '')
        : `role=include${attrlist ? `,${attrlist}` : ''}`;
      return this.replaceNextLine(`link:${lt}[${la}]`)
    }

    if (!this.#maxdepth) return undefined

    if (this.includeStack.length >= this.#maxdepth.curr) {
      this._logError(
        `maximum include depth of ${this.#maxdepth.rel} exceeded`,
        { sourceLocation: this.cursor }
      );
      return undefined
    }

    const parsedAttrs = attrlist
      ? await doc.parseAttributes(attrlist, [], { subInput: true })
      : {};
    const resolution = await this.#resolveIncludePath(
      expandedTarget,
      attrlist,
      parsedAttrs
    );
    if (!Array.isArray(resolution)) return resolution
    const [incPath, targetType, relpath] = resolution;

    let incLinenos = null;
    let incTags = null;
    if (attrlist) {
      if ('lines' in parsedAttrs && parsedAttrs.lines !== '') {
        incLinenos = [];
        for (const ld of this.#splitDelimitedValue(parsedAttrs.lines)) {
          if (ld.includes('..')) {
            const sep = ld.indexOf('..');
            const from = parseInt(ld.slice(0, sep), 10);
            const toStr = ld.slice(sep + 2);
            if (toStr === '' || parseInt(toStr, 10) < 0) {
              incLinenos.push(from, Infinity);
            } else {
              const to = parseInt(toStr, 10);
              for (let i = from; i <= to; i++) incLinenos.push(i);
            }
          } else {
            incLinenos.push(parseInt(ld, 10));
          }
        }
        incLinenos =
          incLinenos.length > 0
            ? [...new Set(incLinenos)].sort((a, b) => a - b)
            : null;
      } else if ('tag' in parsedAttrs) {
        const tag = parsedAttrs.tag;
        if (tag && tag !== '!')
          incTags = tag.startsWith('!')
            ? { [tag.slice(1)]: false }
            : { [tag]: true };
      } else if ('tags' in parsedAttrs) {
        incTags = {};
        for (const td of this.#splitDelimitedValue(parsedAttrs.tags)) {
          if (td && td !== '!') {
            incTags[td.startsWith('!') ? td.slice(1) : td] = !td.startsWith('!');
          }
        }
        if (Object.keys(incTags).length === 0) incTags = null;
      }
    }

    if (targetType === 'uri') {
      let uriContent;
      try {
        const response = await fetchUri(incPath, this._document);
        if (!response.ok)
          throw new Error(`HTTP ${response.status} ${response.statusText}`)
        uriContent = await response.text();
        super._shift();
      } catch (err) {
        if ('optional-option' in parsedAttrs) {
          this._logInfo(
            `optional include dropped because include URI not readable: ${incPath}`,
            { sourceLocation: this.cursor }
          );
          super._shift();
          return true
        }
        this._logError(
          `include URI not readable: ${incPath} (${err.message})`,
          { sourceLocation: this.cursor }
        );
        return this.replaceNextLine(
          `Unresolved directive in ${this.path} - include::${expandedTarget}[${attrlist ?? ''}]`
        )
      }
      if (incLinenos) {
        const { incLines, incOffset } = this.#filterLinesByLinenos(
          uriContent.split('\n'),
          incLinenos
        );
        if (incOffset !== null) {
          parsedAttrs['partial-option'] = '';
          this.pushInclude(incLines, incPath, relpath, incOffset, parsedAttrs);
        }
      } else if (incTags) {
        const { incLines, incOffset } = this.#filterLinesByTags(
          uriContent.split('\n'),
          incPath,
          expandedTarget,
          targetType,
          incTags,
          parsedAttrs
        );
        if (incOffset !== null)
          this.pushInclude(incLines, incPath, relpath, incOffset, parsedAttrs);
      } else {
        this.pushInclude(uriContent, incPath, relpath, 1, parsedAttrs);
      }
      return true
    }

    try {
      if (incLinenos) {
        const fileLines = (await _fsp.readFile(incPath, 'utf8')).split('\n');
        super._shift();
        const { incLines, incOffset } = this.#filterLinesByLinenos(
          fileLines,
          incLinenos
        );
        if (incOffset !== null) {
          parsedAttrs['partial-option'] = '';
          this.pushInclude(incLines, incPath, relpath, incOffset, parsedAttrs);
        }
      } else if (incTags) {
        const fileLines = (await _fsp.readFile(incPath, 'utf8')).split('\n');
        super._shift();
        const { incLines, incOffset } = this.#filterLinesByTags(
          fileLines,
          incPath,
          expandedTarget,
          targetType,
          incTags,
          parsedAttrs
        );
        if (incOffset !== null)
          this.pushInclude(incLines, incPath, relpath, incOffset, parsedAttrs);
      } else {
        let incContent;
        try {
          incContent = await _fsp.readFile(incPath, 'utf8');
          super._shift();
        } catch {
          this._logError(`include ${targetType} not readable: ${incPath}`, {
            sourceLocation: this.cursor,
          });
          return this.replaceNextLine(
            `Unresolved directive in ${this.path} - include::${expandedTarget}[${attrlist ?? ''}]`
          )
        }
        this.pushInclude(incContent, incPath, relpath, 1, parsedAttrs);
      }
    } catch {
      this._logError(`include ${targetType} not readable: ${incPath}`, {
        sourceLocation: this.cursor,
      });
      return this.replaceNextLine(
        `Unresolved directive in ${this.path} - include::${expandedTarget}[${attrlist ?? ''}]`
      )
    }
    return true
  }

  /**
   * Check whether the current context requires browser-mode include resolution.
   * Browser mode applies when there is no Node.js fs (true browser environment) or when
   * the document base_dir is a URI (file:// or http(s)://), even in Node.js.
   * @returns {boolean}
   * @internal
   */
  #isBrowserMode() {
    if (!_fsp) return true
    const baseDir = this._document.baseDir;
    return (
      !!baseDir &&
      baseDir !== '.' &&
      (baseDir.startsWith('file://') || isUriish(baseDir))
    )
  }

  /**
   * Resolve the include target to [incPath, targetType, relpath] or a Boolean.
   * @param {string} target
   * @param {string|null} attrlist
   * @param {Object} attributes
   * @returns {Promise<[string, string, string]|boolean|undefined>}
   * @internal
   */
  async #resolveIncludePath(target, attrlist, attributes) {
    const doc = this._document;

    // Delegate to browser-specific resolution when in a URI-based or browserless environment.
    // This handles file://, http(s)://, and relative targets resolved against a URI base_dir.
    // See src/browser/reader.js for the full specification.
    if (this.#isBrowserMode()) {
      const resolution = resolveBrowserIncludePath(this, target, attrlist);
      if (!Array.isArray(resolution)) return resolution
      const [incPath, relpath] = resolution;
      return [incPath, 'uri', relpath]
    }

    if (isUriish(target) || typeof this._dir !== 'string') {
      if (!doc.hasAttribute('allow-uri-read')) {
        this._logWarn(
          `cannot include contents of URI: ${target} (allow-uri-read attribute not enabled)`,
          { sourceLocation: this.cursor }
        );
        const lt = target.includes(' ') ? `pass:c[${target}]` : target;
        const la = doc.hasAttribute('compat-mode')
          ? (attrlist ?? '')
          : `role=include${attrlist ? `,${attrlist}` : ''}`;
        return this.replaceNextLine(`link:${lt}[${la}]`)
      }
      return [target, 'uri', target]
    }

    const incPath = doc.normalizeSystemPath(target, this._dir, null, {
      targetName: 'include file',
    });
    if (!(await fileExists(incPath))) {
      if ('optional-option' in attributes) {
        this._logInfo(
          `optional include dropped because include file not found: ${incPath}`,
          { sourceLocation: this.cursor }
        );
        super._shift();
        return true
      }
      this._logError(`include file not found: ${incPath}`, {
        sourceLocation: this.cursor,
      });
      return this.replaceNextLine(
        `Unresolved directive in ${this.path} - include::${target}[${attrlist ?? ''}]`
      )
    }
    const relpath = doc.pathResolver.relativePath(incPath, doc.baseDir);
    return [incPath, 'file', relpath]
  }

  /**
   * Pop the top include context and restore state.
   * @internal
   */
  #popInclude() {
    if (this.includeStack.length === 0) return
    ;[
      this._lines,
      this.file,
      this._dir,
      this.path,
      this.lineno,
      this.#maxdepth,
      this.processLines,
    ] = this.includeStack.pop();
    this._lookAhead = 0;
  }

  /**
   * Read lines filtered by line-number ranges.
   * @param {string[]} fileLines
   * @param {number[]} incLinenos
   * @returns {{incLines: string[], incOffset: number|null}}
   * @internal
   */
  #filterLinesByLinenos(fileLines, incLinenos) {
    const remaining = [...incLinenos];
    const incLines = [];
    let incOffset = null;
    let selectRemaining = false;
    for (let idx = 0; idx < fileLines.length; idx++) {
      const incLineno = idx + 1;
      const l = fileLines[idx] + (idx < fileLines.length - 1 ? '\n' : '');
      if (
        selectRemaining ||
        (remaining[0] === Infinity && (selectRemaining = true))
      ) {
        incOffset ??= incLineno;
        incLines.push(l);
      } else if (remaining[0] === incLineno) {
        incOffset ??= incLineno;
        incLines.push(l);
        remaining.shift();
        if (remaining.length === 0) break
      }
    }
    return { incLines, incOffset }
  }

  /**
   * Filter lines by tag directives.
   * @param {string[]} fileLines
   * @param {string} incPath
   * @param {string} expandedTarget
   * @param {string} targetType
   * @param {Object} incTagsIn
   * @param {Object} parsedAttrs
   * @returns {{incLines: string[], incOffset: number|null}}
   * @internal
   */
  #filterLinesByTags(
    fileLines,
    incPath,
    expandedTarget,
    targetType,
    incTagsIn,
    parsedAttrs
  ) {
    const tags = { ...incTagsIn };
    let select, baseSelect, wildcard;
    if ('**' in tags) {
      select = baseSelect = tags['**'];
      delete tags['**'];
      if ('*' in tags) {
        wildcard = tags['*'];
        delete tags['*'];
      } else if (!select && Object.values(tags)[0] === false) wildcard = true;
    } else if ('*' in tags) {
      if (Object.keys(tags)[0] === '*') {
        select = baseSelect = !(wildcard = tags['*']);
      } else {
        select = baseSelect = false;
        wildcard = tags['*'];
      }
      delete tags['*'];
    } else {
      select = baseSelect = !Object.values(tags).includes(true);
    }

    const incLines = [];
    let incOffset = null;
    const tagStack = [];
    const tagsSelected = new Set();
    let activeTag = null;

    for (let idx = 0; idx < fileLines.length; idx++) {
      const incLineno = idx + 1;
      const l = fileLines[idx] + (idx < fileLines.length - 1 ? '\n' : '');
      if (l.includes('::') && l.includes('[]')) {
        const m = TagDirectiveRx.exec(l);
        if (m) {
          const [, isEnd, thisTag] = m;
          if (isEnd) {
            if (thisTag === activeTag) {
              tagStack.pop()
              ;[activeTag, select] =
                tagStack.length === 0
                  ? [null, baseSelect]
                  : tagStack[tagStack.length - 1];
            } else if (thisTag in tags) {
              const ic = this.createIncludeCursor(
                incPath,
                expandedTarget,
                incLineno
              );
              const si = tagStack.findLastIndex(([k]) => k === thisTag);
              if (si >= 0) {
                tagStack.splice(si, 1);
                this._logWarn(
                  `mismatched end tag (expected '${activeTag}' but found '${thisTag}') at line ${incLineno} of include ${targetType}: ${incPath}`,
                  { sourceLocation: this.cursor, includeLocation: ic }
                );
              } else {
                this._logWarn(
                  `unexpected end tag '${thisTag}' at line ${incLineno} of include ${targetType}: ${incPath}`,
                  { sourceLocation: this.cursor, includeLocation: ic }
                );
              }
            }
          } else if (thisTag in tags) {
            if ((select = tags[thisTag])) tagsSelected.add(thisTag);
            tagStack.push([(activeTag = thisTag), select, incLineno]);
          } else if (wildcard !== undefined) {
            select = activeTag && !select ? false : wildcard;
            tagStack.push([(activeTag = thisTag), select, incLineno]);
          }
          continue
        }
      }
      if (select) {
        incOffset ??= incLineno;
        incLines.push(l);
      }
    }

    for (const [tagName, , tagLineno] of tagStack) {
      const ic = this.createIncludeCursor(incPath, expandedTarget, tagLineno);
      this._logWarn(
        `detected unclosed tag '${tagName}' starting at line ${tagLineno} of include ${targetType}: ${incPath}`,
        { sourceLocation: this.cursor, includeLocation: ic }
      );
    }

    const missingTags = Object.entries(tags)
      .filter(([, v]) => v)
      .map(([k]) => k)
      .filter((k) => !tagsSelected.has(k));
    if (missingTags.length > 0) {
      this._logWarn(
        `tag${missingTags.length > 1 ? 's' : ''} '${missingTags.join(', ')}' not found in include ${targetType}: ${incPath}`,
        { sourceLocation: this.cursor }
      );
    }

    if (!baseSelect || wildcard === false || Object.keys(tags).length > 0) {
      parsedAttrs['partial-option'] = '';
    }

    return { incLines, incOffset }
  }

  /**
   * Strip YAML/TOML front matter from the data Array (in-place).
   * @param {string[]} data
   * @param {boolean} [incrementLinenos=true]
   * @returns {string[]|null} The front-matter lines, or null if no front matter was found.
   * @internal
   */
  _skipFrontMatter(data, incrementLinenos = true) {
    const delim = data[0];
    if (delim !== '---' && delim !== '+++') return null
    const original = [...data];
    data.shift();
    const frontMatter = [];
    if (incrementLinenos) this.lineno++;
    let eof = false;
    while (!(eof = data.length === 0) && data[0] !== delim) {
      frontMatter.push(data.shift());
      if (incrementLinenos) this.lineno++;
    }
    if (eof) {
      data.length = 0;
      data.push(...original);
      if (incrementLinenos) this.lineno -= original.length;
      return null
    }
    data.shift();
    if (incrementLinenos) this.lineno++;
    return frontMatter
  }

  /**
   * Resolve the value of one side of an ifeval expression.
   * @param {string} val
   * @returns {string|number|boolean|null}
   * @internal
   */
  #resolveExprVal(val) {
    let quoted = false;
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      quoted = true;
      val = val.slice(1, val.length - 1);
    }
    if (val.includes(ATTR_REF_HEAD)) {
      val = this._document.subAttributes(val, { attributeMissing: 'drop' });
    }
    if (quoted) return val
    if (val === '') return null
    if (val === 'true') return true
    if (val === 'false') return false
    if (val.trimEnd() === '') return ' '
    if (val.includes('.')) return parseFloat(val)
    return parseInt(val, 10)
  }

  /**
   * Evaluate a binary comparison.
   * @param {*} lhs
   * @param {string} op
   * @param {*} rhs
   * @returns {boolean}
   * @internal
   */
  #evalOp(lhs, op, rhs) {
    // Reject comparisons that mix boolean with non-boolean (invalid in Ruby — throws TypeError).
    if ((typeof lhs === 'boolean') !== (typeof rhs === 'boolean'))
      throw new TypeError('incompatible operand types')
    if (op === '==') return lhs === rhs
    if (op === '!=') return lhs !== rhs
    if (op === '<') return lhs < rhs
    if (op === '>') return lhs > rhs
    if (op === '<=') return lhs <= rhs
    if (op === '>=') return lhs >= rhs
    return false
  }

  /**
   * Split a delimited value on comma (if present), otherwise semicolon.
   * @param {string} val
   * @returns {string[]}
   * @internal
   */
  #splitDelimitedValue(val) {
    return val.includes(',') ? val.split(',') : val.split(';')
  }

  // ── JavaScript-style accessors ────────────────────────────────────────────────

  /**
   * Get the current include depth (number of nested includes).
   * @returns {number}
   */
  getIncludeDepth() {
    return this.includeDepth
  }
}

// ESM conversion of block.rb


/**
 * Maps block context strings to their default content model.
 * Any context not listed defaults to 'simple'.
 * @type {Object<string, string>}
 */
const DEFAULT_CONTENT_MODEL = new Proxy(
  {
    audio: 'empty',
    image: 'empty',
    listing: 'verbatim',
    literal: 'verbatim',
    stem: 'raw',
    open: 'compound',
    page_break: 'empty',
    pass: 'raw',
    thematic_break: 'empty',
    video: 'empty',
  },
  {
    get: (target, key) => (Object.hasOwn(target, key) ? target[key] : 'simple'),
  }
);

/**
 * Methods for managing AsciiDoc content blocks.
 */
class Block extends AbstractBlock {
  /** @type {string[]} */
  lines
  /** @type {string[]|null} */
  defaultSubs

  /**
   * Factory method — mirrors the core Block.create(parent, context, opts) API.
   * @param {AbstractBlock} parent
   * @param {string} context
   * @param {Object} [opts={}]
   * @returns {Block}
   */
  static create(parent, context, opts = {}) {
    return new Block(parent, context, opts)
  }

  /**
   * Initialize an Asciidoctor::Block object.
   * @param {AbstractBlock} parent - The parent AbstractBlock.
   * @param {string} context - The context name (e.g. 'paragraph', 'listing').
   * @param {Object} [opts={}]
   * @param {'compound'|'simple'|'verbatim'|'raw'|'empty'} [opts.content_model] - Defaults to lookup from DEFAULT_CONTENT_MODEL.
   * @param {Object} [opts.attributes] - Attributes to merge in.
   * @param {string|string[]} [opts.source] - Raw source string or lines.
   * @param {'default'|string[]|string|null} [opts.subs]
   * @param {string[]} [opts.default_subs] - Override for default subs (used with subs: 'default').
   */
  constructor(parent, context, opts = {}) {
    super(parent, context, opts);
    this.contentModel = opts.content_model ?? DEFAULT_CONTENT_MODEL[context];

    if ('subs' in opts) {
      const subs = opts.subs;
      if (subs) {
        if (subs === 'default') {
          // subs attribute is honored; falls back to opts.default_subs then built-in defaults
          this.defaultSubs = opts.default_subs ?? null;
        } else if (Array.isArray(subs)) {
          // subs attribute is not honored; use provided array directly
          this.defaultSubs = [...subs];
          delete this.attributes.subs;
        } else {
          // e.g. subs: 'normal' — subs attribute is not honored
          this.defaultSubs = null;
          this.attributes.subs = String(subs);
        }
        // Resolve subs eagerly when subs option is specified
        this.commitSubs();
      } else {
        // subs: null/[] — lock subs as empty; subsequent commitSubs() calls are no-ops
        this.defaultSubs = [];
        delete this.attributes.subs;
      }
    } else {
      // Defer subs resolution; subs attribute will be honored later
      this.defaultSubs = null;
    }

    const rawSource = opts.source;
    if (!rawSource && rawSource !== 0) {
      this.lines = [];
    } else if (typeof rawSource === 'string') {
      this.lines = prepareSourceString(rawSource);
    } else {
      this.lines = [...rawSource];
    }
  }

  /** @returns {string} Alias for context — consistent with AsciiDoc terminology. */
  get blockname() {
    return this.context
  }

  /**
   * Get the converted result appropriate to this block's content model.
   * @returns {Promise<string|null>}
   */
  async content() {
    switch (this.contentModel) {
      case 'compound':
        return super.content()
      case 'simple':
        return this.applySubs(this.lines.join(LF$1), this.subs)
      case 'verbatim':
      case 'raw': {
        const result = await this.applySubs(this.lines, this.subs);
        if (result.length < 2) return result[0] ?? ''
        while (result.length > 0 && result[0].trimEnd() === '') result.shift();
        while (result.length > 0 && result[result.length - 1].trimEnd() === '')
          result.pop();
        return result.join(LF$1)
      }
      default:
        if (this.contentModel !== 'empty') {
          this.logger.warn(
            `unknown content model '${this.contentModel}' for block: ${this}`
          );
        }
        return null
    }
  }

  /** @returns {string[]} The source lines for this block (matches the core API). */
  getSourceLines() {
    return this.lines
  }

  /** @returns {string} The preprocessed source of this block as a single String. */
  get source() {
    return this.lines.join(LF$1)
  }

  /** @returns {string} The source as a single String (alias for the source getter). */
  getSource() {
    return this.source
  }

  // ── JavaScript-style accessors ────────────────────────────────────────────────

  /**
   * Get the block name (alias for context).
   * @returns {string}
   */
  getBlockName() {
    return this.blockname
  }

  toString() {
    const contentSummary =
      this.contentModel === 'compound'
        ? `blocks: ${this.blocks.length}`
        : `lines: ${this.lines.length}`;
    return `#<Block {context: '${this.context}', content_model: '${this.contentModel}', style: ${JSON.stringify(this.style ?? null)}, ${contentSummary}}>`
  }
}

// ESM conversion of list.rb


/**
 * @extends {AbstractBlock<any[]>}
 */
class List extends AbstractBlock {
  constructor(parent, context, opts = {}) {
    super(parent, context, opts);
  }

  /** Alias for blocks — the list content. */
  async content() {
    return this.blocks
  }

  /**
   * Alias for {@link getItems}.
   * @returns {ListItem[]}
   * @see {getItems}
   */
  get items() {
    return this.blocks
  }

  /**
   * Check whether this list has items (blocks).
   * @returns {boolean}
   */
  hasItems() {
    return this.blocks.length > 0
  }

  /**
   * Check whether this list is an outline list (unordered or ordered).
   * @returns {boolean}
   */
  outline() {
    return this.context === 'ulist' || this.context === 'olist'
  }

  /**
   * Convert this list, advancing the callout list pointer if a colist.
   * @returns {Promise<string>}
   */
  async convert() {
    const result = await super.convert();
    if (this.context === 'colist') this.document.callouts.nextList();
    return result
  }

  /**
   * @deprecated Use {@link convert} instead.
   */
  render() {
    return this.convert()
  }

  // ── JavaScript-style accessors ────────────────────────────────────────────────

  /**
   * Return the list items.
   * @returns {ListItem[]}
   */
  getItems() {
    return this.blocks
  }

  toString() {
    return `#<List {context: '${this.context}', style: ${JSON.stringify(this.style ?? null)}, items: ${this.blocks.length}}>`
  }
}

/**
 * Methods for managing items for AsciiDoc olists, ulists, and dlists.
 *
 * In a description list (dlist), each item is a tuple: `[[term, term, ...], desc]`.
 * If a description is not set, the second entry is null.
 */
class ListItem extends AbstractBlock {
  /**
   * The string marker used for this list item.
   * @type {string|null}
   */
  marker

  /** @internal @type {string|null} */
  _text

  /** @internal */
  _convertedText

  /** @internal @type {string[]} */
  _subsSnapshot

  /**
   * @param {List} parent - The parent List block.
   * @param {string|null} [text=null] - The text of this item.
   */
  constructor(parent, text = null) {
    super(parent, 'list_item');
    this._text = text;
    this.level = parent.level;
    this.subs = [...NORMAL_SUBS];
    this.marker = null;
  }

  /**
   * Contextual alias for parent.
   * @see {getParent}
   */
  get list() {
    return this.getParent()
  }

  /**
   * Alias for {@link getText}.
   * @see {getText}
   */
  get text() {
    if (this._convertedText != null && this._subsSnapshot != null) {
      const cur = this.subs;
      if (
        cur.length !== this._subsSnapshot.length ||
        cur.some((s, i) => s !== this._subsSnapshot[i])
      ) {
        return this._text ?? null
      }
    }
    return this._convertedText ?? this._text ?? null
  }

  /**
   * Alias for {@link setText}.
   * @see {setText}
   */
  set text(val) {
    this._text = val;
    this._convertedText = null;
    this._subsSnapshot = null;
  }

  /**
   * Check whether the text of this list item is non-blank.
   * @returns {boolean}
   */
  hasText() {
    return !!(this._text && this._text.length > 0)
  }

  /**
   * Pre-compute the converted text asynchronously.
   * Called during `Document.parse()` so the synchronous getter works during conversion.
   * @returns {Promise<void>}
   */
  async precomputeText() {
    if (this._text != null && this._convertedText == null) {
      this._convertedText = await this.applySubs(this._text, this.subs);
      this._subsSnapshot = [...this.subs];
    }
  }

  /**
   * Check whether this list item has simple content.
   * @returns {boolean} `true` if the item has no blocks or only a single nested outline list.
   */
  simple() {
    return (
      this.blocks.length === 0 ||
      (this.blocks.length === 1 &&
        this.blocks[0] instanceof List &&
        this.blocks[0].outline())
    )
  }

  /**
   * Check whether this list item has compound content.
   * @returns {boolean} `true` if the item contains blocks other than a single nested outline list.
   */
  compound() {
    return !this.simple()
  }

  /** @internal Fold the adjacent paragraph block into the list item text. */
  foldFirst() {
    const src = this.blocks.shift().source;
    this._text =
      !this._text || this._text.length === 0 ? src : `${this._text}${LF$1}${src}`;
  }

  // ── JavaScript-style accessors ────────────────────────────────────────────────

  /**
   * Return the parent List block (alias of {@link getParent}).
   * @returns {List}
   * @see {getParent}
   */
  getList() {
    return this.list
  }

  /**
   * Return the list marker string for this item (e.g. '.', '..', '*').
   * @returns {string|null}
   */
  getMarker() {
    return this.marker
  }

  /**
   * Return the text of this list item with substitutions applied.
   * The result is pre-computed during `Document.parse()` via {@link precomputeText}.
   * Falls back to the raw text if {@link precomputeText} has not been called yet.
   *
   * In Ruby, text is lazy (`apply_subs` on first access), so API callers can modify
   * subs before accessing text and get the result they expect. Here we replicate
   * that by invalidating the pre-computed value when subs have changed since it
   * was computed: returning raw text mirrors what Ruby would produce when subs are
   * cleared or reduced to a no-op set (since `applySubs` is async and cannot be
   * re-run synchronously).
   * @returns {string|null}
   */
  getText() {
    return this.text
  }

  /**
   * Set the raw text of this list item.
   * @param {string|null} val
   */
  setText(val) {
    this.text = val;
  }

  toString() {
    return `#<ListItem {list_context: '${this.getParent().context}', text: ${JSON.stringify(this._text)}, blocks: ${(this.blocks ?? []).length}}>`
  }
}

// ESM conversion of table.rb
//
// Ruby-to-JavaScript notes:
//   - Table::Rows#[] (alias for send) → explicit bySection/head/foot/body access.
//   - Table::Cell references Document, PreprocessorReader, Parser — these are
//     imported lazily (dynamic import) to avoid circular dependency issues.
//   - String#squeeze(ch) → replaceAll(ch+ch, ch) loop (only used for '"').
//   - Number#truncate(precision) → Math.trunc(n * 10^p) / 10^p.
//   - :asciidoc / :literal / :header symbols → strings 'asciidoc', 'literal', 'header'.


/**
 * Truncate a float to `precision` decimal places (like Ruby's Float#truncate).
 * @param {number} value
 * @param {number} precision
 * @returns {number}
 * @internal
 */
function truncate(value, precision) {
  const factor = 10 ** precision;
  return Math.trunc(value * factor) / factor
}

/**
 * Collapse consecutive identical characters (like Ruby's String#squeeze(q)).
 * @param {string} str
 * @param {string} ch
 * @returns {string}
 * @internal
 */
function squeezeChar(str, ch) {
  const double = ch + ch;
  while (str.includes(double)) str = str.replaceAll(double, ch);
  return str
}

const DEFAULT_PRECISION = 4;

// ── Table ─────────────────────────────────────────────────────────────────────

class Table extends AbstractBlock {
  constructor(parent, attributes) {
    super(parent, 'table');
    this.rows = new Table.Rows();
    this.columns = [];
    this.hasHeaderOption = false;

    // Resolve tablepcwidth from 'width' attribute
    let pcwidthIntval = 100;
    const pcwidth = attributes.width;
    if (pcwidth != null) {
      let v = parseInt(pcwidth, 10);
      if (Number.isNaN(v)) v = 0;
      if (v > 100 || v < 1) {
        if (!(v === 0 && (pcwidth === '0' || pcwidth === '0%'))) v = 100;
      }
      pcwidthIntval = v;
    }
    this.attributes.tablepcwidth = pcwidthIntval;

    const pagewidthAttr = this.document.attributes.pagewidth;
    if (pagewidthAttr != null) {
      const abswidthVal = truncate(
        (pcwidthIntval / 100.0) * parseFloat(pagewidthAttr),
        DEFAULT_PRECISION
      );
      this.attributes.tableabswidth =
        abswidthVal === Math.trunc(abswidthVal)
          ? Math.trunc(abswidthVal)
          : abswidthVal;
    }

    if ('rotate-option' in attributes) this.attributes.orientation = 'landscape';
  }

  /**
   * Returns the header option state if the row being processed is the header row, otherwise false.
   * @returns {boolean|string}
   * @internal
   */
  headerRow() {
    const val = this.hasHeaderOption;
    return val && this.rows.body.length === 0 ? val : false
  }

  /**
   * Create Column objects from the column test array.
   * @param {Object[]} colspecs
   * @internal
   */
  createColumns(colspecs) {
    const cols = [];
    let autowidthCols = null;
    let widthBase = 0;
    for (const colspec of colspecs) {
      const colwidth = colspec.width;
      cols.push(new Table.Column(this, cols.length, colspec));
      if (colwidth < 0) {
(autowidthCols ??= []).push(cols[cols.length - 1]);
      } else {
        widthBase += colwidth;
      }
    }
    this.columns = cols;
    const numCols = cols.length;
    if (numCols > 0) {
      this.attributes.colcount = numCols;
      const effectiveWidthBase =
        widthBase > 0 || autowidthCols ? widthBase : null;
      this.assignColumnWidths(effectiveWidthBase, autowidthCols);
    }
  }

  /**
   * Assign percentage (and absolute) widths to all columns.
   * @param {number|null} [widthBase=null]
   * @param {Table.Column[]|null} [autowidthCols=null]
   * @internal
   */
  assignColumnWidths(widthBase = null, autowidthCols = null) {
    const precision = DEFAULT_PRECISION;
    let totalWidth = 0;
    let colPcwidth = 0;

    if (widthBase != null) {
      if (autowidthCols) {
        let autowidth;
        if (widthBase > 100) {
          autowidth = 0;
          this.logger.warn(
            `total column width must not exceed 100% when using autowidth columns; got ${widthBase}%`
          );
        } else {
          autowidth = truncate(
            (100.0 - widthBase) / autowidthCols.length,
            precision
          );
          if (Math.trunc(autowidth) === autowidth)
            autowidth = Math.trunc(autowidth);
          widthBase = 100;
        }
        const autowAttrs = { width: autowidth, 'autowidth-option': '' };
        for (const col of autowidthCols) col.updateAttributes(autowAttrs);
      }
      for (const col of this.columns) {
        totalWidth += colPcwidth = col.assignWidth(null, widthBase, precision);
      }
    } else {
      colPcwidth = truncate(100.0 / this.columns.length, precision);
      if (Math.trunc(colPcwidth) === colPcwidth)
        colPcwidth = Math.trunc(colPcwidth);
      for (const col of this.columns) {
        totalWidth += col.assignWidth(colPcwidth, null, precision);
      }
    }

    // Donate balance to the last column (half-up rounding)
    if (totalWidth !== 100) {
      const balance = +(100 - totalWidth + colPcwidth).toFixed(precision);
      this.columns[this.columns.length - 1].assignWidth(
        balance,
        null,
        precision
      );
    }
  }

  /**
   * Partition rows into header, footer, and body.
   * @param {Object} attrs
   * @internal
   */
  async partitionHeaderFooter(attrs) {
    const body = this.rows.body;
    let numBodyRows = (this.attributes.rowcount = body.length);

    if (numBodyRows > 0) {
      if (this.hasHeaderOption === true) {
        this.rows.head = [
          await Promise.all(
            body.shift().map((cell) => cell.reinitialize(true))
          ),
        ];
        numBodyRows--;
      } else if (this.hasHeaderOption === null) {
        this.hasHeaderOption = false;
        body.unshift(
          await Promise.all(
            body.shift().map((cell) => cell.reinitialize(false))
          )
        );
      }
    }

    if (numBodyRows > 0 && 'footer-option' in attrs) {
      this.rows.foot = [body.pop()];
    }
  }
}

// ── Table.Rows ────────────────────────────────────────────────────────────────

Table.Rows = class Rows {
  constructor(head = [], foot = [], body = []) {
    this.head = head;
    this.foot = foot;
    this.body = body;
  }

  /**
   * Retrieve the rows grouped by section as a nested Array.
   * @returns {Array<[string, Array]>}
   */
  bySection() {
    return [
      ['head', this.head],
      ['body', this.body],
      ['foot', this.foot],
    ]
  }

  toObject() {
    return { head: this.head, body: this.body, foot: this.foot }
  }
};

// ── Table.Column ──────────────────────────────────────────────────────────────

Table.Column = class Column extends AbstractNode {
  constructor(table, index, attributes = {}) {
    super(table, 'table_column');
    this.style = attributes.style ?? null;
    attributes.colnumber = index + 1;
    if (!('width' in attributes)) attributes.width = 1;
    if (!('halign' in attributes)) attributes.halign = 'left';
    if (!('valign' in attributes)) attributes.valign = 'top';
    this.updateAttributes(attributes);
  }

  /** Alias for parent (always a Table). */
  get table() {
    return this.getParent()
  }

  /**
   * Calculate and assign the widths for this column.
   * @param {number|null} colPcwidth
   * @param {number|null} widthBase
   * @param {number} precision
   * @returns {number} The resolved colpcwidth value.
   * @internal
   */
  assignWidth(colPcwidth, widthBase, precision) {
    if (widthBase != null) {
      colPcwidth = truncate(
        (parseFloat(this.attributes.width) * 100.0) / widthBase,
        precision
      );
      if (Math.trunc(colPcwidth) === colPcwidth)
        colPcwidth = Math.trunc(colPcwidth);
    }
    const tableAbswidth = this.getParent().attributes.tableabswidth;
    if (tableAbswidth != null) {
      const colAbswidth = truncate(
        (colPcwidth / 100.0) * tableAbswidth,
        precision
      );
      this.attributes.colabswidth =
        colAbswidth === Math.trunc(colAbswidth)
          ? Math.trunc(colAbswidth)
          : colAbswidth;
    }
    this.attributes.colpcwidth = colPcwidth;
    return colPcwidth
  }

  isBlock() {
    return false
  }
  isInline() {
    return false
  }

  // ── JavaScript-style accessors ────────────────────────────────────────────────

  /**
   * Get the parent table of this column.
   * @returns {Table}
   */
  getTable() {
    return this.table
  }
};

// ── Table.Cell ────────────────────────────────────────────────────────────────

/** @extends {AbstractBlock<string | string[]>} */
class Cell extends AbstractBlock {
  static get DOUBLE_LF() {
    return LF$1 + LF$1
  }

  /** @internal */
  _reinitializeArgs

  /** @internal */
  _innerDocSetup

  /** @internal */
  _subs

  /** @internal */
  _text

  /** @internal */
  _cellbgcolor

  /** @internal */
  _convertedText

  constructor(column, cellText, attributes = {}, opts = {}) {
    super(column, 'table_cell');
    this._cursor = null;
    this._reinitializeArgs = null;
    if (this.document.sourcemap && opts.cursor) {
      this.sourceLocation = Object.assign({}, opts.cursor);
    }

    let cellStyle = null;
    let inHeaderRow = false;
    let asciidoc = false;
    let literal = false;
    let normalPsv = false;
    let innerDocumentCursor = null;

    if (column) {
      inHeaderRow = column.table.headerRow();
      if (inHeaderRow) {
        if (inHeaderRow === 'implicit') {
          const cs = column.style ?? attributes?.style;
          if (cs === 'asciidoc' || cs === 'literal') {
            this._reinitializeArgs = [
              column,
              cellText,
              attributes && { ...attributes },
              opts,
            ];
          }
          cellStyle = null;
        }
        // else: don't set cellStyle from column for header row
      } else {
        cellStyle = column.style ?? null;
      }
      // Inherit column attributes
      this.updateAttributes(column.attributes);
    }

    if (attributes != null) {
      if (Object.keys(attributes).length === 0) {
        this.colspan = null;
        this.rowspan = null;
      } else {
        this.colspan = attributes.colspan
          ? parseInt(attributes.colspan, 10)
          : null;
        this.rowspan = attributes.rowspan
          ? parseInt(attributes.rowspan, 10)
          : null;
        delete attributes.colspan;
        delete attributes.rowspan;
        if (!inHeaderRow) cellStyle = attributes.style ?? cellStyle;
        this.updateAttributes(attributes);
      }

      switch (cellStyle) {
        case 'asciidoc': {
          asciidoc = true;
          innerDocumentCursor = opts.cursor;
          cellText = cellText.trimEnd();
          if (cellText.startsWith(LF$1)) {
            let linesAdvanced = 0;
            while (cellText.startsWith(LF$1)) {
              cellText = cellText.slice(1);
              linesAdvanced++;
            }
            if (
              innerDocumentCursor &&
              typeof innerDocumentCursor.advance === 'function'
            ) {
              innerDocumentCursor.advance(linesAdvanced);
            }
          } else {
            cellText = cellText.trimStart();
          }
          break
        }
        case 'literal':
          literal = true;
          cellText = cellText.trimEnd();
          while (cellText.startsWith(LF$1)) cellText = cellText.slice(1);
          break
        default:
          normalPsv = true;
          cellText = cellText != null ? cellText.trim() : '';
      }
    } else {
      this.colspan = null;
      this.rowspan = null;
      if (cellStyle === 'asciidoc') asciidoc = true;
    }

    if (asciidoc) {
      const parentDoc = this.document;
      // Store the setup data for create() to handle asynchronously.
      this._innerDocSetup = {
        lines: cellText.split(LF$1, -1),
        parentDoc,
        parentDoctitle: parentDoc.attributes.doctitle,
        options: {
          safe: parentDoc.safe,
          backend: parentDoc.backend,
          header_footer: false,
          parent: parentDoc,
          cursor: innerDocumentCursor,
        },
      };
      delete parentDoc.attributes.doctitle;
      this._subs = null;
    } else if (literal) {
      this.contentModel = 'verbatim';
      this._subs = [...BASIC_SUBS];
    } else {
      if (normalPsv) {
        if (inHeaderRow) {
          this._cursor = opts.cursor ?? null;
        } else {
          this._catalogInlineAnchor(cellText, opts.cursor);
        }
      }
      this.contentModel = 'simple';
      this._subs = [...NORMAL_SUBS];
    }
    this._text = cellText;
    this.style = cellStyle;
  }

  /** Alias for parent (always a Column). */
  get column() {
    return this.getParent()
  }

  /**
   * Factory — create and fully initialize a Cell asynchronously.
   * For AsciiDoc cells, parses the nested document.
   *
   * NOTE: _innerContent is NOT pre-computed here. Document.convert() will call
   * _convertAsciiDocCells() after parse completes (so callouts are rewound and
   * all cross-references from the parent document are already registered).
   * @param {Table.Column} column
   * @param {string} cellText
   * @param {Object} [attributes={}]
   * @param {Object} [opts={}]
   * @returns {Promise<Table.Cell>}
   */
  static async create(column, cellText, attributes = {}, opts = {}) {
    const cell = new Table.Cell(column, cellText, attributes, opts);
    if (cell._innerDocSetup) {
      const { lines, parentDoc, parentDoctitle, options } = cell._innerDocSetup;
      cell._innerDocSetup = null;
      // If the first line may be a preprocessor directive (include, ifdef…), expand it using a
      // temporary PreprocessorReader — matching the Ruby behaviour in table.rb.
      if (lines.length > 0 && lines[0].includes('::')) {
        const firstLine = lines[0];
        const tmpReader = new PreprocessorReader(
          parentDoc,
          [firstLine],
          options.cursor
        );
        const preprocessedLines = await tmpReader.readLines();
        if (
          !(
            preprocessedLines.length === 1 && preprocessedLines[0] === firstLine
          )
        ) {
          lines.shift();
          if (preprocessedLines.length > 0) lines.unshift(...preprocessedLines);
        }
      }
      const innerDoc = await parentDoc.constructor.create(lines, options);
      if (parentDoctitle) parentDoc.attributes.doctitle = parentDoctitle;
      cell._innerDocument = innerDoc;
    }
    return /** @type {Table.Cell} */ cell
  }

  /** @returns {Promise<Table.Cell>} */
  async reinitialize(hasHeader) {
    if (hasHeader) {
      this._reinitializeArgs = null;
    } else if (this._reinitializeArgs) {
      return Table.Cell.create(...this._reinitializeArgs)
    } else {
      this.style = this.attributes.style ?? null;
    }
    if (this._cursor) this._catalogInlineAnchor();
    return /** @type {Table.Cell} */ (this)
  }

  _catalogInlineAnchor(cellText = this._text, cursor = null) {
    if (!cursor) {
      cursor = this._cursor;
      this._cursor = null;
    }
    if (!cellText.startsWith('[[')) return
    const m = cellText.match(LeadingInlineAnchorRx);
    if (!m) return
    const doc = this.document;
    let reftext = m[2] ?? null;
    if (reftext?.includes(ATTR_REF_HEAD)) reftext = doc.subAttributes(reftext);
    doc.register('refs', [
      m[1],
      new Inline(this, 'anchor', reftext, { type: 'ref', id: m[1] }),
    ]);
  }

  /**
   * Get the text with substitutions applied.
   * The result is pre-computed during Document.parse() via precomputeText().
   * Falls back to the raw text if precomputeText() has not been called yet.
   * @returns {string|null}
   */
  get text() {
    return this._convertedText ?? this._text ?? null
  }

  /**
   * Pre-compute the converted text asynchronously.
   * Called during Document.parse() so the synchronous getter works during conversion.
   * @returns {Promise<void>}
   */
  async precomputeText() {
    if (this._subs && this._convertedText == null) {
      this._convertedText = await this.applySubs(this._text, this._subs);
      // Capture the cellbgcolor attribute value as set by {set:cellbgcolor:...} in cell text.
      // Since {set:...} attribute assignments happen during applySubs, and the document attribute
      // is shared state, we must capture it per-cell immediately after text processing.
      this._cellbgcolor = this.document.attributes.cellbgcolor;
    }
  }

  set text(val) {
    this._text = val;
    this._convertedText = null;
  }

  /**
   * Get the content — converted body data.
   * For AsciiDoc cells, returns the pre-computed content (set by Document.convert()).
   * @returns {Promise<string|string[]>}
   */
  async content() {
    if (this.style === 'asciidoc') {
      return this._innerContent ?? ''
    }
    if (this._text.includes(Table.Cell.DOUBLE_LF)) {
      const parts = [];
      for (const rawPara of this.text.split(BlankLineRx)) {
        const para = rawPara.trim();
        if (!para) continue
        const cs = this.style;
        parts.push(
          cs && cs !== 'header'
            ? await new Inline(this.getParent(), 'quoted', para, {
                type: cs,
              }).convert()
            : para
        );
      }
      return parts
    }
    const subbedText = this.text;
    if (!subbedText) return []
    const cs = this.style;
    if (cs && cs !== 'header') {
      return [
        await new Inline(this.getParent(), 'quoted', subbedText, {
          type: cs,
        }).convert(),
      ]
    }
    return [subbedText]
  }

  lines() {
    return this._text.split(LF$1)
  }
  source() {
    return this._text
  }

  get innerDocument() {
    return this._innerDocument ?? null
  }

  get file() {
    return this.sourceLocation?.file ?? null
  }
  get lineno() {
    return this.sourceLocation?.lineno ?? null
  }

  toString() {
    return `${super.toString()} - [text: ${this._text}, colspan: ${this.colspan ?? 1}, rowspan: ${this.rowspan ?? 1}, attributes: ${JSON.stringify(this.attributes)}]`
  }

  // ── JavaScript-style accessors ────────────────────────────────────────────────

  /**
   * Get the text with substitutions applied.
   * @returns {string|null}
   */
  getText() {
    return this.text
  }

  /**
   * Set the raw text of this cell.
   * @param {string|null} val
   */
  setText(val) {
    this.text = val;
  }

  /**
   * Get the inner document for AsciiDoc-style cells.
   * @returns {Document|null}
   */
  getInnerDocument() {
    return this.innerDocument
  }

  /**
   * Get the source file where this cell is defined.
   * @returns {string|null}
   */
  getFile() {
    return this.file
  }

  /**
   * Get the source line number where this cell is defined.
   * @returns {number|null}
   */
  getLineNumber() {
    return this.lineno
  }
}
Table.Cell = Cell;

// ── Table.ParserContext ───────────────────────────────────────────────────────

Table.ParserContext = class ParserContext {
  static get FORMATS() {
    return new Set(['psv', 'csv', 'dsv', 'tsv'])
  }

  static get DELIMITERS() {
    return {
      psv: ['|', /\|/],
      csv: [',', /,/],
      dsv: [':', /:/],
      tsv: ['\t', /\t/],
      '!sv': ['!', /!/],
    }
  }

  constructor(reader, table, attributes = {}) {
    this._reader = reader;
    this._startCursor = reader.cursor;
    reader.mark();
    this.table = table;
    this.buffer = '';

    // Determine format
    let xsv;
    if ('format' in attributes) {
      xsv = attributes.format;
      if (ParserContext.FORMATS.has(xsv)) {
        if (xsv === 'tsv') {
          this.format = 'csv';
        } else {
          this.format = xsv;
          if (xsv === 'psv' && table.document.nested()) xsv = '!sv';
        }
      } else {
        this.logger.error(
          this.messageWithContext(`illegal table format: ${xsv}`, {
            source_location: reader.cursorAtPrevLine(),
          })
        );
        this.format = 'psv';
        xsv = table.document.nested() ? '!sv' : 'psv';
      }
    } else {
      this.format = 'psv';
      xsv = table.document.nested() ? '!sv' : 'psv';
    }

    // Determine delimiter
    const delimiters = ParserContext.DELIMITERS;
    if ('separator' in attributes) {
      const sep = attributes.separator;
      if (!sep) {
[this.delimiter, this.delimiterRe] = delimiters[xsv];
      } else if (sep === '\\t') {
[this.delimiter, this.delimiterRe] = delimiters.tsv;
      } else {
        this.delimiter = sep;
        this.delimiterRe = new RegExp(
          sep.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        );
      }
    } else {
[this.delimiter, this.delimiterRe] = delimiters[xsv];
    }

    this.colcount = table.columns.length === 0 ? -1 : table.columns.length;
    this._cellspecs = [];
    this._cellOpen = false;
    this._activeRowspans = [0];
    this._columnVisits = 0;
    this._currentRow = [];
    this._linenum = -1;
  }

  startsWith(line) {
    return line.startsWith(this.delimiter)
  }

  matchDelimiter(line) {
    return line.match(this.delimiterRe)
  }

  skipPastDelimiter(pre) {
    this.buffer = `${this.buffer}${pre}${this.delimiter}`;
  }

  skipPastEscapedDelimiter(pre) {
    this.buffer = `${this.buffer}${pre.slice(0, -1)}${this.delimiter}`;
  }

  bufferHasUnclosedQuotesInText(text, q = '"') {
    let record = text.trim();
    if (record === q) return true
    if (!record.startsWith(q)) return false
    const qq = q + q;
    const trailingQuote = record.endsWith(q);
    if ((trailingQuote && record.endsWith(qq)) || record.startsWith(qq)) {
      record = squeezeChar(record, q);
      return record.startsWith(q) && !record.endsWith(q)
    }
    return !trailingQuote
  }

  bufferHasUnclosedQuotes(append = null, q = '"') {
    const record = (append ? this.buffer + append : this.buffer).trim();
    if (!record.startsWith(q)) return false
    // Walk the quoted field character by character (RFC 4180)
    let i = 1; // skip the opening quote
    while (i < record.length) {
      if (record[i] === q) {
        if (i + 1 < record.length && record[i + 1] === q) {
          i += 2; // escaped quote ""
        } else {
          return false // closing quote found → field is closed
        }
      } else {
        i++;
      }
    }
    return true // closing quote never found
  }

  takeCellspec() {
    return this._cellspecs.shift() ?? null
  }

  pushCellspec(cellspec = {}) {
    this._cellspecs.push(cellspec ?? {});
  }

  keepCellOpen() {
    this._cellOpen = true;
  }
  markCellClosed() {
    this._cellOpen = false;
  }
  isCellOpen() {
    return this._cellOpen
  }
  isCellClosed() {
    return !this._cellOpen
  }

  async closeOpenCell(nextCellspec = {}) {
    this.pushCellspec(nextCellspec);
    if (this.isCellOpen()) await this.closeCell(true);
    this._advance();
  }

  async closeCell(eol = false) {
    let cellText, cellspec, repeat;

    if (this.format === 'psv') {
      cellText = this.buffer;
      this.buffer = '';
      cellspec = this.takeCellspec();
      if (cellspec) {
        repeat = cellspec.repeatcol ?? 1;
        delete cellspec.repeatcol;
      } else {
        this.logger.error(
          this.messageWithContext(
            'table missing leading separator; recovering automatically',
            {
              source_location: this._startCursor,
            }
          )
        );
        cellspec = {};
        repeat = 1;
      }
    } else {
      cellText = this.buffer.trim();
      this.buffer = '';
      cellspec = null;
      repeat = 1;
      if (this.format === 'csv' && cellText && cellText.includes('"')) {
        const q = '"';
        if (cellText.startsWith(q)) {
          if (
            cellText.length > 1 &&
            cellText.endsWith(q) &&
            !this.bufferHasUnclosedQuotesInText(cellText, q)
          ) {
            const inner = cellText.slice(1, cellText.length - 1);
            cellText = squeezeChar(inner.trim(), q);
          } else {
            this.logger.error(
              this.messageWithContext(
                'unclosed quote in CSV data; setting cell to empty',
                {
                  source_location: this._reader.cursorAtPrevLine(),
                }
              )
            );
            cellText = '';
          }
        } else {
          cellText = squeezeChar(cellText, '"');
        }
      }
    }

    for (let i = 1; i <= repeat; i++) {
      let column;
      if (this.colcount === -1) {
        this.table.columns.push(
          (column = new Table.Column(
            this.table,
            this.table.columns.length + i - 1
          ))
        );
        if (cellspec && 'colspan' in cellspec) {
          const extraCols = parseInt(cellspec.colspan, 10) - 1;
          if (extraCols > 0) {
            const offset = this.table.columns.length;
            for (let j = 0; j < extraCols; j++) {
              this.table.columns.push(new Table.Column(this.table, offset + j));
            }
          }
        }
      } else {
        column = this.table.columns[this._currentRow.length] ?? null;
      }

      const cursorBeforeMark = this._reader.cursorBeforeMark();
      this._reader.mark();
      const cell = await Table.Cell.create(column, cellText, cellspec, {
        cursor: cursorBeforeMark,
      });

      if (cell.rowspan && cell.rowspan !== 1) {
        this._activateRowspan(cell.rowspan, cell.colspan ?? 1);
      }
      this._columnVisits += cell.colspan ?? 1;
      this._currentRow.push(cell);

      const rowStatus = this._endOfRow();
      if (
        rowStatus > -1 &&
        (this.colcount !== -1 || this._linenum > 0 || (eol && i === repeat))
      ) {
        if (rowStatus > 0) {
          this.logger.error(
            this.messageWithContext(
              'dropping cell because it exceeds specified number of columns',
              { source_location: cursorBeforeMark }
            )
          );
          this._closeRow(true);
        } else {
          this._closeRow();
        }
      }
    }
    this._cellOpen = false;
  }

  closeTable() {
    if (this._columnVisits === 0) return
    this.logger.error(
      this.messageWithContext(
        'dropping cells from incomplete row detected end of table',
        {
          source_location: this._reader.cursorBeforeMark(),
        }
      )
    );
  }

  /**
   * @param {boolean} [drop=false]
   * @internal
   */
  _closeRow(drop = false) {
    if (!drop) this.table.rows.body.push(this._currentRow);
    if (this.colcount === -1) this.colcount = this._columnVisits;
    this._columnVisits = 0;
    this._currentRow = [];
    this._activeRowspans.shift();
    this._activeRowspans[0] ??= 0;
  }

  _activateRowspan(rowspan, colspan) {
    for (let i = 1; i < rowspan; i++) {
      this._activeRowspans[i] = (this._activeRowspans[i] ?? 0) + colspan;
    }
  }

  _endOfRow() {
    if (this.colcount === -1) return 0
    const eff = this._columnVisits + (this._activeRowspans[0] ?? 0);
    if (eff < this.colcount) return -1
    if (eff === this.colcount) return 0
    return 1
  }

  _advance() {
    this._linenum++;
  }

  // ── Logging mixin ───────────────────────────────────────────────────────────
  // Declared here (in addition to being installed by applyLogging() below) so
  // that generated .d.ts declarations expose them — applyLogging() mutates the
  // prototype after the class body closes, which tsc's declaration emit can't see.

  /**
   * The logger for this parser context.
   * The Logging mixin (logging.js) overrides this getter on the prototype.
   * @returns {import('./logging.js').LoggerLike}
   */
  get logger() {
    return this.table?.document?.logger ?? LoggerManager.logger
  }

  /** @returns {import('./logging.js').LoggerLike} */
  getLogger() {
    return this.logger
  }

  /**
   * Build an auto-formatting log message that carries structured source_location
   * (rather than baking it into the text), for use with `this.logger.warn(...)`.
   * @param {string} text
   * @param {{source_location?: any, include_location?: any}} [context={}]
   * @returns {{text: string, source_location?: any, include_location?: any, inspect(): string, toString(): string}}
   */
  messageWithContext(text, context = {}) {
    return Logger.AutoFormattingMessage.attach({ text, ...context })
  }

  /** Alias for {@link messageWithContext} (used in extensions). */
  createLogMessage(text, context = {}) {
    return this.messageWithContext(text, context)
  }
};

applyLogging(Table.ParserContext.prototype);

// ESM conversion of attribute_list.rb
//
// Ruby-to-JavaScript notes:
//   - Ruby's StringScanner is reimplemented as the module-private StringScanner
//     class using JS sticky regexes (flag 'y'). The scanner caches a sticky
//     version of each RegExp on first use to avoid repeated RegExp construction.
//   - scan() returns null (not nil) on no-match; getByte() returns undefined at EOS.
//   - Ruby's boolean `false` return from parse_attribute (bare `return`) is
//     represented as `return false`.
//   - The `continue` local variable is renamed `shouldContinue` because `continue`
//     is a reserved word in JS.
//   - snake_case method names are converted to camelCase.
//   - Private methods/fields use the JS # prefix.
//   - block.apply_subs → block.applySubs (matches Substitutors mixin naming).


// ── Constants ─────────────────────────────────────────────────────────────────
const APOS = "'";
const BACKSLASH = '\\';
const QUOT = '"';

// Regular expressions for detecting the boundary of a value.
// These are passed to StringScanner which converts them to sticky variants.
const BoundaryRx = {
  [QUOT]: /.*?[^\\](?=")/,
  [APOS]: /.*?[^\\](?=')/,
  ',': /.*?(?=[ \t]*(,|$))/,
};

// Regular expressions for unescaping quoted characters.
const EscapedQuotes = {
  [QUOT]: '\\"',
  [APOS]: "\\'",
};

// Regular expressions for skipping delimiters.
const SkipRx = {
  ',': /[ \t]*(,|$)/,
};

// Attribute name: starts with a word character, followed by word chars or hyphens.
// Constructed with the 'u' flag so \p{…} Unicode properties work.
const NameRx = new RegExp(`${CG_WORD}[${CC_WORD}\\-]*`, 'u');

// Matches one or more horizontal whitespace characters.
const BlankRx = /[ \t]+/;

// ── StringScanner ─────────────────────────────────────────────────────────────
/**
 * A minimal port of Ruby's StringScanner, sufficient for AttributeList parsing.
 *
 * Differences from Ruby's StringScanner:
 * - getByte() returns undefined (not nil) at end of string.
 * - scan/skip return null/0 (not nil) on no match.
 * - Regexes are anchored at the current position via the sticky ('y') flag.
 *   A sticky copy is created once per regex and cached for reuse.
 * - unscan() reverts only the most recent getByte / scan / skip advance.
 */
class StringScanner {
  #source
  #pos = 0
  #lastMatchLen = 0
  #stickyCache = new Map()

  constructor(source) {
    this.#source = source;
  }

  /** @returns {string} The original source string (equivalent to Ruby scanner.string). */
  get source() {
    return this.#source
  }

  /** @returns {boolean} true when the scan pointer is at or past the end of the string. */
  eos() {
    return this.#pos >= this.#source.length
  }

  /**
   * @param {number} n
   * @returns {string} The next n characters without advancing the scan pointer.
   */
  peek(n) {
    return this.#source.slice(this.#pos, this.#pos + n)
  }

  /** @returns {string|undefined} The next character, or undefined at EOS. */
  getByte() {
    if (this.#pos >= this.#source.length) {
      this.#lastMatchLen = 0;
      return undefined
    }
    this.#lastMatchLen = 1;
    return this.#source[this.#pos++]
  }

  /** Reverts the most recent getByte / scan / skip advance. */
  unscan() {
    this.#pos -= this.#lastMatchLen;
    this.#lastMatchLen = 0;
  }

  /**
   * Advances past rx at the current position.
   * @param {RegExp} rx
   * @returns {number} The number of characters skipped, or 0 on no match.
   */
  skip(rx) {
    const m = this.#exec(rx);
    return m ? m[0].length : 0
  }

  /**
   * @param {RegExp} rx
   * @returns {string|null} The matched string at the current position, or null on no match.
   */
  scan(rx) {
    const m = this.#exec(rx);
    return m ? m[0] : null
  }

  /**
   * @param {RegExp} rx
   * @returns {RegExpExecArray|null}
   */
  #exec(rx) {
    let sticky = this.#stickyCache.get(rx);
    if (!sticky) {
      const flags = rx.flags.includes('y') ? rx.flags : `${rx.flags}y`;
      sticky = new RegExp(rx.source, flags);
      this.#stickyCache.set(rx, sticky);
    }
    sticky.lastIndex = this.#pos;
    const m = sticky.exec(this.#source);
    if (!m) {
      this.#lastMatchLen = 0;
      return null
    }
    this.#lastMatchLen = m[0].length;
    this.#pos += m[0].length;
    return m
  }
}

// ── AttributeList ─────────────────────────────────────────────────────────────

/**
 * Handles parsing AsciiDoc attribute lists into a plain object of key/value pairs.
 * By default, attributes must each be separated by a comma and quotes may be used
 * around the value. If a key is not detected, the value is assigned to a 1-based
 * positional key. Positional attributes can be "rekeyed" when given a positionalAttrs
 * array either during parsing or after.
 *
 * @example
 * const attrlist = new AttributeList('astyle')
 * await attrlist.parse()
 * // => { 1: 'astyle' }
 *
 * attrlist.rekey(['style'])
 * // => { 1: 'astyle', style: 'astyle' }
 *
 * @example
 * const attrlist2 = new AttributeList('quote, Famous Person, Famous Book (2001)')
 * await attrlist2.parse(['style', 'attribution', 'citetitle'])
 * // => { 1: 'quote', style: 'quote', 2: 'Famous Person', attribution: 'Famous Person',
 * //      3: 'Famous Book (2001)', citetitle: 'Famous Book (2001)' }
 */
class AttributeList {
  #scanner
  #block
  #delimiter
  #delimiterSkipPattern
  #delimiterBoundaryPattern
  #attributes = null

  constructor(source, block = null, delimiter = ',') {
    this.#scanner = new StringScanner(source);
    this.#block = block;
    this.#delimiter = delimiter;
    this.#delimiterSkipPattern = SkipRx[delimiter];
    this.#delimiterBoundaryPattern = BoundaryRx[delimiter];
  }

  /**
   * Parse the attribute list and merge the result into the given object.
   * @param {Object} attributes - The target plain object to update.
   * @param {string[]} [positionalAttrs=[]] - An array of keys to assign to positional values.
   * @returns {Promise<Object>} The updated attributes object.
   */
  async parseInto(attributes, positionalAttrs = []) {
    return Object.assign(attributes, await this.parse(positionalAttrs))
  }

  /**
   * Parse the attribute list and return a plain object of key/value pairs.
   * Subsequent calls return the already-parsed result without re-parsing.
   * @param {string[]} [positionalAttrs=[]] - An array of keys to assign to positional values.
   * @returns {Promise<Object>} A plain object of parsed attributes.
   */
  async parse(positionalAttrs = []) {
    if (this.#attributes) return this.#attributes
    this.#attributes = {};
    let index = 0;
    while (await this.#parseAttribute(index, positionalAttrs)) {
      if (this.#scanner.eos()) break
      this.#skipDelimiter();
      index++;
    }
    return this.#attributes
  }

  /**
   * Rekey the parsed positional attributes using the given key names.
   * @param {string[]} positionalAttrs - An array of keys to assign to positional values.
   * @returns {Object} The updated attributes object.
   */
  rekey(positionalAttrs) {
    return AttributeList.rekey(this.#attributes, positionalAttrs)
  }

  /**
   * Assign string keys to the positional (numeric-keyed) values of the given attributes object.
   * @param {Object} attributes - A plain object produced by parse().
   * @param {Array<string|null>} positionalAttrs - Keys to assign (null entries are skipped).
   * @returns {Object} The updated attributes object.
   */
  static rekey(attributes, positionalAttrs) {
    for (let i = 0; i < positionalAttrs.length; i++) {
      const key = positionalAttrs[i];
      if (key) {
        const val = attributes[i + 1];
        if (val != null) attributes[key] = val;
      }
    }
    return attributes
  }

  /**
   * @param {number} index
   * @param {string[]} positionalAttrs
   * @returns {Promise<boolean>} true to continue parsing, false to stop.
   */
  async #parseAttribute(index, positionalAttrs) {
    let shouldContinue = true;
    this.#skipBlank();
    const peeked = this.#scanner.peek(1);
    let name, value, singleQuoted;

    if (peeked === QUOT) {
      // example: "quote" || "foo
      name = this.#parseAttributeValue(this.#scanner.getByte());
    } else if (peeked === APOS) {
      // example: 'quote' || 'foo
      name = this.#parseAttributeValue(this.#scanner.getByte());
      if (!name.startsWith(APOS)) singleQuoted = true;
    } else {
      name = this.#scanName();
      const skipped = (name !== null && this.#skipBlank()) || 0;

      if (this.#scanner.eos()) {
        // Stop unless we have a name or the source ends with the delimiter
        if (!name && !this.#scanner.source.trimEnd().endsWith(this.#delimiter))
          return false
        // example: quote (at eos)
        shouldContinue = false;
      } else {
        const c = this.#scanner.getByte();
        if (c === this.#delimiter) {
          // example: quote,
          this.#scanner.unscan();
        } else if (name) {
          if (c === '=') {
            // example: foo=...
            this.#skipBlank();
            const c2 = this.#scanner.getByte();
            if (c2 === QUOT) {
              // example: foo="bar" || foo="ba\"zaar" || foo="bar
              value = this.#parseAttributeValue(c2);
            } else if (c2 === APOS) {
              // example: foo='bar' || foo='ba\'zaar' || foo='ba"zaar' || foo='bar
              value = this.#parseAttributeValue(c2);
              if (!value.startsWith(APOS)) singleQuoted = true;
            } else if (c2 === this.#delimiter) {
              // example: foo=,
              value = '';
              this.#scanner.unscan();
            } else if (c2 === undefined) {
              // example: foo= (at eos)
              value = '';
            } else {
              // example: foo=bar || foo=None
              value = `${c2}${this.#scanToDelimiter() ?? ''}`;
              if (value === 'None') return true
            }
          } else {
            // example: foo bar
            name = `${name}${' '.repeat(skipped)}${c}${this.#scanToDelimiter() ?? ''}`;
          }
        } else {
          // example: =foo= || !foo
          name = `${c}${this.#scanToDelimiter() ?? ''}`;
        }
      }
    }

    if (value !== undefined) {
      // Named attribute
      if (name === 'options' || name === 'opts') {
        // example: options="opt1,opt2,opt3" || opts="opt1,opt2,opt3"
        if (value.includes(',')) {
          if (value.includes(' ')) value = value.replace(/ /g, '');
          for (const opt of value.split(',')) {
            if (opt) this.#attributes[`${opt}-option`] = '';
          }
        } else if (value) {
          this.#attributes[`${value}-option`] = '';
        }
      } else if (singleQuoted && this.#block) {
        if (name === 'title' || name === 'reftext') {
          this.#attributes[name] = value;
        } else {
          this.#attributes[name] = await this.#block.applySubs(value);
        }
      } else {
        this.#attributes[name] = value;
      }
    } else {
      // Positional attribute
      if (singleQuoted && this.#block) {
        name = await this.#block.applySubs(name);
      }
      const positionalAttrName = positionalAttrs[index];
      if (positionalAttrName && name != null) {
        this.#attributes[positionalAttrName] = name;
      }
      // QUESTION should we assign the positional key even when claimed by a positional attribute?
      this.#attributes[index + 1] = name;
    }

    return shouldContinue
  }

  /**
   * @param {string} quote - The quote character that opened this value (QUOT or APOS).
   * @returns {string} The parsed value (unescaped, without surrounding quotes).
   */
  #parseAttributeValue(quote) {
    // empty quoted value: "" or ''
    if (this.#scanner.peek(1) === quote) {
      this.#scanner.getByte();
      return ''
    }
    const value = this.#scanToQuote(quote);
    if (value !== null) {
      this.#scanner.getByte(); // consume closing quote
      return value.includes(BACKSLASH)
        ? value.replaceAll(EscapedQuotes[quote], quote)
        : value
    }
    // no closing quote found – treat opening quote as part of the value
    return `${quote}${this.#scanToDelimiter() ?? ''}`
  }

  #skipBlank() {
    return this.#scanner.skip(BlankRx)
  }
  #skipDelimiter() {
    return this.#scanner.skip(this.#delimiterSkipPattern)
  }
  #scanName() {
    return this.#scanner.scan(NameRx)
  }
  #scanToDelimiter() {
    return this.#scanner.scan(this.#delimiterBoundaryPattern)
  }
  #scanToQuote(quote) {
    return this.#scanner.scan(BoundaryRx[quote])
  }
}

// Symbol key used to store attribute entries on a block-attributes object without
// polluting the public attributes (invisible to Object.keys / for-in / JSON.stringify).
// Spread ({ ...attrs }) copies Symbol-keyed properties, so the entry survives the
// shallow clone made in AbstractNode's constructor.
const ATTR_ENTRIES_KEY = Symbol('attribute_entries');

/**
 * Return the attribute entries stored for the given block attributes object,
 * or undefined if none have been saved.
 * @param {Object} blockAttributes
 * @returns {AttributeEntry[]|undefined}
 */
function getAttributeEntries(blockAttributes) {
  return blockAttributes[ATTR_ENTRIES_KEY]
}

class AttributeEntry {
  constructor(name, value, negate = null) {
    this.name = name;
    this.value = value;
    this.negate = negate == null ? value == null : negate;
  }

  saveTo(blockAttributes) {
(blockAttributes[ATTR_ENTRIES_KEY] ??= []).push(this);
    return this
  }
}

// ESM conversion of parser.rb
//
// Ruby-to-JavaScript notes:
//   - All methods are static on the Parser class (Ruby class methods).
//   - Ruby Struct BlockMatchData → plain object { context, masq, tip, terminator }.
//   - Ruby's regex captures ($1, $2, …) → JS match array m[1], m[2], …
//   - Ruby .nil_or_empty? → !val (or val == null || val === '')
//   - Ruby .to_i → parseInt(val, 10) (returns 0 for nil/non-numeric)
//   - ListContinuationMarker module → Symbol used for identity checks.
//   - Logging mixin applied via applyLogging().


// ── List continuation identity marker ────────────────────────────────────────
class ListContinuation extends String {}

function isListContinuation(v) {
  return v instanceof ListContinuation
}

const ListContinuationPlaceholder = new ListContinuation('');
const ListContinuationString = new ListContinuation(LIST_CONTINUATION);

// Author attribute keys
const AuthorKeys = new Set([
  'author',
  'authorinitials',
  'firstname',
  'middlename',
  'lastname',
  'email',
]);

// Cell alignment and style maps
const TableCellHorzAlignments = { '<': 'left', '>': 'right', '^': 'center' };
const TableCellVertAlignments = { '<': 'top', '>': 'bottom', '^': 'middle' };
const TableCellStyles = {
  d: 'none',
  s: 'strong',
  e: 'emphasis',
  m: 'monospaced',
  h: 'header',
  l: 'literal',
  a: 'asciidoc',
};

// ── Parser ────────────────────────────────────────────────────────────────────

class Parser {
  // Prevent instantiation
  constructor() {
    throw new Error('Parser cannot be instantiated')
  }

  /**
   * Parse AsciiDoc source from reader into document.
   * @param {Reader} reader
   * @param {Document} document
   * @param {{header_only?: boolean}} [options={}]
   * @returns {Promise<Document>}
   */
  static async parse(reader, document, options = {}) {
    const headerOnly = options.header_only ?? false;
    let blockAttributes = await Parser.parseDocumentHeader(
      reader,
      document,
      headerOnly
    );

    if (!headerOnly) {
      while (await reader.hasMoreLines()) {
        const [newSection, attrs] = await Parser.nextSection(
          reader,
          document,
          blockAttributes
        );
        blockAttributes = attrs;
        if (newSection) {
          document.assignNumeral(newSection);
          document.blocks.push(newSection);
        }
      }
    }
    return document
  }

  /**
   * Parse the document header.
   * @param {Reader} reader
   * @param {Document} document
   * @param {boolean} [headerOnly=false]
   * @returns {Promise<Object>} Block attributes after the header.
   */
  static async parseDocumentHeader(reader, document, headerOnly = false) {
    let blockAttrs =
      (await reader.skipBlankLines()) != null
        ? await Parser.parseBlockMetadataLines(reader, document)
        : {};
    const docAttrs = document.attributes;

    const implicitDoctitle = await Parser.isNextLineDoctitle(
      reader,
      blockAttrs,
      docAttrs.leveloffset
    );
    if (implicitDoctitle && (blockAttrs.title || blockAttrs.style)) {
      docAttrs.authorcount = 0;
      return document.finalizeHeader(blockAttrs, false)
    }

    let doctitleAttrVal = null;
    const existingDoctitle = docAttrs.doctitle;
    if (existingDoctitle && existingDoctitle !== '') {
      document.title = doctitleAttrVal = existingDoctitle;
    }

    if (implicitDoctitle) {
      const sourceLocation = document.sourcemap ? reader.cursor : null;
      const [_sectId, , l0SectionTitle, , atx] = await Parser.parseSectionTitle(
        reader,
        document
      );
      let finalSectTitle = l0SectionTitle;

      if (doctitleAttrVal) {
        finalSectTitle = null;
      } else {
        document.title = finalSectTitle;
        let sanitized = document.subSpecialchars(finalSectTitle);
        if (sanitized.includes(ATTR_REF_HEAD)) {
          sanitized = document.subAttributes(sanitized, {
            attribute_missing: 'skip',
          });
        }
        docAttrs.doctitle = doctitleAttrVal = sanitized;
      }

      if (sourceLocation && document.header) {
        document.header.sourceLocation = sourceLocation;
      }

      if (!atx && !document.isAttributeLocked('compat-mode')) {
        docAttrs['compat-mode'] = '';
      }
      if (
        blockAttrs.separator &&
        !document.isAttributeLocked('title-separator')
      ) {
        docAttrs['title-separator'] = blockAttrs.separator;
      }
      const docId = blockAttrs.id;
      if (docId) {
        document.id = docId;
      }
      if (blockAttrs.role) docAttrs.role = blockAttrs.role;
      if (blockAttrs.reftext) docAttrs.reftext = blockAttrs.reftext;
      blockAttrs = {};

      const modifiedAttrs = document._attributesModified;
      modifiedAttrs.delete('doctitle');
      await Parser.parseHeaderMetadata(reader, document, null);

      if (modifiedAttrs.has('doctitle')) {
        const val = docAttrs.doctitle;
        if (!val || val === '' || val === doctitleAttrVal) {
          docAttrs.doctitle = doctitleAttrVal;
        } else {
          document.title = val;
        }
      } else if (!finalSectTitle) {
        modifiedAttrs.add('doctitle');
      }

      if (docId) document.register('refs', [docId, document]);
    } else if (docAttrs.author) {
      const authorMeta = Parser.processAuthors(docAttrs.author, true, false);
      if (docAttrs.authorinitials) delete authorMeta.authorinitials;
      Object.assign(docAttrs, authorMeta);
    } else if (docAttrs.authors) {
      const authorMeta = Parser.processAuthors(docAttrs.authors, true);
      Object.assign(docAttrs, authorMeta);
    } else {
      docAttrs.authorcount = 0;
    }

    if (document.doctype === 'manpage') {
      await Parser.parseManpageHeader(reader, document, blockAttrs, headerOnly);
    }

    return document.finalizeHeader(blockAttrs)
  }

  /**
   * Parse manpage header.
   * @param {Reader} reader
   * @param {Document} document
   * @param {Object} blockAttributes
   * @param {boolean} [headerOnly=false]
   * @returns {Promise<void>}
   */
  static async parseManpageHeader(
    reader,
    document,
    blockAttributes,
    headerOnly = false
  ) {
    const docAttrs = document.attributes;
    const doctitle = docAttrs.doctitle || '';
    const m = doctitle.match(ManpageTitleVolnumRx);
    let manvolnum;
    if (m) {
      manvolnum = docAttrs.manvolnum = m[2];
      let mantitle = m[1];
      if (mantitle.includes(ATTR_REF_HEAD))
        mantitle = document.subAttributes(mantitle);
      docAttrs.mantitle = mantitle.toLowerCase();
    } else {
      Parser.logger.error(
        Parser.messageWithContext('non-conforming manpage title', {
          source_location: reader.cursorAtLine(1),
        })
      );
      docAttrs.mantitle = doctitle || docAttrs.docname || 'command';
      manvolnum = docAttrs.manvolnum = '1';
    }

    const manname = docAttrs.manname;
    if (manname && docAttrs.manpurpose) {
      docAttrs['manname-title'] ??= 'Name';
      docAttrs.mannames = [manname];
      if (document.backend === 'manpage') {
        docAttrs.docname = manname;
        docAttrs.outfilesuffix = `.${manvolnum}`;
      }
    } else if (headerOnly) ; else {
      await reader.skipBlankLines();
      reader.save();
      Object.assign(
        blockAttributes,
        await Parser.parseBlockMetadataLines(reader, document)
      );
      const nameSectionLevel = await Parser.isNextLineSection(reader, {});
      if (nameSectionLevel !== null && nameSectionLevel !== undefined) {
        if (nameSectionLevel === 1) {
          const nameSection = await Parser.initializeSection(
            reader,
            document,
            {}
          );
          const buffer = (
            await reader.readLinesUntil({
              break_on_blank_lines: true,
              skip_line_comments: true,
            })
          )
            .map((l) => l.trimStart())
            .join(' ');
          const nm = buffer.match(ManpageNamePurposeRx);
          let errorMsg = null;
          if (nm) {
            let mname = nm[1];
            if (mname.includes(ATTR_REF_HEAD))
              mname = document.subAttributes(mname);
            let mannames;
            if (mname.includes(',')) {
              mannames = mname.split(',').map((n) => n.trimStart());
              mname = mannames[0];
            } else {
              mannames = [mname];
            }
            let manpurpose = nm[2];
            if (manpurpose.includes(ATTR_REF_HEAD))
              manpurpose = document.subAttributes(manpurpose);
            docAttrs['manname-title'] ??= nameSection.title;
            if (nameSection.id) docAttrs['manname-id'] = nameSection.id;
            docAttrs.manname = mname;
            docAttrs.mannames = mannames;
            docAttrs.manpurpose = manpurpose;
            if (document.backend === 'manpage') {
              docAttrs.docname = mname;
              docAttrs.outfilesuffix = `.${manvolnum}`;
            }
          } else {
            errorMsg = 'non-conforming name section body';
          }
          if (errorMsg) {
            reader.restoreSave();
            Parser.logger.error(
              Parser.messageWithContext(errorMsg, {
                source_location: reader.cursor,
              })
            );
            const mn = docAttrs.docname || 'command';
            docAttrs.manname = mn;
            docAttrs.mannames = [mn];
            if (document.backend === 'manpage') {
              docAttrs.docname = mn;
              docAttrs.outfilesuffix = `.${manvolnum}`;
            }
          } else {
            reader.discardSave();
          }
        } else {
          reader.restoreSave();
          Parser.logger.error(
            Parser.messageWithContext('name section must be at level 1', {
              source_location: reader.cursor,
            })
          );
        }
      } else {
        reader.restoreSave();
        Parser.logger.error(
          Parser.messageWithContext('name section expected', {
            source_location: reader.cursor,
          })
        );
        const mn = docAttrs.docname || 'command';
        docAttrs.manname = mn;
        docAttrs.mannames = [mn];
        if (document.backend === 'manpage') {
          docAttrs.docname = mn;
          docAttrs.outfilesuffix = `.${manvolnum}`;
        }
      }
    }
  }

  /**
   * Return the next section from the reader.
   * @param {Reader} reader
   * @param {Document|Section} parent
   * @param {Object} [attributes={}]
   * @returns {Promise<[Section|null, Object]>} Tuple of the new section (or null) and orphaned attributes.
   */
  static async nextSection(reader, parent, attributes = {}) {
    let preamble = null,
      intro = null,
      part = false;

    const parentIsDocument = parent.context === 'document';
    let section, currentLevel, expectedNextLevel, expectedNextLevelAlt;
    let book, document;

    if (
      parentIsDocument &&
      parent.blocks.length === 0 &&
      (parent.hasHeader() ||
        ('invalid-header' in attributes &&
          !!attributes['invalid-header'] &&
          delete attributes['invalid-header'] !== undefined) ||
        typeof (await Parser.isNextLineSection(reader, attributes)) !==
          'number')
    ) {
      // We are at the start of document processing
      document = parent;
      book = document.doctype === 'book';
      if (parent.hasHeader() || (book && attributes[1] !== 'abstract')) {
        preamble = intro = new Block(parent, 'preamble', {
          content_model: 'compound',
        });
        if (book && parent.hasAttribute('preface-title')) {
          preamble.title = parent.getAttribute('preface-title');
        }
        parent.blocks.push(preamble);
      }
      section = parent;
      currentLevel = 0;
      if ('fragment' in parent.attributes) {
        expectedNextLevel = -1;
      } else if (book) {
        expectedNextLevel = 1;
        expectedNextLevelAlt = 0;
      } else {
        expectedNextLevel = 1;
      }
    } else {
      document = parent.document;
      book = document.doctype === 'book';
      section = await Parser.initializeSection(reader, parent, attributes);
      const title = attributes.title;
      attributes = title ? { title } : {};
      currentLevel = section.level;
      expectedNextLevel = currentLevel + 1;
      if (currentLevel === 0) {
        part = book;
      } else if (currentLevel === 1 && section.special) {
        const sn = section.sectname;
        if (sn !== 'appendix' && sn !== 'preface' && sn !== 'abstract') {
          expectedNextLevel = null;
        }
      }
    }

    await reader.skipBlankLines();

    while (await reader.hasMoreLines()) {
      await Parser.parseBlockMetadataLines(reader, document, attributes);
      let nextLevel = await Parser.isNextLineSection(reader, attributes);

      if (
        nextLevel !== null &&
        nextLevel !== undefined &&
        nextLevel !== false
      ) {
        const leveloffset = document.getAttribute('leveloffset');
        if (leveloffset) {
          nextLevel += parseInt(leveloffset, 10);
          if (nextLevel < 0) nextLevel = 0;
        }

        if (nextLevel > currentLevel) {
          if (expectedNextLevel != null) {
            if (
              nextLevel !== expectedNextLevel &&
              !(
                expectedNextLevelAlt != null &&
                nextLevel === expectedNextLevelAlt
              ) &&
              expectedNextLevel >= 0
            ) {
              const expectedCondition =
                expectedNextLevelAlt != null
                  ? `expected levels ${expectedNextLevelAlt} or ${expectedNextLevel}`
                  : `expected level ${expectedNextLevel}`;
              Parser.logger.warn(
                Parser.messageWithContext(
                  `section title out of sequence: ${expectedCondition}, got level ${nextLevel}`,
                  { source_location: reader.cursor }
                )
              );
            }
          } else {
            Parser.logger.error(
              Parser.messageWithContext(
                `${section.sectname} sections do not support nested sections`,
                { source_location: reader.cursor }
              )
            );
          }
          const [newSection, attrs] = await Parser.nextSection(
            reader,
            section,
            attributes
          );
          attributes = attrs;
          section.assignNumeral(newSection);
          section.blocks.push(newSection);
        } else if (nextLevel === 0 && section === document) {
          if (!book) {
            Parser.logger.error(
              Parser.messageWithContext(
                'level 0 sections can only be used when doctype is book',
                { source_location: reader.cursor }
              )
            );
          }
          const [newSection, attrs] = await Parser.nextSection(
            reader,
            section,
            attributes
          );
          attributes = attrs;
          section.assignNumeral(newSection);
          section.blocks.push(newSection);
        } else {
          break
        }
      } else {
        const blockCursor = reader.cursor;
        const newBlock = await Parser.nextBlock(
          reader,
          intro ?? section,
          attributes,
          { parse_metadata: false }
        );
        if (newBlock) {
          if (part) {
            if (!section.hasBlocks()) {
              if (newBlock.style !== 'partintro') {
                if (newBlock.style === 'open' && newBlock.context === 'open') {
                  newBlock.style = 'partintro';
                } else {
                  newBlock.parent = intro = new Block(section, 'open', {
                    content_model: 'compound',
                  });
                  intro.style = 'partintro';
                  section.blocks.push(intro);
                }
              } else if (newBlock.contentModel === 'simple') {
                newBlock.contentModel = 'compound';
                newBlock.append(
                  new Block(newBlock, 'paragraph', {
                    source: newBlock.lines,
                    subs: newBlock.subs,
                  })
                );
                newBlock.lines.length = 0;
                newBlock.subs.length = 0;
              }
            } else if (section.blocks.length === 1) {
              const firstBlock = section.blocks[0];
              if (!intro && firstBlock.contentModel === 'compound') {
                Parser.logger.error(
                  Parser.messageWithContext(
                    'illegal block content outside of partintro block',
                    { source_location: blockCursor }
                  )
                );
              } else if (firstBlock.contentModel !== 'compound') {
                newBlock.parent = intro = new Block(section, 'open', {
                  content_model: 'compound',
                });
                if (firstBlock.style === (intro.style = 'partintro')) {
                  firstBlock.context = 'paragraph';
                  firstBlock.style = null;
                }
                section.blocks.shift();
                intro.append(firstBlock);
                section.blocks.push(intro);
              }
            }
          }
(intro ?? section).blocks.push(newBlock);
          // Reset the shared attributes object for the next block. Use Reflect.ownKeys
          // (not Object.keys) so the Symbol-keyed attribute entries (ATTR_ENTRIES_KEY)
          // are cleared too; otherwise the array of AttributeEntry objects leaks and
          // accumulates across blocks, causing reassigned attributes (e.g. a body-level
          // `:name:` redefined later) to all resolve to the final value at playback time.
          for (const key of Reflect.ownKeys(attributes)) delete attributes[key];
        }
      }

      if ((await reader.skipBlankLines()) == null) break
    }

    if (part) {
      if (
        !section.hasBlocks() ||
        section.blocks[section.blocks.length - 1].context !== 'section'
      ) {
        Parser.logger.error(
          Parser.messageWithContext(
            'invalid part, must have at least one section (e.g., chapter, appendix, etc.)',
            { source_location: reader.cursor }
          )
        );
      }
    } else if (preamble) {
      if (preamble.hasBlocks()) {
        if (
          book ||
          document.blocks[1] ||
          false
        ) {
          if (document.sourcemap)
            preamble.sourceLocation = preamble.blocks[0].sourceLocation;
        } else {
          document.blocks.shift();
          while (preamble.blocks.length > 0) {
            document.append(preamble.blocks.shift());
          }
        }
      } else {
        document.blocks.shift();
      }
    }

    return [section === parent ? null : section, { ...attributes }]
  }

  /**
   * Parse and return the next Block at the Reader's current location.
   * @param {Reader} reader
   * @param {AbstractBlock} parent
   * @param {Object} [attributes={}]
   * @param {Object} [options={}]
   * @returns {Promise<Block|null>}
   */
  static async nextBlock(reader, parent, attributes = {}, options = {}) {
    const skipped = await reader.skipBlankLines();
    if (skipped == null) return null

    let textOnly = options.text_only ?? null;
    if (textOnly && skipped > 0) {
      delete options.text_only;
      textOnly = null;
    }

    const document = parent.document;
    const parseMetadata = options.parse_metadata !== false;

    if (parseMetadata) {
      while (
        await Parser.parseBlockMetadataLine(
          reader,
          document,
          attributes,
          options
        )
      ) {
        await reader.readLine();
        if ((await reader.skipBlankLines()) == null) return null
      }
    }

    const extensions = document.extensions;
    const blockExtensions = extensions?.hasBlocks?.();
    const blockMacroExtensions = extensions?.hasBlockMacros?.();

    reader.mark();
    const thisLine = await reader.readLine();
    if (thisLine === undefined) return null
    const docAttrs = document.attributes;
    const style = attributes[1] ?? null;
    let block = null,
      blockContext = null,
      cloakedContext = null,
      terminator = null;

    const delimitedBlock = Parser.isDelimitedBlock(thisLine, true);
    if (delimitedBlock) {
      blockContext = cloakedContext = delimitedBlock.context;
      terminator = delimitedBlock.terminator;
      if (style) {
        if (style !== blockContext) {
          if (delimitedBlock.masq.has(style)) {
            blockContext = style;
          } else if (
            delimitedBlock.masq.has('admonition') &&
            ADMONITION_STYLES.has(style)
          ) {
            blockContext = 'admonition';
          } else if (
            blockExtensions &&
            extensions.registeredForBlock(style, blockContext)
          ) {
            blockContext = style;
          } else {
            // unknown style; revert to block context
            if (Parser.logger.isDebug())
              Parser.logger.debug(
                Parser.messageWithContext(
                  `unknown style for ${blockContext} block: ${style}`,
                  { source_location: reader.cursor }
                )
              );
          }
        }
      } else {
        attributes.style = blockContext;
      }
    }

    if (!delimitedBlock) {
      // Processed once (break used for flow control)
      do {
        // Verbatim style shortcut
        if (
          style &&
          Compliance.strictVerbatimParagraphs &&
          VERBATIM_STYLES.has(style)
        ) {
          blockContext = style;
          cloakedContext = 'paragraph';
          reader.unshiftLine(thisLine);
          break
        }

        let indented, ch0;

        if (thisLine.startsWith(' ')) {
          indented = true;
          ch0 = ' ';
          {
            const stripped = thisLine.trimStart();
            const firstChar = stripped[0];
            if (
              MARKDOWN_THEMATIC_BREAK_CHARS[firstChar] &&
              MarkdownThematicBreakRx.test(thisLine)
            ) {
              block = new Block(parent, 'thematic_break', {
                content_model: 'empty',
              });
              break
            }
          }
        } else if (thisLine.startsWith('\t')) {
          indented = true;
          ch0 = '\t';
        } else {
          indented = false;
          ch0 = thisLine[0];
          const layoutBreakChars = HYBRID_LAYOUT_BREAK_CHARS
            ;

          if (!textOnly && layoutBreakChars[ch0]) {
            thisLine.length;
            if (
              ExtLayoutBreakRx.test(thisLine)
                
            ) {
              block = new Block(parent, layoutBreakChars[ch0], {
                content_model: 'empty',
              });
              break
            }
          }

          if (thisLine.endsWith(']') && thisLine.includes('::')) {
            // Block macro check
            if (
              ch0 === 'i' ||
              thisLine.startsWith('video:') ||
              thisLine.startsWith('audio:')
            ) {
              const mm = thisLine.match(BlockMediaMacroRx);
              if (mm) {
                const [, blkCtxStr, target0, blkAttrsStr] = mm;
                const blkCtx = blkCtxStr;
                block = new Block(parent, blkCtx, { content_model: 'empty' });
                let target = target0;
                if (blkAttrsStr) {
                  let posattrs = [];
                  if (blkCtx === 'video')
                    posattrs = ['poster', 'width', 'height'];
                  else if (blkCtx === 'image')
                    posattrs = ['alt', 'width', 'height'];
                  await block.parseAttributes(blkAttrsStr, posattrs, {
                    sub_input: true,
                    into: attributes,
                  });
                }
                delete attributes.style;
                if (target.includes(ATTR_REF_HEAD)) {
                  const expanded = block.subAttributes(target, {
                    returnDropSentinel: true,
                  });
                  if (expanded === null) {
                    // A missing attribute triggered drop-line; blank attributes (e.g. {blank})
                    // that resolve to '' are kept (expanded !== null for those).
                    for (const k of Object.keys(attributes))
                      delete attributes[k];
                    return null
                  }
                  target = expanded;
                }
                if (blkCtx === 'image') {
                  document.register('images', target);
                  attributes.imagesdir ??= docAttrs.imagesdir;
                  attributes.alt ??=
                    style ??
                    (attributes['default-alt'] = basename(target, true).replace(
                      /[_-]/g,
                      ' '
                    ));
                  let scaledwidth = attributes.scaledwidth;
                  if (scaledwidth) {
                    delete attributes.scaledwidth;
                    if (!scaledwidth.match(/\D/)) scaledwidth += '%';
                    attributes.scaledwidth = scaledwidth;
                  }
                  if (attributes.title) {
                    block.title = attributes.title;
                    delete attributes.title;
                    block.assignCaption(attributes.caption, 'figure');
                    delete attributes.caption;
                  }
                }
                attributes.target = target;
                break
              }
            }

            if (ch0 === 't' && thisLine.startsWith('toc:')) {
              const tocm = thisLine.match(BlockTocMacroRx);
              if (tocm) {
                block = new Block(parent, 'toc', { content_model: 'empty' });
                if (tocm[1])
                  await block.parseAttributes(tocm[1], [], {
                    sub_input: true,
                    into: attributes,
                  });
                break
              }
            }

            if (blockMacroExtensions) {
              const cbm = thisLine.match(CustomBlockMacroRx);
              if (cbm) {
                const extension = extensions.registeredForBlockMacro(cbm[1]);
                if (extension) {
                  let target = cbm[2];
                  const content = cbm[3];
                  if (target.includes(ATTR_REF_HEAD)) {
                    const expanded = parent.subAttributes(target, {
                      returnDropSentinel: true,
                    });
                    if (expanded === null) {
                      for (const k of Object.keys(attributes))
                        delete attributes[k];
                      return null
                    }
                    target = expanded;
                  }
                  const extConfig = extension.config;
                  const contentModel =
                    extConfig.contentModel ?? extConfig.content_model;
                  if (contentModel === 'attributes') {
                    if (content)
                      await document.parseAttributes(
                        content,
                        extConfig.positionalAttrs ??
                          extConfig.positional_attrs ??
                          extConfig.posAttrs ??
                          extConfig.pos_attrs ??
                          [],
                        { sub_input: true, into: attributes }
                      );
                  } else {
                    attributes.text = content ?? '';
                  }
                  const defaultAttrs =
                    extConfig.defaultAttrs ?? extConfig.default_attrs;
                  if (defaultAttrs) {
                    for (const [k, v] of Object.entries(defaultAttrs)) {
                      attributes[k] ??= v;
                    }
                  }
                  const result = await extension.processMethod(
                    parent,
                    target,
                    attributes
                  );
                  if (result && result !== parent) {
                    Object.assign(attributes, result.attributes);
                    block = result;
                    break
                  }
                  for (const k of Object.keys(attributes)) delete attributes[k];
                  return null
                }
              }
            }
          }
        }

        if (!indented && (ch0 ?? thisLine[0]) === '<') {
          const clm = thisLine.match(CalloutListRx);
          if (clm) {
            reader.unshiftLine(thisLine);
            block = await Parser.parseCalloutList(
              reader,
              clm,
              parent,
              document.callouts
            );
            attributes.style = 'arabic';
            break
          }
        }

        if (UnorderedListRx.test(thisLine)) {
          reader.unshiftLine(thisLine);
          if (
            !style &&
            parent instanceof Section &&
            parent.sectname === 'bibliography'
          ) {
            attributes.style = 'bibliography';
          }
          block = await Parser.parseList(
            reader,
            'ulist',
            parent,
            style ?? attributes.style ?? null
          );
          break
        }

        if (OrderedListRx.test(thisLine)) {
          reader.unshiftLine(thisLine);
          const start = 'start' in attributes ? attributes.start : null;
          delete attributes.start;
          block = await Parser.parseList(reader, 'olist', parent, style, {
            start,
          });
          if (block.style) attributes.style = block.style;
          break
        }

        if (thisLine.includes('::') || thisLine.includes(';;')) {
          const dlm = thisLine.match(DescriptionListRx);
          if (dlm) {
            reader.unshiftLine(thisLine);
            block = await Parser.parseDescriptionList(reader, dlm, parent);
            break
          }
        }

        if (
          (style === 'float' || style === 'discrete') &&
          (Parser.isSectionTitle(thisLine, await reader.peekLine()) != null
            )
        ) {
          reader.unshiftLine(thisLine);
          const [floatId, floatReftext, blockTitle, floatLevel] =
            await Parser.parseSectionTitle(reader, document, attributes.id);
          if (floatReftext) attributes.reftext = floatReftext;
          block = new Block(parent, 'floating_title', {
            content_model: 'empty',
          });
          block.title = blockTitle;
          delete attributes.title;
          // Force title resolution while in scope to capture current attribute values (Ruby: parser.rb ~line 939)
          if (blockTitle.includes(ATTR_REF_HEAD)) await block.precomputeTitle();
          if (floatId) {
            block.id = floatId;
          } else if ('sectids' in docAttrs) {
            await block.precomputeTitle();
            block.id = Section.generateId(block.title, document);
          }
          block.level = floatLevel;
          break
        }

        if (style && style !== 'normal') {
          if (PARAGRAPH_STYLES.has(style)) {
            blockContext = style;
            cloakedContext = 'paragraph';
            reader.unshiftLine(thisLine);
            break
          }
          if (ADMONITION_STYLES.has(style)) {
            blockContext = 'admonition';
            cloakedContext = 'paragraph';
            reader.unshiftLine(thisLine);
            break
          }
          if (
            blockExtensions &&
            extensions.registeredForBlock(style, 'paragraph')
          ) {
            blockContext = style;
            cloakedContext = 'paragraph';
            reader.unshiftLine(thisLine);
            break
          }
          // unknown style; fall through
          if (style && Parser.logger.isDebug())
            Parser.logger.debug(
              Parser.messageWithContext(
                `unknown style for paragraph: ${style}`,
                { source_location: reader.cursor }
              )
            );
        }

        reader.unshiftLine(thisLine);

        if (indented && !style) {
          const contentAdjacent = skipped === 0 ? options.list_type : null;
          const lines = await Parser.readParagraphLines(
            reader,
            contentAdjacent,
            { skip_line_comments: !!textOnly }
          );
          Parser.adjustIndentation(lines);
          if (textOnly || contentAdjacent === 'dlist') {
            block = new Block(parent, 'paragraph', {
              content_model: 'simple',
              source: lines,
              attributes,
            });
          } else {
            block = new Block(parent, 'literal', {
              content_model: 'verbatim',
              source: lines,
              attributes,
            });
          }
        } else {
          const lines = await Parser.readParagraphLines(
            reader,
            skipped === 0 && options.list_type,
            { skip_line_comments: true }
          );
          if (textOnly) {
            if (indented && style === 'normal') Parser.adjustIndentation(lines);
            block = new Block(parent, 'paragraph', {
              content_model: 'simple',
              source: lines,
              attributes,
            });
          } else if (
            ADMONITION_STYLE_HEADS.has(ch0) &&
            thisLine.includes(':')
          ) {
            const am = thisLine.match(AdmonitionParagraphRx);
            if (am) {
              lines[0] = thisLine.slice(am[0].length);
              const admName = am[1].toLowerCase();
              attributes.name = admName;
              attributes.style = am[1];
              attributes.textlabel =
                attributes.caption ?? docAttrs[`${admName}-caption`];
              delete attributes.caption;
              block = new Block(parent, 'admonition', {
                content_model: 'simple',
                source: lines,
                attributes,
              });
            } else {
              if (indented && style === 'normal')
                Parser.adjustIndentation(lines);
              block = new Block(parent, 'paragraph', {
                content_model: 'simple',
                source: lines,
                attributes,
              });
            }
          } else if (ch0 === '>' && thisLine.startsWith('> ')) {
            const mapped = lines.map((line) => {
              if (line === '>') return line.slice(1)
              if (line.startsWith('> ')) return line.slice(2)
              return line
            });
            let creditLine = null;
            if (mapped[mapped.length - 1]?.startsWith('-- ')) {
              creditLine = mapped.pop().slice(3);
              while (mapped.length > 0 && mapped[mapped.length - 1] === '')
                mapped.pop();
            }
            attributes.style = 'quote';
            const Rdr = Reader;
            block = await Parser.buildBlock(
              'quote',
              'compound',
              false,
              parent,
              new Rdr(mapped),
              attributes
            );
            if (creditLine) {
              const subsApplied = await block.applySubs(creditLine, [
                'specialcharacters',
                'quotes',
                'attributes',
                'replacements',
                'macros',
                'post_replacements',
              ]);
              const commaIdx = subsApplied.indexOf(', ');
              const attribution =
                commaIdx !== -1 ? subsApplied.slice(0, commaIdx) : subsApplied;
              const citetitle =
                commaIdx !== -1 ? subsApplied.slice(commaIdx + 2) : null;
              if (attribution) attributes.attribution = attribution;
              if (citetitle) attributes.citetitle = citetitle;
            }
          } else if (
            ch0 === '"' &&
            lines.length > 1 &&
            lines[lines.length - 1].startsWith('-- ') &&
            lines[lines.length - 2].endsWith('"')
          ) {
            lines[0] = thisLine.slice(1);
            const cred = lines.pop().slice(3);
            while (lines.length > 0 && lines[lines.length - 1] === '')
              lines.pop();
            lines[lines.length - 1] = lines[lines.length - 1].slice(0, -1);
            attributes.style = 'quote';
            block = new Block(parent, 'quote', {
              content_model: 'simple',
              source: lines,
              attributes,
            });
            const subsApplied = await block.applySubs(cred, [
              'specialcharacters',
              'quotes',
              'attributes',
              'replacements',
              'macros',
              'post_replacements',
            ]);
            const commaIdx = subsApplied.indexOf(', ');
            const attribution =
              commaIdx !== -1 ? subsApplied.slice(0, commaIdx) : subsApplied;
            const citetitle =
              commaIdx !== -1 ? subsApplied.slice(commaIdx + 2) : null;
            if (attribution) attributes.attribution = attribution;
            if (citetitle) attributes.citetitle = citetitle;
          } else {
            if (indented && style === 'normal') Parser.adjustIndentation(lines);
            block = new Block(parent, 'paragraph', {
              content_model: 'simple',
              source: lines,
              attributes,
            });
          }
          Parser.catalogInlineAnchors(lines.join(LF$1), block, document, reader);
        }
      } while (false)
    }

    // Delimited block or styled paragraph
    if (!block) {
      switch (blockContext) {
        case 'listing':
        case 'source': {
          const lang =
            blockContext !== 'source' && !attributes[1]
              ? (attributes[2] ?? docAttrs['source-language'])
              : null;
          if (lang) {
            attributes.style = 'source';
            attributes.language = lang;
            AttributeList.rekey(attributes, [null, null, 'linenums']);
          } else if (blockContext === 'source') {
            AttributeList.rekey(attributes, [null, 'language', 'linenums']);
            if ('source-language' in docAttrs && !('language' in attributes)) {
              attributes.language = docAttrs['source-language'];
            }
            if (cloakedContext !== 'listing')
              attributes['cloaked-context'] = cloakedContext;
          }
          if (
            !('linenums-option' in attributes) &&
            ('linenums' in attributes || 'source-linenums-option' in docAttrs)
          ) {
            attributes['linenums-option'] = '';
          }
          if (!('indent' in attributes) && 'source-indent' in docAttrs) {
            attributes.indent = docAttrs['source-indent'];
          }
          block = await Parser.buildBlock(
            'listing',
            'verbatim',
            terminator,
            parent,
            reader,
            attributes
          );
          break
        }
        case 'fenced_code': {
          attributes.style = 'source';
          const ll = thisLine.length;
          let language = null;
          if (ll > 3) {
            const langPart = thisLine.slice(3);
            const commaIdx = langPart.indexOf(',');
            if (commaIdx >= 0) {
              if (commaIdx > 0) language = langPart.slice(0, commaIdx).trim();
              if (commaIdx < ll - 4) attributes.linenums = '';
            } else {
              language = langPart.trimStart();
            }
          }
          if (!language) {
            if ('source-language' in docAttrs)
              attributes.language = docAttrs['source-language'];
          } else {
            attributes.language = language;
          }
          attributes['cloaked-context'] = cloakedContext;
          if (
            !('linenums-option' in attributes) &&
            ('linenums' in attributes || 'source-linenums-option' in docAttrs)
          ) {
            attributes['linenums-option'] = '';
          }
          if (!('indent' in attributes) && 'source-indent' in docAttrs)
            attributes.indent = docAttrs['source-indent'];
          terminator = terminator.slice(0, 3);
          block = await Parser.buildBlock(
            'listing',
            'verbatim',
            terminator,
            parent,
            reader,
            attributes
          );
          break
        }
        case 'table': {
          const blockCursor = reader.cursor;
          const Rdr = Reader;
          const blockReader = new Rdr(
            await reader.readLinesUntil({
              terminator,
              skip_line_comments: true,
              context: 'table',
              cursor: 'at_mark',
            }),
            blockCursor
          );
          if (!terminator.startsWith('|') && !terminator.startsWith('!')) {
            attributes.format ??= terminator.startsWith(',') ? 'csv' : 'dsv';
          }
          block = await Parser.parseTable(blockReader, parent, attributes);
          break
        }
        case 'sidebar':
          block = await Parser.buildBlock(
            blockContext,
            'compound',
            terminator,
            parent,
            reader,
            attributes
          );
          break
        case 'admonition': {
          const admStyle = attributes.style ?? blockContext;
          attributes.name = admStyle.toLowerCase();
          attributes.textlabel =
            attributes.caption ?? docAttrs[`${attributes.name}-caption`];
          delete attributes.caption;
          block = await Parser.buildBlock(
            blockContext,
            'compound',
            terminator,
            parent,
            reader,
            attributes
          );
          break
        }
        case 'open':
        case 'abstract':
        case 'partintro':
          block = await Parser.buildBlock(
            'open',
            'compound',
            terminator,
            parent,
            reader,
            attributes
          );
          break
        case 'literal':
          block = await Parser.buildBlock(
            blockContext,
            'verbatim',
            terminator,
            parent,
            reader,
            attributes
          );
          break
        case 'example':
          if ('collapsible-option' in attributes) attributes.caption ??= '';
          block = await Parser.buildBlock(
            blockContext,
            'compound',
            terminator,
            parent,
            reader,
            attributes
          );
          break
        case 'quote':
        case 'verse':
          AttributeList.rekey(attributes, [null, 'attribution', 'citetitle']);
          block = await Parser.buildBlock(
            blockContext,
            blockContext === 'verse' ? 'verbatim' : 'compound',
            terminator,
            parent,
            reader,
            attributes
          );
          break
        case 'stem':
        case 'latexmath':
        case 'asciimath':
          if (blockContext === 'stem') {
            attributes.style = STEM_TYPE_ALIASES[attributes[2] ?? docAttrs.stem];
          }
          block = await Parser.buildBlock(
            'stem',
            'raw',
            terminator,
            parent,
            reader,
            attributes
          );
          break
        case 'pass':
          block = await Parser.buildBlock(
            blockContext,
            'raw',
            terminator,
            parent,
            reader,
            attributes
          );
          break
        case 'comment':
          await Parser.buildBlock(
            blockContext,
            'skip',
            terminator,
            parent,
            reader,
            attributes
          );
          for (const k of Object.keys(attributes)) delete attributes[k];
          return null
        default: {
          if (
            !blockExtensions ||
            !extensions.registeredForBlock(blockContext, cloakedContext)
          ) {
            throw new Error(
              `Unsupported block type ${blockContext} at ${reader.cursor}`
            )
          }
          const extension = extensions.registeredForBlock(
            blockContext,
            cloakedContext
          );
          const extConfig = extension.config;
          const contentModel = extConfig.contentModel ?? extConfig.content_model;
          if (contentModel !== 'skip') {
            const posAttrs =
              extConfig.positionalAttrs ??
              extConfig.positional_attrs ??
              extConfig.posAttrs ??
              extConfig.pos_attrs;
            if (posAttrs && posAttrs.length > 0) {
              AttributeList.rekey(attributes, [null, ...posAttrs]);
            }
            const defaultAttrs =
              extConfig.defaultAttrs ?? extConfig.default_attrs;
            if (defaultAttrs) {
              for (const [k, v] of Object.entries(defaultAttrs)) {
                attributes[k] ??= v;
              }
            }
            attributes['cloaked-context'] = cloakedContext;
          }
          block = await Parser.buildBlock(
            blockContext,
            contentModel,
            terminator,
            parent,
            reader,
            attributes,
            { extension }
          );
          if (!block) {
            for (const k of Object.keys(attributes)) delete attributes[k];
            return null
          }
        }
      }
    }

    if (!block) return null

    if (document.sourcemap) block.sourceLocation = reader.cursorAtMark();
    if (attributes.title) {
      const blockTitle = attributes.title;
      block.title = blockTitle;
      delete attributes.title;
      // Force title resolution while in scope to capture current attribute values (Ruby: parser.rb ~line 939)
      if (blockTitle.includes(ATTR_REF_HEAD)) await block.precomputeTitle();
      if (CAPTION_ATTRIBUTE_NAMES[block.context]) {
        block.assignCaption(attributes.caption);
        delete attributes.caption;
      }
    }
    block.style = attributes.style ?? null;

    const blockId = block.id ?? (block.id = attributes.id ?? null);
    if (blockId) {
      if (!document.register('refs', [blockId, block])) {
        Parser.logger.warn(
          Parser.messageWithContext(
            `id assigned to block already in use: ${blockId}`,
            { source_location: reader.cursorAtMark() }
          )
        );
      }
    }

    // Reflect.ownKeys (not Object.keys) so a block carrying only Symbol-keyed
    // attribute entries (ATTR_ENTRIES_KEY) — e.g. an `:attr:` entry immediately
    // preceding a list or table — still receives them, matching Ruby's
    // `attributes.empty?` where the `:attribute_entries` key is counted. Without this
    // the entries are dropped and the attribute is not played back for that block.
    if (Reflect.ownKeys(attributes).length > 0)
      block.updateAttributes(attributes);
    block.commitSubs();

    if (block.hasSub('callouts')) {
      if (!Parser.catalogCallouts(block.source, document))
        block.removeSub('callouts');
    }

    return block
  }

  /**
   * Build a block from reader lines.
   * @returns {Promise<Block|null>}
   * @internal
   */
  static async buildBlock(
    blockContext,
    contentModel,
    terminator,
    parent,
    reader,
    attributes,
    options = {}
  ) {
    let skipProcessing, parseAsContentModel;

    if (contentModel === 'skip') {
      skipProcessing = true;
      parseAsContentModel = 'simple';
    } else if (contentModel === 'raw') {
      skipProcessing = false;
      parseAsContentModel = 'simple';
    } else {
      skipProcessing = false;
      parseAsContentModel = contentModel;
    }

    let lines = null,
      blockReader = null;

    if (terminator == null) {
      if (parseAsContentModel === 'verbatim') {
        lines = await reader.readLinesUntil({
          break_on_blank_lines: true,
          break_on_list_continuation: true,
        });
      } else {
        if (contentModel === 'compound') contentModel = 'simple';
        lines = await Parser.readParagraphLines(reader, false, {
          skip_line_comments: true,
          skip_processing: skipProcessing,
        });
      }
    } else if (parseAsContentModel !== 'compound') {
      lines = await reader.readLinesUntil({
        terminator,
        skip_processing: skipProcessing,
        context: blockContext,
        cursor: 'at_mark',
      });
    } else if (terminator === false) {
      blockReader = reader;
    } else {
      const blockCursor = reader.cursor;
      const Rdr = Reader;
      blockReader = new Rdr(
        await reader.readLinesUntil({
          terminator,
          skip_processing: skipProcessing,
          context: blockContext,
          cursor: 'at_mark',
        }),
        blockCursor,
        { document: parent.document }
      );
    }

    if (contentModel === 'verbatim') {
      const tabSize = parseInt(
        attributes.tabsize ?? parent.document.attributes.tabsize ?? '0',
        10
      );
      const indent = attributes.indent;
      if (indent != null) {
        Parser.adjustIndentation(lines, parseInt(indent, 10), tabSize);
      } else if (tabSize > 0) {
        Parser.adjustIndentation(lines, -1, tabSize);
      }
    } else if (contentModel === 'skip') {
      return null
    }

    let block;
    if (options.extension) {
      const extension = options.extension;
      delete attributes.style;
      const Rdr = Reader;
      const result = await extension.processMethod(
        parent,
        blockReader ?? new Rdr(lines, null, { document: parent.document }),
        { ...attributes }
      );
      if (!result || result === parent) return null
      block = result;
      Object.assign(attributes, block.attributes);
      if (
        block.contentModel === 'compound' &&
        block instanceof Block &&
        block.lines.length > 0
      ) {
        contentModel = 'compound';
        blockReader = new Rdr(block.lines);
      }
    } else {
      block = new Block(parent, blockContext, {
        content_model: contentModel,
        source: lines,
        attributes,
      });
    }

    if (contentModel === 'compound')
      await Parser.parseBlocks(blockReader, block);

    return block
  }

  /**
   * Parse blocks from reader until exhausted.
   * @param {Reader} reader
   * @param {AbstractBlock} parent
   * @param {Object|null} [attributes=null]
   * @returns {Promise<void>}
   */
  static async parseBlocks(reader, parent, attributes = null) {
    while (true) {
      const block = await Parser.nextBlock(
        reader,
        parent,
        attributes ? { ...attributes } : {}
      );
      if (block) parent.blocks.push(block);
      if (!(await reader.hasMoreLines())) break
    }
  }

  /**
   * Parse an ordered or unordered list.
   * @returns {Promise<List>}
   * @internal
   */
  static async parseList(reader, listType, parent, style = null, opts = {}) {
    const start = opts.start != null ? parseInt(opts.start, 10) : null;
    const listAttrs = start != null && start !== 1 ? { start } : null;
    const listBlock = new List(
      parent,
      listType,
      listAttrs ? { attributes: listAttrs } : {}
    );
    const listRx = ListRxMap[listType];

    while (
      (await reader.hasMoreLines()) &&
      listRx.test(await reader.peekLine())
    ) {
      const m = (await reader.peekLine()).match(listRx);
      const listItem = await Parser.parseListItem(
        reader,
        listBlock,
        m,
        m[1],
        style
      );
      if (listItem) listBlock.blocks.push(listItem);
      if ((await reader.skipBlankLines()) == null) break
    }

    return listBlock
  }

  /**
   * Catalog callouts in text.
   * @param {string} text
   * @param {Document} document
   * @returns {boolean} Whether any callouts were found.
   * @internal
   */
  static catalogCallouts(text, document) {
    if (!text.includes('<')) return false
    let found = false;
    let autonum = 0;
    const rx = new RegExp(CalloutScanRx.source, `${CalloutScanRx.flags}g`);
    let m;
    while ((m = rx.exec(text)) !== null) {
      if (!m[0].startsWith('\\')) {
        document.callouts.register(m[2] === '.' ? String(++autonum) : m[2]);
      }
      found = true;
    }
    return found
  }

  /**
   * Catalog a single inline anchor.
   * @internal
   */
  static catalogInlineAnchor(id, reftext, node, location, doc = node.document) {
    if (reftext?.includes(ATTR_REF_HEAD)) {
      reftext = doc.subAttributes(reftext);
    }
    const cursor = location?.cursor ? location.cursor : location;
    if (
      !doc.register('refs', [
        id,
        new Inline(node, 'anchor', reftext, { type: 'ref', id }),
      ])
    ) {
      Parser.logger.warn(
        Parser.messageWithContext(
          `id assigned to anchor already in use: ${id}`,
          { source_location: cursor }
        )
      );
    }
  }

  /**
   * Catalog all inline anchors in text.
   * @internal
   */
  static catalogInlineAnchors(text, block, document, reader) {
    if (!text.includes('[[') && !text.includes('anchor:')) return

    let m;
    // Reset lastIndex for global search
    InlineAnchorScanRx.lastIndex = 0;
    const globalRx = new RegExp(InlineAnchorScanRx.source, 'gu');
    while ((m = globalRx.exec(text)) !== null) {
      let id, reftext;
      if (m[1]) {
        id = m[1];
        reftext = m[2];
        if (reftext?.includes(ATTR_REF_HEAD)) {
          reftext = document.subAttributes(reftext);
          if (!reftext) continue
        }
      } else {
        id = m[3];
        reftext = m[4];
        if (reftext) {
          if (reftext.includes(']')) reftext = reftext.replace(/\\]/g, ']');
          if (reftext.includes(ATTR_REF_HEAD)) {
            reftext = document.subAttributes(reftext);
            if (!reftext) reftext = null;
          }
        }
      }
      if (
        !document.register('refs', [
          id,
          new Inline(block, 'anchor', reftext, { type: 'ref', id }),
        ])
      ) {
        Parser.logger.warn(
          Parser.messageWithContext(
            `id assigned to anchor already in use: ${id}`,
            { source_location: reader.cursorAtMark() }
          )
        );
      }
    }
  }

  /**
   * Catalog a bibliography inline anchor.
   * @internal
   */
  static catalogInlineBiblioAnchor(id, reftext, node, reader) {
    const displayReftext = reftext != null ? `[${reftext}]` : null;
    if (
      !node.document.register('refs', [
        id,
        new Inline(node, 'anchor', displayReftext, { type: 'bibref', id }),
      ])
    ) {
      Parser.logger.warn(
        Parser.messageWithContext(
          `id assigned to bibliography anchor already in use: ${id}`,
          { source_location: reader.cursor }
        )
      );
    }
  }

  /**
   * Parse a description list.
   * @returns {Promise<List>}
   * @internal
   */
  static async parseDescriptionList(reader, match, parent) {
    const listBlock = new List(parent, 'dlist');
    const siblingPattern = DescriptionListSiblingRx[match[2]];
    let currentPair = await Parser.parseListItem(
      reader,
      listBlock,
      match,
      siblingPattern
    );
    listBlock.blocks.push(currentPair);

    while (await reader.hasMoreLines()) {
      const pLine = await reader.peekLine();
      const nm = pLine.match(siblingPattern);
      if (!nm) break
      const nextPair = await Parser.parseListItem(
        reader,
        listBlock,
        nm,
        siblingPattern
      );
      if (currentPair[1]) {
        listBlock.blocks.push((currentPair = nextPair));
      } else {
        currentPair[0].push(nextPair[0][0]);
        currentPair[1] = nextPair[1];
      }
    }

    return listBlock
  }

  /**
   * Parse a callout list.
   * @returns {Promise<List>}
   * @internal
   */
  static async parseCalloutList(reader, match, parent, callouts) {
    const listBlock = new List(parent, 'colist');
    let nextIndex = 1;
    let autonum = 0;

    while (true) {
      if (!match) {
        const pLine = await reader.peekLine();
        if (!pLine) break
        const nm = pLine.match(CalloutListRx);
        if (!nm) break
        match = nm;
        reader.mark();
      }
      let num = match[1];
      if (num === '.') num = String(++autonum);
      if (num !== String(nextIndex)) {
        Parser.logger.warn(
          Parser.messageWithContext(
            `callout list item index: expected ${nextIndex}, got ${num}`,
            { source_location: reader.cursorAtMark() }
          )
        );
      }
      const listItem = await Parser.parseListItem(
        reader,
        listBlock,
        match,
        '<1>'
      );
      if (listItem) {
        listBlock.blocks.push(listItem);
        const coids = callouts.getCalloutIds(listBlock.blocks.length);
        if (!coids) {
          Parser.logger.warn(
            Parser.messageWithContext(
              `no callout found for <${listBlock.blocks.length}>`,
              { source_location: reader.cursorAtMark() }
            )
          );
        } else {
          listItem.attributes.coids = coids;
        }
      }
      nextIndex++;
      match = null;
    }

    callouts.nextList();
    return listBlock
  }

  /**
   * Parse a list item (ordered, unordered, callout, or description list).
   * @returns {Promise<ListItem|[ListItem[], ListItem|null]>}
   * @internal
   */
  static async parseListItem(
    reader,
    listBlock,
    match,
    siblingTrait,
    style = null
  ) {
    const listType = listBlock.context;
    const dlist = listType === 'dlist';
    let listTerm, listItem, hasText, sourcemapAssignmentDeferred;

    if (dlist) {
      const termText = match[1];
      listTerm = new ListItem(listBlock, termText);
      if (termText.startsWith('[[')) {
        const am = termText.match(LeadingInlineAnchorRx);
        if (am)
          Parser.catalogInlineAnchor(
            am[1],
            am[2] ?? termText.slice(am[0].length).trimStart(),
            listTerm,
            reader
          );
      }
      const itemText = match[3] ?? null;
      hasText = !!itemText;
      listItem = new ListItem(listBlock, itemText);
      if (listBlock.document.sourcemap) {
        listTerm.sourceLocation = reader.cursor;
        if (hasText) {
          listItem.sourceLocation = listTerm.sourceLocation;
        } else {
          sourcemapAssignmentDeferred = true;
        }
      }
    } else {
      hasText = true;
      const itemText = match[2];
      listItem = new ListItem(listBlock, itemText);
      if (listBlock.document.sourcemap) listItem.sourceLocation = reader.cursor;

      if (listType === 'ulist') {
        listItem.marker = siblingTrait;
        if (itemText.startsWith('[')) {
          if (style && style === 'bibliography') {
            const bm = itemText.match(InlineBiblioAnchorRx);
            if (bm)
              Parser.catalogInlineBiblioAnchor(bm[1], bm[2], listItem, reader);
          } else if (itemText.startsWith('[[')) {
            const am = itemText.match(LeadingInlineAnchorRx);
            if (am) Parser.catalogInlineAnchor(am[1], am[2], listItem, reader);
          } else if (
            itemText.startsWith('[ ] ') ||
            itemText.startsWith('[x] ') ||
            itemText.startsWith('[*] ')
          ) {
            listBlock.attributes['checklist-option'] = '';
            listItem.attributes.checkbox = '';
            if (!itemText.startsWith('[ ')) listItem.attributes.checked = '';
            listItem.setText(itemText.slice(4));
          }
        }
      } else if (listType === 'olist') {
        const ordinal = listBlock.blocks.length;
        const isFirst = ordinal === 0;
        let validate = true;
        const startAttr = listBlock.attributes.start;
        let effectiveOrdinal = ordinal;
        if (startAttr != null) {
          effectiveOrdinal += parseInt(startAttr, 10) - 1;
        } else if (isFirst) {
          const startNum = Parser.resolveOrderedListStart(siblingTrait);
          if (startNum !== 1) {
            listBlock.attributes.start = startNum;
            effectiveOrdinal += startNum - 1;
            validate = false;
          }
        }
        const [resolvedMarker, implicitStyle] = Parser.resolveOrderedListMarker(
          siblingTrait,
          effectiveOrdinal,
          validate,
          reader
        );
        listItem.marker = resolvedMarker;
        if (isFirst && !style) {
          listBlock.style =
            implicitStyle ??
            ORDERED_LIST_STYLES[resolvedMarker.length - 1] ??
            'arabic';
        }
        if (itemText.startsWith('[[')) {
          const am = itemText.match(LeadingInlineAnchorRx);
          if (am) Parser.catalogInlineAnchor(am[1], am[2], listItem, reader);
        }
      } else {
        // colist
        listItem.marker = siblingTrait;
        if (itemText.startsWith('[[')) {
          const am = itemText.match(LeadingInlineAnchorRx);
          if (am) Parser.catalogInlineAnchor(am[1], am[2], listItem, reader);
        }
      }
    }

    await reader.readLine();
    const blockCursor = reader.cursor;
    const Rdr = Reader;
    const listItemLines = await Parser.readLinesForListItem(
      reader,
      listType,
      siblingTrait,
      hasText
    );
    const listItemReader = new Rdr(listItemLines, blockCursor);

    if (await listItemReader.hasMoreLines()) {
      if (sourcemapAssignmentDeferred) listItem.sourceLocation = blockCursor;
      const commentLines = await listItemReader.skipLineComments();
      const subsequentLine = await listItemReader.peekLine();
      if (subsequentLine != null) {
        if (commentLines.length > 0) listItemReader.unshiftLines(commentLines);
        let contentAdjacent = false;
        if (String(subsequentLine) !== '') {
          contentAdjacent = true;
          if (!dlist) hasText = null;
        }
        const block = await Parser.nextBlock(
          listItemReader,
          listItem,
          {},
          { text_only: hasText ? null : true, list_type: listType }
        );
        if (block) listItem.blocks.push(block);
        while (await listItemReader.hasMoreLines()) {
          const b = await Parser.nextBlock(
            listItemReader,
            listItem,
            {},
            { list_type: listType }
          );
          if (b) listItem.blocks.push(b);
        }
        if (
          contentAdjacent &&
          listItem.blocks.length > 0 &&
          listItem.blocks[0].context === 'paragraph'
        ) {
          listItem.foldFirst();
        }
      }
    }

    return dlist
      ? [
          [listTerm],
          listItem.hasText() || listItem.blocks.length > 0 ? listItem : null,
        ]
      : listItem
  }

  /**
   * Collect lines belonging to the current list item.
   * @returns {Promise<string[]>}
   * @internal
   */
  static async readLinesForListItem(
    reader,
    listType,
    siblingTrait = null,
    hasText = true
  ) {
    const buffer = [];
    let continuation = 'inactive';
    let withinNestedList = false;
    let detachedContinuation = null;
    const dlist = listType === 'dlist';
    let thisLine = null;

    while (await reader.hasMoreLines()) {
      thisLine = await reader.readLine();

      if (Parser.isSiblingListItem(thisLine, listType, siblingTrait)) break

      if (thisLine === LIST_CONTINUATION) thisLine = ListContinuationString;

      const prevLine = buffer.length > 0 ? buffer[buffer.length - 1] : null;

      if (isListContinuation(prevLine)) {
        if (continuation === 'inactive') {
          continuation = 'active';
          hasText = true;
          if (!withinNestedList)
            buffer[buffer.length - 1] = ListContinuationPlaceholder;
        }
        if (isListContinuation(thisLine)) {
          if (continuation !== 'frozen') {
            continuation = 'frozen';
            buffer.push(thisLine);
          }
          thisLine = null;
          continue
        }
      }

      const delimMatch = Parser.isDelimitedBlock(thisLine, true);
      if (delimMatch) {
        if (continuation !== 'active') break
        buffer.push(thisLine);
        const blockLines = await reader.readLinesUntil({
          terminator: delimMatch.terminator,
          read_last_line: true,
          context: delimMatch.context,
        });
        buffer.push(...blockLines);
        continuation = 'inactive';
      } else if (
        dlist &&
        continuation !== 'active' &&
        thisLine.startsWith('[') &&
        BlockAttributeLineRx.test(thisLine)
      ) {
        const blockAttributeLines = [thisLine];
        let interrupt = false;
        while (true) {
          const nextLine = await reader.peekLine();
          if (nextLine == null) break
          if (Parser.isDelimitedBlock(nextLine)) {
            interrupt = true;
            break
          }
          if (
            nextLine === '' ||
            (nextLine.startsWith('[') && BlockAttributeLineRx.test(nextLine))
          ) {
            blockAttributeLines.push(await reader.readLine());
          } else if (
            AnyListRx.test(nextLine) &&
            !Parser.isSiblingListItem(nextLine, listType, siblingTrait)
          ) {
            buffer.push(...blockAttributeLines);
            break
          } else {
            interrupt = true;
            break
          }
        }
        if (interrupt) {
          thisLine = null;
          reader.unshiftLines(blockAttributeLines);
          break
        }
      } else if (continuation === 'active' && thisLine !== '') {
        if (LiteralParagraphRx.test(thisLine)) {
          reader.unshiftLine(thisLine);
          if (dlist) {
            const lns = await reader.readLinesUntil(
              {
                preserve_last_line: true,
                break_on_blank_lines: true,
                break_on_list_continuation: true,
              },
              (line) => Parser.isSiblingListItem(line, listType, siblingTrait)
            );
            buffer.push(...lns);
          } else {
            const lns = await reader.readLinesUntil({
              preserve_last_line: true,
              break_on_blank_lines: true,
              break_on_list_continuation: true,
            });
            buffer.push(...lns);
          }
          continuation = 'inactive';
        } else if (
          (thisLine[0] === '.' && BlockTitleRx.test(thisLine)) ||
          (thisLine[0] === '[' && BlockAttributeLineRx.test(thisLine)) ||
          (thisLine[0] === ':' && AttributeEntryRx.test(thisLine))
        ) {
          buffer.push(thisLine);
        } else {
          if (!withinNestedList) {
            const nestedType = NESTABLE_LIST_CONTEXTS.find((ctx) =>
              ListRxMap[ctx].test(thisLine)
            );
            if (nestedType) {
              withinNestedList = true;
              if (
                nestedType === 'dlist' &&
                !thisLine.match(DescriptionListRx)?.[3]
              ) {
                hasText = false;
              }
            }
          }
          buffer.push(thisLine);
          continuation = 'inactive';
        }
      } else if (prevLine !== null && prevLine === '') {
        if (thisLine === '') {
          const skippedLine = await reader.skipBlankLines();
          if (skippedLine == null) {
            thisLine = null;
            break
          }
          thisLine = await reader.readLine();
          if (thisLine == null) break
          if (Parser.isSiblingListItem(thisLine, listType, siblingTrait)) break
        }
        if (String(thisLine) === LIST_CONTINUATION) {
          detachedContinuation = buffer.length;
          buffer.push(ListContinuationString);
        } else if (hasText) {
          if (Parser.isSiblingListItem(thisLine, listType, siblingTrait)) break
          const nestedType = NESTABLE_LIST_CONTEXTS.find((ctx) =>
            ListRxMap[ctx].test(thisLine)
          );
          if (nestedType) {
            buffer.push(thisLine);
            withinNestedList = true;
            if (
              nestedType === 'dlist' &&
              !thisLine.match(DescriptionListRx)?.[3]
            )
              hasText = false;
          } else if (LiteralParagraphRx.test(thisLine)) {
            reader.unshiftLine(thisLine);
            if (dlist) {
              const lns = await reader.readLinesUntil(
                {
                  preserve_last_line: true,
                  break_on_blank_lines: true,
                  break_on_list_continuation: true,
                },
                (line) => Parser.isSiblingListItem(line, listType, siblingTrait)
              );
              buffer.push(...lns);
            } else {
              const lns = await reader.readLinesUntil({
                preserve_last_line: true,
                break_on_blank_lines: true,
                break_on_list_continuation: true,
              });
              buffer.push(...lns);
            }
          } else {
            break
          }
        } else {
          if (!withinNestedList) buffer.pop();
          buffer.push(thisLine);
          hasText = true;
        }
      } else if (isListContinuation(thisLine)) {
        hasText = true;
        buffer.push(thisLine);
      } else {
        if (thisLine !== '') {
          hasText = true;
          const nestedType = (
            withinNestedList ? ['dlist'] : NESTABLE_LIST_CONTEXTS
          ).find((ctx) => ListRxMap[ctx].test(thisLine));
          if (nestedType) {
            withinNestedList = true;
            if (
              nestedType === 'dlist' &&
              !thisLine.match(DescriptionListRx)?.[3]
            )
              hasText = false;
          }
        }
        buffer.push(thisLine);
      }
      thisLine = null;
    }

    if (thisLine != null) reader.unshiftLine(thisLine);
    if (detachedContinuation != null)
      buffer[detachedContinuation] = ListContinuationPlaceholder;

    while (buffer.length > 0) {
      const last = buffer[buffer.length - 1];
      if (isListContinuation(last)) {
        buffer.pop();
        break
      }
      if (last === '') {
        buffer.pop();
      } else {
        break
      }
    }

    return buffer
  }

  /**
   * Initialize a Section from the current reader position.
   * @returns {Promise<Section>}
   * @internal
   */
  static async initializeSection(reader, parent, attributes = {}) {
    const document = parent.document;
    const doctype = document.doctype;
    const book = doctype === 'book';
    const sourceLocation = document.sourcemap ? reader.cursor : null;
    const sectStyle = attributes[1] ?? null;

    const [sectId, sectReftext, sectTitle, rawSectLevel, sectAtx] =
      await Parser.parseSectionTitle(reader, document, attributes.id);
    let sectLevel = rawSectLevel;

    let sectName,
      sectSpecial = false,
      sectNumbered = false;
    if (sectStyle) {
      if (book && sectStyle === 'abstract') {
        sectName = 'chapter';
        // sectLevel already 1 from parseSectionTitle typically
      } else if (
        sectStyle.startsWith('sect') &&
        SectionLevelStyleRx.test(sectStyle)
      ) {
        sectName = 'section';
      } else {
        sectName = sectStyle;
        sectSpecial = true;
        if (book && sectLevel === 0) sectLevel = 1;
        sectNumbered = sectName === 'appendix';
      }
    } else if (book) {
      sectName =
        sectLevel === 0 ? 'part' : sectLevel > 1 ? 'section' : 'chapter';
    } else if (
      doctype === 'manpage' &&
      sectTitle.toLowerCase() === 'synopsis'
    ) {
      sectName = 'synopsis';
      sectSpecial = true;
    } else {
      sectName = 'section';
    }

    if (sectReftext) attributes.reftext = sectReftext;
    const section = new Section(parent, sectLevel);
    section.id = sectId ?? null;
    section.title = sectTitle;
    section.sectname = sectName;
    section.sourceLocation = sourceLocation;

    if (sectSpecial) {
      section.special = true;
      if (sectNumbered) {
        section.numbered = true;
      } else if (document.attributes.sectnums === 'all') {
        section.numbered = book && sectLevel === 1 ? 'chapter' : true;
      }
    } else if ('sectnums' in document.attributes && sectLevel > 0) {
      section.numbered = section.special ? parent.numbered && true : true;
    } else if (book && sectLevel === 0 && 'partnums' in document.attributes) {
      section.numbered = true;
    }

    let id = section.id;
    if (id != null) {
      if (id === '') {
        section.id = id = null;
      } else if (sectTitle.includes(ATTR_REF_HEAD)) {
        // Force title resolution while in scope, mirroring Ruby's lazy-memo access
        // (`section.title` triggers `@converted_title ||= apply_title_subs(@title)`).
        // Must happen before _restoreAttributes resets body-scoped attribute values.
        await section.precomputeTitle();
      }
    } else if ('sectids' in document.attributes) {
      // Match Ruby behaviour: section.title returns apply_title_subs(@title) (fully substituted HTML).
      // InvalidSectionIdCharsRx then strips the HTML tags, so inline anchors, icon macros and
      // URL macros are correctly excluded from the generated ID.
      // precomputeTitle() is idempotent (guarded by #convertedTitle == null), so calling it here
      // prevents a second substitution pass in _resolveAllTexts (avoids double-cataloging images,
      // footnotes, etc.).
      await section.precomputeTitle();
      section.id = id = Section.generateId(section.title, document);
    }

    if (id && !document.register('refs', [id, section])) {
      const lineNo = reader.lineno - (sectAtx ? 1 : 2);
      Parser.logger.warn(
        Parser.messageWithContext(
          `id assigned to section already in use: ${id}`,
          { source_location: reader.cursorAtLine(lineNo) }
        )
      );
    }

    section.updateAttributes(attributes);
    await reader.skipBlankLines();

    return section
  }

  /**
   * Check if the next line is a section title.
   * @returns {Promise<number|null>} The section level, or null.
   * @internal
   */
  static async isNextLineSection(reader, attributes) {
    const style = attributes[1];
    if (style && (style === 'discrete' || style === 'float')) return null

    {
      const nextLines = await reader.peekLines(2, style && style === 'comment');
      return Parser.isSectionTitle(nextLines[0] ?? '', nextLines[1] ?? null)
    }
  }

  /**
   * Check if the next line is the document title.
   * @returns {Promise<boolean>}
   * @internal
   */
  static async isNextLineDoctitle(reader, attributes, leveloffset) {
    const sectLevel = await Parser.isNextLineSection(reader, attributes);
    if (sectLevel == null || sectLevel === false) return false
    if (leveloffset) {
      return sectLevel + parseInt(leveloffset, 10) === 0
    }
    return sectLevel === 0
  }

  /**
   * Check if line1 (and optionally line2) form a section title.
   * @param {string} line1
   * @param {string|null} [line2=null]
   * @returns {number|null} The section level, or null.
   */
  static isSectionTitle(line1, line2 = null) {
    const atxLevel = Parser.atxSectionTitle(line1);
    if (atxLevel != null) return atxLevel
    if (!line2) return null
    return Parser.setextSectionTitle(line1, line2)
  }

  /**
   * Check for ATX-style section title.
   * @param {string} line
   * @returns {number|null} The section level, or null.
   * @internal
   */
  static atxSectionTitle(line) {
    const rx = ExtAtxSectionTitleRx
      ;
    if (
      !(line.startsWith('=') || line.startsWith('#')
        )
    )
      return null
    const m = line.match(rx);
    return m ? m[1].length - 1 : null
  }

  /**
   * Check for setext-style section title.
   * @param {string} line1
   * @param {string} line2
   * @returns {number|null} The section level, or null.
   * @internal
   */
  static setextSectionTitle(line1, line2) {
    const ch0 = line2[0];
    const level = SETEXT_SECTION_LEVELS[ch0];
    if (level == null) return null
    if (!_uniform(line2, ch0, line2.length)) return null
    if (!SetextSectionTitleRx.test(line1)) return null
    if (Math.abs(line1.length - line2.length) >= 2) return null
    return level
  }

  /**
   * Parse section title from reader.
   * @param {Reader} reader
   * @param {Document} document
   * @param {string|null} [sectId=null]
   * @returns {Promise<[string|null, string|null, string, number, boolean]>} Tuple of [id, reftext, title, level, atx].
   */
  static async parseSectionTitle(reader, document, sectId = null) {
    let sectReftext = null,
      sectTitle,
      sectLevel,
      atx;

    const line1 = await reader.readLine();
    const rx = ExtAtxSectionTitleRx
      ;

    if (
      (line1.startsWith('=') || line1.startsWith('#')
        ) &&
      rx.test(line1)
    ) {
      const m = line1.match(rx);
      sectLevel = m[1].length - 1;
      sectTitle = m[2];
      atx = true;
      if (!sectId && sectTitle.endsWith(']]')) {
        const am = sectTitle.match(InlineSectionAnchorRx);
        if (am && !am[1]) {
          // not escaped
          sectTitle = sectTitle.slice(0, sectTitle.length - am[0].length);
          sectId = am[2];
          sectReftext = am[3] ?? null;
        }
      }
    } else {
      const line2 = await reader.peekLine(true);
      if (line2) {
        const ch0 = line2[0];
        const level = SETEXT_SECTION_LEVELS[ch0];
        if (
          level != null &&
          _uniform(line2, ch0, line2.length) &&
          SetextSectionTitleRx.test(line1) &&
          Math.abs(line1.length - line2.length) < 2
        ) {
          sectLevel = level;
          const m = line1.match(SetextSectionTitleRx);
          sectTitle = m ? m[1] : line1;
          atx = false;
          if (!sectId && sectTitle.endsWith(']]')) {
            const am = sectTitle.match(InlineSectionAnchorRx);
            if (am && !am[1]) {
              sectTitle = sectTitle.slice(0, sectTitle.length - am[0].length);
              sectId = am[2];
              sectReftext = am[3] ?? null;
            }
          }
          await reader.readLine();
        }
      }
    }

    if (sectTitle == null) {
      throw new Error(`Unrecognized section at ${reader.cursorAtPrevLine()}`)
    }

    const leveloffset = document.getAttribute('leveloffset');
    if (leveloffset) {
      sectLevel += parseInt(leveloffset, 10);
      if (sectLevel < 0) sectLevel = 0;
    }

    return [sectId, sectReftext, sectTitle, sectLevel, atx]
  }

  /**
   * Parse header metadata (author line and revision line).
   * @param {Reader} reader
   * @param {Document|null} [document=null]
   * @param {boolean} [retrieve=true]
   * @returns {Promise<Object|null>}
   */
  static async parseHeaderMetadata(reader, document = null, retrieve = true) {
    const docAttrs = document?.attributes;

    await Parser.processAttributeEntries(reader, document);

    let implicitAuthorMetadata = {};
    let authorcount = null;
    let implicitAuthor = null;
    let implicitAuthorinitials = null;
    let implicitAuthors = null;

    if ((await reader.hasMoreLines()) && !(await reader.isNextLineEmpty())) {
      const authorLine = await reader.readLine();
      const parsed = Parser.processAuthors(authorLine);
      authorcount = parsed.authorcount;
      delete parsed.authorcount;
      implicitAuthorMetadata = parsed;
      implicitAuthorMetadata.authorcount = authorcount;

      if (document && docAttrs) {
        docAttrs.authorcount = authorcount;
        if (authorcount > 0) {
          for (const [key, val] of Object.entries(parsed)) {
            if (!(key in docAttrs)) {
              docAttrs[key] = await document.applyHeaderSubs(val);
            }
          }
          implicitAuthor = docAttrs.author;
          implicitAuthorinitials = docAttrs.authorinitials;
          implicitAuthors = docAttrs.authors;
        }
      }

      await Parser.processAttributeEntries(reader, document);

      if ((await reader.hasMoreLines()) && !(await reader.isNextLineEmpty())) {
        const revLine = await reader.readLine();
        const rm = revLine.match(RevisionInfoLineRx);
        if (rm) {
          const revMetadata = {};
          if (rm[1]) revMetadata.revnumber = rm[1].trimEnd();
          if (rm[2]) {
            const component = rm[2].trim();
            if (component !== '') {
              if (!rm[1] && component.startsWith('v')) {
                revMetadata.revnumber = component.slice(1);
              } else {
                revMetadata.revdate = component;
              }
            }
          }
          if (rm[3]) revMetadata.revremark = rm[3].trimEnd();
          if (document && docAttrs && Object.keys(revMetadata).length > 0) {
            for (const [key, val] of Object.entries(revMetadata)) {
              if (!(key in docAttrs))
                docAttrs[key] = await document.applyHeaderSubs(val);
            }
          }
          Object.assign(implicitAuthorMetadata, revMetadata);
        } else {
          reader.unshiftLine(revLine);
        }
      }

      await Parser.processAttributeEntries(reader, document);
      await reader.skipBlankLines();
    }

    // Process author attribute entries that override (or stand in for) the implicit author line.
    let authorMetadata = null;
    if (document) {
      if ('author' in docAttrs && docAttrs.author !== implicitAuthor) {
        // author attribute was set or overridden; re-parse as names only (no multiple)
        authorMetadata = Parser.processAuthors(docAttrs.author, true, false);
        if (docAttrs.authorinitials !== implicitAuthorinitials) {
          delete authorMetadata.authorinitials;
        }
      } else if (
        'authors' in docAttrs &&
        docAttrs.authors !== implicitAuthors
      ) {
        // authors attribute was set or overridden; re-parse as names only (allow multiple)
        authorMetadata = Parser.processAuthors(docAttrs.authors, true);
      } else {
        // check for individual author_N overrides
        const authors = [];
        let authorIdx = 1;
        let authorKey = 'author_1';
        let explicit = false;
        let sparse = false;
        while (authorKey in docAttrs) {
          const authorOverride = docAttrs[authorKey];
          if (authorOverride === implicitAuthorMetadata[authorKey]) {
            authors.push(null);
            sparse = true;
          } else {
            authors.push(authorOverride);
            explicit = true;
          }
          authorKey = `author_${++authorIdx}`;
        }
        if (explicit) {
          if (sparse) {
            for (let idx = 0; idx < authors.length; idx++) {
              if (authors[idx] != null) continue
              const nameIdx = idx + 1;
              const parts = [
                implicitAuthorMetadata[`firstname_${nameIdx}`],
                implicitAuthorMetadata[`middlename_${nameIdx}`],
                implicitAuthorMetadata[`lastname_${nameIdx}`],
              ]
                .filter(Boolean)
                .map((n) => n.replace(/ /g, '_'));
              authors[idx] = parts.join(' ');
            }
          }
          // process as names only (no multiple — each entry is already a single author)
          authorMetadata = Parser.processAuthors(authors, true, false);
        } else {
          authorMetadata = { authorcount: 0 };
        }
      }

      if (authorMetadata.authorcount === 0) {
        if (authorcount != null) {
          authorMetadata = null;
        } else {
          docAttrs.authorcount = 0;
        }
      } else {
        Object.assign(docAttrs, authorMetadata);
        if (!('email' in docAttrs) && 'email_1' in docAttrs) {
          docAttrs.email = docAttrs.email_1;
        }
      }
    }

    if (!retrieve) return null
    return Object.assign({}, implicitAuthorMetadata, authorMetadata ?? {})
  }

  /**
   * Parse the author line into a metadata object.
   * @returns {Object}
   * @internal
   */
  static processAuthors(authorLine, namesOnly = false, multiple = true) {
    const authorMetadata = {};
    let authorIdx = 0;
    const entries =
      multiple && String(authorLine).includes(';')
        ? String(authorLine).split(AuthorDelimiterRx)
        : [].concat(authorLine);

    for (const authorEntry of entries) {
      const entry = String(authorEntry);
      if (entry === '') continue
      authorIdx++;

      const keyMap = {};
      if (authorIdx === 1) {
        for (const key of AuthorKeys) keyMap[key] = key;
      } else {
        for (const key of AuthorKeys) keyMap[key] = `${key}_${authorIdx}`;
      }

      let segments = null;
      if (namesOnly) {
        let cleanEntry = entry;
        if (entry.includes('<')) {
          authorMetadata[keyMap.author] = entry.replace(/_/g, ' ');
          cleanEntry = entry.replace(new RegExp(XmlSanitizeRx.source, 'g'), '');
        }
        // Ruby: split(nil, 3) — splits on whitespace, keeps remainder in 3rd element.
        // JS split with limit drops the remainder, so we split fully then cap at 3.
        const allParts = cleanEntry.split(/\s+/).filter(Boolean);
        const parts =
          allParts.length > 3
            ? [...allParts.slice(0, 2), allParts.slice(2).join(' ')]
            : allParts;
        if (parts.length === 3) {
          const last = parts.pop();
          parts.push(last.replace(/ {2,}/g, ' '));
        }
        segments = parts;
      } else {
        const m = entry.match(AuthorInfoLineRx);
        if (m) segments = m.slice(1);
      }

      if (segments) {
        const fname = segments[0].replace(/_/g, ' ');
        authorMetadata[keyMap.firstname] = fname;
        authorMetadata[keyMap.authorinitials] = fname[0];
        let author = fname;

        if (segments[1]) {
          if (segments[2]) {
            const mname = segments[1].replace(/_/g, ' ');
            const lname = segments[2].replace(/_/g, ' ');
            authorMetadata[keyMap.middlename] = mname;
            authorMetadata[keyMap.lastname] = lname;
            author = `${fname} ${mname} ${lname}`;
            authorMetadata[keyMap.authorinitials] =
              `${fname[0]}${mname[0]}${lname[0]}`;
          } else {
            const lname = segments[1].replace(/_/g, ' ');
            authorMetadata[keyMap.lastname] = lname;
            author = `${fname} ${lname}`;
            authorMetadata[keyMap.authorinitials] = `${fname[0]}${lname[0]}`;
          }
        }
        authorMetadata[keyMap.author] ??= author;
        if (!namesOnly && segments[3])
          authorMetadata[keyMap.email] = segments[3];
      } else {
        const author = entry.replace(/ {2,}/g, ' ').trim();
        authorMetadata[keyMap.author] = author;
        authorMetadata[keyMap.firstname] = author;
        authorMetadata[keyMap.authorinitials] = author[0];
      }

      if (authorIdx === 1) {
        authorMetadata.authors = authorMetadata[keyMap.author];
      } else {
        if (authorIdx === 2) {
          for (const key of AuthorKeys) {
            if (key in authorMetadata)
              authorMetadata[`${key}_1`] = authorMetadata[key];
          }
        }
        authorMetadata.authors = `${authorMetadata.authors}, ${authorMetadata[keyMap.author]}`;
      }
    }

    authorMetadata.authorcount = authorIdx;
    return authorMetadata
  }

  /**
   * Parse block metadata lines.
   * @returns {Promise<Object>} Accumulated attributes.
   * @internal
   */
  static async parseBlockMetadataLines(
    reader,
    document,
    attributes = {},
    options = {}
  ) {
    while (
      await Parser.parseBlockMetadataLine(reader, document, attributes, options)
    ) {
      await reader.readLine();
      if ((await reader.skipBlankLines()) == null) break
    }
    return attributes
  }

  /**
   * Parse the next line if it contains block metadata.
   * @returns {Promise<true|null>} True if the line is metadata, otherwise null.
   * @internal
   */
  static async parseBlockMetadataLine(
    reader,
    document,
    attributes,
    options = {}
  ) {
    const nextLine = await reader.peekLine();
    if (!nextLine) return null

    const textOnly = options.text_only;
    const normal =
      !textOnly &&
      (nextLine.startsWith('[') ||
        nextLine.startsWith('.') ||
        nextLine.startsWith('/') ||
        nextLine.startsWith(':'));
    const isAttrOrComment = textOnly
      ? nextLine.startsWith('[') || nextLine.startsWith('/')
      : normal;

    if (!isAttrOrComment) return null

    if (nextLine.startsWith('[')) {
      if (nextLine.startsWith('[[')) {
        if (nextLine.endsWith(']]')) {
          const m = nextLine.match(BlockAnchorRx);
          if (m) {
            attributes.id = m[1];
            if (m[2]) {
              const reftext = m[2];
              attributes.reftext = reftext.includes(ATTR_REF_HEAD)
                ? document.subAttributes(reftext)
                : reftext;
            }
            return true
          }
        }
      } else if (nextLine.endsWith(']')) {
        const m = nextLine.match(BlockAttributeListRx);
        if (m) {
          const currentStyle = attributes[1];
          const parsed = await document.parseAttributes(m[1], [], {
            sub_input: true,
            sub_result: true,
            into: attributes,
          });
          if (parsed[1]) {
            attributes[1] =
              Parser.parseStyleAttribute(attributes, reader) ?? currentStyle;
          }
          return true
        }
      }
    } else if (normal && nextLine.startsWith('.')) {
      const m = nextLine.match(BlockTitleRx);
      if (m) {
        attributes.title = m[1];
        return true
      }
    } else if (!normal || nextLine.startsWith('/')) {
      if (nextLine === '//') return true
      if (
        normal &&
        nextLine.startsWith('//') &&
        _uniform(nextLine, '/', nextLine.length)
      ) {
        if (nextLine.length !== 3) {
          await reader.readLinesUntil({
            terminator: nextLine,
            skip_first_line: true,
            preserve_last_line: true,
            skip_processing: true,
            context: 'comment',
          });
          return true
        }
      } else if (nextLine.startsWith('//') && !nextLine.startsWith('///')) {
        return true
      }
    } else if (normal && nextLine.startsWith(':')) {
      const m = nextLine.match(AttributeEntryRx);
      if (m) {
        await Parser.processAttributeEntry(reader, document, attributes, m);
        return true
      }
    }
    return null
  }

  /**
   * Process consecutive attribute entries.
   * @internal
   */
  static async processAttributeEntries(reader, document, attributes = null) {
    await reader.skipCommentLines();
    while (await Parser.processAttributeEntry(reader, document, attributes)) {
      await reader.readLine();
      await reader.skipCommentLines();
    }
  }

  /**
   * Process a single attribute entry.
   * @returns {Promise<boolean>}
   * @internal
   */
  static async processAttributeEntry(
    reader,
    document,
    attributes = null,
    match = null
  ) {
    if (!match) {
      if (!(await reader.hasMoreLines())) return false
      const pLine = await reader.peekLine();
      const m = pLine ? pLine.match(AttributeEntryRx) : null;
      if (!m) return false
      match = m;
    }

    let value = match[2] ?? '';
    if (value === '' || value == null) {
      value = '';
    } else if (
      value.endsWith(LINE_CONTINUATION) ||
      value.endsWith(LINE_CONTINUATION_LEGACY)
    ) {
      const conStr = value.slice(-2);
      value = value.slice(0, -2).trimEnd();
      while (await reader.advance()) {
        const nextLine = (await reader.peekLine()) ?? '';
        if (nextLine === '') break
        let next = nextLine.trimStart();
        const keepOpen = next.endsWith(conStr);
        if (keepOpen) next = next.slice(0, -2).trimEnd();
        value = `${value}${value.endsWith(' +') ? LF$1 : ' '}${next}`;
        if (!keepOpen) break
      }
    }

    // Pre-process pass macros with full async subs (e.g. quotes) before storeAttribute.
    // The sync _applyAttributeValueSubs inside setAttribute cannot handle async subs.
    if (document && value !== '') {
      const passMatch = value.match(AttributeEntryPassMacroRx);
      if (passMatch) {
        value = await document._applyAttributeEntryValueSubs(value);
        Parser.storeAttribute(match[1], value, document, attributes, {
          skipSubs: true,
        });
        return true
      }
    }

    Parser.storeAttribute(match[1], value, document, attributes);
    return true
  }

  /**
   * Store the attribute in the document.
   * @param {string} name
   * @param {string} value
   * @param {Document|null} [doc=null]
   * @param {Object|null} [attrs=null]
   * @param {Object} [opts={}]
   * @returns {[string, string|null]} Tuple of the resolved name and value.
   */
  static storeAttribute(name, value, doc = null, attrs = null, opts = {}) {
    if (name.endsWith('!')) {
      name = name.slice(0, -1);
      value = null;
    } else if (name.startsWith('!')) {
      name = name.slice(1);
      value = null;
    }

    name = Parser.sanitizeAttributeName(name);

    if (name === 'numbered') name = 'sectnums';
    else if (name === 'hardbreaks') name = 'hardbreaks-option';
    else if (name === 'showtitle') {
      // Ruby: '' is truthy so `value ? nil : ''` unsets notitle when showtitle is set.
      // In JS, '' is falsy, so we test value !== null instead.
      Parser.storeAttribute('notitle', value !== null ? null : '', doc, attrs);
    }

    if (doc) {
      if (value != null) {
        if (value !== '') {
          if (name === 'leveloffset') {
            const current =
              parseInt(doc.getAttribute('leveloffset', 0), 10) || 0;
            if (value.startsWith('+'))
              value = String(current + parseInt(value.slice(1), 10));
            else if (value.startsWith('-'))
              value = String(current - parseInt(value.slice(1), 10));
          }
        }
        // value === '' means set to empty string (Ruby: '' is truthy → setAttribute path)
        const resolvedValue = opts.skipSubs
          ? doc._setAttributeRaw(name, value)
          : doc.setAttribute(name, value);
        if (resolvedValue != null) {
          value = resolvedValue;
          if (attrs) new AttributeEntry(name, value).saveTo(attrs);
        }
      } else if (doc.deleteAttribute(name) && attrs) {
        new AttributeEntry(name, value).saveTo(attrs);
      }
    } else if (attrs) {
      new AttributeEntry(name, value).saveTo(attrs);
    }

    return [name, value]
  }

  /**
   * Read paragraph lines.
   * @returns {Promise<string[]>}
   * @internal
   */
  static async readParagraphLines(reader, breakAtList, opts = {}) {
    opts.break_on_blank_lines = true;
    opts.break_on_list_continuation = true;
    opts.preserve_last_line = true;

    // isPlaceholder matches only ListContinuationPlaceholder (empty boxed String), not ListContinuationString ('+').
    // We must not fire on ListContinuationString here because it would be preserved back to the reader,
    // and skipBlankLines would not consume it (String('+') ≠ ''), causing an infinite loop.
    const isPlaceholder = (l) => isListContinuation(l) && String(l) === '';

    let breakCondition = null;
    if (breakAtList) {
      breakCondition = (l) =>
            isPlaceholder(l) ||
            Parser.isDelimitedBlock(l) ||
            (l.startsWith('[') && BlockAttributeLineRx.test(l)) ||
            AnyListRx.test(l)
        ;
    } else {
      breakCondition = (l) =>
        isPlaceholder(l) ||
        (l.startsWith('[') && BlockAttributeLineRx.test(l)) ||
        Parser.isDelimitedBlock(l);
    }

    return await reader.readLinesUntil(opts, breakCondition)
  }

  /**
   * Check if line is the start of a delimited block.
   * @param {string} line
   * @param {boolean} [returnMatchData=false]
   * @returns {{context: string, masq: string[], tip: string, terminator: string}|true|null}
   *   BlockMatchData object if returnMatchData is true, true/null otherwise.
   */
  static isDelimitedBlock(line, returnMatchData = false) {
    let lineLen = line.length;
    if (lineLen < 2 || !DELIMITED_BLOCK_HEADS[line.slice(0, 2)]) return null

    let tip, tipLen;

    if (lineLen === 2) {
      tip = line;
      tipLen = 2;
    } else {
      tipLen = lineLen < 5 ? lineLen : 4;
      tip = line.slice(0, tipLen);

      // Fenced code special case
      if (tip.startsWith('`')) {
        if (tipLen === 4) {
          if (tip === '````') return null
          tip = tip.slice(0, 3);
          if (tip !== '```') return null
          // Mirror Ruby: line = tip; line_len = tip_len = 3
          // This ensures the returned terminator is '```', not the full opener line
          // (e.g. '```ruby'), so that readLinesUntil finds the correct closing delimiter.
          line = tip;
          lineLen = tipLen = 3;
        } else if (tip !== '```') {
          return null
        }
      } else if (tipLen === 3) {
        return null
      }
    }

    const entry = DELIMITED_BLOCKS[tip];
    if (!entry) return null
    const [context, masq] = entry;

    const isMatch =
      lineLen === tipLen ||
      (DELIMITED_BLOCK_TAILS[tip] != null &&
        _uniform(line.slice(1), DELIMITED_BLOCK_TAILS[tip], lineLen - 1));
    if (!isMatch) return null

    return returnMatchData ? { context, masq, tip, terminator: line } : true
  }

  /**
   * Resolve the list marker for a list item.
   * @returns {string}
   * @internal
   */
  static resolveListMarker(listType, marker) {
    if (listType === 'ulist') return marker
    if (listType === 'olist') return Parser.resolveOrderedListMarker(marker)[0]
    return '<1>'
  }

  /**
   * Resolve the normalized ordered list marker.
   * @returns {[string]|[string, string]} Tuple of [normalizedMarker] or [normalizedMarker, style].
   * @internal
   */
  static resolveOrderedListMarker(
    marker,
    ordinal = null,
    validate = false,
    reader = null
  ) {
    if (marker.startsWith('.')) return [marker]

    const style = ORDERED_LIST_STYLES.find((s) =>
      OrderedListMarkerRxMap[s].test(marker)
    );
    let normalizedMarker, expected, actual;

    switch (style) {
      case 'arabic':
        if (validate) {
          expected = String(ordinal + 1);
          actual = String(parseInt(marker, 10));
        }
        normalizedMarker = '1.';
        break
      case 'loweralpha':
        if (validate) {
          expected = String.fromCharCode(97 + ordinal);
          actual = marker.slice(0, -1);
        }
        normalizedMarker = 'a.';
        break
      case 'upperalpha':
        if (validate) {
          expected = String.fromCharCode(65 + ordinal);
          actual = marker.slice(0, -1);
        }
        normalizedMarker = 'A.';
        break
      case 'lowerroman':
        if (validate) {
          expected = intToRoman(ordinal + 1).toLowerCase();
          actual = marker.slice(0, -1);
        }
        normalizedMarker = 'i)';
        break
      case 'upperroman':
        if (validate) {
          expected = intToRoman(ordinal + 1);
          actual = marker.slice(0, -1);
        }
        normalizedMarker = 'I)';
        break
      default:
        normalizedMarker = marker;
    }

    if (ordinal != null) {
      if (validate && expected !== actual) {
        Parser.logger.warn(
          Parser.messageWithContext(
            `list item index: expected ${expected}, got ${actual}`,
            { source_location: reader?.cursor }
          )
        );
      }
      return [normalizedMarker, style]
    }
    return [normalizedMarker]
  }

  /**
   * Resolve the start value for an ordered list.
   * @param {string} marker
   * @returns {number}
   * @internal
   */
  static resolveOrderedListStart(marker) {
    if (marker.startsWith('.')) return 1
    const style = ORDERED_LIST_STYLES.find((s) =>
      OrderedListMarkerRxMap[s].test(marker)
    );
    switch (style) {
      case 'arabic':
        return parseInt(marker, 10)
      case 'loweralpha':
        return marker.slice(0, -1).charCodeAt(0) - 96
      case 'upperalpha':
        return marker.slice(0, -1).charCodeAt(0) - 64
      case 'lowerroman':
        return romanToInt(marker.slice(0, -1).toUpperCase())
      case 'upperroman':
        return romanToInt(marker.slice(0, -1))
      default:
        return 1
    }
  }

  /**
   * Check if this line is a sibling list item.
   * @returns {boolean}
   * @internal
   */
  static isSiblingListItem(line, listType, siblingTrait) {
    if (siblingTrait instanceof RegExp) return siblingTrait.test(line)
    const m = line.match(ListRxMap[listType]);
    if (!m) return false
    const resolvedSibling = Parser.resolveListMarker(listType, siblingTrait);
    return resolvedSibling === Parser.resolveListMarker(listType, m[1])
  }

  /**
   * Parse a table.
   * @returns {Promise<Table>}
   * @internal
   */
  static async parseTable(tableReader, parent, attributes) {
    const table = new Table(parent, attributes);

    let explicitColspecs = false;
    if ('cols' in attributes) {
      const colspecs = Parser.parseColspecs(attributes.cols);
      if (colspecs.length > 0) {
        table.createColumns(colspecs);
        explicitColspecs = true;
      }
    }

    const skipped = (await tableReader.skipBlankLines()) ?? 0;
    if ('header-option' in attributes) {
      table.hasHeaderOption = true;
    } else if (skipped === 0 && !('noheader-option' in attributes)) {
      table.hasHeaderOption = 'implicit';
    }
    let implicitHeader = table.hasHeaderOption === 'implicit';

    const parserCtx = new Table.ParserContext(tableReader, table, attributes);
    const format = parserCtx.format;
    let loopIdx = -1;
    let implicitHeaderBoundary = null;

    while (true) {
      let line = await tableReader.readLine();
      if (line == null) break

      const beyondFirst = ++loopIdx > 0;
      if (beyondFirst && line === '') {
        line = null;
        if (implicitHeaderBoundary != null) implicitHeaderBoundary++;
      } else if (format === 'psv') {
        if (parserCtx.startsWith(line)) {
          line = line.slice(1);
          await parserCtx.closeOpenCell();
          if (implicitHeaderBoundary != null) implicitHeaderBoundary = null;
        } else {
          const [nextCellspec, rest] = Parser.parseCellspec(
            line,
            'start',
            parserCtx.delimiter
          );
          if (nextCellspec != null) {
            await parserCtx.closeOpenCell(nextCellspec);
            if (implicitHeaderBoundary != null) implicitHeaderBoundary = null;
          } else if (
            implicitHeaderBoundary != null &&
            implicitHeaderBoundary === loopIdx
          ) {
            table.hasHeaderOption =
              implicitHeader =
              implicitHeaderBoundary =
                null;
          }
          line = rest;
        }
      }

      if (!beyondFirst) {
        tableReader.mark();
        if (implicitHeader) {
          if (
            (await tableReader.hasMoreLines()) &&
            (await tableReader.peekLine()) === ''
          ) {
            implicitHeaderBoundary = 1;
          } else {
            table.hasHeaderOption = implicitHeader = null;
          }
        }
      }

      // Inner loop for cell delimiter processing
      while (true) {
        if (line != null) {
          const m = line.match(parserCtx.delimiterRe);
          if (m) {
            const preMatch = line.slice(0, m.index);
            const postMatch = line.slice(m.index + m[0].length);
            if (format === 'csv') {
              if (parserCtx.bufferHasUnclosedQuotes(preMatch)) {
                parserCtx.skipPastDelimiter(preMatch);
                line = postMatch;
                if (line === '') break
                continue
              }
              parserCtx.buffer += preMatch;
            } else if (format === 'dsv') {
              if (preMatch.endsWith('\\')) {
                parserCtx.skipPastEscapedDelimiter(preMatch);
                if (postMatch === '') {
                  parserCtx.buffer += LF$1;
                  parserCtx.keepCellOpen();
                  break
                }
                line = postMatch;
                continue
              }
              parserCtx.buffer += preMatch;
            } else {
              if (preMatch.endsWith('\\')) {
                parserCtx.skipPastEscapedDelimiter(preMatch);
                if (postMatch === '') {
                  parserCtx.buffer += LF$1;
                  parserCtx.keepCellOpen();
                  break
                }
                line = postMatch;
                continue
              }
              const [nextSpec, cellText] = Parser.parseCellspec(preMatch);
              parserCtx.pushCellspec(nextSpec);
              parserCtx.buffer += cellText;
            }
            line = postMatch || null;
            await parserCtx.closeCell();
            if (postMatch === '') {
              if (format === 'csv' || format === 'dsv') {
                await parserCtx.closeCell(true);
              } else if (format === 'psv') {
                parserCtx.keepCellOpen();
              }
            }
          } else {
            parserCtx.buffer += line + LF$1;
            if (format === 'csv') {
              if (parserCtx.bufferHasUnclosedQuotes()) {
                if (implicitHeaderBoundary != null && loopIdx === 0) {
                  table.hasHeaderOption =
                    implicitHeader =
                    implicitHeaderBoundary =
                      null;
                }
                parserCtx.keepCellOpen();
              } else {
                await parserCtx.closeCell(true);
              }
            } else if (format === 'dsv') {
              await parserCtx.closeCell(true);
            } else {
              parserCtx.keepCellOpen();
            }
            break
          }
        } else {
          // null line = blank line; preserve in buffer so multi-paragraph cells are detected
          if (format === 'psv' && parserCtx.buffer !== '') {
            parserCtx.buffer += LF$1;
            parserCtx.keepCellOpen();
          } else if (format === 'csv' && parserCtx.isCellOpen()) {
            parserCtx.buffer += LF$1;
          }
          break
        }
      }

      if (parserCtx.isCellOpen()) {
        if (!(await tableReader.hasMoreLines())) await parserCtx.closeCell(true);
      } else {
        if ((await tableReader.skipBlankLines()) == null) break
      }
    }

    await parserCtx.closeTable();
    if (
      (table.attributes.colcount ??= table.columns.length) !== 0 &&
      !explicitColspecs
    ) {
      table.assignColumnWidths();
    }
    if (implicitHeader) table.hasHeaderOption = true;
    await table.partitionHeaderFooter(attributes);

    return table
  }

  /**
   * Parse column specs.
   * @param {string} records
   * @returns {Object[]}
   * @internal
   */
  static parseColspecs(records) {
    records = records.replace(/ /g, '');
    if (!records) return []
    if (records === String(parseInt(records, 10))) {
      return Array.from({ length: parseInt(records, 10) }, () => ({ width: 1 }))
    }
    const specs = [];
    const parts = records.includes(',')
      ? records.split(',')
      : records.split(';');
    for (const record of parts) {
      if (record === '') {
        specs.push({ width: 1 });
      } else {
        const m = record.match(ColumnSpecRx);
        if (!m) continue
        const spec = {};
        if (m[2]) {
          const [colspec, rowspec] = m[2].split('.');
          if (colspec && TableCellHorzAlignments[colspec])
            spec.halign = TableCellHorzAlignments[colspec];
          if (rowspec && TableCellVertAlignments[rowspec])
            spec.valign = TableCellVertAlignments[rowspec];
        }
        spec.width = m[3] ? (m[3] === '~' ? -1 : parseInt(m[3], 10)) : 1;
        if (m[4] && TableCellStyles[m[4]]) spec.style = TableCellStyles[m[4]];
        const repeat = m[1] ? parseInt(m[1], 10) : 1;
        for (let i = 0; i < repeat; i++) specs.push({ ...spec });
      }
    }
    return specs
  }

  /**
   * Parse cell test from line.
   * @param {string} line
   * @param {'start'|'end'} [pos='end']
   * @param {string|null} [delimiter=null]
   * @returns {[Object|null, string]} Tuple of [test, rest].
   * @internal
   */
  static parseCellspec(line, pos = 'end', delimiter = null) {
    let m,
      rest = '';

    if (pos === 'start') {
      if (!line.includes(delimiter)) return [null, line]
      const delimIdx = line.indexOf(delimiter);
      const specPart = line.slice(0, delimIdx);
      rest = line.slice(delimIdx + delimiter.length);
      m = specPart.match(CellSpecStartRx);
      if (!m) return [null, line]
      if (m[0] === '') return [{}, rest]
      if (specPart.trim() === '') return [null, line]
    } else {
      m = line.match(CellSpecEndRx);
      if (!m) return [{}, line]
      if (m[0].trimStart() === '') return [{}, line.trimEnd()]
      rest = line.slice(0, m.index);
    }

    const spec = {};
    if (m[1]) {
      const [colspec, rowspec] = m[1].split('.');
      const cs = colspec ? parseInt(colspec, 10) : 1;
      const rs = rowspec ? parseInt(rowspec, 10) : 1;
      if (m[2] === '+') {
        if (cs !== 1) spec.colspan = cs;
        if (rs !== 1) spec.rowspan = rs;
      } else if (m[2] === '*') {
        if (cs !== 1) spec.repeatcol = cs;
      }
    }
    if (m[3]) {
      const [colspec, rowspec] = m[3].split('.');
      if (colspec && TableCellHorzAlignments[colspec])
        spec.halign = TableCellHorzAlignments[colspec];
      if (rowspec && TableCellVertAlignments[rowspec])
        spec.valign = TableCellVertAlignments[rowspec];
    }
    if (m[4] && TableCellStyles[m[4]]) spec.style = TableCellStyles[m[4]];

    return [spec, rest]
  }

  /**
   * Parse the first positional attribute for style, role, id, and options.
   * @param {Object} attributes
   * @param {Reader|null} [reader=null]
   * @returns {string|null} The resolved style value.
   */
  static parseStyleAttribute(attributes, reader = null) {
    const rawStyle = attributes[1];
    if (
      !rawStyle ||
      rawStyle.includes(' ') ||
      false
    ) {
      return (attributes.style = rawStyle)
    }

    let name = null;
    let accum = '';
    const parsed = {};

    for (const c of rawStyle) {
      if (c === '.') {
        Parser._yieldBufferedAttribute(parsed, name, accum, reader);
        accum = '';
        name = 'role';
      } else if (c === '#') {
        Parser._yieldBufferedAttribute(parsed, name, accum, reader);
        accum = '';
        name = 'id';
      } else if (c === '%') {
        Parser._yieldBufferedAttribute(parsed, name, accum, reader);
        accum = '';
        name = 'option';
      } else {
        accum += c;
      }
    }

    if (name) {
      Parser._yieldBufferedAttribute(parsed, name, accum, reader);
      if (parsed.style) attributes.style = parsed.style;
      if ('id' in parsed) attributes.id = parsed.id;
      if ('role' in parsed) {
        const existing = attributes.role;
        attributes.role =
          !existing || existing === ''
            ? parsed.role.join(' ')
            : `${existing} ${parsed.role.join(' ')}`;
      }
      if ('option' in parsed) {
        for (const opt of parsed.option) attributes[`${opt}-option`] = '';
      }
      return parsed.style ?? null
    }
    return (attributes.style = rawStyle)
  }

  static _yieldBufferedAttribute(attrs, name, value, reader) {
    if (name) {
      if (value === '') {
        const msg = `invalid empty ${name} detected in style attribute`;
        if (reader)
          Parser.logger.warn(
            Parser.messageWithContext(msg, {
              source_location: reader.cursorAtPrevLine(),
            })
          );
        else Parser.logger.warn(msg);
      } else if (name === 'id') {
        if ('id' in attrs) {
          const msg = 'multiple ids detected in style attribute';
          if (reader)
            Parser.logger.warn(
              Parser.messageWithContext(msg, {
                source_location: reader.cursorAtPrevLine(),
              })
            );
          else Parser.logger.warn(msg);
        }
        attrs.id = value;
      } else {
(attrs[name] ??= []).push(value);
      }
    } else if (value !== '') {
      attrs.style = value;
    }
  }

  /**
   * Remove block indentation and optionally expand tabs.
   * @param {string[]} lines - Modified in place.
   * @param {number} [indentSize=0]
   * @param {number} [tabSize=0]
   * @internal
   */
  static adjustIndentation(lines, indentSize = 0, tabSize = 0) {
    if (!lines || lines.length === 0) return

    if (tabSize > 0 && lines.some((l) => l.includes('\t'))) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line === '' || !line.includes('\t')) continue
        let result = '';
        let spacesAdded = 0;
        let idx = 0;
        for (const c of line) {
          if (c === '\t') {
            const offset = idx + spacesAdded;
            const spaces = tabSize - (offset % tabSize) || tabSize;
            spacesAdded += spaces - 1;
            result += ' '.repeat(spaces);
          } else {
            result += c;
          }
          idx++;
        }
        lines[i] = result;
      }
    }

    if (indentSize < 0) return

    let blockIndent = null;
    for (const line of lines) {
      if (String(line) === '') continue
      const lineIndent = line.length - line.trimStart().length;
      if (lineIndent === 0) {
        blockIndent = null;
        break
      }
      if (blockIndent == null || lineIndent < blockIndent)
        blockIndent = lineIndent;
    }

    if (indentSize === 0) {
      if (blockIndent) {
        for (let i = 0; i < lines.length; i++) {
          if (String(lines[i]) !== '' && !isListContinuation(lines[i]))
            lines[i] = lines[i].slice(blockIndent);
        }
      }
    } else {
      const newIndent = ' '.repeat(indentSize);
      for (let i = 0; i < lines.length; i++) {
        if (String(lines[i]) !== '' && !isListContinuation(lines[i])) {
          lines[i] =
            newIndent + (blockIndent ? lines[i].slice(blockIndent) : lines[i]);
        }
      }
    }
  }

  /**
   * Check if string is uniform (all same character).
   * @param {string} str
   * @param {string} chr
   * @param {number} len
   * @returns {boolean}
   * @internal
   */
  static uniform(str, chr, len) {
    if (str.length !== len) return false
    for (const c of str) if (c !== chr) return false
    return true
  }

  /**
   * Convert an attribute name to a legal form.
   * @param {string} name
   * @returns {string}
   * @internal
   */
  static sanitizeAttributeName(name) {
    return name
      .replace(new RegExp(InvalidAttributeNameCharsRx.source, 'gu'), '')
      .toLowerCase()
  }

  // ── Logging mixin (static) ──────────────────────────────────────────────────
  // Declared here (in addition to being installed by applyLogging(Parser) below)
  // so that generated .d.ts declarations expose them — applyLogging() assigns
  // static properties after the class body closes, which tsc's declaration
  // emit can't see.

  /**
   * The logger used by the static Parser methods.
   * The Logging mixin (logging.js) overrides this getter on the class.
   * @returns {import('./logging.js').LoggerLike}
   */
  static get logger() {
    return LoggerManager.logger
  }

  /** @returns {import('./logging.js').LoggerLike} */
  static getLogger() {
    return this.logger
  }

  /**
   * Build an auto-formatting log message that carries structured source_location
   * (rather than baking it into the text), for use with `Parser.logger.warn(...)`.
   * @param {string} text
   * @param {{source_location?: any, include_location?: any}} [context={}]
   * @returns {{text: string, source_location?: any, include_location?: any, inspect(): string, toString(): string}}
   */
  static messageWithContext(text, context = {}) {
    return Logger.AutoFormattingMessage.attach({ text, ...context })
  }

  /** Alias for {@link messageWithContext} (used in extensions). */
  static createLogMessage(text, context = {}) {
    return this.messageWithContext(text, context)
  }
}

// Apply logging mixin to the Parser class itself (static methods use it via singleton)
applyLogging(Parser);

// ── Module-level helpers ──────────────────────────────────────────────────────

function _uniform(str, chr, len) {
  return Parser.uniform(str, chr, len)
}

// ESM conversion of extensions.rb
//
// Ruby-to-JavaScript notes:
//   - Ruby modules used as mixins → plain JS objects applied via Object.assign.
//   - Ruby :symbols used as keys → plain strings throughout.
//   - Ruby ::Set → JavaScript Set.
//   - Ruby defined? @foo → this._foo !== undefined.
//   - Ruby instance_exec(&block) → block.call(instance) or instance method call.
//   - Ruby singleton_class.enable_dsl → Object.assign(instance, kindClass.DSL).
//   - Ruby class << self → static methods.
//   - Ruby Helpers.resolve_class → typeof fn === 'function' check.
//   - Ruby @@class_var (InlineMacroProcessor.rx_cache) → static property.
//   - Config option keys (contentModel, positionalAttrs, defaultAttrs) use
//     camelCase, matching normal JS style. The legacy snake_case Ruby-style
//     keys (content_model, positional_attrs, pos_attrs, default_attrs) are
//     still accepted when a user declares a static config object directly,
//     for backward compatibility — see normalizeLegacyConfigAliases().
//   - String class-name resolution (e.g. preprocessor 'MyClass') is not supported;
//     pass the class constructor or an instance directly.
//   - Parser.parseBlocks / block.subAttributes / block.assignCaption are forward
//     references; they will be resolved when those modules implement the methods.


// Type-only imports for JSDoc
/**
 * @typedef {import('./document.js').Document} Document
 * @typedef {import('./abstract_block.js').AbstractBlock} AbstractBlock
 * @typedef {import('./reader.js').PreprocessorReader} PreprocessorReader
 */

// ── DSL interface types ───────────────────────────────────────────────────────

/**
 * DSL interface for configuring a {@link Processor} instance.
 * Applied to a processor instance via `Object.assign(instance, DslMixin)`.
 *
 * The `process` property behaves as a setter when called with a single Function
 * argument (stores the process block), or as a passthrough caller otherwise.
 *
 * @typedef {object} ProcessorDslInterface
 * @property {(key: string, value: unknown) => void} option - Set a config option.
 * @property {(fn: (...args: unknown[]) => unknown) => void} process - Register the process function.
 * @property {() => boolean} processBlockGiven - Returns true if a process function has been registered.
 */

/**
 * DSL interface for document processors (Preprocessor, TreeProcessor, Postprocessor, DocinfoProcessor).
 *
 * @typedef {ProcessorDslInterface & { prefer(): void; prepend(): void }} DocumentProcessorDslInterface
 */

/**
 * DSL interface for preprocessors.
 *
 * @typedef {Omit<DocumentProcessorDslInterface, 'process'> & {
 *   process(fn: (this: PreprocessorDslInterface, document: Document, reader: PreprocessorReader) => Reader | void): void;
 * }} PreprocessorDslInterface
 */

/**
 * DSL interface for tree processors.
 *
 * @typedef {Omit<DocumentProcessorDslInterface, 'process'> & {
 *   process(fn: (this: TreeProcessorDslInterface, document: Document) => Document | void): void;
 * }} TreeProcessorDslInterface
 */

/**
 * DSL interface for postprocessors.
 *
 * @typedef {Omit<DocumentProcessorDslInterface, 'process'> & {
 *   process(fn: (this: PostprocessorDslInterface, document: Document, output: string) => string): void;
 * }} PostprocessorDslInterface
 */

/**
 * DSL interface for syntax processors (BlockProcessor, BlockMacroProcessor, InlineMacroProcessor).
 *
 * @typedef {ProcessorDslInterface & {
 *   named(value: string): void;
 *   contentModel(value: string): void;
 *   parseContentAs(value: string): void;
 *   positionalAttributes(...value: string[]): void;
 *   namePositionalAttributes(...value: string[]): void;
 *   positionalAttrs(...value: string[]): void;
 *   defaultAttributes(value: Record<string, string>): void;
 *   defaultAttrs(value: Record<string, string>): void;
 *   resolveAttributes(...args: unknown[]): void;
 *   resolvesAttributes(...args: unknown[]): void;
 * }} SyntaxProcessorDslInterface
 */

/**
 * DSL interface for include processors.
 *
 * @typedef {Omit<DocumentProcessorDslInterface, 'process'> & {
 *   handles(fn: (target: string) => boolean): void;
 *   handles(fn: (doc: Document, target: string) => boolean): void;
 *   process(fn: (this: IncludeProcessorDslInterface, document: Document, reader: PreprocessorReader, target: string, attributes: Record<string, string>) => void): void;
 * }} IncludeProcessorDslInterface
 */

/**
 * DSL interface for docinfo processors.
 *
 * @typedef {Omit<DocumentProcessorDslInterface, 'process'> & {
 *   atLocation(value: string): void;
 *   process(fn: (this: DocinfoProcessorDslInterface, document: Document) => string): void;
 * }} DocinfoProcessorDslInterface
 */

/**
 * DSL interface for block processors.
 *
 * The `process` callback is bound to the processor instance, so `this` inside it
 * (and inside the registration function) exposes the `createBlock` helpers.
 *
 * @typedef {Omit<SyntaxProcessorDslInterface, 'process'> & {
 *   contexts(...value: (string | string[])[]): void;
 *   onContexts(...value: (string | string[])[]): void;
 *   onContext(...value: (string | string[])[]): void;
 *   bindTo(...value: (string | string[])[]): void;
 *   createBlock(parent: AbstractBlock, context: string, source?: string | string[] | null, attrs?: object, opts?: object): Block;
 *   process(fn: (this: BlockProcessorDslInterface, parent: AbstractBlock, reader: Reader, attributes: Record<string, unknown>) => AbstractBlock | void): void;
 * }} BlockProcessorDslInterface
 */

/**
 * DSL interface for macro processors (block and inline macros).
 *
 * @typedef {SyntaxProcessorDslInterface} MacroProcessorDslInterface
 */

/**
 * DSL interface for block macro processors.
 *
 * The `process` callback is bound to the processor instance, so `this` inside it
 * (and inside the registration function) exposes the `createBlock` helpers.
 *
 * @typedef {Omit<MacroProcessorDslInterface, 'process'> & {
 *   createBlock(parent: AbstractBlock, context: string, source?: string | string[] | null, attrs?: object, opts?: object): Block;
 *   process(fn: (this: BlockMacroProcessorDslInterface, parent: AbstractBlock, target: string, attributes: Record<string, unknown>) => AbstractBlock | void): void;
 * }} BlockMacroProcessorDslInterface
 */

/**
 * DSL interface for inline macro processors.
 *
 * The `process` callback is bound to the processor instance, so `this` inside it
 * (and inside the registration function) exposes the `createInline` helper.
 *
 * @typedef {Omit<MacroProcessorDslInterface, 'process'> & {
 *   format(value: string): void;
 *   matchFormat(value: string): void;
 *   usingFormat(value: string): void;
 *   match(value: RegExp): void;
 *   createInline(parent: AbstractBlock, context: string, text: string, opts?: object): Inline;
 *   process(fn: (this: InlineMacroProcessorDslInterface, parent: AbstractBlock, target: string, attributes: Record<string, unknown>) => Inline | void): void;
 * }} InlineMacroProcessorDslInterface
 */

// ── DSL Mixins ────────────────────────────────────────────────────────────────

/**
 * @internal Builder DSL mixin for configuring a Processor instance.
 * Applied to a processor instance via Object.assign(instance, DslMixin).
 *
 * The process() method has dual behaviour (mirrors Ruby's block / no-block):
 *   - Called with a single Function argument → stores it as the process block.
 *   - Called with non-Function arguments   → invokes the stored process block.
 *
 * The `this` context inside a stored process function is bound to the processor
 * instance at definition time.
 */
const ProcessorDsl = {
  option(key, value) {
    this.config[key] = value;
  },

  process(...args) {
    if (args.length === 1 && typeof args[0] === 'function') {
      this._processBlock = args[0].bind(this);
    } else if (this._processBlock !== undefined) {
      return this._processBlock(...args)
    } else {
      throw new Error(
        `${this.constructor.name} #process method called before being registered`
      )
    }
  },

  processBlockGiven() {
    return this._processBlock !== undefined
  },
};

const DocumentProcessorDsl = {
  ...ProcessorDsl,

  prefer() {
    this.option('position', '>>');
  },

  /** Alias for {@link prefer}. */
  prepend() {
    this.prefer();
  },
};

const SyntaxProcessorDsl = {
  ...ProcessorDsl,

  named(value) {
    // When applied to a processor instance, set the name directly.
    // When applied to a class (via static enableDsl), store in config.
    if (this instanceof Processor) {
      this.name = value;
    } else {
      this.option('name', value);
    }
  },

  contentModel(value) {
    this.option('contentModel', value);
  },

  /** Alias for {@link contentModel}. */
  parseContentAs(value) {
    this.option('contentModel', value);
  },

  positionalAttributes(...value) {
    this.option('positionalAttrs', value.flat().map(String));
  },

  /** Alias for {@link positionalAttributes}. */
  namePositionalAttributes(...value) {
    this.option('positionalAttrs', value.flat().map(String));
  },

  positionalAttrs(...value) {
    this.option('positionalAttrs', value.flat().map(String));
  },

  defaultAttributes(value) {
    this.option('defaultAttrs', value);
  },

  /** @deprecated Alias for {@link defaultAttributes}. */
  defaultAttrs(value) {
    this.option('defaultAttrs', value);
  },

  /**
   * Resolve and register positional attribute names and default values.
   *
   * Accepts any of:
   *   resolveAttributes()             → positionalAttrs: [], defaultAttrs: {}
   *   resolveAttributes('foo', 'bar') → positional maps (Array-style)
   *   resolveAttributes({...})        → positional maps (Object-style)
   *
   * Array-style tokens understand positional-index notation (e.g. '1:name',
   * '@:name') and default-value notation (e.g. 'name=value', '1:name=value').
   *
   * @param {...*} args - Positional attribute specifications.
   */
  resolveAttributes(...args) {
    // Normalise: if 0 or 1 argument given, unwrap into a single value.
    if (args.length <= 1) {
      const first = args.length === 0 ? true : args[0];
      if (typeof first === 'string' || typeof first === 'symbol') {
        args = [first];
      } else {
        args = first; // true, Array, or plain Object
      }
    }

    if (args === true) {
      this.option('positionalAttrs', []);
      this.option('defaultAttrs', {});
    } else if (Array.isArray(args)) {
      const names = [];
      const defaults = {};
      for (let arg of args) {
        arg = String(arg);
        if (arg.includes('=')) {
          const eqIdx = arg.indexOf('=');
          let name = arg.slice(0, eqIdx);
          const value = arg.slice(eqIdx + 1);
          if (name.includes(':')) {
            const colonIdx = name.indexOf(':');
            const idxStr = name.slice(0, colonIdx);
            name = name.slice(colonIdx + 1);
            const idx = idxStr === '@' ? names.length : parseInt(idxStr, 10);
            names[idx] = name;
          }
          defaults[name] = value;
        } else if (arg.includes(':')) {
          const colonIdx = arg.indexOf(':');
          const idxStr = arg.slice(0, colonIdx);
          const name = arg.slice(colonIdx + 1);
          const idx = idxStr === '@' ? names.length : parseInt(idxStr, 10);
          names[idx] = name;
        } else {
          names.push(arg);
        }
      }
      this.option(
        'positionalAttrs',
        names.filter((n) => n != null)
      );
      this.option('defaultAttrs', defaults);
    } else if (typeof args === 'object' && args !== null) {
      const names = [];
      const defaults = {};
      for (const [key, val] of Object.entries(args)) {
        let name = String(key);
        if (name.includes(':')) {
          const colonIdx = name.indexOf(':');
          const idxStr = name.slice(0, colonIdx);
          name = name.slice(colonIdx + 1);
          const idx = idxStr === '@' ? names.length : parseInt(idxStr, 10);
          names[idx] = name;
        }
        if (val) defaults[name] = val;
      }
      this.option(
        'positionalAttrs',
        names.filter((n) => n != null)
      );
      this.option('defaultAttrs', defaults);
    } else {
      throw new Error(`unsupported attributes specification for macro: ${args}`)
    }
  },

  /** @deprecated Alias for {@link resolveAttributes}. */
  resolvesAttributes(...args) {
    this.resolveAttributes(...args);
  },
};

const IncludeProcessorDsl = {
  ...DocumentProcessorDsl,

  /**
   * @overload
   * @param {(target: string) => boolean} fn - Predicate that receives only the include target.
   * @returns {void}
   */
  /**
   * @overload
   * @param {(doc: Document, target: string) => boolean} fn - Predicate that receives the document and the include target.
   * @returns {void}
   */
  /**
   * @overload
   * @param {Document} doc - The document being parsed.
   * @param {string} target - The include target.
   * @returns {boolean}
   */
  /**
   * Register a function that decides whether this include processor handles a given target,
   * or invoke the registered handler.
   *
   * **Setter form** — register a predicate. The callback may accept either just the target
   * string (arity 1) or both the document and the target string (arity 2).
   *
   * **Invoker form** — call the registered predicate with `(doc, target)` and return its
   * result, or return `true` if no predicate has been registered.
   *
   * @param {...*} args
   * @returns {boolean | void}
   */
  handles(...args) {
    if (args.length === 1 && typeof args[0] === 'function') {
      const fn = args[0];
      // Normalise arity-1 handle blocks to accept (doc, target)
      this._handlesBlock =
        fn.length === 1 ? (_doc, target) => fn(target) : fn.bind(this);
    } else if (this._handlesBlock !== undefined) {
      return this._handlesBlock(args[0], args[1])
    } else {
      return true
    }
  },
};

const DocinfoProcessorDsl = {
  ...DocumentProcessorDsl,

  atLocation(value) {
    this.option('location', value);
  },
};

const BlockProcessorDsl = {
  ...SyntaxProcessorDsl,

  contexts(...value) {
    this.option('contexts', new Set(value.flat()));
  },

  // aliases
  onContexts(...value) {
    this.contexts(...value);
  },
  onContext(...value) {
    this.contexts(...value);
  },
  bindTo(...value) {
    this.contexts(...value);
  },
};

const MacroProcessorDsl = {
  ...SyntaxProcessorDsl,

  /**
   * Override: passing a falsy value sets contentModel to 'text' instead of
   * configuring positional attributes.
   *
   * @param {...*} args - Positional attribute specifications.
   */
  resolveAttributes(...args) {
    if (args.length === 1 && !args[0]) {
      this.option('contentModel', 'text');
    } else {
      SyntaxProcessorDsl.resolveAttributes.call(this, ...args);
      this.option('contentModel', 'attributes');
    }
  },

  /** @deprecated Alias for {@link resolveAttributes}. */
  resolvesAttributes(...args) {
    this.resolveAttributes(...args);
  },
};

const InlineMacroProcessorDsl = {
  ...MacroProcessorDsl,

  format(value) {
    this.option('format', value);
  },

  /** Alias for {@link format}. */
  matchFormat(value) {
    this.option('format', value);
  },
  /** @deprecated Alias for {@link format}. */
  usingFormat(value) {
    this.option('format', value);
  },

  match(value) {
    this.option('regexp', value);
  },
};

// ── Processor ────────────────────────────────────────────────────────────────

/**
 * Legacy Ruby-style snake_case config keys, mapped to the camelCase keys
 * actually read by the parser/substitutor. Only consulted when a processor
 * is declared with a raw static config object (e.g. `static config = {
 * content_model: 'attributes' }`) that bypasses the DSL setters, which
 * already write camelCase directly.
 */
const LEGACY_CONFIG_ALIASES = {
  content_model: 'contentModel',
  positional_attrs: 'positionalAttrs',
  pos_attrs: 'positionalAttrs',
  default_attrs: 'defaultAttrs',
};

/** @internal Fill in camelCase config keys from their legacy snake_case alias. */
function normalizeLegacyConfigAliases(config) {
  for (const [legacyKey, key] of Object.entries(LEGACY_CONFIG_ALIASES)) {
    if (config[key] === undefined && config[legacyKey] !== undefined) {
      config[key] = config[legacyKey];
    }
  }
  return config
}

/**
 * Abstract base class for document and syntax processors.
 *
 * Provides a class-level config map (via static config / static option) and a
 * set of convenience factory methods for creating AST nodes.
 */
class Processor {
  /**
   * Get the static configuration map for this processor class.
   * Uses hasOwnProperty to avoid inheriting a parent class's config object
   * through the prototype chain when a subclass first accesses config.
   *
   * @returns {object}
   */
  static get config() {
    if (!Object.hasOwn(this, '_config')) this._config = {};
    return this._config
  }

  /**
   * Replace the static configuration map for this processor class, e.g.
   * `ShoutBlock.config = { name: 'shout', contentModel: 'simple' }`.
   *
   * @param {object} value
   */
  static set config(value) {
    this._config = value;
  }

  /**
   * Set a default option value for all instances of this processor class.
   *
   * @param {string} key - The option key.
   * @param {*} value - The option value.
   */
  static option(key, value) {
    this.config[key] = value;
  }

  /**
   * Mix the DSL object for this processor class into its prototype.
   */
  static enableDsl() {
    const DSL = this.DSL;
    if (DSL) Object.assign(this.prototype, DSL);
  }
  /** Alias for {@link enableDsl}. */
  static useDsl() {
    this.enableDsl();
  }

  constructor(config = {}) {
    this.config = {
      ...normalizeLegacyConfigAliases({ ...this.constructor.config }),
      ...normalizeLegacyConfigAliases({ ...config }),
    };
  }

  updateConfig(config) {
    Object.assign(this.config, normalizeLegacyConfigAliases({ ...config }));
  }

  process(..._args) {
    throw new Error(
      `${this.constructor.name} subclass must implement the process method`
    )
  }

  /**
   * Create a Section node in the same manner as the parser.
   *
   * @param {Section|Document} parent - The parent Section or Document of this new Section.
   * @param {string} title - The String title of the new Section.
   * @param {object} attrs - A plain object of attributes to control how the section is built.
   *   Use the style attribute to set the name of a special section (e.g. appendix).
   *   Use the id attribute to assign an explicit ID, or set it to false to
   *   disable automatic ID generation (when sectids document attribute is set).
   * @param {object} [opts={}] - An optional plain object of options:
   *   - level {number} - The Integer level to assign; defaults to parent.level + 1.
   *   - numbered {boolean} - Flag to force numbering.
   * @returns {Section} a Section node with all properties properly initialized.
   */
  createSection(parent, title, attrs, opts = {}) {
    const doc = parent.document;
    const doctype = doc.doctype;
    const book = doctype === 'book';
    const level = opts.level ?? parent.level + 1;

    let sectname,
      special = false;
    const style = attrs.style;
    if (style) {
      delete attrs.style;
      if (book && style === 'abstract') {
        sectname = 'chapter';
        // level intentionally set to 1 (overrides local const)
        Object.defineProperty(opts, '_level', { value: 1 });
      } else {
        sectname = style;
        special = true;
      }
    } else if (book) {
      sectname = level === 0 ? 'part' : level > 1 ? 'section' : 'chapter';
    } else if (doctype === 'manpage' && title.toLowerCase() === 'synopsis') {
      sectname = 'synopsis';
      special = true;
    } else {
      sectname = 'section';
    }

    // Re-derive level if style forced it (appendix/abstract style override)
    const effectiveLevel =
      style && book && style === 'abstract'
        ? 1
        : style && special && level === 0
          ? 1
          : level;

    const sect = new Section(parent, effectiveLevel);
    sect.title = title;
    sect.sectname = sectname;

    if (special) {
      sect.special = true;
      if ('numbered' in opts ? opts.numbered : style === 'appendix') {
        sect.numbered = true;
      } else if (!('numbered' in opts) && doc.hasAttribute('sectnums', 'all')) {
        sect.numbered = book && effectiveLevel === 1 ? 'chapter' : true;
      }
    } else if (effectiveLevel > 0) {
      if ('numbered' in opts ? opts.numbered : doc.hasAttribute('sectnums')) {
        sect.numbered = sect.special ? !!parent.numbered : true;
      }
    } else if (
      'numbered' in opts ? opts.numbered : book && doc.hasAttribute('partnums')
    ) {
      sect.numbered = true;
    }

    if (attrs.id === false) {
      delete attrs.id;
    } else {
      sect.id = attrs.id =
        attrs.id ||
        (doc.hasAttribute('sectids')
          ? Section.generateId(sect.title, doc)
          : null);
    }
    sect.updateAttributes(attrs);
    return sect
  }

  /**
   * Create a generic block node and link it to the specified parent.
   *
   * @param {Block|Section} parent - The parent node.
   * @param {string} context - The block context (e.g. 'paragraph', 'listing').
   * @param {string|string[]|null} source - The source content.
   * @param {object} attrs - A plain object of attributes.
   * @param {object} [opts={}] - An optional plain object of options.
   * @returns {Block} a Block node with all properties properly initialized.
   */
  createBlock(parent, context, source, attrs, opts = {}) {
    return new Block(parent, context, { source, attributes: attrs, ...opts })
  }

  /**
   * Create a list node and link it to the specified parent.
   *
   * @param {Block|Section|Document} parent - The parent of this new list.
   * @param {string} context - The list context ('ulist', 'olist', 'colist', 'dlist').
   * @param {object|null} [attrs=null] - A plain object of attributes to set on this list block.
   * @returns {List} a List node with all properties properly initialized.
   */
  createList(parent, context, attrs = null) {
    const list = new List(parent, context);
    if (attrs) list.updateAttributes(attrs);
    return list
  }

  /**
   * Create a list item node and link it to the specified parent.
   *
   * @param {List} parent - The parent List of this new list item.
   * @param {string|null} [text=null] - The text of the list item.
   * @returns {ListItem} a ListItem node with all properties properly initialized.
   */
  createListItem(parent, text = null) {
    return new ListItem(parent, text)
  }

  /**
   * Create an image block node and link it to the specified parent.
   *
   * @param {Block|Section|Document} parent - The parent of this new image block.
   * @param {object} attrs - A plain object of attributes to control how the image block is built.
   *   The target attribute sets the image source; alt sets the alt text.
   * @param {object} [opts={}] - An optional plain object of options.
   * @returns {Block} a Block node with all properties properly initialized.
   */
  createImageBlock(parent, attrs, opts = {}) {
    const target = attrs.target;
    if (!target)
      throw new Error(
        'Unable to create an image block, target attribute is required'
      )
    if (!attrs.alt)
      attrs.alt = attrs['default-alt'] = basename(target, true).replace(
        /[_-]/g,
        ' '
      );
    const title = 'title' in attrs ? attrs.title : null;
    if (title !== null) delete attrs.title;
    const block = this.createBlock(parent, 'image', null, attrs, opts);
    if (title) {
      block.title = title;
      const caption = attrs.caption;
      delete attrs.caption;
      block.assignCaption(caption, 'figure');
    }
    return block
  }

  /**
   * Create an inline node and bind it to the specified parent.
   *
   * @param {Block} parent - The parent Block of this new inline node.
   * @param {string} context - The context of the inline node ('quoted', 'anchor', etc.).
   * @param {string} text - The text of the inline node.
   * @param {object} [opts={}] - An optional plain object of options:
   *   - type {string} - The subtype of the inline node context.
   *   - attributes {object} - Attributes to set on the inline node.
   * @returns {Inline} an Inline node with all properties properly initialized.
   */
  createInline(parent, context, text, opts = {}) {
    const options = context === 'quoted' ? { type: 'unquoted', ...opts } : opts;
    return new Inline(parent, context, text, options)
  }

  /**
   * Parse blocks in the content and attach them to the parent.
   *
   * @param {Block|Section} parent - The parent node.
   * @param {string[]|Reader} content - Lines or a Reader.
   * @param {object|null} [attributes=null] - Attributes to pass to the parser.
   * @returns {Promise<Block|Section>} the parent node into which the blocks are parsed.
   */
  async parseContent(parent, content, attributes = null) {
    const reader = content instanceof Reader ? content : new Reader(content);
    await Parser.parseBlocks(reader, parent, attributes);
    return parent
  }

  /**
   * Parse the attrlist String into a plain object of attributes.
   *
   * @param {Block|Section} block - The current block (used for applying subs).
   * @param {string} attrlist - The list of attributes as a String.
   * @param {object} [opts={}] - An optional plain object of options:
   *   - positional_attributes {string[]} - Array of attribute names to map positional args to.
   *   - sub_attributes {boolean} - Enables attribute substitution on attrlist.
   * @returns {Promise<object>} a plain object of parsed attributes.
   */
  async parseAttributes(block, attrlist, opts = {}) {
    if (!attrlist || attrlist.length === 0) return {}
    if (opts.sub_attributes && attrlist.includes(ATTR_REF_HEAD)) {
      attrlist = block.subAttributes(attrlist);
    }
    return new AttributeList(attrlist).parse(opts.positional_attributes || [])
  }

  /** Shorthand for {@link createBlock} with context 'paragraph'. */
  createParagraph(parent, ...rest) {
    return this.createBlock(parent, 'paragraph', ...rest)
  }

  /** Shorthand for {@link createBlock} with context 'open'. */
  createOpenBlock(parent, ...rest) {
    return this.createBlock(parent, 'open', ...rest)
  }

  /** Shorthand for {@link createBlock} with context 'example'. */
  createExampleBlock(parent, ...rest) {
    return this.createBlock(parent, 'example', ...rest)
  }

  /** Shorthand for {@link createBlock} with context 'pass'. */
  createPassBlock(parent, ...rest) {
    return this.createBlock(parent, 'pass', ...rest)
  }

  /** Shorthand for {@link createBlock} with context 'listing'. */
  createListingBlock(parent, ...rest) {
    return this.createBlock(parent, 'listing', ...rest)
  }

  /** Shorthand for {@link createBlock} with context 'literal'. */
  createLiteralBlock(parent, ...rest) {
    return this.createBlock(parent, 'literal', ...rest)
  }

  /** Shorthand for {@link createInline} with context 'anchor'. */
  createAnchor(parent, ...rest) {
    return this.createInline(parent, 'anchor', ...rest)
  }

  /** Shorthand for {@link createInline} with context 'quoted'. */
  createInlinePass(parent, ...rest) {
    return this.createInline(parent, 'quoted', ...rest)
  }
}

// ── Document processors ───────────────────────────────────────────────────────

/**
 * Preprocessors are run after the source text is split into lines and
 * normalised, but before parsing begins.
 *
 * Asciidoctor passes the document and the document's Reader to the process
 * method of the Preprocessor instance. The Preprocessor can modify the Reader
 * as necessary and either return the same Reader (or falsy) or a substitute Reader.
 *
 * Implementations must extend Preprocessor and override {@link process}.
 *
 * @example
 * class CommentStripPreprocessor extends Preprocessor {
 *   process(document, reader) {
 *     const lines = reader.getLines().filter((l) => !l.startsWith('//'))
 *     reader.pushInclude(lines, null, null, 1, {})
 *     return reader
 *   }
 * }
 * // Register:
 * Extensions.register(function () { this.preprocessor(CommentStripPreprocessor) })
 */
class Preprocessor extends Processor {
  /**
   * @param {Document} document - The document being parsed.
   * @param {PreprocessorReader} reader - The reader positioned at the beginning of the source.
   * @returns {Reader|undefined} The same or a substitute Reader, or undefined to use the original.
   */
  process(document, reader) {
    throw new Error(
      `${this.constructor.name} must implement the process method`
    )
  }
}
Preprocessor.DSL = DocumentProcessorDsl;

/**
 * TreeProcessors are run on the Document after the source has been
 * parsed into an abstract syntax tree (AST).
 *
 * Implementations must extend TreeProcessor and override {@link process}.
 *
 * @example
 * class ShoutTreeProcessor extends TreeProcessor {
 *   process(document) {
 *     for (const block of document.findBy({ context: 'paragraph' })) {
 *       block.source = block.source.toUpperCase()
 *     }
 *   }
 * }
 * Extensions.register(function () { this.treeProcessor(ShoutTreeProcessor) })
 */
class TreeProcessor extends Processor {
  /**
   * @param {Document} document - The parsed document.
   * @returns {void}
   */
  process(document) {
    throw new Error(
      `${this.constructor.name} must implement the process method`
    )
  }
}
TreeProcessor.DSL = DocumentProcessorDsl;

/**
 * Postprocessors are run after the document is converted, but before
 * it is written to the output stream.
 *
 * The `process` method receives the document and the converted output string, and
 * must return the (possibly modified) output string.
 *
 * Implementations must extend Postprocessor and override {@link process}.
 *
 * @example
 * class FooterPostprocessor extends Postprocessor {
 *   process(document, output) {
 *     return output.replace('</body>', '<footer>Generated by Acme</footer></body>')
 *   }
 * }
 * Extensions.register(function () { this.postprocessor(FooterPostprocessor) })
 */
class Postprocessor extends Processor {
  /**
   * @param {Document} document - The converted document.
   * @param {string} output - The converted output string.
   * @returns {string} The (possibly modified) output string.
   */
  process(document, output) {
    throw new Error(
      `${this.constructor.name} must implement the process method`
    )
  }
}
Postprocessor.DSL = DocumentProcessorDsl;

/**
 * IncludeProcessors handle include::<target>[] directives.
 *
 * Implementations must extend IncludeProcessor.
 */
class IncludeProcessor extends Processor {
  /**
   * @param {Document} document - The document being parsed.
   * @param {PreprocessorReader} reader - The reader for the including document.
   * @param {string} target - The target of the include directive.
   * @param {Record<string, string>} attributes - The parsed include attributes.
   * @returns {void}
   */
  process(document, reader, target, attributes) {
    throw new Error(
      `${this.constructor.name} must implement the process method`
    )
  }

  /**
   * Decide whether this include processor handles the given target.
   *
   * Override this method in a subclass. The override may accept either just the
   * target string (Ruby-style, arity 1) or both the document and the target
   * (arity 2) — an arity-1 override is adapted at registration time so the
   * parser can always invoke it as `handles(doc, target)`. The first parameter
   * is therefore typed `Document | string` so both override shapes type-check.
   *
   * @param {Document|string} doc - The document being parsed, or (for a Ruby-style arity-1 override) the include target.
   * @param {string} target - The target of the include directive.
   * @returns {boolean} true if this processor handles the given target.
   */
  handles(doc, target) {
    return true
  }
}
IncludeProcessor.DSL = IncludeProcessorDsl;

/**
 * DocinfoProcessors add additional content to the header and/or footer
 * of the generated document.
 *
 * Implementations must extend DocinfoProcessor.
 */
class DocinfoProcessor extends Processor {
  constructor(config = {}) {
    super(config);
    this.config.location ??= 'head';
  }

  /**
   * @param {Document} document - The document being converted.
   * @returns {string} The docinfo content to inject into the document.
   */
  process(document) {
    throw new Error(
      `${this.constructor.name} must implement the process method`
    )
  }
}
DocinfoProcessor.DSL = DocinfoProcessorDsl;

// ── Syntax processors ─────────────────────────────────────────────────────────

/**
 * BlockProcessors handle delimited blocks and paragraphs with a custom name.
 *
 * The `process(parent, reader, attributes)` method receives:
 * - `parent` {AbstractBlock} — the enclosing block
 * - `reader` {Reader} — positioned at the block content
 * - `attributes` {Object} — parsed block attributes
 *
 * It must return a block node (created with `this.createBlock(...)`, etc.)
 * or call `this.parseContent(parent, reader)` to delegate parsing.
 *
 * Use the static `config` object or the DSL helpers (`contexts()`,
 * `contentModel()`, `resolveAttributes()`, …) to declare the block's behaviour
 * before registering.
 *
 * Implementations must extend BlockProcessor and override {@link process}.
 *
 * @example <caption>Custom delimited block that wraps content in a div</caption>
 * class ShoutBlock extends BlockProcessor {
 *   static config = { name: 'shout', contexts: ['paragraph'], contentModel: 'simple' }
 *   process(parent, reader, attrs) {
 *     const block = this.createBlock(parent, 'paragraph', reader.readLines().join('\n').toUpperCase(), attrs)
 *     return block
 *   }
 * }
 * Extensions.register(function () { this.block(ShoutBlock) })
 * // AsciiDoc usage: [shout]\nHello world
 */
class BlockProcessor extends Processor {
  constructor(name = null, config = {}) {
    super(config);
    this.name = name || this.config.name || null;

    // Normalise contexts config to a Set.
    const ctx = this.config.contexts;
    if (ctx == null) {
      this.config.contexts = new Set(['open', 'paragraph']);
    } else if (typeof ctx === 'string') {
      this.config.contexts = new Set([ctx]);
    } else if (Array.isArray(ctx)) {
      this.config.contexts = new Set(ctx);
    }

    this.config.contentModel ??= 'compound';
  }

  /**
   * @param {AbstractBlock} parent - The enclosing block.
   * @param {Reader} reader - The reader positioned at the block content.
   * @param {Record<string, unknown>} attributes - The parsed block attributes.
   * @returns {Block|void} A block node, or void to let the parser handle it.
   */
  process(parent, reader, attributes) {
    throw new Error(
      `${this.constructor.name} must implement the process method`
    )
  }
}
BlockProcessor.DSL = BlockProcessorDsl;

/**
 * Base class shared by BlockMacroProcessor and InlineMacroProcessor.
 */
class MacroProcessor extends Processor {
  constructor(name = null, config = {}) {
    super(config);
    this.name = name || this.config.name || null;
    this.config.contentModel ??= 'attributes';
  }

  /**
   * @param {AbstractBlock} parent - The enclosing block.
   * @param {string} target - The macro target (text between `name:` and `[`).
   * @param {Record<string, unknown>} attributes - The parsed macro attributes.
   * @returns {Block|Inline|void}
   */
  process(parent, target, attributes) {
    throw new Error(
      `${this.constructor.name} must implement the process method`
    )
  }
}

/**
 * BlockMacroProcessors handle block macros with a custom name.
 *
 * The `process(parent, target, attributes)` method receives:
 * - `parent` {AbstractBlock} — the enclosing block
 * - `target` {string} — the macro target (text between `name:` and `[`)
 * - `attributes` {Object} — parsed macro attributes
 *
 * It must return a block node created with one of the `createBlock`,
 * `createImage`, etc. helpers inherited from {@link Processor}.
 *
 * Implementations must extend BlockMacroProcessor and override {@link process}.
 *
 * @example <caption>Block macro that embeds a GitHub Gist</caption>
 * class GistBlockMacro extends BlockMacroProcessor {
 *   process(parent, target, attrs) {
 *     const html = `<script src="https://gist.github.com/${target}.js"></script>`
 *     return this.createBlock(parent, 'pass', html)
 *   }
 * }
 * GistBlockMacro.config = { name: 'gist' }
 * Extensions.register(function () { this.blockMacro(GistBlockMacro) })
 * // AsciiDoc usage: gist::abc123[]
 */
class BlockMacroProcessor extends MacroProcessor {
  /**
   * Get the name, validating the format.
   * The setter stores without validation to avoid throwing during construction.
   */
  get name() {
    if (this._name != null && !MacroNameRx.test(String(this._name))) {
      throw new Error(`invalid name for block macro: ${this._name}`)
    }
    return this._name
  }

  set name(value) {
    this._name = value;
  }

  /**
   * @param {AbstractBlock} parent - The enclosing block.
   * @param {string} target - The macro target.
   * @param {Record<string, unknown>} attributes - The parsed macro attributes.
   * @returns {Block} A block node created with one of the `createBlock` helpers.
   */
  process(parent, target, attributes) {
    return super.process(parent, target, attributes)
  }
}
BlockMacroProcessor.DSL = MacroProcessorDsl;

/**
 * InlineMacroProcessors handle inline macros with a custom name.
 *
 * The `process(parent, target, attributes)` method receives:
 * - `parent` {AbstractBlock} — the enclosing block
 * - `target` {string} — the macro target (text between `name:` and `[`)
 * - `attributes` {Object} — parsed macro attributes (first positional attr is `attributes[1]`)
 *
 * It must return an {@link Inline} node created with `this.createInline(parent, 'quoted', text, opts)`.
 *
 * By default the macro format is `'long'` (`name:target[attrs]`). Set
 * `config.format = 'short'` for a no-target form (`name:[attrs]`).
 *
 * Implementations must extend InlineMacroProcessor and override {@link process}.
 *
 * @example <caption>Inline macro that generates a keyboard shortcut span</caption>
 * class KbdInlineMacro extends InlineMacroProcessor {
 *   process(parent, target, attrs) {
 *     return this.createInline(parent, 'quoted', target, { type: 'monospaced' })
 *   }
 * }
 * KbdInlineMacro.config = { name: 'kbd', format: 'short' }
 * Extensions.register(function () { this.inlineMacro(KbdInlineMacro) })
 * // AsciiDoc usage: kbd:[Ctrl+C]
 */
class InlineMacroProcessor extends MacroProcessor {
  static rxCache = new Map()

  /**
   * Look up (and memoize) the regexp for this inline macro processor.
   *
   * @returns {RegExp}
   */
  get regexp() {
    return (this.config.regexp ??= this.resolveRegexp(
      String(this.name),
      this.config.format
    ))
  }

  /**
   * @param {AbstractBlock} parent - The enclosing block.
   * @param {string} target - The macro target.
   * @param {Record<string, unknown>} attributes - The parsed macro attributes.
   * @returns {Inline} An Inline node created with `this.createInline(...)`.
   */
  process(parent, target, attributes) {
    return super.process(parent, target, attributes)
  }

  resolveRegexp(name, format) {
    if (!MacroNameRx.test(name)) {
      throw new Error(`invalid name for inline macro: ${name}`)
    }
    const key = `${name}:${format}`;
    if (!InlineMacroProcessor.rxCache.has(key)) {
      const targetPart = format === 'short' ? '(){0}' : '(\\S+?)';
      InlineMacroProcessor.rxCache.set(
        key,
        new RegExp(
          `\\\\?${name}:${targetPart}\\[(|(?:${CC_ANY})*?(?<!\\\\))\\]`
        )
      );
    }
    return InlineMacroProcessor.rxCache.get(key)
  }
}
InlineMacroProcessor.DSL = InlineMacroProcessorDsl;

// ── Extension proxy objects ───────────────────────────────────────────────────

/**
 * Proxy that encapsulates the extension kind, config, and instance.
 * This is what gets stored in the extension registry when activated.
 */
class Extension {
  constructor(kind, instance, config) {
    this.kind = kind;
    this.instance = instance;
    this.config = config;
  }
}

/**
 * Specialisation of Extension that additionally stores a reference
 * to the process method, accommodating both class-based processors and function blocks.
 */
class ProcessorExtension extends Extension {
  constructor(kind, instance, processMethod = null) {
    super(kind, instance, instance.config);
    this.processMethod =
      processMethod || ((...args) => instance.process(...args));
    /** @internal */
    this._direct = false;
  }
}

// ── Registry ──────────────────────────────────────────────────────────────────

/** @internal Maps kind name → document-processor class. */
const DOCUMENT_PROCESSOR_CLASSES = {
  preprocessor: Preprocessor,
  tree_processor: TreeProcessor,
  postprocessor: Postprocessor,
  include_processor: IncludeProcessor,
  docinfo_processor: DocinfoProcessor,
};

/** @internal Maps kind name → syntax-processor class. */
const SYNTAX_PROCESSOR_CLASSES = {
  block: BlockProcessor,
  block_macro: BlockMacroProcessor,
  inline_macro: InlineMacroProcessor,
};

/**
 * The primary entry point into the extension system.
 *
 * Registry holds the extensions which have been registered and activated, has
 * methods for registering or defining a processor and looks up extensions
 * stored in the registry during parsing.
 *
 * A registry can be reused across multiple conversions. Extensions registered
 * via a group block (passed to {@link Extensions.create} or
 * {@link Extensions.register}) are re-executed on every activation. Extensions
 * registered directly on the registry instance (e.g. `registry.preprocessor(fn)`)
 * are preserved across activations.
 *
 * @example
 * const registry = Extensions.create('my-ext', function () {
 *   this.preprocessor(function () { ... })
 * })
 * // registry can be passed to multiple conversions safely
 */
class Registry {
  constructor(groups = {}) {
    this.groups = groups;
    /** @internal */
    this._activating = false;
    this._reset();
  }

  /**
   * Activate all global extension Groups and the Groups associated with this registry.
   *
   * @param {Document} document - The Document on which the extensions are to be used.
   * @returns {Registry} this Registry.
   */
  activate(document) {
    if (this.document) this._reset();
    this.document = document;
    const extGroups = [
      ...Object.values(Extensions.groups()),
      ...Object.values(this.groups),
    ];
    this._activating = true;
    try {
      for (const group of extGroups) {
        if (typeof group === 'function') {
          // Check if it is a class (constructor) with an activate prototype method.
          if (
            group.prototype &&
            typeof group.prototype.activate === 'function'
          ) {
            new group().activate(this);
          } else {
            // Plain function — call in the context of this registry (like instance_exec).
            group.length === 0 ? group.call(this) : group(this);
          }
        } else if (group && typeof group.activate === 'function') {
          group.activate(this);
        }
      }
    } finally {
      this._activating = false;
    }
    return this
  }

  /**
   * Register a Preprocessor with the extension registry.
   *
   * The processor may be:
   *   - A Preprocessor subclass (constructor function)
   *   - An instance of a Preprocessor subclass
   *   - A Function that configures the processor via the DSL (block style)
   *
   * @example
   * // class style
   * preprocessor(FrontMatterPreprocessor)
   * // instance style
   * preprocessor(new FrontMatterPreprocessor())
   * // block style
   * preprocessor(function () {
   *   this.process(function (doc, reader) { ... })
   * })
   *
   * @overload
   * @param {typeof Preprocessor} processor - A Preprocessor subclass.
   * @returns {ProcessorExtension} the Extension stored in the registry.
   *
   * @overload
   * @param {Preprocessor} processor - An already-constructed Preprocessor instance.
   * @returns {ProcessorExtension} the Extension stored in the registry.
   *
   * @overload
   * @param {(this: PreprocessorDslInterface) => void} fn - Registration function bound to the preprocessor DSL.
   * @returns {ProcessorExtension} the Extension stored in the registry.
   *
   * @param {...*} args - Class constructor, instance, or block function.
   * @returns {ProcessorExtension} the Extension stored in the registry.
   */
  preprocessor(...args) {
    return this._addDocumentProcessor('preprocessor', args)
  }

  /**
   * Return the registered Preprocessor extensions, or null if none.
   *
   * @returns {ProcessorExtension[]|null}
   */
  preprocessors() {
    return this._preprocessor_extensions
  }

  /**
   * Check whether any Preprocessor extensions have been registered.
   *
   * @returns {boolean}
   */
  hasPreprocessors() {
    return !!this._preprocessor_extensions
  }

  /** @internal Core API compatibility alias for preprocessors(). */
  get preprocessor_extensions() {
    return this._preprocessor_extensions
  }

  /**
   * Register a TreeProcessor with the extension registry.
   *
   * @overload
   * @param {typeof TreeProcessor} processor - A TreeProcessor subclass.
   * @returns {ProcessorExtension} the Extension stored in the registry.
   *
   * @overload
   * @param {TreeProcessor} processor - An already-constructed TreeProcessor instance.
   * @returns {ProcessorExtension} the Extension stored in the registry.
   *
   * @overload
   * @param {(this: TreeProcessorDslInterface) => void} fn - Registration function bound to the tree processor DSL.
   * @returns {ProcessorExtension} the Extension stored in the registry.
   *
   * @param {...*} args - Class constructor, instance, or block function.
   * @returns {ProcessorExtension} the Extension stored in the registry.
   */
  treeProcessor(...args) {
    return this._addDocumentProcessor('tree_processor', args)
  }

  /** @deprecated Alias for {@link treeProcessor}. */
  treeprocessor(...args) {
    return this.treeProcessor(...args)
  }

  /** Alias for {@link treeProcessor} (snake_case for prefer() / Registry method dispatch). */
  tree_processor(...args) {
    return this.treeProcessor(...args)
  }

  /**
   * Return the registered TreeProcessor extensions, or null if none.
   *
   * @returns {ProcessorExtension[]|null}
   */
  treeProcessors() {
    return this._tree_processor_extensions
  }

  /**
   * Check whether any TreeProcessor extensions have been registered.
   *
   * @returns {boolean}
   */
  hasTreeProcessors() {
    return !!this._tree_processor_extensions
  }

  /** @deprecated Typo alias kept for backward compatibility. Use {@link hasTreeProcessors}. */
  hasTeeProcessors() {
    return !!this._tree_processor_extensions
  }

  /** @deprecated Alias for {@link treeProcessors}. */
  treeprocessors() {
    return this._tree_processor_extensions
  }

  /** @internal Core API compatibility alias for treeProcessors(). */
  get tree_processor_extensions() {
    return this._tree_processor_extensions
  }

  /**
   * Register a Postprocessor with the extension registry.
   *
   * @overload
   * @param {typeof Postprocessor} processor - A Postprocessor subclass.
   * @returns {ProcessorExtension} the Extension stored in the registry.
   *
   * @overload
   * @param {Postprocessor} processor - An already-constructed Postprocessor instance.
   * @returns {ProcessorExtension} the Extension stored in the registry.
   *
   * @overload
   * @param {(this: PostprocessorDslInterface) => void} fn - Registration function bound to the postprocessor DSL.
   * @returns {ProcessorExtension} the Extension stored in the registry.
   *
   * @param {...*} args - Class constructor, instance, or block function.
   * @returns {ProcessorExtension} the Extension stored in the registry.
   */
  postprocessor(...args) {
    return this._addDocumentProcessor('postprocessor', args)
  }

  /**
   * Return the registered Postprocessor extensions, or null if none.
   *
   * @returns {ProcessorExtension[]|null}
   */
  postprocessors() {
    return this._postprocessor_extensions
  }

  /**
   * Check whether any Postprocessor extensions have been registered.
   *
   * @returns {boolean}
   */
  hasPostprocessors() {
    return !!this._postprocessor_extensions
  }

  /** @internal Core API compatibility alias for postprocessors(). */
  get postprocessor_extensions() {
    return this._postprocessor_extensions
  }

  /**
   * Register an IncludeProcessor with the extension registry.
   *
   * @overload
   * @param {typeof IncludeProcessor} processor - An IncludeProcessor subclass.
   * @returns {ProcessorExtension} the Extension stored in the registry.
   *
   * @overload
   * @param {IncludeProcessor} processor - An already-constructed IncludeProcessor instance.
   * @returns {ProcessorExtension} the Extension stored in the registry.
   *
   * @overload
   * @param {(this: IncludeProcessorDslInterface) => void} fn - Registration function bound to the include processor DSL.
   * @returns {ProcessorExtension} the Extension stored in the registry.
   *
   * @param {...*} args - Class constructor, instance, or block function.
   * @returns {ProcessorExtension} the Extension stored in the registry.
   */
  includeProcessor(...args) {
    return this._addDocumentProcessor('include_processor', args)
  }

  /**
   * Return the registered IncludeProcessor extensions, or null if none.
   *
   * @returns {ProcessorExtension[]|null}
   */
  includeProcessors() {
    return this._include_processor_extensions
  }

  /**
   * Check whether any IncludeProcessor extensions have been registered.
   *
   * @returns {boolean}
   */
  hasIncludeProcessors() {
    return !!this._include_processor_extensions
  }

  /** Alias for {@link includeProcessor} (snake_case for prefer() / Registry method dispatch). */
  include_processor(...args) {
    return this.includeProcessor(...args)
  }

  /** @internal Core API compatibility alias for includeProcessors(). */
  get include_processor_extensions() {
    return this._include_processor_extensions
  }

  /**
   * Register a DocinfoProcessor with the extension registry.
   *
   * @overload
   * @param {typeof DocinfoProcessor} processor - A DocinfoProcessor subclass.
   * @returns {ProcessorExtension} the Extension stored in the registry.
   *
   * @overload
   * @param {DocinfoProcessor} processor - An already-constructed DocinfoProcessor instance.
   * @returns {ProcessorExtension} the Extension stored in the registry.
   *
   * @overload
   * @param {(this: DocinfoProcessorDslInterface) => void} fn - Registration function bound to the docinfo processor DSL.
   * @returns {ProcessorExtension} the Extension stored in the registry.
   *
   * @param {...*} args - Class constructor, instance, or block function.
   * @returns {ProcessorExtension} the Extension stored in the registry.
   */
  docinfoProcessor(...args) {
    return this._addDocumentProcessor('docinfo_processor', args)
  }

  /**
   * Check whether any DocinfoProcessor extensions have been registered.
   *
   * @param {string|null} [location=null] - Optional location ('head' or 'footer') to filter by.
   * @returns {boolean}
   */
  hasDocinfoProcessors(location = null) {
    if (!this._docinfo_processor_extensions) return false
    if (location) {
      return this._docinfo_processor_extensions.some(
        (ext) => ext.config.location === location
      )
    }
    return true
  }

  /**
   * Retrieve Extension proxy objects for DocinfoProcessor instances.
   *
   * @param {string|null} [location=null] - Optional location ('head' or 'footer') to filter by.
   * @returns {ProcessorExtension[]} array of Extension proxy objects.
   */
  docinfoProcessors(location = null) {
    if (!this._docinfo_processor_extensions) return []
    if (location) {
      return this._docinfo_processor_extensions.filter(
        (ext) => ext.config.location === location
      )
    }
    return this._docinfo_processor_extensions
  }

  /** Alias for {@link docinfoProcessor} (snake_case for prefer() / Registry method dispatch). */
  docinfo_processor(...args) {
    return this.docinfoProcessor(...args)
  }

  /** @internal Core API compatibility alias for docinfoProcessors(). */
  get docinfo_processor_extensions() {
    return this._docinfo_processor_extensions
  }

  /**
   * Register a BlockProcessor with the extension registry.
   *
   * @example
   * // class style
   * block(ShoutBlock)
   * // class style with explicit name
   * block(ShoutBlock, 'shout')
   * // block style
   * block(function () {
   *   this.named('shout')
   *   this.process(function (parent, reader, attrs) { ... })
   * })
   * // block style with explicit name
   * block('shout', function () {
   *   this.process(function (parent, reader, attrs) { ... })
   * })
   *
   * @overload
   * @param {typeof BlockProcessor} processor - A BlockProcessor subclass.
   * @param {string} [name] - Optional explicit block name.
   * @returns {ProcessorExtension} an Extension proxy object.
   *
   * @overload
   * @param {BlockProcessor} processor - An already-constructed BlockProcessor instance.
   * @param {string} [name] - Optional explicit block name (overrides the instance's name).
   * @returns {ProcessorExtension} an Extension proxy object.
   *
   * @overload
   * @param {string} name - The block name.
   * @param {(this: BlockProcessorDslInterface) => void} fn - Registration function bound to the block DSL.
   * @returns {ProcessorExtension} an Extension proxy object.
   *
   * @overload
   * @param {(this: BlockProcessorDslInterface) => void} fn - Registration function bound to the block DSL.
   * @returns {ProcessorExtension} an Extension proxy object.
   *
   * @param {...*} args - Class constructor, instance, block function, or name + one of those.
   * @returns {ProcessorExtension} an Extension proxy object.
   */
  block(...args) {
    return this._addSyntaxProcessor('block', args)
  }

  /**
   * Check whether any BlockProcessor extensions have been registered.
   *
   * @returns {boolean}
   */
  hasBlocks() {
    return !!this._block_extensions
  }

  /**
   * Retrieve all BlockProcessor Extension proxy objects.
   *
   * @returns {ProcessorExtension[]}
   */
  blocks() {
    return this._block_extensions ? Object.values(this._block_extensions) : []
  }

  /**
   * Check whether a BlockProcessor is registered for the given name and context.
   *
   * @param {string} name - The block name.
   * @param {string} context - The block context.
   * @returns {ProcessorExtension|false} the Extension proxy or false.
   */
  registeredForBlock(name, context) {
    const ext = this._block_extensions?.[String(name)];
    return ext ? ext.config.contexts.has(context) && ext : false
  }

  /**
   * Retrieve the Extension proxy for the BlockProcessor registered with the given name.
   *
   * @param {string} name - The block name.
   * @returns {ProcessorExtension|null}
   */
  findBlockExtension(name) {
    return this._block_extensions?.[String(name)] ?? null
  }

  /**
   * Register a BlockMacroProcessor with the extension registry.
   *
   * @overload
   * @param {typeof BlockMacroProcessor} processor - A BlockMacroProcessor subclass.
   * @param {string} [name] - Optional explicit macro name.
   * @returns {ProcessorExtension} the Extension stored in the registry.
   *
   * @overload
   * @param {BlockMacroProcessor} processor - An already-constructed BlockMacroProcessor instance.
   * @param {string} [name] - Optional explicit macro name (overrides the instance's name).
   * @returns {ProcessorExtension} the Extension stored in the registry.
   *
   * @overload
   * @param {string} name - The macro name.
   * @param {(this: BlockMacroProcessorDslInterface) => void} fn - Registration function bound to the block macro DSL.
   * @returns {ProcessorExtension} the Extension stored in the registry.
   *
   * @overload
   * @param {(this: BlockMacroProcessorDslInterface) => void} fn - Registration function bound to the block macro DSL.
   * @returns {ProcessorExtension} the Extension stored in the registry.
   *
   * @param {...*} args - Class constructor, instance, or block function.
   * @returns {ProcessorExtension} the Extension stored in the registry.
   */
  blockMacro(...args) {
    return this._addSyntaxProcessor('block_macro', args)
  }

  /** @deprecated Alias for {@link blockMacro}. */
  block_macro(...args) {
    return this.blockMacro(...args)
  }

  /**
   * Check whether any BlockMacroProcessor extensions have been registered.
   *
   * @returns {boolean}
   */
  hasBlockMacros() {
    return !!this._block_macro_extensions
  }

  /**
   * Retrieve all BlockMacroProcessor Extension proxy objects.
   *
   * @returns {ProcessorExtension[]}
   */
  blockMacros() {
    return this._block_macro_extensions
      ? Object.values(this._block_macro_extensions)
      : []
  }

  /**
   * Check whether a BlockMacroProcessor is registered for the given name.
   *
   * @param {string} name - The macro name.
   * @returns {ProcessorExtension|false}
   */
  registeredForBlockMacro(name) {
    return this._block_macro_extensions?.[String(name)] || false
  }

  /**
   * Retrieve the Extension proxy for the BlockMacroProcessor registered with the given name.
   *
   * @param {string} name - The macro name.
   * @returns {ProcessorExtension|null}
   */
  findBlockMacroExtension(name) {
    return this._block_macro_extensions?.[String(name)] ?? null
  }

  /**
   * Register an InlineMacroProcessor with the extension registry.
   *
   * @overload
   * @param {typeof InlineMacroProcessor} processor - An InlineMacroProcessor subclass.
   * @param {string} [name] - Optional explicit macro name.
   * @returns {ProcessorExtension} the Extension stored in the registry.
   *
   * @overload
   * @param {InlineMacroProcessor} processor - An already-constructed InlineMacroProcessor instance.
   * @param {string} [name] - Optional explicit macro name (overrides the instance's name).
   * @returns {ProcessorExtension} the Extension stored in the registry.
   *
   * @overload
   * @param {string} name - The macro name.
   * @param {(this: InlineMacroProcessorDslInterface) => void} fn - Registration function bound to the inline macro DSL.
   * @returns {ProcessorExtension} the Extension stored in the registry.
   *
   * @overload
   * @param {(this: InlineMacroProcessorDslInterface) => void} fn - Registration function bound to the inline macro DSL.
   * @returns {ProcessorExtension} the Extension stored in the registry.
   *
   * @param {...*} args - Class constructor, instance, or block function.
   * @returns {ProcessorExtension} the Extension stored in the registry.
   */
  inlineMacro(...args) {
    return this._addSyntaxProcessor('inline_macro', args)
  }

  /** @deprecated Alias for {@link inlineMacro}. */
  inline_macro(...args) {
    return this.inlineMacro(...args)
  }

  /**
   * Check whether any InlineMacroProcessor extensions have been registered.
   *
   * @returns {boolean}
   */
  hasInlineMacros() {
    return !!this._inline_macro_extensions
  }

  /**
   * Check whether an InlineMacroProcessor is registered for the given name.
   *
   * @param {string} name - The macro name.
   * @returns {ProcessorExtension|false}
   */
  registeredForInlineMacro(name) {
    return this._inline_macro_extensions?.[String(name)] || false
  }

  /**
   * Retrieve the Extension proxy for the InlineMacroProcessor registered with the given name.
   *
   * @param {string} name - The macro name.
   * @returns {ProcessorExtension|null}
   */
  findInlineMacroExtension(name) {
    return this._inline_macro_extensions?.[String(name)] ?? null
  }

  /**
   * Retrieve all InlineMacroProcessor Extension proxy objects.
   *
   * @returns {ProcessorExtension[]}
   */
  inlineMacros() {
    return this._inline_macro_extensions
      ? Object.values(this._inline_macro_extensions)
      : []
  }

  /**
   * Insert the document-processor Extension as the first of its kind in the extension registry.
   *
   * @example
   * registry.prefer('includeProcessor', function () {
   *   this.process(function (document, reader, target, attrs) { ... })
   * })
   *
   * @param {...*} args - A ProcessorExtension, or a method name followed by processor args.
   * @returns {ProcessorExtension} the Extension stored in the registry.
   */
  prefer(...args) {
    const arg0 = args.shift();
    let extension;
    if (arg0 instanceof ProcessorExtension) {
      extension = arg0;
    } else {
      // arg0 is a method name; remaining args include the processor and optional block.
      extension = this[arg0](...args);
    }
    const storeKey = `_${extension.kind}_extensions`;
    const store = this[storeKey];
    if (Array.isArray(store)) {
      const idx = store.indexOf(extension);
      if (idx > -1) store.splice(idx, 1);
      store.unshift(extension);
    }
    return extension
  }

  // ── JavaScript-style accessors ───────────────────────────────────────────────

  /** @returns {object} the plain Object that maps names to groups for this registry. */
  getGroups() {
    return this.groups
  }

  /** Alias for {@link preprocessors}. */
  getPreprocessors() {
    return this.preprocessors()
  }

  /** Alias for {@link treeProcessors}. */
  getTreeProcessors() {
    return this.treeProcessors()
  }

  /** Alias for {@link includeProcessors}. */
  getIncludeProcessors() {
    return this.includeProcessors()
  }

  /** Alias for {@link postprocessors}. */
  getPostprocessors() {
    return this.postprocessors()
  }

  /**
   * Alias for {@link docinfoProcessors}.
   *
   * @param {string|null} [location=null]
   */
  getDocinfoProcessors(location = null) {
    return this.docinfoProcessors(location)
  }

  /** Alias for {@link blocks}. */
  getBlocks() {
    return this.blocks()
  }

  /** Alias for {@link blockMacros}. */
  getBlockMacros() {
    return this.blockMacros()
  }

  /** Alias for {@link inlineMacros}. */
  getInlineMacros() {
    return this.inlineMacros()
  }

  /**
   * Alias for {@link registeredForInlineMacro}.
   *
   * @param {string} name
   */
  getInlineMacroFor(name) {
    return this.registeredForInlineMacro(name)
  }

  /**
   * Alias for {@link registeredForBlock}.
   *
   * @param {string} name
   * @param {string} context
   */
  getBlockFor(name, context) {
    return this.registeredForBlock(name, context)
  }

  /**
   * Alias for {@link registeredForBlockMacro}.
   *
   * @param {string} name
   */
  getBlockMacroFor(name) {
    return this.registeredForBlockMacro(name)
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  /** @internal */
  _addDocumentProcessor(kind, args) {
    const kindName = kind.replace(/_/g, ' ');
    const kindClass = DOCUMENT_PROCESSOR_CLASSES[kind];
    if (!this[`_${kind}_extensions`]) this[`_${kind}_extensions`] = [];
    const store = this[`_${kind}_extensions`];

    // Detect block style: last argument is a function that is NOT a class constructor.
    // Class constructors (ES6 classes) have a non-writable prototype descriptor;
    // plain functions (used as DSL blocks) have a writable prototype.
    const lastArg = args[args.length - 1];
    const hasBlock =
      args.length > 0 &&
      typeof lastArg === 'function' &&
      !!(
        Object.getOwnPropertyDescriptor(lastArg, 'prototype')?.writable ?? true
      );

    let processorInstance;

    if (hasBlock) {
      const block = args.pop();
      const config = this._resolveArgs(args, 1);
      const processor = new kindClass(config);
      Object.assign(processor, kindClass.DSL);
      block.length === 0 ? block.call(processor) : block(processor);
      if (!processor.processBlockGiven()) {
        throw new Error(`No block specified to process ${kindName} extension`)
      }
      processorInstance = processor;
    } else {
      const [processorArg, config] = this._resolveArgs(args, 2);
      if (typeof processorArg === 'function') {
        // Style 2: class constructor
        if (!(processorArg.prototype instanceof kindClass)) {
          throw new Error(
            `Invalid type for ${kindName} extension: ${processorArg}`
          )
        }
        processorInstance = new processorArg(config);
      } else if (processorArg instanceof kindClass) {
        // Style 3: already an instance
        processorArg.updateConfig(config);
        processorInstance = processorArg;
      } else {
        throw new Error(
          `Invalid arguments specified for registering ${kindName} extension: ${args}`
        )
      }
    }

    // Apply legacy handles adapter for IncludeProcessors with arity-1 handles method.
    if (kind === 'include_processor') {
      const handlesFn = processorInstance.handles;
      if (typeof handlesFn === 'function' && handlesFn.length === 1) {
        const original = handlesFn.bind(processorInstance);
        processorInstance.handles = (_doc, target) => original(target);
      }
    }

    const extension = new ProcessorExtension(kind, processorInstance);
    extension._direct = !this._activating;
    extension.config.position === '>>'
      ? store.unshift(extension)
      : store.push(extension);
    return extension
  }

  /** @internal */
  _addSyntaxProcessor(kind, args) {
    const kindName = kind.replace(/_/g, ' ');
    const kindClass = SYNTAX_PROCESSOR_CLASSES[kind];
    if (!this[`_${kind}_extensions`])
      this[`_${kind}_extensions`] = Object.create(null);
    const store = this[`_${kind}_extensions`];

    // Detect block style (same heuristic as _addDocumentProcessor).
    const lastArg = args[args.length - 1];
    const hasBlock =
      args.length > 0 &&
      typeof lastArg === 'function' &&
      !!(
        Object.getOwnPropertyDescriptor(lastArg, 'prototype')?.writable ?? true
      );

    let processorInstance, name;

    if (hasBlock) {
      const block = args.pop();
      const [nameArg, config] = this._resolveArgs(args, 2);
      const processor = new kindClass(this._asSymbol(nameArg), config);
      Object.assign(processor, kindClass.DSL);
      block.length === 0 ? block.call(processor) : block(processor);
      name = this._asSymbol(processor.name);
      if (!name) throw new Error(`No name specified for ${kindName} extension`)
      if (!processor.processBlockGiven()) {
        throw new Error(`No block specified to process ${kindName} extension`)
      }
      processorInstance = processor;
    } else {
      const [processorArg, nameArg, config] = this._resolveArgs(args, 3);
      if (typeof processorArg === 'function') {
        // Style 2: class constructor
        if (!(processorArg.prototype instanceof kindClass)) {
          throw new Error(
            `Class specified for ${kindName} extension does not inherit from ${kindClass.name}: ${processorArg}`
          )
        }
        processorInstance = new processorArg(this._asSymbol(nameArg), config);
        name = this._asSymbol(processorInstance.name);
        if (!name)
          throw new Error(
            `No name specified for ${kindName} extension: ${processorArg}`
          )
      } else if (processorArg instanceof kindClass) {
        // Style 3: already an instance
        processorArg.updateConfig(config);
        name = nameArg
          ? (processorArg.name = this._asSymbol(nameArg))
          : this._asSymbol(processorArg.name);
        if (!name)
          throw new Error(
            `No name specified for ${kindName} extension: ${processorArg}`
          )
        processorInstance = processorArg;
      } else {
        throw new Error(
          `Invalid arguments specified for registering ${kindName} extension: ${args}`
        )
      }
    }

    store[name] = new ProcessorExtension(kind, processorInstance);
    store[name]._direct = !this._activating;
    return store[name]
  }

  /** @internal */
  _reset() {
    // Keep extensions registered directly (outside a group); only clear group-registered ones.
    // Extensions tagged with _direct=true survive across activations.
    const keepArr = (arr) => {
      const kept = arr?.filter((e) => e._direct) ?? [];
      return kept.length ? kept : null
    };
    const keepMap = (map) => {
      if (!map) return null
      const kept = Object.create(null);
      for (const [k, v] of Object.entries(map)) if (v._direct) kept[k] = v;
      return Object.keys(kept).length ? kept : null
    };
    /** @internal */
    this._preprocessor_extensions = keepArr(this._preprocessor_extensions);
    /** @internal */
    this._tree_processor_extensions = keepArr(this._tree_processor_extensions);
    /** @internal */
    this._postprocessor_extensions = keepArr(this._postprocessor_extensions);
    /** @internal */
    this._include_processor_extensions = keepArr(
      this._include_processor_extensions
    );
    /** @internal */
    this._docinfo_processor_extensions = keepArr(
      this._docinfo_processor_extensions
    );
    /** @internal */
    this._block_extensions = keepMap(this._block_extensions);
    /** @internal */
    this._block_macro_extensions = keepMap(this._block_macro_extensions);
    /** @internal */
    this._inline_macro_extensions = keepMap(this._inline_macro_extensions);
    this.document = null;
  }

  /**
   * @internal Normalise an args array to the expected number of values.
   *
   * Pops a trailing plain-object as options (or uses {}), then pads / trims
   * the remaining args to (expect - 1) elements, then appends the options object.
   * If expect === 1, returns just the options object.
   */
  _resolveArgs(args, expect) {
    const last = args[args.length - 1];
    const opts =
      args.length > 0 &&
      last !== null &&
      typeof last === 'object' &&
      !Array.isArray(last) &&
      !(last instanceof Processor)
        ? args.pop()
        : {};

    if (expect === 1) return opts

    const missing = expect - 1 - args.length;
    if (missing > 0) {
      for (let i = 0; i < missing; i++) args.push(undefined);
    } else if (missing < 0) {
      args.splice(args.length + missing, -missing);
    }
    args.push(opts);
    return args
  }

  /** @internal */
  _asSymbol(name) {
    return name != null ? String(name) : null
  }
}

// ── Extensions module namespace ───────────────────────────────────────────────

// Module-level state (mirrors Ruby module instance variables @auto_id / @groups).
let _autoId = -1;
const _groups = Object.create(null);

/**
 * The primary entry point for registering extensions globally.
 *
 * Mirrors the class-level methods on the Ruby Asciidoctor::Extensions module.
 */
const Extensions = {
  /** @internal Generate a unique name for an anonymous extension group. */
  generateName() {
    return `extgrp${this.nextAutoId()}`
  },

  /** @internal Increment and return the global auto-id counter. */
  nextAutoId() {
    return ++_autoId
  },

  /**
   * Return the plain Object that maps names to registered groups.
   *
   * @returns {object}
   */
  groups() {
    return _groups
  },

  /**
   * Alias for {@link groups}.
   *
   * @returns {object}
   */
  getGroups() {
    return this.groups()
  },

  /**
   * Create a new Registry, optionally pre-populated with a named block.
   *
   * When a `block` is provided it is stored as a group and re-executed on every
   * activation, making the registry safe to reuse across multiple conversions.
   * Without a `block`, any extensions registered directly on the returned registry
   * (e.g. `registry.preprocessor(fn)`) are stored in transient state that is
   * cleared on every activation — those registrations will be lost from the second
   * conversion onwards. Prefer the block form when the registry may be reused.
   *
   * @param {string|null} [name=null] - Optional name for the group; auto-generated if omitted.
   * @param {Function|null} [block=null] - Optional function to register as the group.
   * @returns {Registry}
   */
  create(name = null, block = null) {
    if (block) {
      return new Registry({ [name || this.generateName()]: block })
    }
    return new Registry()
  },

  /**
   * Register an extension Group that subsequently registers extensions.
   *
   * @example
   * Extensions.register(UmlExtensions)
   * Extensions.register('uml', UmlExtensions)
   * Extensions.register(function () { this.blockMacro('plantuml', PlantUmlBlock) })
   * Extensions.register('uml', function () { this.blockMacro('plantuml', PlantUmlBlock) })
   *
   * @param {...*} args - Optional name followed by a Group class, instance, or function.
   * @returns {Function|object} the registered group.
   */
  register(...args) {
    const argc = args.length;
    if (argc === 0) throw new Error('Extension group to register not specified')
    const group = args.pop();
    if (!group) throw new Error('Extension group to register not specified')
    const name = args.pop() ?? this.generateName();
    if (args.length > 0)
      throw new Error(`Wrong number of arguments (${argc} for 1..2)`)
    _groups[String(name)] = group;
    return group
  },

  /**
   * Unregister all statically-registered extension groups.
   */
  unregisterAll() {
    for (const key of Object.keys(_groups)) delete _groups[key];
  },

  /**
   * Unregister statically-registered extension groups by name.
   *
   * @param {...string} names - One or more group names to unregister.
   */
  unregister(...names) {
    for (const name of names) delete _groups[String(name)];
  },

  // ── Processor factory helpers (mirrors core API) ─────────────────────────────
  // Each pair: create<Kind>(name?, functions) → class constructor
  //            new<Kind>(name?, functions)    → instance of that class
  // The `name` argument is optional; if omitted the sole argument is `functions`.

  /** @internal Build a subclass of BaseClass with the given prototype functions. */
  _buildProcessorClass(BaseClass, name, functions) {
    if (arguments.length === 2) {
      functions = name;
      name = null;
    }
    const klass = class extends BaseClass {};
    if (name) Object.defineProperty(klass, 'name', { value: name });
    Object.assign(klass.prototype, functions);
    return klass
  },

  /**
   * Create a Preprocessor subclass with the given prototype functions.
   *
   * @param {string} [name] - Optional class name.
   * @param {object} [functions] - Methods to mix into the prototype.
   * @returns {typeof Preprocessor}
   */
  createPreprocessor(name, functions) {
    if (arguments.length === 1) {
      functions = name;
      name = null;
    }
    return this._buildProcessorClass(Preprocessor, name, functions)
  },

  /**
   * Create and return a new Preprocessor instance with the given prototype functions.
   *
   * @param {string} [name] - Optional class name.
   * @param {object} [functions] - Methods to mix into the prototype.
   * @returns {Preprocessor}
   */
  newPreprocessor(name, functions) {
    if (arguments.length === 1) {
      functions = name;
      name = null;
    }
    return new (this.createPreprocessor(name, functions))()
  },

  /**
   * Create a TreeProcessor subclass with the given prototype functions.
   *
   * @param {string} [name] - Optional class name.
   * @param {object} [functions] - Methods to mix into the prototype.
   * @returns {typeof TreeProcessor}
   */
  createTreeProcessor(name, functions) {
    if (arguments.length === 1) {
      functions = name;
      name = null;
    }
    return this._buildProcessorClass(TreeProcessor, name, functions)
  },

  /**
   * Create and return a new TreeProcessor instance with the given prototype functions.
   *
   * @param {string} [name] - Optional class name.
   * @param {object} [functions] - Methods to mix into the prototype.
   * @returns {TreeProcessor}
   */
  newTreeProcessor(name, functions) {
    if (arguments.length === 1) {
      functions = name;
      name = null;
    }
    return new (this.createTreeProcessor(name, functions))()
  },

  /**
   * Create a Postprocessor subclass with the given prototype functions.
   *
   * @param {string} [name] - Optional class name.
   * @param {object} [functions] - Methods to mix into the prototype.
   * @returns {typeof Postprocessor}
   */
  createPostprocessor(name, functions) {
    if (arguments.length === 1) {
      functions = name;
      name = null;
    }
    return this._buildProcessorClass(Postprocessor, name, functions)
  },

  /**
   * Create and return a new Postprocessor instance with the given prototype functions.
   *
   * @param {string} [name] - Optional class name.
   * @param {object} [functions] - Methods to mix into the prototype.
   * @returns {Postprocessor}
   */
  newPostprocessor(name, functions) {
    if (arguments.length === 1) {
      functions = name;
      name = null;
    }
    return new (this.createPostprocessor(name, functions))()
  },

  /**
   * Create an IncludeProcessor subclass with the given prototype functions.
   *
   * @param {string} [name] - Optional class name.
   * @param {object} [functions] - Methods to mix into the prototype.
   * @returns {typeof IncludeProcessor}
   */
  createIncludeProcessor(name, functions) {
    if (arguments.length === 1) {
      functions = name;
      name = null;
    }
    return this._buildProcessorClass(IncludeProcessor, name, functions)
  },

  /**
   * Create and return a new IncludeProcessor instance with the given prototype functions.
   *
   * @param {string} [name] - Optional class name.
   * @param {object} [functions] - Methods to mix into the prototype.
   * @returns {IncludeProcessor}
   */
  newIncludeProcessor(name, functions) {
    if (arguments.length === 1) {
      functions = name;
      name = null;
    }
    return new (this.createIncludeProcessor(name, functions))()
  },

  /**
   * Create a DocinfoProcessor subclass with the given prototype functions.
   *
   * @param {string} [name] - Optional class name.
   * @param {object} [functions] - Methods to mix into the prototype.
   * @returns {typeof DocinfoProcessor}
   */
  createDocinfoProcessor(name, functions) {
    if (arguments.length === 1) {
      functions = name;
      name = null;
    }
    return this._buildProcessorClass(DocinfoProcessor, name, functions)
  },

  /**
   * Create and return a new DocinfoProcessor instance with the given prototype functions.
   *
   * @param {string} [name] - Optional class name.
   * @param {object} [functions] - Methods to mix into the prototype.
   * @returns {DocinfoProcessor}
   */
  newDocinfoProcessor(name, functions) {
    if (arguments.length === 1) {
      functions = name;
      name = null;
    }
    return new (this.createDocinfoProcessor(name, functions))()
  },

  /**
   * Create a BlockProcessor subclass with the given prototype functions.
   *
   * @param {string} [name] - Optional class name.
   * @param {object} [functions] - Methods to mix into the prototype.
   * @returns {typeof BlockProcessor}
   */
  createBlockProcessor(name, functions) {
    if (arguments.length === 1) {
      functions = name;
      name = null;
    }
    return this._buildProcessorClass(BlockProcessor, name, functions)
  },

  /**
   * Create and return a new BlockProcessor instance with the given prototype functions.
   *
   * @param {string} [name] - Optional class name.
   * @param {object} [functions] - Methods to mix into the prototype.
   * @returns {BlockProcessor}
   */
  newBlockProcessor(name, functions) {
    if (arguments.length === 1) {
      functions = name;
      name = null;
    }
    return new (this.createBlockProcessor(name, functions))()
  },

  /**
   * Create an InlineMacroProcessor subclass with the given prototype functions.
   *
   * @param {string} [name] - Optional class name.
   * @param {object} [functions] - Methods to mix into the prototype.
   * @returns {typeof InlineMacroProcessor}
   */
  createInlineMacroProcessor(name, functions) {
    if (arguments.length === 1) {
      functions = name;
      name = null;
    }
    return this._buildProcessorClass(InlineMacroProcessor, name, functions)
  },

  /**
   * Create and return a new InlineMacroProcessor instance with the given prototype functions.
   *
   * @param {string} [name] - Optional class name.
   * @param {object} [functions] - Methods to mix into the prototype.
   * @returns {InlineMacroProcessor}
   */
  newInlineMacroProcessor(name, functions) {
    if (arguments.length === 1) {
      functions = name;
      name = null;
    }
    return new (this.createInlineMacroProcessor(name, functions))()
  },

  /**
   * Create a BlockMacroProcessor subclass with the given prototype functions.
   *
   * @param {string} [name] - Optional class name.
   * @param {object} [functions] - Methods to mix into the prototype.
   * @returns {typeof BlockMacroProcessor}
   */
  createBlockMacroProcessor(name, functions) {
    if (arguments.length === 1) {
      functions = name;
      name = null;
    }
    return this._buildProcessorClass(BlockMacroProcessor, name, functions)
  },

  /**
   * Create and return a new BlockMacroProcessor instance with the given prototype functions.
   *
   * @param {string} [name] - Optional class name.
   * @param {object} [functions] - Methods to mix into the prototype.
   * @returns {BlockMacroProcessor}
   */
  newBlockMacroProcessor(name, functions) {
    if (arguments.length === 1) {
      functions = name;
      name = null;
    }
    return new (this.createBlockMacroProcessor(name, functions))()
  },
};

class Footnote {
  constructor(index, id, text) {
    this.index = index;
    this.id = id ?? null;
    this.text = text;
  }

  /**
   * @returns {number} the index of this footnote.
   */
  getIndex() {
    return this.index
  }

  /**
   * @returns {string|null} the id of this footnote, or null if not set.
   */
  getId() {
    return this.id
  }

  /**
   * @returns {string} the text of this footnote.
   */
  getText() {
    return this.text
  }
}

/** @import { Reader } from './reader.js' */


// ── Helper structs ────────────────────────────────────────────────────────────

class ImageReference {
  constructor(target, imagesdir) {
    this.target = target;
    this.imagesdir = imagesdir;
  }

  /**
   * @returns {string} the target image path or URI.
   */
  getTarget() {
    return this.target
  }

  /**
   * @returns {string} the images directory.
   */
  getImagesDirectory() {
    return this.imagesdir
  }

  toString() {
    return this.target
  }
}

/**
 * Parsed and stores a partitioned title (title & subtitle).
 */
class DocumentTitle {
  constructor(val, opts = {}) {
    this._sanitized = !!(opts.sanitize && val.includes('<'));
    if (this._sanitized) {
      val = val.replace(XmlSanitizeRx, '').replace(/ {2,}/g, ' ').trim();
    }
    const sep = opts.separator ?? ':';
    const sepStr = sep ? `${sep} ` : null;
    if (!sepStr || !val.includes(sepStr)) {
      this.main = val;
      this.subtitle = null;
    } else {
      const idx = val.lastIndexOf(sepStr);
      this.main = val.slice(0, idx);
      this.subtitle = val.slice(idx + sepStr.length);
    }
    this.combined = val;
  }

  get title() {
    return this.main
  }

  isSanitized() {
    return this._sanitized
  }
  hasSubtitle() {
    return this.subtitle != null
  }
  getMain() {
    return this.main
  }
  getCombined() {
    return this.combined
  }
  getSubtitle() {
    return this.subtitle
  }
  toString() {
    return this.combined
  }
}

/**
 * Represents an Author parsed from document attributes.
 */
class Author {
  constructor(name, firstname, middlename, lastname, initials, email) {
    this.name = name;
    this.firstname = firstname;
    this.middlename = middlename;
    this.lastname = lastname;
    this.initials = initials;
    this.email = email;
  }

  getName() {
    return this.name
  }
  getFirstName() {
    return this.firstname
  }
  getMiddleName() {
    return this.middlename
  }
  getLastName() {
    return this.lastname
  }
  getInitials() {
    return this.initials
  }
  getEmail() {
    return this.email
  }
}

class RevisionInfo {
  constructor(number, date, remark) {
    this._number = number ?? null;
    this._date = date ?? null;
    this._remark = remark ?? null;
  }

  isEmpty() {
    return !this._number && !this._date && !this._remark
  }
  getNumber() {
    return this._number
  }
  getDate() {
    return this._date
  }
  getRemark() {
    return this._remark
  }
}

// ── Document ──────────────────────────────────────────────────────────────────

class Document extends AbstractBlock {
  /** @internal */
  _converter
  /** @internal */
  _maxAttributeValueSize
  /** @internal */
  _docinfoProcessorExtensions
  /** @internal */
  _attributesModified
  /** @internal */
  _counters
  /** @internal */
  _headerAttributes
  /** @internal */
  _reftexts
  /** @internal */
  _parsed
  /** @internal */
  _inputMtime
  /** @internal */
  _parentDoctype
  /** @internal */
  _initializeExtensions
  /** @internal */
  _timings
  /** @internal */
  _attributeOverrides
  /** @type {Reader} */
  reader
  /** @type {string} */
  doctype
  /** @type {string} */
  baseDir
  /** @type {string} */
  backend
  /** @type {number} */
  safe
  /** @type {boolean} */
  compatMode
  /** Override AbstractNode's getter so Document can own its converter directly. */
  get converter() {
    return this._converter
  }
  set converter(v) {
    this._converter = v;
  }

  constructor(data = null, options = {}) {
    // Bootstrap: call super with a temporary placeholder — we'll fix parent ref below.
    // AbstractBlock(parent, context, opts) — we pass `null` and patch afterward.
    super(null, 'document', options);
    // Document is its own parent/document (write _parent directly to avoid shadowing the accessor).
    /** @internal */
    this._parent = this;
    /** @internal */
    this.document = this;

    const parentDoc = options.parent ?? null;
    delete options.parent;

    // ── Nested document setup ─────────────────────────────────────────────────
    if (parentDoc) {
      this.parentDocument = parentDoc;
      options.base_dir ??= parentDoc.baseDir;
      if (parentDoc.options.catalog_assets) options.catalog_assets = true;
      if (parentDoc.options.to_dir) options.to_dir = parentDoc.options.to_dir;

      this.catalog = { ...parentDoc.catalog, footnotes: [] };

      // Clone parent's attribute overrides merged with parent attributes
      this._attributeOverrides = {
        ...parentDoc._attributeOverrides,
        ...parentDoc.attributes,
      };
      const attrOverrides = this._attributeOverrides;
      delete attrOverrides['compat-mode'];
      const parentDoctype = attrOverrides.doctype;
      delete attrOverrides.doctype;
      delete attrOverrides.notitle;
      delete attrOverrides.showtitle;
      delete attrOverrides.toc;
      this.attributes['toc-placement'] =
        attrOverrides['toc-placement'] ?? 'auto';
      delete attrOverrides['toc-placement'];
      delete attrOverrides['toc-position'];

      this.safe = parentDoc.safe;
      this.compatMode = parentDoc.compatMode;
      if (this.compatMode) this.attributes['compat-mode'] = '';
      this.outfilesuffix = parentDoc.outfilesuffix;
      this.sourcemap = parentDoc.sourcemap;
      this._timings = null;
      this.pathResolver = parentDoc.pathResolver;
      this.converter = parentDoc.converter;
      this.extensions = parentDoc.extensions;
      this.syntaxHighlighter = parentDoc.syntaxHighlighter;
      this._initializeExtensions = null;

      // For nested: re-use parent's @_parentDoctype
      this._parentDoctype = parentDoctype;
    } else {
      // ── Root document setup ───────────────────────────────────────────────
      this.parentDocument = null;
      this.catalog = {
        ids: {}, // deprecated
        refs: {},
        footnotes: [],
        links: [],
        images: [],
        callouts: new Callouts(),
        includes: {},
      };

      // Process attribute overrides from options
      this._attributeOverrides = {};
      const attrOverrides = this._attributeOverrides;
      for (let [key, val] of Object.entries(options.attributes ?? {})) {
        if (key.endsWith('@')) {
          if (key.startsWith('!')) {
            key = key.slice(1, -1);
            val = false;
          } else if (key.endsWith('!@')) {
            key = key.slice(0, -2);
            val = false;
          } else {
            key = key.slice(0, -1);
            val = `${val}@`;
          }
        } else if (key.startsWith('!')) {
          key = key.slice(1);
          val = val === '@' ? false : null;
        } else if (key.endsWith('!')) {
          key = key.slice(0, -1);
          val = val === '@' ? false : null;
        }
        attrOverrides[key.toLowerCase()] = val;
      }

      if (typeof options.to_file === 'string') {
        attrOverrides.outfilesuffix = extname(options.to_file);
      }

      // Resolve safe mode
      const safeMode = options.safe;
      if (!safeMode) {
        this.safe = SafeMode.SECURE;
      } else if (typeof safeMode === 'number') {
        this.safe = safeMode;
      } else {
        this.safe = SafeMode.valueForName(safeMode) ?? SafeMode.SECURE;
      }

      this._inputMtime = options.input_mtime ?? null;
      delete options.input_mtime;
      this.compatMode = 'compat-mode' in attrOverrides;
      this.sourcemap = options.sourcemap ?? false;
      this._timings = options.timings ?? null;
      delete options.timings;
      this.pathResolver = new PathResolver();
      if (options.extension_registry) {
        this.extensions = options.extension_registry.activate(this);
      } else {
        this.extensions = null;
        // If no explicit registry but global extension groups are registered, activate them.
        const globalGroups = Extensions.groups();
        if (Object.keys(globalGroups).length > 0) {
          this.extensions = new Registry();
          this.extensions.activate(this);
        }
      }
      this.syntaxHighlighter = null;
      this._initializeExtensions = true; // set to class if available
      this._parentDoctype = null;

      // Normalize :header_footer → :standalone
      if ('header_footer' in options && !('standalone' in options)) {
        options.standalone = options.header_footer;
      }
    }

    this._parsed = false;
    this._reftexts = null;
    this.header = null;
    this._headerAttributes = null;
    this._counters = {};
    this._attributesModified = new Set();
    this._docinfoProcessorExtensions = {};
    const standalone = options.standalone ?? false;
    this.options = Object.freeze({ ...options });

    const attrs = this.attributes;

    if (!parentDoc) {
      attrs['attribute-undefined'] = Compliance.attributeUndefined;
      attrs['attribute-missing'] = Compliance.attributeMissing;
      Object.assign(attrs, DEFAULT_ATTRIBUTES);
    }

    if (standalone) {
      delete this._attributeOverrides.embedded;
      attrs.copycss = '';
      attrs['iconfont-remote'] = '';
      attrs.stylesheet = '';
      attrs.webfonts = '';
    } else {
      this._attributeOverrides.embedded = '';
      const ao = this._attributeOverrides;
      const showtitle = ao.showtitle;
      const notitle = ao.notitle;
      if (
        'showtitle' in ao &&
        ['showtitle', 'notitle'].filter((k) => k in ao).pop() === 'showtitle'
      ) {
        ao.notitle = { null: '', false: '@', '@': false }[showtitle];
      } else if ('notitle' in ao) {
        ao.showtitle = { null: '', false: '@', '@': false }[notitle];
      } else {
        attrs.notitle = '';
      }
    }

    const attrOverrides = this._attributeOverrides;
    attrOverrides.asciidoctor = '';
    attrOverrides['asciidoctor-version'] = packageJson.version;

    const safeModeName = SafeMode.nameForValue(this.safe);
    attrOverrides['safe-mode-name'] = safeModeName;
    attrOverrides[`safe-mode-${safeModeName}`] = '';
    attrOverrides['safe-mode-level'] = this.safe;
    attrOverrides['max-include-depth'] ??= 64;
    attrOverrides['allow-uri-read'] ??= null;

    // Remap legacy attributes
    if ('numbered' in attrOverrides) {
      const _v = attrOverrides.numbered;
      delete attrOverrides.numbered;
      attrOverrides.sectnums = _v;
    }
    if ('hardbreaks' in attrOverrides) {
      const _v = attrOverrides.hardbreaks;
      delete attrOverrides.hardbreaks;
      attrOverrides['hardbreaks-option'] = _v;
    }

    // Resolve base_dir
    if (options.base_dir) {
      this.baseDir = attrOverrides.docdir = _expandPath(options.base_dir);
    } else if (attrOverrides.docdir) {
      this.baseDir = attrOverrides.docdir;
    } else {
      this.baseDir = attrOverrides.docdir = _cwd();
    }

    if (options.backend) attrOverrides.backend = String(options.backend);
    if (options.doctype) attrOverrides.doctype = String(options.doctype);

    if (this.safe >= SafeMode.SERVER) {
      attrOverrides.copycss ??= null;
      attrOverrides['source-highlighter'] ??= null;
      attrOverrides.backend ??= DEFAULT_BACKEND;
      if (!parentDoc && 'docfile' in attrOverrides) {
        const docdir = attrOverrides.docdir ?? '';
        attrOverrides.docfile = attrOverrides.docfile.slice(docdir.length + 1);
      }
      attrOverrides.docdir = '';
      attrOverrides['user-home'] ??= '.';
      if (this.safe >= SafeMode.SECURE) {
        if (!('max-attribute-value-size' in attrOverrides)) {
          attrOverrides['max-attribute-value-size'] = 4096;
        }
        attrOverrides.linkcss ??= '';
        attrOverrides.icons ??= null;
      }
    } else {
      attrOverrides['user-home'] ??= USER_HOME;
    }

    const sizeAttr = (attrOverrides['max-attribute-value-size'] ??= null);
    this._maxAttributeValueSize =
      sizeAttr != null ? Math.abs(parseInt(sizeAttr, 10)) : null;

    // Apply attribute overrides — overrides that survive (non-soft) stay in attrOverrides.
    const softKeys = [];
    for (const [key, val] of Object.entries(attrOverrides)) {
      if (val != null && val !== false) {
        let effective = val;
        let isSoft = false;
        if (typeof val === 'string' && val.endsWith('@')) {
          effective = val.slice(0, -1);
          isSoft = true;
        }
        attrs[key] = effective;
        if (isSoft) softKeys.push(key);
      } else {
        delete attrs[key];
        if (val === false) softKeys.push(key); // false = soft-lock delete; null = hard-lock absent (stays in overrides)
      }
    }
    for (const key of softKeys) delete attrOverrides[key];

    if (parentDoc) {
      this.backend = attrs.backend;
      const parentDoctype = this._parentDoctype;
      if ((this.doctype = attrs.doctype = parentDoctype) !== DEFAULT_DOCTYPE) {
        this._updateDoctypeAttributes(DEFAULT_DOCTYPE);
      }
      // Nested documents use a plain Reader (no include/conditional processing), matching Ruby behaviour.
      this.reader = new Reader(data, options.cursor, { document: this });
      if (this.sourcemap) this.sourceLocation = this.reader.cursor;
    } else {
      this.backend = null;
      const initialBackend = attrs.backend || DEFAULT_BACKEND;
      if (initialBackend === 'manpage') {
        this.doctype = attrs.doctype = attrOverrides.doctype = 'manpage';
      } else {
        this.doctype = attrs.doctype ??= DEFAULT_DOCTYPE;
      }
      this._updateBackendAttributes(initialBackend, true);

      attrs.stylesdir ??= '.';
      attrs.iconsdir ??= `${attrs.imagesdir ?? './images'}/icons`;

      this._fillDatetimeAttributes(attrs, this._inputMtime);

      // Extensions initialization deferred — handle in parse()
      this.reader = new PreprocessorReader(
        this,
        data,
        new Cursor(attrs.docfile ?? null, this.baseDir),
        { normalize: true }
      );
      if (this.sourcemap) this.sourceLocation = this.reader.cursor;
    }
  }

  /** Alias catalog as references (backwards compat). */
  get references() {
    return this.catalog
  }

  /** @returns {boolean} True if this is a nested (child) document. */
  nested() {
    return !!this.parentDocument
  }

  /**
   * Factory — create and fully parse a Document asynchronously.
   * @param {string|string[]|null} data - The AsciiDoc source.
   * @param {Object} [options={}] - Processing options.
   * @returns {Promise<Document>} The parsed Document.
   */
  static async create(data, options = {}) {
    const doc = new Document(data, options);
    await doc.parse();
    return doc
  }

  /**
   * Parse the AsciiDoc source and populate the document AST.
   *
   * This method is idempotent — repeated calls are no-ops once parsing is done.
   * You rarely need to call it directly: prefer {@link Document.create} (factory) or
   * the top-level {@link load} / {@link loadFile} functions, which call `parse()` for you.
   *
   * Call `parse()` explicitly only when you constructed `new Document(...)` by hand and
   * need to defer the work, or when you want to supply a replacement `data` source.
   *
   * @param {string|string[]|null} [data=null] - Optional replacement source lines.
   *   When provided, replaces the data that was given to the constructor.
   * @returns {Promise<Document>} This Document instance (allows chaining).
   *
   * @example
   * const doc = new Document('= Hello', {})
   * await doc.parse()
   * console.log(doc.getTitle()) // → 'Hello'
   */
  async parse(data = null) {
    if (this._parsed) return this

    if (data) {
      this.reader = new PreprocessorReader(
        this,
        data,
        new Cursor(this.attributes.docfile ?? null, this.baseDir),
        { normalize: true }
      );
      if (this.sourcemap) this.sourceLocation = this.reader.cursor;
    }

    if (!this.parentDocument && this.extensions?.hasPreprocessors?.()) {
      for (const ext of this.extensions.preprocessors()) {
        this.reader = ext.processMethod(this, this.reader) ?? this.reader;
      }
    }

    await Parser.parse(this.reader, this, {
      header_only: this.options.parse_header_only,
    });
    this.restoreAttributes();

    if (!this.parentDocument && this.extensions?.hasTreeProcessors?.()) {
      for (const ext of this.extensions.treeProcessors()) {
        const result = ext.processMethod(this);
        if (result instanceof Document && result !== this) {
          return result
        }
      }
    }

    // Pre-compute all async text values (titles, list item text, cell text, reftexts)
    // so that synchronous getters work correctly during conversion. _resolveAllTexts
    // replays attribute entries in document order (mirroring conversion) so body-level
    // attribute (re)assignments are in scope; snapshot and restore the document
    // attributes so the downstream steps and conversion still start from the restored
    // (header) state, matching Ruby's restore_attributes-before-convert invariant.
    //
    // This runs in two passes because list item / table cell / dlist text may contain
    // natural cross-references (e.g. <<Some section title>>) that resolve against the
    // reftext→id map. Pass 1 substitutes titles and reftexts only, so every section
    // reftext is known; the map is then built; pass 2 substitutes the block content
    // text, where resolveId() can now match those natural references.
    const attributesSnapshot = { ...this.attributes };
    // Pass 1: titles + reftexts (no block content text yet).
    await this._resolveAllTexts(this, false);
    this._restoreAttributeSnapshot(attributesSnapshot);
    // Pre-compute reftext for all registered inline anchor nodes.
    for (const ref of Object.values(this.catalog.refs)) {
      if (ref && typeof ref.precomputeReftext === 'function') {
        await ref.precomputeReftext();
      }
    }
    // Build the reftext→id lookup map so that resolveId() is synchronous.
    await this._buildReftextsMap();
    // Pass 2: list item / table cell / dlist text, now that natural cross-references
    // can be resolved against the reftext→id map.
    await this._resolveAllTexts(this, true);
    this._restoreAttributeSnapshot(attributesSnapshot);
    // Reset the footnote counter so that body-content footnotes (processed during conversion)
    // start numbering from 1, reproducing Ruby's "out of sequence" quirk: title footnotes are
    // numbered during parsing via apply_title_subs, then the counter restarts for body content.
    delete this.attributes['footnote-number'];
    delete this._counters['footnote-number'];

    this._parsed = true;
    return this
  }

  /**
   * Return whether the document has been fully parsed.
   * @returns {boolean}
   */
  isParsed() {
    return this._parsed
  }

  /**
   * Get the named counter and advance it by one step.
   *
   * Counters are document-scoped sequences used for automatic numbering (figures,
   * tables, custom labels, …). Each call increments the sequence and returns the
   * new value. Numeric counters increment by 1; alphabetic counters advance through
   * the alphabet (`'a'` → `'b'` → … → `'z'`).
   *
   * When the counter does not yet exist:
   * - If `seed` is a number (or a string that parses as an integer), the counter starts at `seed`.
   * - If `seed` is a letter (`'a'`–`'z'`), the counter starts at that letter.
   * - If `seed` is `null` (default), the counter starts at `1`.
   *
   * @param {string} name - Counter name (document-scoped key).
   * @param {string|number|null} [seed=null] - Starting value for new counters.
   * @returns {string|number} The new counter value after incrementing.
   *
   * @example <caption>Numeric counter (auto-starts at 1)</caption>
   * doc.counter('figure-number')   // → 1
   * doc.counter('figure-number')   // → 2
   *
   * @example <caption>Alphabetic counter</caption>
   * doc.counter('appendix-number', 'A')  // → 'A'
   * doc.counter('appendix-number', 'A')  // → 'B'
   *
   * @example <caption>Numeric counter with custom start</caption>
   * doc.counter('example-number', 5)   // → 5
   * doc.counter('example-number', 5)   // → 6
   */
  counter(name, seed = null) {
    if (this.parentDocument) return this.parentDocument.counter(name, seed)
    const isLocked = this.isAttributeLocked(name);
    let currVal = this._counters[name];
    let nextVal;
    if (
      (isLocked && currVal != null) ||
      ((currVal = this.attributes[name]) != null && currVal !== '')
    ) {
      nextVal = this._counters[name] = nextval(currVal);
    } else if (seed != null) {
      nextVal = this._counters[name] =
        String(seed) === String(parseInt(seed, 10)) ? parseInt(seed, 10) : seed;
    } else {
      nextVal = this._counters[name] = 1;
    }
    if (!isLocked) this.attributes[name] = nextVal;
    return nextVal
  }

  /**
   * Increment the specified counter and store it in the block's attributes.
   * @param {string} counterName
   * @param {Object} block
   * @returns {string|number} The new counter value.
   */
  incrementAndStoreCounter(counterName, block) {
    return new AttributeEntry(counterName, this.counter(counterName)).saveTo(
      block.attributes
    ).value
  }

  /** @deprecated Use incrementAndStoreCounter instead. */
  counterIncrement(counterName, block) {
    return this.incrementAndStoreCounter(counterName, block)
  }

  /**
   * Register a reference in the document catalog.
   * @param {string} type - Catalog type ('ids', 'refs', 'footnotes', 'links', 'images', 'callouts').
   * @param {*} value - The value to register.
   */
  register(type, value) {
    switch (type) {
      case 'ids': {
        // deprecated
        const id = value[0];
        const ref = new Inline(this, 'anchor', value[1], { type: 'ref', id });
        this.catalog.refs[id] ??= ref;
        // Keep _reftexts in sync if the map was already built (post-parse registration).
        if (this._reftexts && value[1]) this._reftexts[value[1]] ??= id;
        return ref
      }
      case 'refs': {
        const id = value[0];
        if (id in this.catalog.refs) return false
        this.catalog.refs[id] = value[1];
        return true
      }
      case 'footnotes':
        this.catalog.footnotes.push(value);
        return
      default:
        if (this.options.catalog_assets) {
          const entry =
            type === 'images'
              ? new ImageReference(value, this.attributes.imagesdir)
              : value;
          this.catalog[type]?.push(entry);
        }
    }
  }

  /**
   * Find the first registered reference matching the given reftext.
   * @param {string} text - The reftext to look up.
   * @returns {string|null} The matching ID, or null.
   */
  resolveId(text) {
    if (this._reftexts) return this._reftexts[text] ?? null
    // Fallback: scan refs synchronously (for documents not parsed via parse()).
    for (const [id, ref] of Object.entries(this.catalog.refs)) {
      const xreftext = ref.reftext ?? null;
      if (xreftext === text) return id
    }
    return null
  }

  /**
   * @private
   * @internal
   * Build the reftext→id lookup map. Called at end of parse().
   */
  async _buildReftextsMap() {
    this._reftexts = {};
    for (const [id, ref] of Object.entries(this.catalog.refs)) {
      const xreftext = ref.xreftext ? await ref.xreftext() : null;
      if (xreftext != null) this._reftexts[xreftext] ??= id;
    }
  }

  /** @returns {boolean} True if this document has child Section objects. */
  hasSections() {
    return this._nextSectionIndex > 0
  }

  isMultipart() {
    if (this.doctype !== 'book') return undefined
    return this.blocks.some((b) => {
      if (b.context !== 'section') return false
      if (b.level === 0) return true
      if (!b.special) return false // break in Ruby → but some() handles this
      return false
    })
  }

  hasFootnotes() {
    return this.catalog.footnotes.length > 0
  }
  get footnotes() {
    return this.catalog.footnotes
  }
  get callouts() {
    return this.catalog.callouts
  }

  isNested() {
    return this.parentDocument != null
  }
  isEmbedded() {
    return 'embedded' in this.attributes
  }
  hasExtensions() {
    return this.extensions != null
  }

  source() {
    return this.reader?.source?.() ?? null
  }
  sourceLines() {
    return this.reader?.sourceLines ?? null
  }

  basebackend(base) {
    return this.attributes.basebackend === base
  }

  /** @returns {string|null} The document title. */
  get title() {
    return this.doctitle()
  }
  set title(val) {
    let sect = this.header;
    if (!sect) {
      sect = this.header = new Section(this, 0);
      sect.sectname = 'header';
    }
    sect.title = val;
  }

  /**
   * Resolve the primary title for the document.
   * @param {Object} [opts={}]
   * @param {boolean} [opts.use_fallback] - Use 'untitled-label' if no title found.
   * @param {boolean|string} [opts.partition] - Return a DocumentTitle instead of a string.
   * @param {boolean} [opts.sanitize] - Strip XML tags from the title.
   * @returns {string|DocumentTitle|null}
   */
  doctitle(opts = {}) {
    let val = this.attributes.title;
    if (val == null) {
      const sect = this.firstSection();
      if (sect) {
        val = sect.title;
      } else if (opts.use_fallback) {
        val = this.attributes['untitled-label'];
      }
      if (val == null) return null
    }
    if (opts.partition) {
      const sep =
        opts.partition === true
          ? this.attributes['title-separator']
          : opts.partition;
      return new DocumentTitle(val, { ...opts, separator: sep })
    }
    if (opts.sanitize && val.includes('<')) {
      return val.replace(XmlSanitizeRx, '').replace(/ {2,}/g, ' ').trim()
    }
    return val
  }

  get name() {
    return this.doctitle()
  }

  /**
   * @param {string|null} [_xrefstyle=null]
   * @returns {Promise<string|null>}
   */
  xreftext(_xrefstyle = null) {
    const val = this.reftext;
    return val && val.length > 0 ? val : this.title
  }

  get author() {
    return this.attributes.author ?? null
  }
  get revdate() {
    return this.attributes.revdate ?? null
  }

  authors() {
    const attrs = this.attributes;
    if (!('author' in attrs)) return []
    const list = [
      new Author(
        attrs.author,
        attrs.firstname,
        attrs.middlename,
        attrs.lastname,
        attrs.authorinitials,
        attrs.email
      ),
    ];
    const numAuthors = parseInt(attrs.authorcount ?? '0', 10);
    for (let idx = 2; idx <= numAuthors; idx++) {
      list.push(
        new Author(
          attrs[`author_${idx}`],
          attrs[`firstname_${idx}`],
          attrs[`middlename_${idx}`],
          attrs[`lastname_${idx}`],
          attrs[`authorinitials_${idx}`],
          attrs[`email_${idx}`]
        )
      );
    }
    return list
  }

  isNotitle() {
    return 'notitle' in this.attributes
  }
  isNoheader() {
    return 'noheader' in this.attributes
  }
  isNofooter() {
    return 'nofooter' in this.attributes
  }

  firstSection() {
    return (
      this.header ?? this.blocks.find((b) => b.context === 'section') ?? null
    )
  }

  hasHeader() {
    return this.header != null
  }

  /**
   * Append a child Block, assigning index if it's a section.
   * @param {Object} block
   * @returns {Object} The appended block.
   */
  append(block) {
    if (block.context === 'section') this.assignNumeral(block);
    return super.append(block)
  }

  /**
   * @private
   * Called by parser after parsing header, before parsing body.
   */
  finalizeHeader(unrootedAttributes, headerValid = true) {
    this._clearPlaybackAttributes(unrootedAttributes);
    this._saveAttributes();
    if (!headerValid) unrootedAttributes['invalid-header'] = true;
    return unrootedAttributes
  }

  /**
   * Replay attribute assignments from block attributes.
   * @param {Object} blockAttributes
   */
  playbackAttributes(blockAttributes) {
    const entries = getAttributeEntries(blockAttributes);
    if (!entries) return
    for (const entry of entries) {
      if (entry.negate) {
        delete this.attributes[entry.name];
        if (entry.name === 'compat-mode') this.compatMode = false;
      } else {
        this.attributes[entry.name] = entry.value;
        if (entry.name === 'compat-mode') this.compatMode = true;
      }
    }
  }

  /**
   * Set the specified attribute if not locked, applying attribute value substitutions.
   * @param {string} name
   * @param {string} [value='']
   * @returns {string|null} The substituted value, or `null` if the attribute is locked.
   */
  setAttribute(name, value = '') {
    return this._setAttributeInternal(name, value, false)
  }

  /**
   * Delete the specified attribute if not locked.
   * @param {string} name
   * @returns {boolean} True if deleted, false if locked.
   */
  deleteAttribute(name) {
    if (this.isAttributeLocked(name)) return false
    delete this.attributes[name];
    this._attributesModified.add(name);
    return true
  }

  /**
   * Check if the attribute is locked (set via attribute overrides).
   * @param {string} name
   * @returns {boolean}
   */
  isAttributeLocked(name) {
    return name in this._attributeOverrides
  }

  /** @deprecated Use isAttributeLocked instead. */
  attributeLocked(name) {
    return this.isAttributeLocked(name)
  }

  /**
   * Assign a value to the specified attribute in the document header.
   * @param {string} name
   * @param {string} [value='']
   * @param {boolean} [overwrite=true]
   * @returns {boolean} False if the attribute exists and overwrite is false.
   */
  setHeaderAttribute(name, value = '', overwrite = true) {
    const target = this._headerAttributes ?? this.attributes;
    if (!overwrite && name in target) return false
    target[name] = value;
    return true
  }

  /**
   * Convert the parsed document to its output format (HTML5 by default).
   *
   * If `parse()` has not been called yet, it is called automatically.
   *
   * @param {Object} [opts={}] - Conversion options.
   * @param {boolean} [opts.standalone] - When `true`, wraps output in a full
   *   document shell (html/head/body). Defaults to the `standalone` option
   *   passed at load time (which itself defaults to `true`).
   * @param {string} [opts.outfile] - Path of the output file; stored as the
   *   `outfile` document attribute during conversion.
   * @param {string} [opts.outdir] - Directory of the output file; stored as the
   *   `outdir` document attribute during conversion.
   * @returns {Promise<string>} The converted output string.
   *
   * @example <caption>Embedded HTML (no html/head/body wrapper)</caption>
   * const doc = await Document.create('= Hello\nWorld', {})
   * const html = await doc.convert({ standalone: false })
   *
   * @example <caption>Full standalone HTML page</caption>
   * const html = await doc.convert({ standalone: true })
   */
  async convert(opts = {}) {
    if (this._timings) this._timings.start('convert');
    await this.parse();
    // Pre-compute AsciiDoc table cell content now that parse is done:
    // callouts are rewound and all refs are registered.
    if (!this.parentDocument) await this._convertAsciiDocCells();
    if (this.safe < SafeMode.SERVER && Object.keys(opts).length > 0) {
      if (!opts.outfile) delete this.attributes.outfile;
      else this.attributes.outfile = opts.outfile;
      if (!opts.outdir) delete this.attributes.outdir;
      else this.attributes.outdir = opts.outdir;
    }

    let output;
    if (this.doctype === 'inline') {
      const block = this.blocks[0] ?? this.header;
      if (block) {
        if (
          block.contentModel === 'compound' ||
          block.contentModel === 'empty'
        ) {
          this.logger.warn(
            'no inline candidate; use the inline doctype to convert a single paragraph, verbatim, or raw block'
          );
        } else {
          output = await block.content();
        }
      }
    } else {
      let transform;
      if ('standalone' in opts) {
        transform = opts.standalone ? 'document' : 'embedded';
      } else if ('header_footer' in opts) {
        transform = opts.header_footer ? 'document' : 'embedded';
      } else {
        transform = this.options.standalone ? 'document' : 'embedded';
      }
      output = await this.converter.convert(this, transform);
    }

    if (!this.parentDocument && this.extensions?.hasPostprocessors?.()) {
      for (const ext of this.extensions.postprocessors()) {
        output = ext.processMethod(this, output);
      }
    }

    if (this._timings) this._timings.record('convert');
    return output
  }

  /** @deprecated Use convert instead. */
  render(opts = {}) {
    return this.convert(opts)
  }

  /**
   * Write converted output to a file path or a writable stream.
   *
   * When `target` is a **string**, the output is written to that file path using
   * `node:fs/promises.writeFile`.
   * When `target` is a **writable stream** (has a `.write()` method), the output
   * is written to the stream in two chunks (content + newline).
   * When the converter itself implements `write()`, that method is called instead.
   *
   * @param {string} output - The converted output string returned by {@link convert}.
   * @param {string|import('stream').Writable} target - File path or writable stream.
   * @returns {Promise<void>}
   *
   * @example <caption>Write to a file</caption>
   * const output = await doc.convert()
   * await doc.write(output, 'out/index.html')
   *
   * @example <caption>Write to a stream</caption>
   * await doc.write(output, process.stdout)
   */
  async write(output, target) {
    if (this._timings) this._timings.start('write');
    if (typeof this.converter.write === 'function') {
      this.converter.write(output, target);
    } else {
      if (target && typeof target.write === 'function') {
        if (output && output.length > 0) {
          target.write(output.replace(/\n$/, ''));
          target.write(LF$1);
        }
      } else {
        try {
          const { writeFile } = await import('node:fs/promises');
          await writeFile(target, output ?? '', 'utf8');
        } catch {}
      }
      if (
        this.backend === 'manpage' &&
        typeof target === 'string' &&
        typeof this.converter.constructor?.writeAlternatePages === 'function'
      ) {
        this.converter.constructor.writeAlternatePages(
          this.attributes.mannames,
          this.attributes.manvolnum,
          target
        );
      }
    }
    if (this._timings) this._timings.record('write');
  }

  async content() {
    delete this.attributes.title;
    return super.content()
  }

  /**
   * Read the docinfo file(s) for inclusion in the document template.
   * @param {string} [location='head'] - 'head' or 'footer'.
   * @param {string|null} [suffix=null] - File suffix override.
   * @returns {Promise<string>} Combined docinfo content.
   */
  async docinfo(location = 'head', suffix = null) {
    let content = null;
    if (this.safe < SafeMode.SECURE) {
      const qualifier = location !== 'head' ? `-${location}` : '';
      suffix ??= this.outfilesuffix;

      let docinfo = this.attributes.docinfo;
      if (!docinfo) {
        if ('docinfo2' in this.attributes) {
          docinfo = ['private', 'shared'];
        } else if ('docinfo1' in this.attributes) {
          docinfo = ['shared'];
        } else {
          docinfo = docinfo != null ? ['private'] : null;
        }
      } else {
        docinfo = docinfo.split(',').map((k) => k.trim());
      }

      if (docinfo) {
        content = [];
        const docinfoFile = `docinfo${qualifier}${suffix}`;
        const docinfoDir = this.attributes.docinfodir;
        const docinfoSubs = this._resolveDocinfoSubs();

        const hasShared =
          docinfo.includes('shared') || docinfo.includes(`shared-${location}`);
        if (hasShared) {
          const path = this.normalizeSystemPath(docinfoFile, docinfoDir);
          const shared = await this.readAsset(path, { normalize: true });
          if (shared) content.push(await this.applySubs(shared, docinfoSubs));
        }

        const docname = this.attributes.docname;
        const hasPrivate =
          docname &&
          (docinfo.includes('private') ||
            docinfo.includes(`private-${location}`));
        if (hasPrivate) {
          const path = this.normalizeSystemPath(
            `${docname}-${docinfoFile}`,
            docinfoDir
          );
          const priv = await this.readAsset(path, { normalize: true });
          if (priv) content.push(await this.applySubs(priv, docinfoSubs));
        }
      }
    }

    if (this.extensions && this.hasDocinfoProcessors(location)) {
      const extContent = this._docinfoProcessorExtensions[location]
        .map((ext) => ext.processMethod(this))
        .filter(Boolean);
      return (content ?? []).concat(extContent).join(LF$1)
    }
    return content ? content.join(LF$1) : ''
  }

  /**
   * @param {string} [location='head'] A location for checking docinfo extensions at a given location (head or footer).
   * @returns {boolean} True if docinfo processors are registered for the given location.
   */
  hasDocinfoProcessors(location = 'head') {
    if (location in this._docinfoProcessorExtensions) {
      return this._docinfoProcessorExtensions[location] !== false
    }
    if (this.extensions?.hasDocinfoProcessors?.(location)) {
      const exts = this.extensions.docinfoProcessors(location);
      this._docinfoProcessorExtensions[location] = exts || false;
      return !!exts
    }
    this._docinfoProcessorExtensions[location] = false;
    return false
  }

  // ── JavaScript-style accessors ────────────────────────────────────────────────

  /** @returns {string|null} The document title. */
  getTitle() {
    return this.title
  }

  /** @param {string} val */
  setTitle(val) {
    this.title = val;
  }

  /**
   * @deprecated Use {@link getDocumentTitle} instead.
   * @see getDocumentTitle
   */
  getDoctitle(opts = {}) {
    return this.doctitle(opts)
  }

  /**
   * Resolve the primary title for the document.
   *
   * Searches the following locations in order, returning the first non-empty value:
   * - document-level attribute named `title`
   * - header title (the document title)
   * - title of the first section
   * - document-level attribute named `untitled-label` (if `opts.use_fallback` is set)
   *
   * If no value can be resolved, `null` is returned.
   *
   * If `opts.partition` is specified, the value is parsed into a {@link DocumentTitle} object.
   * If `opts.sanitize` is specified, XML elements are removed from the value.
   * @param {Object} [opts={}]
   * @param {boolean} [opts.partition] - Parse the title into a {@link DocumentTitle} with main and subtitle parts.
   * @param {boolean} [opts.sanitize] - Strip XML/HTML elements from the resolved title.
   * @param {boolean} [opts.use_fallback] - Fall back to the `untitled-label` attribute if no title is found.
   * @returns {string|DocumentTitle|null} The resolved title, or null if none found.
   */
  getDocumentTitle(opts = {}) {
    return this.doctitle(opts)
  }

  /** @returns {string} The captioned title. */
  getCaptionedTitle() {
    return this.captionedTitle()
  }

  /** @returns {string} The document type (e.g. 'article', 'book'). */
  getDoctype() {
    return this.doctype
  }

  /** @returns {string} The backend name (e.g. 'html5', 'docbook5'). */
  getBackend() {
    return this.backend
  }

  /**
   * @returns {number} The safe mode level as a numeric value.
   * Corresponds to {@link SafeMode}: unsafe (0), safe (1), server (10), secure (20).
   */
  getSafe() {
    return this.safe
  }

  /**
   * Get the AsciiDoc compatibility mode flag.
   *
   * Enabling this attribute activates the following syntax changes:
   * - single quotes as constrained emphasis formatting marks
   * - single backticks parsed as inline literal, formatted as monospace
   * - single plus parsed as constrained, monospaced inline formatting
   * - double plus parsed as constrained, monospaced inline formatting
   * @returns {boolean} True if compat mode is enabled.
   */
  getCompatMode() {
    return this.compatMode
  }

  /** @returns {boolean} True if sourcemap is enabled. */
  getSourcemap() {
    return this.sourcemap
  }

  /** @param {boolean} val */
  setSourcemap(val) {
    this.sourcemap = val;
  }

  /** @returns {string} The output file suffix (e.g. '.html'). */
  getOutfilesuffix() {
    return this.outfilesuffix
  }

  /** @returns {Object} The frozen options object. */
  getOptions() {
    return this.options
  }

  /** @returns {Object} The converter instance. */
  getConverter() {
    return this.converter
  }

  /**
   * Set the converter instance for this document.
   * @param {Object} converter - The converter instance.
   */
  setConverter(converter) {
    this.converter = converter;
  }

  /** @returns {string|null} The raw AsciiDoc source. */
  getSource() {
    return this.source()
  }

  /** @returns {string[]|null} The source lines. */
  getSourceLines() {
    return this.sourceLines()
  }

  /** @returns {Object} The preprocessor reader. */
  getReader() {
    return this.reader
  }

  /** @returns {Footnote[]} The registered footnotes. */
  getFootnotes() {
    return this.footnotes
  }

  /** @returns {Object} The callouts registry. */
  getCallouts() {
    return this.callouts
  }

  /** @returns {Object} The asset catalog. */
  getCatalog() {
    return this.catalog
  }

  /** @returns {Object} The counters map. */
  getCounters() {
    return this._counters
  }

  /** @returns {string|null} The first author name. */
  getAuthor() {
    return this.author
  }

  /** @returns {Author[]} All document authors. */
  getAuthors() {
    return this.authors()
  }

  /** @returns {string} The base directory path. */
  getBaseDir() {
    return this.baseDir
  }

  /** @returns {RevisionInfo} The revision information. */
  getRevisionInfo() {
    const attrs = this.attributes;
    return new RevisionInfo(
      attrs.revnumber ?? null,
      attrs.revdate ?? null,
      attrs.revremark ?? null
    )
  }

  /** @returns {Object|null} The extensions registry. */
  getExtensions() {
    return this.extensions
  }

  /** @returns {Document|undefined} The parent document, or undefined for root documents. */
  getParentDocument() {
    return this.parentDocument ?? undefined
  }

  /**
   * Get the parent node of this node.
   * Always returns undefined for a root Document (Document is its own internal parent).
   * @returns {undefined}
   */
  getParent() {
    return undefined
  }

  /** @returns {Object|null} The syntax highlighter instance. */
  getSyntaxHighlighter() {
    return this.syntaxHighlighter
  }

  /** @returns {Object} The id→node reference map. */
  getRefs() {
    return this.catalog.refs
  }

  /** @returns {ImageReference[]} The registered image references. */
  getImages() {
    return this.catalog.images
  }

  /** @returns {string[]} The registered links. */
  getLinks() {
    return this.catalog.links
  }

  /** @returns {Object|null} The level-0 Section (document header). */
  getHeader() {
    return this.header
  }

  /** @returns {boolean} True if the basebackend attribute is set. */
  isBasebackend() {
    return !!this.attributes.basebackend
  }

  /** @returns {Object} The asset catalog (alias for getCatalog). */
  getReferences() {
    return this.catalog
  }

  /** @returns {string|undefined} The revision date. */
  getRevisionDate() {
    return this.attributes.revdate ?? undefined
  }

  /** @returns {string|undefined} The revision date (alias for getRevisionDate). */
  getRevdate() {
    return this.attributes.revdate ?? undefined
  }

  /** @returns {string|undefined} The revision number. */
  getRevisionNumber() {
    return this.attributes.revnumber ?? undefined
  }

  /** @returns {string|undefined} The revision remark. */
  getRevisionRemark() {
    return this.attributes.revremark ?? undefined
  }

  /** @returns {boolean} True if any revision info is set. */
  hasRevisionInfo() {
    return !this.getRevisionInfo().isEmpty()
  }

  /** @returns {boolean} True if the notitle attribute is set. */
  getNotitle() {
    return this.isNotitle()
  }

  /** @returns {boolean} True if the noheader attribute is set. */
  getNoheader() {
    return this.isNoheader()
  }

  /** @returns {boolean} True if the nofooter attribute is set. */
  getNofooter() {
    return this.isNofooter()
  }

  /** Restore attributes to their saved header state. */
  restoreAttributes() {
    if (!this.parentDocument) this.catalog.callouts.rewind();
    const toRestore = this._headerAttributes;
    if (toRestore) {
      for (const key of Object.keys(this.attributes)) {
        if (!(key in toRestore)) delete this.attributes[key];
      }
      Object.assign(this.attributes, toRestore);
    }
  }

  /**
   * @param {string} [location='head']
   * @param {string} [suffix]
   * @returns {Promise<string>}
   */
  async getDocinfo(location = 'head', suffix = undefined) {
    return this.docinfo(location, suffix)
  }

  /**
   * Delete the specified attribute if not locked.
   * @param {string} name - The attribute name to remove.
   * @returns {string|undefined} The previous value, or undefined if not present or locked.
   */
  removeAttribute(name) {
    const prev = this.attributes[name];
    this.deleteAttribute(name);
    return prev
  }

  toString() {
    return `#<Document {doctype: '${this.doctype}', doctitle: ${JSON.stringify(this.header?.title ?? null)}, blocks: ${this.blocks.length}}>`
  }

  // ── Private methods ─────────────────────────────────────────────────────────

  /**
   * @private
   * @internal
   * Set the specified attribute without applying attribute value substitutions.
   * Used internally by the parser when the value is already resolved.
   * @param {string} name
   * @param {string} [value='']
   * @returns {string|null} The value as-is, or `null` if the attribute is locked.
   */
  _setAttributeRaw(name, value = '') {
    return this._setAttributeInternal(name, value, true)
  }

  /**
   * @private
   * @internal
   */
  _setAttributeInternal(name, value, skipSubs) {
    if (this.isAttributeLocked(name)) return null
    if (!skipSubs && value && value !== '')
      value = this._applyAttributeValueSubs(value);
    if (this._headerAttributes) {
      // Beyond the document header; only update live attributes, not the header snapshot.
      this.attributes[name] = value;
    } else {
      switch (name) {
        case 'backend':
          this._updateBackendAttributes(
            value,
            this._attributesModified.delete('htmlsyntax') &&
              value === this.backend
          );
          break
        case 'doctype':
          this._updateDoctypeAttributes(value);
          break
        default:
          this.attributes[name] = value;
      }
      this._attributesModified.add(name);
    }
    return value
  }

  /**
   * @private
   * @internal
   * Walk the block tree in document order and pre-compute the content of
   * every AsciiDoc-style table cell. Must be called AFTER parse() has finished so
   * that (a) callouts.rewind() has been called and (b) all cross-references from
   * the main document are already registered in the catalog.
   */
  async _convertAsciiDocCells(block = this) {
    for (const child of block.blocks ?? []) {
      if (child.context === 'table') {
        for (const section of ['head', 'body', 'foot']) {
          for (const row of child.rows[section] ?? []) {
            for (const cell of row) {
              if (
                cell.style === 'asciidoc' &&
                cell._innerDocument &&
                cell._innerContent == null
              ) {
                // Recurse into the inner document first so that AsciiDoc cells
                // of any nested table have their content computed before the
                // inner document (and the nested table) is rendered.
                await this._convertAsciiDocCells(cell._innerDocument);
                cell._innerContent = await cell._innerDocument.convert();
              }
            }
          }
        }
      } else {
        await this._convertAsciiDocCells(child);
      }
    }
  }

  /**
   * @private
   * Sync version: applies only synchronous subs (specialcharacters, attributes, replacements).
   * Used by setAttribute() which must remain sync for the {set:...} inline directive path.
   * Async subs (quotes, macros, …) in pass macros are handled by _applyAttributeEntryValueSubs.
   */
  _applyAttributeValueSubs(value) {
    const m = value.match(AttributeEntryPassMacroRx);
    if (m) {
      let result = m[2] ?? '';
      if (m[1]) {
        const subs = this.resolvePassSubs(m[1]);
        if (subs) {
          for (const sub of subs) {
            if (sub === 'specialcharacters')
              result = this.subSpecialchars(result);
            else if (sub === 'attributes') result = this.subAttributes(result);
            else if (sub === 'replacements')
              result = this.subReplacements(result);
          }
        }
      }
      return this._maxAttributeValueSize != null
        ? _limitBytesize(result, this._maxAttributeValueSize)
        : result
    }
    const result = this.applyHeaderSubs(value);
    return this._maxAttributeValueSize != null
      ? _limitBytesize(result, this._maxAttributeValueSize)
      : result
  }

  /**
   * @private
   * Async version: applies all subs including async ones (quotes, macros, …).
   * Used by processAttributeEntry() which can await the result.
   */
  async _applyAttributeEntryValueSubs(value) {
    const m = value.match(AttributeEntryPassMacroRx);
    if (m) {
      let result = m[2] ?? '';
      if (m[1]) {
        const subs = this.resolvePassSubs(m[1]);
        if (subs) result = await this.applySubs(result, subs);
      }
      return this._maxAttributeValueSize != null
        ? _limitBytesize(result, this._maxAttributeValueSize)
        : result
    }
    const result = this.applyHeaderSubs(value);
    return this._maxAttributeValueSize != null
      ? _limitBytesize(result, this._maxAttributeValueSize)
      : result
  }

  /**
   * @private
   * Resolve the list of substitutions to apply to docinfo files.
   *
   * Resolves subs from the `docinfosubs` document attribute if present,
   * otherwise returns `['attributes']` as the default.
   * @returns {string[]} The list of substitutions to apply.
   */
  _resolveDocinfoSubs() {
    return 'docinfosubs' in this.attributes
      ? this.resolveSubs(this.attributes.docinfosubs, 'block', null, 'docinfo')
      : ['attributes']
  }

  /**
   * @private
   * Restore the document attributes to a previously captured snapshot, discarding any
   * body-level (re)assignments replayed while pre-computing text. Mirrors Ruby's
   * restore_attributes-before-convert invariant.
   * @param {Object} snapshot - The attributes snapshot to restore.
   */
  _restoreAttributeSnapshot(snapshot) {
    for (const key of Reflect.ownKeys(this.attributes))
      delete this.attributes[key];
    Object.assign(this.attributes, snapshot);
  }

  /**
   * @private
   * Walk the block tree and pre-compute all async text values.
   * Handles titles (AbstractBlock), list item text, table cell text, and reftexts.
   *
   * Runs in two passes (see {@link parse}): with `resolveContent` false only titles and
   * reftexts are substituted (so the reftext→id map can be built); with `resolveContent`
   * true the list item / table cell / dlist text is substituted, resolving any natural
   * cross-references against the now-complete map. Title/reftext pre-computation is
   * idempotent (results are cached), so running it in both passes is a no-op the second time.
   * @param {AbstractBlock} block - The block to resolve.
   * @param {boolean} resolveContent - Whether to substitute list item / cell / dlist text.
   */
  async _resolveAllTexts(block, resolveContent) {
    // Replay this block's attribute entries (in document order, since the walk is
    // depth-first pre-order like conversion) so that body-level attribute assignments
    // and reassignments are in scope when the block's — and its descendants' and later
    // siblings' — title / list item / table cell / reftext values are substituted.
    // Mirrors AbstractBlock#convert, which calls playbackAttributes before converting.
    this.playbackAttributes(block.attributes);
    // The header section lives outside document.blocks; pre-compute its title here so
    // that doc.doctitle() returns the fully-substituted title (with replacements applied,
    // e.g. ' → &#8217;) rather than the header-subs-only fallback.
    if (block === this && this.header) {
      await this.header.precomputeTitle?.();
    }
    // Skip title pre-computation for blocks with an explicit empty id ([id=]).
    // In Ruby, apply_title_subs is lazy: it is never called during parsing for such
    // blocks because section.title is never accessed.  An explicit empty id is
    // distinguished by block.attributes.id === '' (the AttributeList parser preserves it).
    if (block.attributes?.id !== '') {
      await block.precomputeTitle?.();
    }
    await block.precomputeReftext?.();
    const ctx = block.context;
    if (ctx === 'dlist') {
      // dlist.blocks is an array of [[term, ...], item_or_null] pairs.
      for (const [terms, item] of block.blocks ?? []) {
        for (const term of terms ?? []) {
          if (resolveContent) await term.precomputeText?.();
          await this._resolveAllTexts(term, resolveContent);
        }
        if (item) {
          if (resolveContent) await item.precomputeText?.();
          await this._resolveAllTexts(item, resolveContent);
        }
      }
    } else if (ctx === 'table') {
      for (const row of [
        ...(block.rows?.head ?? []),
        ...(block.rows?.body ?? []),
        ...(block.rows?.foot ?? []),
      ]) {
        for (const cell of row) {
          if (resolveContent) await cell.precomputeText?.();
          await cell.precomputeReftext?.();
        }
      }
    } else {
      for (const child of block.blocks ?? []) {
        if (resolveContent) await child.precomputeText?.();
        await this._resolveAllTexts(child, resolveContent);
      }
    }
  }

  /**
   * @private
   * Create and initialize an instance of the converter for this document.
   * @param {string} backend - The backend name (e.g. 'html5', 'docbook5').
   * @param {string} [delegateBackend] - An optional delegate backend to use when resolving the converter.
   */
  _createConverter(backend, delegateBackend) {
    const opts = this.options;
    if (!this.converter && opts._preCreatedConverter) {
      return opts._preCreatedConverter
    }
    const converterOpts = {
      document: this,
      htmlsyntax: this.attributes.htmlsyntax,
    };
    if (opts.template_dirs || opts.template_dir) {
      converterOpts.template_dirs = [].concat(
        opts.template_dirs ?? opts.template_dir
      );
      converterOpts.template_cache = opts.template_cache ?? true;
      converterOpts.template_engine = opts.template_engine;
      converterOpts.template_engine_options = opts.template_engine_options;
      converterOpts.eruby = opts.eruby;
      converterOpts.safe = this.safe;
      if (delegateBackend) converterOpts.delegate_backend = delegateBackend;
    }
    if (opts.converter) {
      return new CustomFactory$1({ [backend]: opts.converter }).createSync(
        backend,
        converterOpts
      )
    }
    const factory = opts.converter_factory ?? Converter;
    return factory.createSync(backend, converterOpts)
  }

  /**
   * Delete any attributes stored for playback
   * @param attributes
   * @private
   * @internal
   */
  _clearPlaybackAttributes(attributes) {
    delete attributes[ATTR_ENTRIES_KEY];
  }

  /**
   * Branch the attributes so that the original state can be restored
   * at a future time.
   * @returns the duplicated attributes, which will later be restored
   * @private
   * @internal
   */
  _saveAttributes() {
    const attrs = this.attributes;
    if (!('doctitle' in attrs)) {
      const dt = this.doctitle();
      if (dt) attrs.doctitle = dt;
    }
    this.id ??= attrs['css-signature'] ?? null;

    // Handle toc / toc2
    // NOTE: delete toc/toc2 from attrs first; only re-add specific placement/position attrs
    let tocVal;
    if ('toc2' in attrs) {
      delete attrs.toc2;
      tocVal = 'left';
    } else if ('toc' in attrs) {
      tocVal = attrs.toc;
      delete attrs.toc;
    }
    if (tocVal != null) {
      const tocPlacementVal = attrs['toc-placement'] ?? 'macro';
      const tocPositionVal =
        tocPlacementVal && tocPlacementVal !== 'auto'
          ? tocPlacementVal
          : attrs['toc-position'];
      if (tocVal !== '' || tocPositionVal) {
        const defaultTocPosition = 'left';
        let defaultTocClass = 'toc2';
        const position = !tocPositionVal
          ? tocVal || defaultTocPosition
          : tocPositionVal;
        attrs['toc-placement'] = 'auto';
        switch (position) {
          case 'left':
          case '<':
          case '&lt;':
            attrs['toc-position'] = 'left';
            break
          case 'right':
          case '>':
          case '&gt;':
            attrs['toc-position'] = 'right';
            break
          case 'top':
          case '^':
            attrs['toc-position'] = 'top';
            break
          case 'bottom':
          case 'v':
            attrs['toc-position'] = 'bottom';
            break
          case 'preamble':
          case 'macro':
            attrs['toc-position'] = 'content';
            attrs['toc-placement'] = position;
            defaultTocClass = null;
            break
          default:
            delete attrs['toc-position'];
            defaultTocClass = null;
        }
        if (defaultTocClass) attrs['toc-class'] ??= defaultTocClass;
      }
      attrs.toc = '';
    }

    const iconsVal = attrs.icons;
    if (iconsVal != null && !('icontype' in attrs)) {
      if (iconsVal !== '' && iconsVal !== 'font') {
        attrs.icons = '';
        if (iconsVal !== 'image') attrs.icontype = iconsVal;
      }
    }

    this.compatMode = 'compat-mode' in attrs;
    if (this.compatMode && 'language' in attrs) {
      attrs['source-language'] = attrs.language;
    }

    if (!this.parentDocument) {
      const basebackend = attrs.basebackend;
      if (basebackend === 'html') {
        const syntaxHlName = attrs['source-highlighter'];
        if (syntaxHlName && !attrs[`${syntaxHlName}-unavailable`]) {
          // SyntaxHighlighter — optional integration, handle gracefully
          try {
            const factory = this.options.syntax_highlighter_factory;
            const syntaxHls = this.options.syntax_highlighters;
            if (factory) {
              this.syntaxHighlighter = factory.create(
                syntaxHlName,
                this.backend,
                { document: this }
              );
            } else if (syntaxHls) {
              this.syntaxHighlighter = new DefaultFactoryProxy(
                syntaxHls,
                SyntaxHighlighter
              ).create(syntaxHlName, this.backend, { document: this });
            } else {
              this.syntaxHighlighter = SyntaxHighlighter.create(
                syntaxHlName,
                this.backend,
                { document: this }
              );
            }
          } catch {}
        }
      } else if (basebackend === 'docbook') {
        if (
          !this.isAttributeLocked('toc') &&
          !this._attributesModified.has('toc')
        ) {
          attrs.toc = '';
        }
        if (
          !this.isAttributeLocked('sectnums') &&
          !this._attributesModified.has('sectnums')
        ) {
          attrs.sectnums = '';
        }
      }
      this.outfilesuffix = attrs.outfilesuffix ?? null;

      for (const name of FLEXIBLE_ATTRIBUTES) {
        const _fv = this._attributeOverrides[name];
        if (name in this._attributeOverrides && _fv != null && _fv !== false) {
          delete this._attributeOverrides[name];
        }
      }
    }

    this._headerAttributes = { ...attrs };
  }

  /**
   * Assign the local and document datetime attributes, which includes localdate, localyear, localtime,
   * localdatetime, docdate, docyear, doctime, and docdatetime. Honor the SOURCE_DATE_EPOCH environment variable, if set.
   * @param attrs
   * @param inputMtime
   * @private
   * @internal
   */
  _fillDatetimeAttributes(attrs, inputMtime) {
    const sourceDateEpoch =
      typeof process !== 'undefined' ? process.env.SOURCE_DATE_EPOCH : null;
    const now =
      sourceDateEpoch && sourceDateEpoch !== ''
        ? new Date(parseInt(sourceDateEpoch, 10) * 1000)
        : new Date();

    let localdate = attrs.localdate;
    if (localdate) {
      attrs.localyear ??= localdate.length >= 4 ? localdate.slice(0, 4) : null;
    } else {
      localdate = attrs.localdate = _formatDate(now);
      attrs.localyear ??= String(now.getFullYear());
    }
    const localtime = (attrs.localtime ??= _formatTime(now));
    attrs.localdatetime ??= `${localdate} ${localtime}`;

    const effectiveMtime =
      sourceDateEpoch && sourceDateEpoch !== ''
        ? now
        : inputMtime instanceof Date
          ? inputMtime
          : now;

    let docdate = attrs.docdate;
    if (docdate) {
      attrs.docyear ??= docdate.length >= 4 ? docdate.slice(0, 4) : null;
    } else {
      docdate = attrs.docdate = _formatDate(effectiveMtime);
      attrs.docyear ??= String(effectiveMtime.getFullYear());
    }
    const doctime = (attrs.doctime ??= _formatTime(effectiveMtime));
    attrs.docdatetime ??= `${docdate} ${doctime}`;
  }

  /**
   * Update the backend attributes to reflect a change in the active backend.
   *
   * This method also handles updating the related doctype attributes if the
   * doctype attribute is assigned at the time this method is called.
   *
   * @param newBackend
   * @param init
   * @returns {undefined|*} the resolved String backend if updated, nothing otherwise.
   * @private
   * @internal
   */
  _updateBackendAttributes(newBackend, init = false) {
    if (!init && newBackend === this.backend) return undefined
    const currentBackend = this.backend;
    const attrs = this.attributes;
    const currentBasebackend = attrs.basebackend;
    const currentDoctype = this.doctype;

    let delegateBackend = null;
    let actualBackend = null;
    if (newBackend.includes(':')) {
      const parts = newBackend.split(':');
      actualBackend = parts[0];
      newBackend = parts[1];
    }
    if (newBackend.startsWith('xhtml')) {
      attrs.htmlsyntax = 'xml';
      newBackend = newBackend.slice(1);
    } else if (newBackend.startsWith('html')) {
      attrs.htmlsyntax ??= 'html';
    }
    newBackend = BACKEND_ALIASES[newBackend] ?? newBackend;
    if (actualBackend) {
      delegateBackend = newBackend;
      newBackend = actualBackend;
    }

    if (currentDoctype) {
      if (currentBackend) {
        delete attrs[`backend-${currentBackend}`];
        delete attrs[`backend-${currentBackend}-doctype-${currentDoctype}`];
      }
      attrs[`backend-${newBackend}-doctype-${currentDoctype}`] = '';
      attrs[`doctype-${currentDoctype}`] = '';
    } else if (currentBackend) {
      delete attrs[`backend-${currentBackend}`];
    }
    attrs[`backend-${newBackend}`] = '';
    this.backend = attrs.backend = newBackend;

    // Create the converter (may be async in some environments; here synchronous)
    const converter = this._createConverter(newBackend, delegateBackend);
    let newBasebackend, newFiletype;

    if (converter && typeof converter._getBackendTraits === 'function') {
      // Read the traits object directly rather than the same-named accessor
      // methods. A user converter that declares flat string properties
      // (`converter.outfilesuffix = '.html'`, convention #2) keeps them intact,
      // so callers reading `converter.outfilesuffix` still see the string.
      const traits = converter._getBackendTraits();
      newBasebackend = traits.basebackend;
      newFiletype = traits.filetype;
      const htmlsyntax = traits.htmlsyntax;
      if (htmlsyntax) attrs.htmlsyntax = htmlsyntax;
      if (init) {
        attrs.outfilesuffix ??= traits.outfilesuffix;
      } else if (!this.isAttributeLocked('outfilesuffix')) {
        attrs.outfilesuffix = traits.outfilesuffix;
      }
    } else if (converter) {
      const traits = deriveBackendTraits(newBackend);
      newBasebackend = traits.basebackend;
      newFiletype = traits.filetype;
      if (init) {
        attrs.outfilesuffix ??= traits.outfilesuffix;
      } else if (!this.isAttributeLocked('outfilesuffix')) {
        attrs.outfilesuffix = traits.outfilesuffix;
      }
    } else {
      throw new Error(
        `asciidoctor: FAILED: missing converter for backend '${newBackend}'. Processing aborted.`
      )
    }
    this.converter = converter;

    const currentFiletype = attrs.filetype;
    if (currentFiletype) delete attrs[`filetype-${currentFiletype}`];
    attrs.filetype = newFiletype;
    attrs[`filetype-${newFiletype}`] = '';

    const pageWidth = DEFAULT_PAGE_WIDTHS[newBasebackend];
    if (pageWidth) {
      attrs.pagewidth = pageWidth;
    } else {
      delete attrs.pagewidth;
    }

    if (newBasebackend !== currentBasebackend) {
      if (currentDoctype) {
        if (currentBasebackend) {
          delete attrs[`basebackend-${currentBasebackend}`];
          delete attrs[
            `basebackend-${currentBasebackend}-doctype-${currentDoctype}`
          ];
        }
        attrs[`basebackend-${newBasebackend}-doctype-${currentDoctype}`] = '';
      } else if (currentBasebackend) {
        delete attrs[`basebackend-${currentBasebackend}`];
      }
      attrs[`basebackend-${newBasebackend}`] = '';
      attrs.basebackend = newBasebackend;
    }
    return newBackend
  }

  /**
   * Update the doctype and backend attributes to reflect a change in the active doctype.
   *
   * @param newDoctype
   * @returns {undefined|*} the String doctype if updated, nothing otherwise.
   * @private
   * @internal
   */
  _updateDoctypeAttributes(newDoctype) {
    if (!newDoctype || newDoctype === this.doctype) return undefined
    const currentBackend = this.backend;
    const attrs = this.attributes;
    const currentBasebackend = attrs.basebackend;
    const currentDoctype = this.doctype;
    if (currentDoctype) {
      delete attrs[`doctype-${currentDoctype}`];
      if (currentBackend) {
        delete attrs[`backend-${currentBackend}-doctype-${currentDoctype}`];
        attrs[`backend-${currentBackend}-doctype-${newDoctype}`] = '';
      }
      if (currentBasebackend) {
        delete attrs[
          `basebackend-${currentBasebackend}-doctype-${currentDoctype}`
        ];
        attrs[`basebackend-${currentBasebackend}-doctype-${newDoctype}`] = '';
      }
    } else {
      if (currentBackend)
        attrs[`backend-${currentBackend}-doctype-${newDoctype}`] = '';
      if (currentBasebackend)
        attrs[`basebackend-${currentBasebackend}-doctype-${newDoctype}`] = '';
    }
    attrs[`doctype-${newDoctype}`] = '';
    this.doctype = attrs.doctype = newDoctype;
    return newDoctype
  }

  // ── Logging mixin ───────────────────────────────────────────────────────────
  // Declared here (in addition to being installed by applyLogging() below) so
  // that generated .d.ts declarations expose them — applyLogging() mutates the
  // prototype after the class body closes, which tsc's declaration emit can't see.

  /**
   * Build an auto-formatting log message that carries structured source_location
   * (rather than baking it into the text), for use with `this.logger.warn(...)`.
   * The Logging mixin (logging.js) overrides this method on the prototype.
   * @param {string} text
   * @param {{source_location?: any, include_location?: any}} [context={}]
   * @returns {{text: string, source_location?: any, include_location?: any, inspect(): string, toString(): string}}
   */
  messageWithContext(text, context = {}) {
    return Logger.AutoFormattingMessage.attach({ text, ...context })
  }

  /** Alias for {@link messageWithContext} (used in extensions). */
  createLogMessage(text, context = {}) {
    return this.messageWithContext(text, context)
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _expandPath(p) {
  const resolver = new PathResolver();
  const posixed = p.replace(/\\/g, '/');
  if (resolver.absolutePath(posixed)) return resolver.expandPath(posixed)
  return resolver.expandPath(`${resolver.workingDir}/${posixed}`)
}

function _cwd() {
  return typeof process !== 'undefined' ? process.cwd() : '/'
}

function _pad2(n) {
  return String(n).padStart(2, '0')
}

function _formatDate(d) {
  return `${d.getFullYear()}-${_pad2(d.getMonth() + 1)}-${_pad2(d.getDate())}`
}

function _formatTime(d) {
  const offset = -d.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  const hh = _pad2(Math.floor(abs / 60));
  const mm = _pad2(abs % 60);
  return `${_pad2(d.getHours())}:${_pad2(d.getMinutes())}:${_pad2(d.getSeconds())} ${offset === 0 ? 'UTC' : `${sign}${hh}${mm}`}`
}

function _limitBytesize(str, max) {
  const encoded = new TextEncoder().encode(str);
  if (encoded.length <= max) return str
  // Walk back from max to find the last complete UTF-8 character boundary.
  let end = max;
  // Back up past continuation bytes (0x80–0xBF).
  while (end > 0 && (encoded[end - 1] & 0xc0) === 0x80) end--;
  // If the byte at end-1 is a multibyte start byte, check whether its full
  // sequence fits within max.
  if (end > 0 && (encoded[end - 1] & 0x80) !== 0) {
    const b = encoded[end - 1];
    const charLen = b >= 0xf0 ? 4 : b >= 0xe0 ? 3 : b >= 0xc0 ? 2 : 1;
    if (end - 1 + charLen > max) {
      end--; // sequence extends past max → exclude this start byte
    } else {
      end = max; // sequence fits entirely → restore max
    }
  }
  return new TextDecoder().decode(encoded.slice(0, end))
}

applyLogging(Document.prototype);

Document.Footnote = Footnote;

// ESM conversion of syntax_highlighter/highlightjs.rb
//
// Ruby-to-JavaScript notes:
//   - Ruby class SyntaxHighlighter::HighlightJsAdapter → HighlightJsAdapter extends SyntaxHighlighterBase.
//   - register_for 'highlightjs', 'highlight.js' → handled by the parent SyntaxHighlighter factory.
//   - HIGHLIGHT_JS_VERSION constant imported from constants.js.
//   - Ruby doc.getAttribute(name, default) → doc.getAttribute(name) with fallback using ?? operator.
//   - Ruby doc.attr? 'name' → doc.hasAttribute('name').
//   - Ruby string interpolation / multiline heredocs → template literals.
//   - Ruby :head / :footer symbols → plain strings 'head' / 'footer'.


class HighlightJsAdapter extends SyntaxHighlighterBase {
  constructor(...args) {
    super(...args);
    this.name = 'highlightjs';
    this._preClass = 'highlightjs';
  }

  /**
   * Wrap the source block in `<pre><code>` with highlight.js CSS classes.
   *
   * Adds `language-<lang>` and `hljs` to the `<code>` class attribute, and strips
   * the `highlight` class from `<pre>` when the `nohighlight-option` attribute is set.
   * @param {object} node - the source Block being processed
   * @param {string|null} lang - the source language string, or falsy if none
   * @param {object} opts - options passed to the base format()
   * @returns {Promise<string>}
   */
  async format(node, lang, opts) {
    const transform = (pre, code) => {
      if (node.hasAttribute('nohighlight-option')) {
        pre.class = pre.class.replace(' highlight', '');
      }
      code.class = `language-${lang || 'none'} hljs`;
    };
    return super.format(node, lang, { ...opts, transform })
  }

  /**
   * Always returns true — highlight.js injects markup into the document.
   * @param {string} location - 'head' or 'footer'
   * @returns {true}
   */
  hasDocinfo(location) {
    return true
  }

  /**
   * Returns the CSS `<link>` tag (head) or the `<script>` tags (footer).
   * @param {string} location - 'head' or 'footer'
   * @param {object} doc - the Document being converted
   * @param {{ cdn_base_url: string, self_closing_tag_slash: string }} opts
   * @returns {string}
   */
  docinfo(location, doc, opts) {
    const baseUrl =
      doc.getAttribute('highlightjsdir') ??
      `${opts.cdn_base_url}/highlight.js/${HIGHLIGHT_JS_VERSION}`;

    if (location === 'head') {
      const theme = doc.getAttribute('highlightjs-theme') ?? 'github';
      return `<link rel="stylesheet" href="${baseUrl}/styles/${theme}.min.css"${opts.self_closing_tag_slash ?? ''}>`
    }

    // footer
    const langScripts = doc.getAttribute('highlightjs-languages')
      ? doc
          .getAttribute('highlightjs-languages')
          .split(',')
          .map(
            (lang) =>
              `<script src="${baseUrl}/languages/${lang.trimStart()}.min.js"></script>\n`
          )
          .join('')
      : '';

    return `<script src="${baseUrl}/highlight.min.js"></script>
${langScripts}<script>
if (!hljs.initHighlighting.called) {
  hljs.initHighlighting.called = true
  ;[].slice.call(document.querySelectorAll('pre.highlight > code[data-lang]')).forEach(function (el) { hljs.highlightBlock(el) })
}
</script>`
  }
}

// ESM conversion of syntax_highlighter/html_pipeline.rb
//
// Ruby-to-JavaScript notes:
//   - Ruby class SyntaxHighlighter::HtmlPipelineAdapter → HtmlPipelineAdapter extends SyntaxHighlighterBase.
//   - register_for 'html-pipeline' → registration delegated to load.js for consistency.
//   - format() overrides the base class to emit <pre lang="..."><code>…</code></pre> without
//     highlight CSS classes — the html-pipeline gem processes the markup downstream.
//   - Ruby string interpolation → template literals.


class HtmlPipelineAdapter extends SyntaxHighlighterBase {
  constructor(...args) {
    super(...args);
    this.name = 'html-pipeline';
  }

  /**
   * Wrap the source block in `<pre><code>` without highlight classes.
   *
   * The html-pipeline gem processes the markup downstream, so only a bare
   * `<pre lang="<lang>"><code>` wrapper is emitted (no CSS classes, no data-lang).
   * @param {object} node - the source Block being processed
   * @param {string|null} lang - the source language string, or falsy if none
   * @param {object} opts - options (unused by this adapter)
   * @returns {Promise<string>} the wrapped source string
   */
  async format(node, lang, opts) {
    return `<pre${lang ? ` lang="${lang}"` : ''}><code>${await node.content()}</code></pre>`
  }
}

// ESM conversion of substitutors.rb
// This module is intended to be mixed into Section and Block via Object.assign(Target.prototype, Substitutors)


// ── Module-level constants ────────────────────────────────────────────────────

const SPECIAL_CHARS_RX = /[<&>]/g;
const SPECIAL_CHARS_TR = { '>': '&gt;', '<': '&lt;', '&': '&amp;' };

// Detects if text is a possible candidate for the quotes substitution.
const QUOTED_TEXT_SNIFF_RX = {
  false: /[*_`#^~]/,
  true: /[*'_+#^~]/,
};
const NO_SUBS = Object.freeze([]);
const REFTEXT_SUBS = Object.freeze([
  'specialcharacters',
  'quotes',
  'replacements',
]);
const VERBATIM_SUBS = Object.freeze(['specialcharacters', 'callouts']);

const SUB_GROUPS = {
  none: NO_SUBS,
  normal: NORMAL_SUBS,
  verbatim: VERBATIM_SUBS,
  specialchars: BASIC_SUBS,
};

const SUB_HINTS = {
  a: 'attributes',
  m: 'macros',
  n: 'normal',
  p: 'post_replacements',
  q: 'quotes',
  r: 'replacements',
  c: 'specialcharacters',
  v: 'verbatim',
};

const SUB_OPTIONS = {
  block: [...Object.keys(SUB_GROUPS), ...NORMAL_SUBS, 'callouts'],
  inline: [...Object.keys(SUB_GROUPS), ...NORMAL_SUBS],
};

// control characters used as placeholders
const CAN = '\u0018';
const DEL = '\u007f';

// SPA, start of guarded protected area (\u0096)
const PASS_START = '\u0096';

// EPA, end of guarded protected area (\u0097)
const PASS_END = '\u0097';

// match passthrough slot
const PASS_SLOT_RX = new RegExp(`${PASS_START}(\\d+)${PASS_END}`, 'g');

// fix passthrough slot after syntax highlighting
const HIGHLIGHTED_PASS_SLOT_RX = new RegExp(
  `<span\\b[^>]*>${PASS_START}</span>[^\\d]*(\\d+)[^\\d]*<span\\b[^>]*>${PASS_END}</span>`,
  'g'
);

const RS = '\\';
const R_SB = ']';
const ESC_R_SB = '\\]';
const PLUS = '+';

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Ruby `str.partition(delim)` → `[before, delim, after]` (first occurrence).
 * Returns `[str, '', '']` when delim is not found.
 */
function partition(str, delim) {
  const idx = str.indexOf(delim);
  if (idx === -1) return [str, '', '']
  return [str.slice(0, idx), delim, str.slice(idx + delim.length)]
}

/**
 * Array union (Ruby `arr | other`).
 */
function arrayUnion(a, b) {
  const set = new Set(a);
  for (const v of b) set.add(v);
  return [...set]
}

/**
 * Array intersection (Ruby `arr & other`): elements of a that appear in b, deduplicated,
 * preserving the order from a with first occurrence winning.
 */
function arrayIntersect(a, b) {
  const allowed = new Set(b);
  const seen = new Set();
  return a.filter((v) => {
    if (!allowed.has(v) || seen.has(v)) return false
    seen.add(v);
    return true
  })
}

/**
 * Array difference (Ruby `arr - other`).
 */
function arrayDiff(a, b) {
  const set = new Set(b);
  return a.filter((v) => !set.has(v))
}

/**
 * Make a regex global if it isn't already.
 */
function globalRx(rx) {
  return rx.global ? rx : new RegExp(rx.source, `${rx.flags}g`)
}

// ── Substitutors mixin ────────────────────────────────────────────────────────

const Substitutors = {
  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Apply the specified substitutions to the text.
   *
   * @param {string|string[]} text - The text to process; must not be null.
   * @param {string[]} [subs=NORMAL_SUBS] - The substitutions to perform.
   * @returns {Promise<string|string[]>} Text with substitutions applied.
   */
  async applySubs(text, subs = NORMAL_SUBS) {
    const isEmpty = Array.isArray(text) ? text.length === 0 : text.length === 0;
    if (isEmpty || !subs || subs.length === 0) return text

    const isMultiline = Array.isArray(text);
    if (isMultiline) {
      text = text.length > 1 ? text.join(LF$1) : text[0];
    }

    let passthrus;
    let clearPassthrus = false;

    if (subs.includes('macros')) {
      text = this.extractPassthroughs(text);
      if (this.passthroughs.length > 0) {
        passthrus = this.passthroughs;
        // placeholders can move around; only clear in the outermost substitution call
        if (!this.passthroughsLocked) {
          this.passthroughsLocked = true;
          clearPassthrus = true;
        }
      }
    }

    for (const type of subs) {
      switch (type) {
        case 'specialcharacters':
          text = this.subSpecialchars(text);
          break
        case 'quotes':
          text = await this.subQuotes(text);
          break
        case 'attributes':
          if (text.includes(ATTR_REF_HEAD)) text = this.subAttributes(text);
          break
        case 'replacements':
          text = this.subReplacements(text);
          break
        case 'macros':
          text = await this.subMacros(text);
          break
        case 'highlight':
          text = await this.highlightSource(text, subs.includes('callouts'));
          break
        case 'callouts':
          if (!subs.includes('highlight')) text = await this.subCallouts(text);
          break
        case 'post_replacements':
          text = await this.subPostReplacements(text);
          break
        default:
          this.logger.warn(`unknown substitution type ${type}`);
      }
    }

    if (passthrus) {
      text = await this.restorePassthroughs(text);
      if (clearPassthrus) {
        passthrus.length = 0;
        this.passthroughsLocked = null;
      }
    }

    return isMultiline ? text.split(LF$1) : text
  },

  /** Apply normal substitutions (alias for applySubs with default args). */
  async applyNormalSubs(text) {
    return this.applySubs(text, NORMAL_SUBS)
  },

  /** Apply substitutions for header metadata and attribute assignments.
   * Header subs are 'specialcharacters' + 'attributes', both of which are
   * purely synchronous operations — so this method is intentionally sync
   * to allow it to be called from synchronous contexts such as setAttribute()
   * and the {set:...} directive inside subAttributes(). */
  applyHeaderSubs(text) {
    return this.subAttributes(this.subSpecialchars(text))
  },

  /** Apply substitutions for titles (alias for applySubs). */
  async applyTitleSubs(text, subs = NORMAL_SUBS) {
    return this.applySubs(text, subs)
  },

  /** Apply substitutions for reftext. */
  async applyReftextSubs(text) {
    return this.applySubs(text, REFTEXT_SUBS)
  },

  /**
   * Substitute special characters (encode XML entities).
   *
   * @param {string} text
   * @returns {string}
   */
  subSpecialchars(text) {
    if (text.includes('>') || text.includes('&') || text.includes('<')) {
      return text.replace(SPECIAL_CHARS_RX, (ch) => SPECIAL_CHARS_TR[ch])
    }
    return text
  },

  /** Alias for subSpecialchars. */
  subSpecialcharacters(text) {
    return this.subSpecialchars(text)
  },

  /**
   * Substitute quoted text (emphasis, strong, monospaced, etc.)
   *
   * @param {string} text
   * @returns {Promise<string>}
   */
  async subQuotes(text) {
    const compat = this.document.compatMode;
    if (QUOTED_TEXT_SNIFF_RX[compat].test(text)) {
      for (const [type, scope, pattern] of QUOTE_SUBS[compat]) {
        text = await asyncReplace(text, globalRx(pattern), async (...args) => {
          return this.convertQuotedText(args, type, scope)
        });
      }
    }
    return text
  },

  /**
   * Substitute attribute references in the specified text.
   *
   * @param {string} text
   * @param {Object} [opts={}]
   * @returns {string}
   */
  subAttributes(text, opts = {}) {
    const docAttrs = this.document.attributes;
    let drop = false;
    let dropLine = false;
    let dropLineSeverity = null;
    let dropEmptyLine = false;
    let attributeUndefined = null;
    let attributeMissing = null;

    text = text.replace(
      globalRx(AttributeReferenceRx),
      (match, p1, p2, p3, p4) => {
        // escaped attribute → return unescaped
        if (p1 === RS || p4 === RS) {
          return `{${p2}}`
        }

        if (p3) {
          const args = p2.split(':', 3);
          const directive = args.shift();
          if (directive === 'set') {
            const [, value] = Parser.storeAttribute(
              args[0],
              args[1] || '',
              this.document
            );
            if (
              (value !== null && value !== undefined) ||
              (attributeUndefined ||=
                docAttrs['attribute-undefined'] ||
                Compliance.attributeUndefined) !== 'drop-line'
            ) {
              drop = true;
              dropEmptyLine = true;
              return DEL
            } else {
              drop = true;
              dropLine = true;
              return CAN
            }
          } else if (directive === 'counter2') {
            this.document.counter(...args);
            drop = true;
            dropEmptyLine = true;
            return DEL
          } else {
            // 'counter'
            return this.document.counter(...args)
          }
        }

        const key = p2.toLowerCase();
        if (Object.hasOwn(docAttrs, key)) {
          return docAttrs[key]
        }

        const intrinsicValue = INTRINSIC_ATTRIBUTES[key];
        if (intrinsicValue !== undefined) return intrinsicValue

        switch (
          (attributeMissing ||=
            opts.attributeMissing ||
            docAttrs['attribute-missing'] ||
            Compliance.attributeMissing)
        ) {
          case 'drop':
            drop = true;
            dropEmptyLine = true;
            return DEL
          case 'drop-line':
            dropLineSeverity ||= opts.dropLineSeverity || 'info';
            if (dropLineSeverity === 'info') {
              this.logger.info(
                `dropping line containing reference to missing attribute: ${key}`
              );
            }
            drop = true;
            dropLine = true;
            return CAN
          case 'warn':
            this.logger.warn(`skipping reference to missing attribute: ${key}`);
            return match
          default: // 'skip'
            return match
        }
      }
    );

    if (drop) {
      if (dropEmptyLine) {
        const lines = text.replace(new RegExp(`${DEL}+`, 'g'), DEL).split(LF$1);
        if (dropLine) {
          return lines
            .filter(
              (line) =>
                line !== DEL &&
                line !== CAN &&
                !line.startsWith(CAN) &&
                !line.includes(CAN)
            )
            .join(LF$1)
            .split(DEL)
            .join('')
        } else {
          return lines
            .filter((line) => line !== DEL)
            .join(LF$1)
            .split(DEL)
            .join('')
        }
      } else if (text.includes(LF$1)) {
        return text
          .split(LF$1)
          .filter(
            (line) =>
              line !== CAN && !line.startsWith(CAN) && !line.includes(CAN)
          )
          .join(LF$1)
      } else {
        // When the caller sets returnDropSentinel, return null to signal that the line was
        // dropped due to a *missing* attribute (as opposed to an attribute that simply has a
        // blank value).  This lets callers distinguish the two cases without changing the
        // general contract of subAttributes for every other call-site.
        return opts.returnDropSentinel ? null : ''
      }
    }

    return text
  },

  /**
   * Substitute replacement characters (copyright, trademark, etc.)
   *
   * @param {string} text
   * @returns {string}
   */
  subReplacements(text) {
    if (ReplaceableTextRx.test(text)) {
      for (const [pattern, replacement, restore] of REPLACEMENTS) {
        text = text.replace(globalRx(pattern), (...args) => {
          return this.doReplacement(args, replacement, restore)
        });
      }
    }
    return text
  },

  /**
   * Substitute inline macros (links, images, etc.)
   *
   * @param {string} text
   * @returns {Promise<string>}
   */
  async subMacros(text) {
    const foundSquareBracket = text.includes('[');
    const foundColon = text.includes(':');
    const foundMacroish = foundSquareBracket && foundColon;
    const foundMacroishShort = foundMacroish && text.includes(':[');
    const doc = this.document;
    const docAttrs = doc.attributes;

    // Extension inline macros
    const extensions = doc.extensions;
    if (extensions?.inlineMacros()) {
      for (const extension of extensions.inlineMacros()) {
        text = await asyncReplace(
          text,
          globalRx(extension.instance.regexp),
          async (...args) => {
            const match = args[0];
            if (match.startsWith(RS)) return match.slice(1)

            const groups =
              typeof args[args.length - 1] === 'object' &&
              args[args.length - 1] !== null
                ? args[args.length - 1]
                : null;
            let target, content;
            if (!groups || Object.keys(groups).length === 0) {
              target = args[1];
              content = args[2];
            } else {
              target = groups.target ?? null;
              content = groups.content ?? null;
            }

            const extConfig = extension.config;
            const defaultAttrs =
              extConfig.defaultAttrs || extConfig.default_attrs;
            const attributes = defaultAttrs ? { ...defaultAttrs } : {};
            const contentModel =
              extConfig.contentModel || extConfig.content_model;

            if (content !== null && content !== undefined) {
              if (!content) {
                if (contentModel !== 'attributes') attributes.text = content;
              } else {
                content = this.normalizeText(content, true, true);
                if (contentModel === 'attributes') {
                  await this.parseAttributes(
                    content,
                    extConfig.positionalAttrs ||
                      extConfig.positional_attrs ||
                      extConfig.posAttrs ||
                      extConfig.pos_attrs ||
                      [],
                    { into: attributes }
                  );
                } else {
                  attributes.text = content;
                }
              }
              target = target ?? (extConfig.format === 'short' ? content : null);
            }

            const replacement = extension.processMethod(
              this,
              target,
              attributes
            );
            if (replacement instanceof Inline) {
              const inlineSubs = replacement.attributes.subs;
              if (inlineSubs) {
                const expandedSubs = this.expandSubs(
                  inlineSubs,
                  'custom inline macro'
                );
                if (expandedSubs)
                  replacement.text = await this.applySubs(
                    replacement.text,
                    expandedSubs
                  );
                delete replacement.attributes.subs;
              }
              return replacement.convert()
            } else if (replacement) {
              this.logger.info(
                `expected substitution value for custom inline macro to be of type Inline; got ${replacement.constructor.name}: ${match}`
              );
              return replacement
            }
            return ''
          }
        );
      }
    }

    // kbd / btn macros (experimental)
    if (docAttrs.experimental !== undefined) {
      if (
        foundMacroishShort &&
        (text.includes('kbd:') || text.includes('btn:'))
      ) {
        text = await asyncReplace(
          text,
          globalRx(InlineKbdBtnMacroRx),
          async (match, p1, p2, p3) => {
            if (p1) return match.slice(1)
            if (p2 === 'kbd') {
              let keys = p3.trim();
              if (keys.includes(R_SB)) keys = keys.split(ESC_R_SB).join(R_SB);
              if (keys.length > 1) {
                let delimIdx = keys.indexOf(',', 1);
                const plusIdx = keys.indexOf('+', 1);
                if (delimIdx !== -1 && plusIdx !== -1)
                  delimIdx = Math.min(delimIdx, plusIdx);
                else if (delimIdx === -1) delimIdx = plusIdx;

                if (delimIdx !== -1) {
                  const delim = keys.charAt(delimIdx);
                  if (keys.endsWith(delim)) {
                    keys = keys
                      .slice(0, -1)
                      .split(delim)
                      .map((k) => k.trim());
                    keys[keys.length - 1] += delim;
                  } else {
                    keys = keys.split(delim).map((k) => k.trim());
                  }
                } else {
                  keys = [keys];
                }
              } else {
                keys = [keys];
              }
              return new Inline(this, 'kbd', null, {
                attributes: { keys },
              }).convert()
            } else {
              // btn
              return new Inline(
                this,
                'button',
                this.normalizeText(p3, true, true)
              ).convert()
            }
          }
        );
      }

      if (foundMacroish && text.includes('menu:')) {
        text = await asyncReplace(
          text,
          globalRx(InlineMenuMacroRx),
          async (match, p1, p2) => {
            if (match.startsWith(RS)) return match.slice(1)
            const menu = p1;
            let submenus, menuitem;
            if (p2) {
              const items = p2.includes(R_SB)
                ? p2.split(ESC_R_SB).join(R_SB)
                : p2;
              let delim = null;
              if (items.includes('&gt;')) delim = '&gt;';
              else if (items.includes(',')) delim = ',';
              if (delim) {
                const parts = items.split(delim).map((item) => item.trim());
                menuitem = parts.pop();
                submenus = parts;
              } else {
                submenus = [];
                menuitem = items.trimEnd();
              }
            } else {
              submenus = [];
              menuitem = null;
            }
            return new Inline(this, 'menu', null, {
              attributes: { menu, submenus, menuitem },
            }).convert()
          }
        );
      }

      if (text.includes('"') && text.includes('&gt;')) {
        text = await asyncReplace(
          text,
          globalRx(InlineMenuRx),
          async (match, p1) => {
            if (match.startsWith(RS)) return match.slice(1)
            const parts = p1.split('&gt;').map((item) => item.trim());
            const menu = parts.shift();
            const menuitem = parts.pop() ?? null;
            const submenus = parts;
            return new Inline(this, 'menu', null, {
              attributes: { menu, submenus, menuitem },
            }).convert()
          }
        );
      }
    }

    // image / icon macros
    if (foundMacroish && (text.includes('image:') || text.includes('icon:'))) {
      text = await asyncReplace(
        text,
        globalRx(InlineImageMacroRx),
        async (match, p1, p2) => {
          if (match.startsWith(RS)) return match.slice(1)
          let type, posattrs;
          if (match.startsWith('icon:')) {
            type = 'icon';
            posattrs = ['size'];
          } else {
            type = 'image';
            posattrs = ['alt', 'width', 'height'];
          }
          const target = p1;
          const attrs = await this.parseAttributes(p2, posattrs, {
            unescapeInput: true,
          });
          let id;
          if (type !== 'icon') {
            id = attrs.id;
            doc.register('images', target);
            attrs.imagesdir = attrs.imagesdir ?? docAttrs.imagesdir;
          }
          attrs.alt =
            attrs.alt ??
            (attrs['default-alt'] = basename(target, true).replace(
              /[_-]/g,
              ' '
            ));
          return new Inline(this, 'image', null, {
            type,
            target,
            id,
            attributes: attrs,
          }).convert()
        }
      );
    }

    // index terms
    if (
      (text.includes('((') && text.includes('))')) ||
      (foundMacroishShort && text.includes('dexterm'))
    ) {
      text = await asyncReplace(
        text,
        globalRx(InlineIndextermMacroRx),
        async (match, p1, p2, p3) => {
          switch (p1) {
            case 'indexterm': {
              if (match.startsWith(RS)) return match.slice(1)
              const attrlist = this.normalizeText(p2, true, true);
              let attrs;
              if (attrlist.includes('=')) {
                const parsed = await new AttributeList(attrlist, this).parse();
                const primary = parsed[1];
                if (primary) {
                  const terms = [primary];
                  const secondary = parsed[2];
                  if (secondary) {
                    terms.push(secondary);
                    const tertiary = parsed[3];
                    if (tertiary) terms.push(tertiary);
                  }
                  attrs = { ...parsed, terms };
                  if (attrs['see-also']) {
                    const seeAlso = attrs['see-also'];
                    attrs['see-also'] = seeAlso.includes(',')
                      ? seeAlso.split(',').map((s) => s.trimStart())
                      : [seeAlso];
                  }
                } else {
                  attrs = { terms: attrlist };
                }
              } else {
                attrs = { terms: this.splitSimpleCsv(attrlist) };
              }
              return new Inline(this, 'indexterm', null, {
                attributes: attrs,
              }).convert()
            }
            case 'indexterm2': {
              if (match.startsWith(RS)) return match.slice(1)
              let term = this.normalizeText(p2, true, true);
              let attrs = null;
              if (term.includes('=')) {
                const parsed = await new AttributeList(term, this).parse();
                term = parsed[1] || term;
                if (parsed[1]) {
                  attrs = parsed;
                  if (attrs['see-also']) {
                    attrs['see-also'] = attrs['see-also'].includes(',')
                      ? attrs['see-also'].split(',').map((s) => s.trimStart())
                      : [attrs['see-also']];
                  }
                } else {
                  attrs = null;
                }
              }
              return new Inline(this, 'indexterm', term, {
                attributes: attrs,
                type: 'visible',
              }).convert()
            }
            default: {
              let enclText = p3;
              let visible = true,
                before = null,
                after = null;
              if (match.startsWith(RS)) {
                if (enclText.startsWith('(') && enclText.endsWith(')')) {
                  enclText = enclText.slice(1, -1);
                  visible = true;
                  before = '(';
                  after = ')';
                } else {
                  return match.slice(1)
                }
              } else {
                if (enclText.startsWith('(')) {
                  if (enclText.endsWith(')')) {
                    enclText = enclText.slice(1, -1);
                    visible = false;
                  } else {
                    enclText = enclText.slice(1);
                    before = '(';
                    after = '';
                  }
                } else if (enclText.endsWith(')')) {
                  enclText = enclText.slice(0, -1);
                  before = '';
                  after = ')';
                }
              }
              let subbed_term;
              if (visible) {
                let term = this.normalizeText(enclText, true);
                let attrs = null;
                if (term.includes(';&')) {
                  if (term.includes(' &gt;&gt; ')) {
                    const [t, , see] = partition(term, ' &gt;&gt; ');
                    term = t;
                    attrs = { see };
                  } else if (term.includes(' &amp;&gt; ')) {
                    const parts = term.split(' &amp;&gt; ');
                    term = parts.shift();
                    attrs = { 'see-also': parts };
                  }
                }
                subbed_term = await new Inline(this, 'indexterm', term, {
                  attributes: attrs,
                  type: 'visible',
                }).convert();
              } else {
                const attrs = {};
                let terms = this.normalizeText(enclText, true);
                if (terms.includes(';&')) {
                  if (terms.includes(' &gt;&gt; ')) {
                    const [t, , see] = partition(terms, ' &gt;&gt; ');
                    terms = t;
                    attrs.see = see;
                  } else if (terms.includes(' &amp;&gt; ')) {
                    const parts = terms.split(' &amp;&gt; ');
                    terms = parts.shift();
                    attrs['see-also'] = parts;
                  }
                }
                attrs.terms = this.splitSimpleCsv(terms);
                subbed_term = await new Inline(this, 'indexterm', null, {
                  attributes: attrs,
                }).convert();
              }
              return before !== null
                ? `${before}${subbed_term}${after}`
                : subbed_term
            }
          }
        }
      );
    }

    // inline URLs
    if (foundColon && text.includes('://')) {
      text = await asyncReplace(
        text,
        globalRx(InlineLinkRx),
        async (match, p1, p2, p3, p4, p5, p6, p7, p8) => {
          if (p2 && p5 == null) {
            if (p1.startsWith(RS)) return match.slice(1)
            if (p3.startsWith(RS)) return p1 + match.slice(p1.length + 1)
            if (!p6) return match
            const target = p3 + p6;
            doc.register('links', target);
            const linkText =
              docAttrs['hide-uri-scheme'] !== undefined
                ? target.replace(UriSniffRx, '')
                : target;
            return new Inline(this, 'anchor', linkText, {
              type: 'link',
              target,
              attributes: { role: 'bare' },
            }).convert()
          } else {
            if (p3.startsWith(RS)) return p1 + match.slice(p1.length + 1)
            let prefix = p1;
            let target = p3 + (p4 || p7 || '');
            let suffix = '';

            let link_text;
            if (p5 != null) {
              if (prefix === 'link:') prefix = '';
              const rawLinkText = p5;
              link_text = rawLinkText || null;
            } else {
              switch (prefix) {
                case 'link:':
                case '"':
                case "'":
                  return match
              }
              switch (p8) {
                case ';':
                  target = target.slice(0, -1);
                  if (target.endsWith(')')) {
                    target = target.slice(0, -1);
                    suffix = ');';
                  } else {
                    suffix = ';';
                  }
                  if (target === p3) return match
                  break
                case ':':
                  target = target.slice(0, -1);
                  if (target.endsWith(')')) {
                    target = target.slice(0, -1);
                    suffix = '):';
                  } else {
                    suffix = ':';
                  }
                  if (target === p3) return match
                  break
              }
              link_text = null;
            }

            const linkOpts = { type: 'link' };
            let attrs = null;
            let bare = false;

            if (link_text !== null) {
              let newLinkText = link_text.includes(R_SB)
                ? link_text.split(ESC_R_SB).join(R_SB)
                : link_text;
              link_text = newLinkText;

              if (!doc.compatMode && link_text.includes('=')) {
                const [extractedText, extractedAttrs] =
                  await this.extractAttributesFromText(link_text, '');
                link_text = extractedText;
                newLinkText = extractedText;
                attrs = extractedAttrs;
                linkOpts.id = attrs?.id;
              }

              if (link_text.endsWith('^')) {
                newLinkText = link_text = link_text.slice(0, -1);
                if (attrs) {
                  attrs.window = attrs.window ?? '_blank';
                } else {
                  attrs = { window: '_blank' };
                }
              }

              if (
                newLinkText !== null &&
                newLinkText !== undefined &&
                newLinkText === ''
              ) {
                link_text =
                  docAttrs['hide-uri-scheme'] !== undefined
                    ? target.replace(UriSniffRx, '')
                    : target;
                bare = true;
              }
            } else {
              link_text =
                docAttrs['hide-uri-scheme'] !== undefined
                  ? target.replace(UriSniffRx, '')
                  : target;
              bare = true;
            }

            if (bare) {
              if (attrs) {
                attrs.role =
                  'role' in (attrs || {}) ? `bare ${attrs.role}` : 'bare';
              } else {
                attrs = { role: 'bare' };
              }
            }

            linkOpts.target = target;
            doc.register('links', target);
            if (attrs) linkOpts.attributes = attrs;
            return `${prefix}${await new Inline(this, 'anchor', link_text, linkOpts).convert()}${suffix}`
          }
        }
      );
    }

    // link: and mailto: macros
    if (foundMacroish && (text.includes('link:') || text.includes('ilto:'))) {
      text = await asyncReplace(
        text,
        globalRx(InlineLinkMacroRx),
        async (match, p1, p2, p3) => {
          if (match.startsWith(RS)) return match.slice(1)
          let target, mailtoText;
          if (p1) {
            mailtoText = p2;
            target = `mailto:${mailtoText}`;
          } else {
            target = p2;
          }

          let attrs = null;
          const linkOpts = { type: 'link' };
          let linkText = p3;

          if (linkText) {
            linkText = linkText.includes(R_SB)
              ? linkText.split(ESC_R_SB).join(R_SB)
              : linkText;
            if (p1) {
              if (!doc.compatMode && linkText.includes(',')) {
                const [extractedText, extractedAttrs] =
                  await this.extractAttributesFromText(linkText, '');
                linkText = extractedText;
                attrs = extractedAttrs;
                linkOpts.id = attrs?.id;
                if (attrs?.[2]) {
                  if (attrs[3]) {
                    target = `${target}?subject=${encodeUriComponent(attrs[2])}&amp;body=${encodeUriComponent(attrs[3])}`;
                  } else {
                    target = `${target}?subject=${encodeUriComponent(attrs[2])}`;
                  }
                }
              }
            } else if (!doc.compatMode && linkText.includes('=')) {
              const [extractedText, extractedAttrs] =
                await this.extractAttributesFromText(linkText, '');
              linkText = extractedText;
              attrs = extractedAttrs;
              linkOpts.id = attrs?.id;
            }

            if (linkText.endsWith('^')) {
              linkText = linkText.slice(0, -1);
              if (attrs) {
                attrs.window = attrs.window ?? '_blank';
              } else {
                attrs = { window: '_blank' };
              }
            }
          }

          if (!linkText) {
            if (p1) {
              linkText = mailtoText;
            } else {
              if (docAttrs['hide-uri-scheme'] !== undefined) {
                linkText = target.replace(UriSniffRx, '') || target;
              } else {
                linkText = target;
              }
              if (attrs) {
                attrs.role = 'role' in attrs ? `bare ${attrs.role}` : 'bare';
              } else {
                attrs = { role: 'bare' };
              }
            }
          }

          linkOpts.target = target;
          doc.register('links', target);
          if (attrs) linkOpts.attributes = attrs;
          return new Inline(this, 'anchor', linkText, linkOpts).convert()
        }
      );
    }

    // bare email addresses
    if (text.includes('@')) {
      text = await asyncReplace(
        text,
        globalRx(InlineEmailRx),
        async (match, p1) => {
          if (p1) return p1 === RS ? match.slice(1) : match
          const address = match;
          const target = `mailto:${address}`;
          doc.register('links', target);
          return new Inline(this, 'anchor', address, {
            type: 'link',
            target,
          }).convert()
        }
      );
    }

    // bibliography anchor
    if (
      foundSquareBracket &&
      this.context === 'list_item' &&
      this.getParent().style === 'bibliography'
    ) {
      text = await asyncReplace(
        text,
        InlineBiblioAnchorRx,
        async (match, p1, p2) => {
          return new Inline(this, 'anchor', p2, {
            type: 'bibref',
            id: p1,
          }).convert()
        }
      );
    }

    // inline anchors
    if (
      (foundSquareBracket && text.includes('[[')) ||
      (foundMacroish && text.includes('or:'))
    ) {
      text = await asyncReplace(
        text,
        globalRx(InlineAnchorRx),
        async (match, p1, p2, p3, p4, p5) => {
          if (p1) return match.slice(1)
          let id, reftext;
          if (p2) {
            id = p2;
            reftext = p3;
          } else {
            id = p4;
            reftext = p5
              ? p5.includes(R_SB)
                ? p5.split(ESC_R_SB).join(R_SB)
                : p5
              : null;
          }
          return new Inline(this, 'anchor', reftext, {
            type: 'ref',
            id,
          }).convert()
        }
      );
    }

    // xref macros
    if (
      (text.includes('&') && text.includes(';&l')) ||
      (foundMacroish && text.includes('xref:'))
    ) {
      text = await asyncReplace(
        text,
        globalRx(InlineXrefMacroRx),
        async (match, p1, p2, p3) => {
          if (match.startsWith(RS)) return match.slice(1)
          const attrs = {};
          let refid, linkText, macro, path, fragment, target, src2src;

          if (p1) {
            refid = p1;
            if (refid.includes(',')) {
              const commaIdx = refid.indexOf(',');
              const rawLinkText = refid.slice(commaIdx + 1).trimStart();
              refid = refid.slice(0, commaIdx);
              linkText = rawLinkText || null;
            }
          } else {
            macro = true;
            refid = p2;
            if (p3) {
              linkText = p3.includes(R_SB) ? p3.split(ESC_R_SB).join(R_SB) : p3;
              if (!doc.compatMode && linkText.includes('=')) {
                const [extractedText, extractedAttrs] =
                  await this.extractAttributesFromText(linkText);
                linkText = extractedText;
                Object.assign(attrs, extractedAttrs);
              }
            }
          }

          if (doc.compatMode) {
            fragment = refid;
          } else {
            const hashIdx = refid.indexOf('#');
            if (
              hashIdx !== -1 &&
              (hashIdx === 0 || refid[hashIdx - 1] !== '&')
            ) {
              if (hashIdx > 0) {
                const fragmentLen = refid.length - 1 - hashIdx;
                if (fragmentLen > 0) {
                  path = refid.slice(0, hashIdx);
                  fragment = refid.slice(hashIdx + 1);
                } else {
                  path = refid.slice(0, -1);
                }
                if (macro) {
                  if (path.endsWith('.adoc')) {
                    src2src = path = path.slice(0, -5);
                  } else if (!isExtname(path)) {
                    src2src = path;
                  }
                } else if (
                  Object.keys(ASCIIDOC_EXTENSIONS).some((ext) =>
                    path.endsWith(ext)
                  )
                ) {
                  src2src = path = path.slice(0, path.lastIndexOf('.'));
                } else {
                  src2src = path;
                }
              } else {
                target = refid;
                fragment = refid.slice(1);
              }
            } else if (macro) {
              if (refid.endsWith('.adoc')) {
                src2src = path = refid.slice(0, -5);
              } else if (isExtname(refid)) {
                path = refid;
              } else {
                fragment = refid;
              }
            } else {
              fragment = refid;
            }
          }

          if (target) {
            // handles: #id
            refid = fragment;
            if (this.logger.isInfo?.() && !doc.catalog.refs[refid]) {
              this.logger.info(`possible invalid reference: ${refid}`);
            }
          } else if (path) {
            if (
              src2src &&
              (doc.attributes.docname === path || doc.catalog.includes[path])
            ) {
              if (fragment) {
                refid = fragment;
                path = null;
                target = `#${fragment}`;
                if (this.logger.isInfo?.() && !doc.catalog.refs[refid]) {
                  this.logger.info(`possible invalid reference: ${refid}`);
                }
              } else {
                refid = null;
                path = null;
                target = '#';
              }
            } else {
              const relfileprefix = doc.attributes.relfileprefix || '';
              const relfilesuffix = src2src
                ? (doc.attributes.relfilesuffix ?? doc.outfilesuffix)
                : '';
              const resolvedPath = `${relfileprefix}${path}${relfilesuffix}`;
              refid = path;
              path = resolvedPath;
              if (fragment) {
                refid = `${refid}#${fragment}`;
                target = `${path}#${fragment}`;
              } else {
                target = path;
              }
            }
          } else if (doc.compatMode || false) {
            refid = fragment;
            target = `#${fragment}`;
            if (this.logger.isInfo?.() && !doc.catalog.refs[refid]) {
              this.logger.info(`possible invalid reference: ${refid}`);
            }
          } else if (doc.catalog.refs[fragment]) {
            refid = fragment;
            target = `#${fragment}`;
          } else if (
            (fragment.includes(' ') || fragment.toLowerCase() !== fragment) &&
            (refid = await doc.resolveId(fragment))
          ) {
            fragment = refid;
            target = `#${refid}`;
          } else {
            refid = fragment;
            target = `#${fragment}`;
            if (this.logger.isInfo?.())
              this.logger.info(`possible invalid reference: ${refid}`);
          }

          if (path != null) attrs.path = path;
          if (fragment != null) attrs.fragment = fragment;
          attrs.refid = refid;
          return new Inline(this, 'anchor', linkText, {
            type: 'xref',
            target,
            attributes: attrs,
          }).convert()
        }
      );
    }

    // footnote macros
    if (foundMacroish && text.includes('tnote')) {
      text = await asyncReplace(
        text,
        globalRx(InlineFootnoteMacroRx),
        async (match, p1, p2, p3) => {
          if (match.startsWith(RS)) return match.slice(1)

          let id, content, type, target;
          if (p1) {
            // footnoteref
            if (p3) {
              const commaIdx = p3.indexOf(',');
              if (commaIdx >= 0) {
                id = p3.slice(0, commaIdx);
                content = p3.slice(commaIdx + 1);
              } else {
                // reference only (no text), e.g. footnoteref:[id]
                id = p3;
              }
              if (!doc.compatMode) {
                this.logger.warn(
                  `found deprecated footnoteref macro: ${match}; use footnote macro with target instead`
                );
              }
            } else {
              return match
            }
          } else {
            id = p2;
            content = p3;
          }

          let index;
          if (id) {
            const footnote = doc.footnotes.find((f) => f.id === id);
            if (footnote) {
              index = footnote.index;
              content = footnote.text;
              type = 'xref';
              target = id;
              id = null;
            } else if (content) {
              content = await this.restorePassthroughs(
                this.normalizeText(content, true, true)
              );
              index = doc.counter('footnote-number');
              doc.register('footnotes', new Footnote(index, id, content));
              type = 'ref';
              target = null;
            } else {
              this.logger.warn(`invalid footnote reference: ${id}`);
              type = 'xref';
              target = id;
              content = id;
              id = null;
            }
          } else if (content) {
            content = await this.restorePassthroughs(
              this.normalizeText(content, true, true)
            );
            index = doc.counter('footnote-number');
            doc.register('footnotes', new Footnote(index, id, content));
            type = null;
            target = null;
          } else {
            return match
          }

          return new Inline(this, 'footnote', content, {
            attributes: { index },
            id,
            target,
            type,
          }).convert()
        }
      );
    }

    return text
  },

  /**
   * Substitute post replacements (hard line breaks).
   *
   * @param {string} text
   * @returns {Promise<string>}
   */
  async subPostReplacements(text) {
    if (
      'hardbreaks-option' in this.attributes ||
      'hardbreaks-option' in this.document.attributes
    ) {
      const lines = text.split(LF$1);
      if (lines.length < 2) return text
      const last = lines.pop();
      const converted = await Promise.all(
        lines.map((line) =>
          new Inline(
            this,
            'break',
            line.endsWith(HARD_LINE_BREAK) ? line.slice(0, -2) : line,
            { type: 'line' }
          ).convert()
        )
      );
      return [...converted, last].join(LF$1)
    } else if (text.includes(PLUS) && text.includes(HARD_LINE_BREAK)) {
      return asyncReplace(
        text,
        globalRx(HardLineBreakRx),
        async (match, p1) => {
          return new Inline(this, 'break', p1, { type: 'line' }).convert()
        }
      )
    }
    return text
  },

  /**
   * Apply verbatim substitutions on source.
   *
   * @param {string} source
   * @param {boolean} processCallouts
   * @returns {Promise<string>}
   */
  async subSource(source, processCallouts) {
    return processCallouts
      ? await this.subCallouts(this.subSpecialchars(source))
      : this.subSpecialchars(source)
  },

  /**
   * Substitute callout source references.
   *
   * @param {string} text
   * @returns {Promise<string>}
   */
  async subCallouts(text) {
    const calloutRx = this.hasAttribute('line-comment')
      ? CalloutSourceRxMap[this.getAttribute('line-comment')]
      : CalloutSourceRx;
    let autonum = 0;
    return asyncReplace(
      text,
      globalRx(calloutRx),
      async (match, p1, p2, p3, p4) => {
        if (p2) {
          return match.replace(RS, '')
        }
        const guard = p1 || (p3 === '--' ? ['<!--', '-->'] : null);
        const numeral = p4 === '.' ? String(++autonum) : p4;
        return new Inline(this, 'callout', numeral, {
          id: this.document.callouts.readNextId(),
          attributes: { guard },
        }).convert()
      }
    )
  },

  /**
   * Highlight (colorize) the source code using a syntax highlighter.
   *
   * @param {string} source
   * @param {boolean} processCallouts
   * @returns {Promise<string>}
   */
  async highlightSource(source, processCallouts) {
    const syntaxHl = this.document.syntaxHighlighter;
    if (!syntaxHl?.handlesHighlighting()) {
      return this.subSource(source, processCallouts)
    }

    let calloutMarks;
    if (processCallouts) {
[source, calloutMarks] = this.extractCallouts(source);
    }

    const docAttrs = this.document.attributes;
    const syntaxHlName = syntaxHl.name;
    let linenumsMode = null;
    let startLineNumber = null;
    if (this.hasOption('linenums')) {
      linenumsMode = docAttrs[`${syntaxHlName}-linenums-mode`] || 'table';
      startLineNumber = parseInt(this.getAttribute('start', 1), 10);
      if (startLineNumber < 1) startLineNumber = 1;
    }

    let highlightLines = null;
    if (this.hasAttribute('highlight')) {
      highlightLines = this.resolveLinesToHighlight(
        source,
        this.getAttribute('highlight'),
        startLineNumber
      );
    }

    const hlResult = syntaxHl.highlight(
      this,
      source,
      this.getAttribute('language'),
      {
        callouts: calloutMarks,
        cssMode: docAttrs[`${syntaxHlName}-css`] || 'class',
        highlightLines,
        numberLines: linenumsMode,
        startLineNumber,
        style: docAttrs[`${syntaxHlName}-style`],
      }
    );
    const [highlighted, sourceOffset] = Array.isArray(hlResult)
      ? hlResult
      : [hlResult, undefined];

    let result = highlighted;
    if (this.passthroughs.length > 0) {
      result = result.replace(
        globalRx(HIGHLIGHTED_PASS_SLOT_RX),
        `${PASS_START}$1${PASS_END}`
      );
    }

    if (!calloutMarks || Object.keys(calloutMarks).length === 0) {
      return result
    }
    return await this.restoreCallouts(result, calloutMarks, sourceOffset)
  },

  /**
   * Resolve line numbers to highlight from a test string.
   *
   * @param {string} source
   * @param {string} spec   - e.g. "1-5, !2, 10" or "1..5;!2;10"
   * @param {number|null} [start=null]
   * @returns {number[]}
   */
  resolveLinesToHighlight(source, spec, start = null) {
    let lines = [];
    if (spec.includes(' ')) spec = spec.split(' ').join('');
    const entries = spec.includes(',') ? spec.split(',') : spec.split(';');

    for (let entry of entries) {
      let negate = false;
      if (entry.startsWith('!')) {
        entry = entry.slice(1);
        negate = true;
      }
      const delim = entry.includes('..')
        ? '..'
        : entry.includes('-')
          ? '-'
          : null;
      if (delim) {
        const [fromStr, , toStr] = partition(entry, delim);
        const from = parseInt(fromStr, 10);
        let to;
        if (!toStr || (to = parseInt(toStr, 10)) < 0) {
          to = source.split(LF$1).length + 1;
        }
        const range = Array.from({ length: to - from + 1 }, (_, i) => from + i);
        if (negate) {
          lines = arrayDiff(lines, range);
        } else {
          lines = arrayUnion(lines, range);
        }
      } else if (negate) {
        const val = parseInt(entry, 10);
        lines = lines.filter((l) => l !== val);
      } else {
        const line = parseInt(entry, 10);
        if (!lines.includes(line)) lines.push(line);
      }
    }

    if (start) {
      const shift = start - 1;
      if (shift !== 0) lines = lines.map((l) => l - shift);
    }

    return lines.sort((a, b) => a - b)
  },

  /**
   * Extract passthrough text for reinsertion after processing.
   *
   * @param {string} text
   * @returns {string} Text with passthrough regions replaced by placeholders.
   */
  extractPassthroughs(text) {
    const compatMode = this.document.compatMode;
    const passthrus = this.passthroughs;

    if (text.includes('++') || text.includes('$$') || text.includes('ss:')) {
      text = text.replace(
        globalRx(InlinePassMacroRx),
        (match, p1, p2, p3, p4, p5, p6, p7, p8) => {
          const boundary = p4; // $$, ++, or +++
          if (boundary) {
            // skip ++ in compat mode
            if (compatMode && boundary === '++') {
              const prefix = p2 ? `${p1}[${p2}]${p3}` : `${p1}${p3}`;
              return `${prefix}++${this.extractPassthroughs(p5)}++`
            }

            let attributes, oldBehavior, preceding;
            if (p2) {
              const attrlist = p2;
              const escapeCount = p3.length;
              if (escapeCount > 0) {
                return `${p1}[${attrlist}]${RS.repeat(escapeCount - 1)}${boundary}${p5}${boundary}`
              } else if (p1 === RS) {
                preceding = `[${attrlist}]`;
              } else if (boundary === '++') {
                if (attrlist === 'x-') {
                  oldBehavior = true;
                  attributes = {};
                } else if (attrlist.endsWith(' x-')) {
                  oldBehavior = true;
                  attributes = this.parseQuotedTextAttributes(
                    attrlist.slice(0, -3)
                  );
                } else {
                  attributes = this.parseQuotedTextAttributes(attrlist);
                }
              } else {
                attributes = this.parseQuotedTextAttributes(attrlist);
              }
            } else {
              const escapeCount = p3.length;
              if (escapeCount > 0) {
                return `${RS.repeat(escapeCount - 1)}${boundary}${p5}${boundary}`
              }
            }

            const subs = boundary === '+++' ? [] : [...BASIC_SUBS];
            let passthruKey;
            if (attributes) {
              if (oldBehavior) {
                passthrus[(passthruKey = passthrus.length)] = {
                  text: p5,
                  subs: NORMAL_SUBS,
                  type: 'monospaced',
                  attributes,
                };
              } else {
                passthrus[(passthruKey = passthrus.length)] = {
                  text: p5,
                  subs,
                  type: 'unquoted',
                  attributes,
                };
              }
            } else {
              passthrus[(passthruKey = passthrus.length)] = { text: p5, subs };
            }
            return `${preceding || ''}${PASS_START}${passthruKey}${PASS_END}`
          } else {
            // pass:[]
            if (p6 === RS) return match.slice(1)
            let passthruKey;
            if (p7) {
              passthrus[(passthruKey = passthrus.length)] = {
                text: this.normalizeText(p8, null, true),
                subs: this.resolvePassSubs(p7),
              };
            } else {
              passthrus[(passthruKey = passthrus.length)] = {
                text: this.normalizeText(p8, null, true),
              };
            }
            return `${PASS_START}${passthruKey}${PASS_END}`
          }
        }
      );
    }

    const [passInlineChar1, passInlineChar2, passInlineRx] =
      InlinePassRx[compatMode];

    if (
      text.includes(passInlineChar1) ||
      (passInlineChar2 && text.includes(passInlineChar2))
    ) {
      text = text.replace(
        globalRx(passInlineRx),
        (match, p1, p2, p3, p4, p5, p6, p7, p8) => {
          const preceding = p1;
          const attrlist = p4 || p3;
          const escaped = !!p5;
          const quotedText = p6;
          const formatMark = p7;
          const content = p8;

          let oldBehavior, oldBehaviorForced, attributes;

          if (compatMode) {
            oldBehavior = true;
          } else if (
            attrlist &&
            (attrlist === 'x-' || attrlist.endsWith(' x-'))
          ) {
            oldBehavior = true;
            oldBehaviorForced = true;
          }

          if (attrlist) {
            if (escaped) {
              return `${preceding}[${attrlist}]${quotedText.slice(1)}`
            } else if (preceding === RS) {
              if (oldBehaviorForced && formatMark === '`') {
                return `${preceding}[${attrlist}]${quotedText}`
              }
              if (compatMode && formatMark === '`') {
                // escaped role in compat-mode: role becomes literal text, backtick span still processed as monospaced
                let passthruKey;
                passthrus[(passthruKey = passthrus.length)] = {
                  text: content,
                  subs: BASIC_SUBS,
                  type: 'monospaced',
                };
                return `[${attrlist}]${PASS_START}${passthruKey}${PASS_END}`
              }
              return `[${attrlist}]${quotedText}` // preceding replaced by attrlist form
            } else if (oldBehaviorForced) {
              attributes =
                attrlist === 'x-'
                  ? {}
                  : this.parseQuotedTextAttributes(attrlist.slice(0, -3));
            } else {
              attributes = this.parseQuotedTextAttributes(attrlist);
            }
          } else if (escaped) {
            return `${preceding}${quotedText.slice(1)}`
          } else if (compatMode && preceding === RS) {
            return quotedText
          }

          let passthruKey;
          if (compatMode) {
            passthrus[(passthruKey = passthrus.length)] = {
              text: content,
              subs: BASIC_SUBS,
              attributes,
              type: 'monospaced',
            };
          } else if (attributes) {
            if (oldBehavior) {
              const subs = formatMark === '`' ? BASIC_SUBS : NORMAL_SUBS;
              passthrus[(passthruKey = passthrus.length)] = {
                text: content,
                subs,
                attributes,
                type: 'monospaced',
              };
            } else {
              passthrus[(passthruKey = passthrus.length)] = {
                text: content,
                subs: BASIC_SUBS,
                attributes,
                type: 'unquoted',
              };
            }
          } else {
            passthrus[(passthruKey = passthrus.length)] = {
              text: content,
              subs: BASIC_SUBS,
            };
          }

          return `${preceding || ''}${PASS_START}${passthruKey}${PASS_END}`
        }
      );
    }

    // stem macros (in a subsequent step to allow escaping by the former)
    if (
      text.includes(':') &&
      (text.includes('stem:') || text.includes('math:'))
    ) {
      text = text.replace(globalRx(InlineStemMacroRx), (match, p1, p2, p3) => {
        if (match.startsWith(RS)) return match.slice(1)
        let type = p1;
        if (type === 'stem') {
          type = STEM_TYPE_ALIASES[this.document.attributes.stem];
        }
        let content = this.normalizeText(p3, null, true);
        if (
          type === 'latexmath' &&
          content.startsWith('$') &&
          content.endsWith('$')
        ) {
          content = content.slice(1, -1);
        }
        const subs = p2
          ? this.resolvePassSubs(p2, 'stem macro')
          : this.document.basebackend('html')
            ? BASIC_SUBS
            : null;
        const passthruKey = passthrus.length;
        passthrus[passthruKey] = { text: content, subs, type };
        return `${PASS_START}${passthruKey}${PASS_END}`
      });
    }

    return text
  },

  /**
   * Restore passthrough text by reinserting into placeholder positions.
   *
   * @param {string} text
   * @returns {Promise<string>}
   */
  async restorePassthroughs(text) {
    if (!text.includes(PASS_START)) return text
    const passthrus = this.passthroughs;
    return asyncReplace(text, globalRx(PASS_SLOT_RX), async (match, p1) => {
      const pass = passthrus[parseInt(p1, 10)];
      if (pass) {
        let subbedText = await this.applySubs(pass.text, pass.subs);
        const type = pass.type;
        if (type) {
          const attributes = pass.attributes;
          const id = attributes?.id;
          subbedText = await new Inline(this, 'quoted', subbedText, {
            type,
            id,
            attributes,
          }).convert();
        }
        return subbedText.includes(PASS_START)
          ? this.restorePassthroughs(subbedText)
          : subbedText
      } else {
        this.logger.error(`unresolved passthrough detected: ${text}`);
        return '??pass??'
      }
    })
  },

  /**
   * Resolve the list of comma-delimited subs against the possible options.
   *
   * @param {string} subs
   * @param {'block'|'inline'} [type='block']
   * @param {string[]|null} [defaults=null]
   * @param {string|null} [subject=null]
   * @returns {string[]|undefined}
   */
  resolveSubs(subs, type = 'block', defaults = null, subject = null) {
    if (!subs || subs.length === 0) return undefined
    let candidates = null;
    if (subs.includes(' ')) subs = subs.split(' ').join('');
    const modifiersPresent = SubModifierSniffRx.test(subs);

    for (let key of subs.split(',')) {
      let modifierOperation = null;
      if (modifiersPresent) {
        const first = key.charAt(0);
        if (first === '+') {
          modifierOperation = 'append';
          key = key.slice(1);
        } else if (first === '-') {
          modifierOperation = 'remove';
          key = key.slice(1);
        } else if (key.endsWith('+')) {
          modifierOperation = 'prepend';
          key = key.slice(0, -1);
        }
      }

      let resolvedKeys;
      if (type === 'inline' && (key === 'verbatim' || key === 'v')) {
        resolvedKeys = BASIC_SUBS;
      } else if (key in SUB_GROUPS) {
        resolvedKeys = SUB_GROUPS[key];
      } else if (type === 'inline' && key.length === 1 && key in SUB_HINTS) {
        const resolvedKey = SUB_HINTS[key];
        resolvedKeys = SUB_GROUPS[resolvedKey] || [resolvedKey];
      } else {
        resolvedKeys = [key];
      }

      if (modifierOperation) {
        candidates = candidates ?? (defaults ? [...defaults] : []);
        switch (modifierOperation) {
          case 'append':
            candidates = [...candidates, ...resolvedKeys];
            break
          case 'prepend':
            candidates = [...resolvedKeys, ...candidates];
            break
          case 'remove':
            candidates = arrayDiff(candidates, resolvedKeys);
            break
        }
      } else {
        candidates = candidates ?? [];
        candidates = [...candidates, ...resolvedKeys];
      }
    }

    if (!candidates) return undefined

    // weed out invalid options and remove duplicates (order preserved; first occurrence wins)
    const resolved = arrayIntersect(candidates, SUB_OPTIONS[type]);
    const invalid = arrayDiff(candidates, resolved);
    if (invalid.length > 0) {
      this.logger.warn(
        `invalid substitution type${invalid.length > 1 ? 's' : ''}${subject ? ' for ' : ''}${subject || ''}: ${invalid.join(', ')}`
      );
    }
    return resolved
  },

  /** Call resolveSubs for the 'block' type. */
  resolveBlockSubs(subs, defaults, subject) {
    return this.resolveSubs(subs, 'block', defaults, subject)
  },

  /** Call resolveSubs for the 'inline' type with subject set as passthrough macro. */
  resolvePassSubs(subs, subject = 'passthrough macro') {
    return this.resolveSubs(subs, 'inline', null, subject)
  },

  /**
   * Expand all groups in the subs list and return.
   *
   * @param {string|string[]} subs
   * @param {string|null} [subject=null]
   * @returns {string[]|null}
   */
  expandSubs(subs, subject = null) {
    if (typeof subs === 'string') {
      // subs is a single key name
      if (subs === 'none') return null
      return SUB_GROUPS[subs] || [subs]
    } else if (Array.isArray(subs)) {
      const expandedSubs = [];
      for (const key of subs) {
        if (key !== 'none') {
          const subGroup = SUB_GROUPS[key];
          if (subGroup) {
            expandedSubs.push(...subGroup);
          } else {
            expandedSubs.push(key);
          }
        }
      }
      return expandedSubs.length === 0 ? null : expandedSubs
    } else {
      return this.resolveSubs(subs, 'inline', null, subject)
    }
  },

  /**
   * Commit the requested substitutions to this block.
   * Looks for an attribute named "subs". If present, resolves substitutions.
   */
  commitSubs() {
    let defaultSubs = this.defaultSubs;
    if (!defaultSubs) {
      switch (this.contentModel) {
        case 'simple':
          defaultSubs = NORMAL_SUBS;
          break
        case 'verbatim':
          defaultSubs = this.context === 'verse' ? NORMAL_SUBS : VERBATIM_SUBS;
          break
        case 'raw':
          defaultSubs = this.context === 'stem' ? BASIC_SUBS : NO_SUBS;
          break
        default:
          return this.subs
      }
    }

    const customSubs = this.attributes.subs;
    if (customSubs) {
      this.subs =
        this.resolveBlockSubs(customSubs, defaultSubs, this.context) || [];
    } else {
      this.subs = [...defaultSubs];
    }

    if (
      this.context === 'listing' &&
      this.style === 'source' &&
      this.document.syntaxHighlighter?.handlesHighlighting()
    ) {
      const idx = this.subs.indexOf('specialcharacters');
      if (idx !== -1) this.subs[idx] = 'highlight';
    }

    return null
  },

  /**
   * Parse attributes in name or name=value format from a comma-separated String.
   *
   * @param {string} attrlist
   * @param {string[]} [posattrs=[]]
   * @param {Object} [opts={}]
   * @returns {Promise<Object>}
   */
  async parseAttributes(attrlist, posattrs = [], opts = {}) {
    if (!attrlist || attrlist.length === 0) return {}
    if (opts.unescapeInput) attrlist = this.normalizeText(attrlist, true, true);
    if ((opts.subInput || opts.sub_input) && attrlist.includes(ATTR_REF_HEAD)) {
      attrlist = this.document.subAttributes(attrlist);
    }
    const block = opts.subResult || opts.sub_result ? this : null;
    const al = new AttributeList(attrlist, block);
    if (opts.into) {
      return al.parseInto(opts.into, posattrs)
    }
    return al.parse(posattrs)
  },

  // ── Private methods ────────────────────────────────────────────────────────

  async extractAttributesFromText(text, defaultText = null) {
    const attrlist = text.includes(LF$1) ? text.split(LF$1).join(' ') : text;
    const attrs = await new AttributeList(attrlist, this).parse();
    const resolvedText = attrs[1];
    if (resolvedText != null) {
      if (resolvedText === attrlist) {
        Object.keys(attrs).forEach((k) => {
          delete attrs[k];
        });
        return [text, attrs]
      }
      return [resolvedText, attrs]
    }
    return [defaultText, attrs]
  },

  extractCallouts(source) {
    const calloutMarks = {};
    let autonum = 0;
    let lineno = 0;
    let lastLineno = null;
    const calloutRx = this.hasAttribute('line-comment')
      ? CalloutExtractRxMap[this.getAttribute('line-comment')]
      : CalloutExtractRx;

    const lines = source.split(LF$1).map((line) => {
      lineno++;
      return line.replace(globalRx(calloutRx), (match, p1, p2, p3, p4) => {
        if (p2) {
          return match.replace(RS, '')
        }
        const guard = p1 || (p3 === '--' ? ['<!--', '-->'] : null);
        const numeral = p4 === '.' ? String(++autonum) : p4
        ;(calloutMarks[lineno] = calloutMarks[lineno] || []).push([
          guard,
          numeral,
        ]);
        lastLineno = lineno;
        return ''
      })
    });

    let result = lines.join(LF$1);
    if (lastLineno !== null) {
      if (lastLineno === lineno) result = `${result}${LF$1}`;
    } else {
      return [result, null]
    }
    return [result, calloutMarks]
  },

  async restoreCallouts(source, calloutMarks, sourceOffset = null) {
    let preamble = '';
    if (sourceOffset !== null) {
      preamble = source.slice(0, sourceOffset);
      source = source.slice(sourceOffset);
    }
    let lineno = 0;
    const result = await Promise.all(
      source.split(LF$1).map(async (line) => {
        const conums = calloutMarks[++lineno];
        if (conums) {
          delete calloutMarks[lineno];
          if (conums.length === 1) {
            const [guard, numeral] = conums[0];
            return `${line}${await new Inline(this, 'callout', numeral, {
              id: this.document.callouts.readNextId(),
              attributes: { guard },
            }).convert()}`
          } else {
            const converted = await Promise.all(
              conums.map(([guard, numeral]) =>
                new Inline(this, 'callout', numeral, {
                  id: this.document.callouts.readNextId(),
                  attributes: { guard },
                }).convert()
              )
            );
            return `${line}${converted.join(' ')}`
          }
        }
        return line
      })
    );
    return preamble + result.join(LF$1)
  },

  async convertQuotedText(args, type, scope) {
    // args: [fullMatch, group1, group2, ...]
    const fullMatch = args[0];
    if (fullMatch.startsWith(RS)) {
      if (scope === 'constrained') {
        const attrs = args[2];
        if (attrs) {
          return `[${attrs}]${await new Inline(this, 'quoted', args[3], { type }).convert()}`
        }
      }
      return fullMatch.slice(1)
    }

    if (scope === 'constrained') {
      const attrlist = args[2];
      let id, attributes;
      if (attrlist) {
        attributes = this.parseQuotedTextAttributes(attrlist);
        id = attributes.id;
        if (type === 'mark') type = 'unquoted';
      }
      return `${args[1] || ''}${await new Inline(this, 'quoted', args[3], { type, id, attributes }).convert()}`
    } else {
      const attrlist = args[1];
      let id, attributes;
      if (attrlist) {
        attributes = this.parseQuotedTextAttributes(attrlist);
        id = attributes.id;
        if (type === 'mark') type = 'unquoted';
      }
      return new Inline(this, 'quoted', args[2], {
        type,
        id,
        attributes,
      }).convert()
    }
  },

  doReplacement(match, replacement, restore) {
    const captured = match[0];
    if (captured.includes(RS)) {
      return captured.replace(RS, '')
    }
    switch (restore) {
      case 'none':
        return replacement
      case 'bounding':
        return match[1] + replacement + match[2]
      default: // 'leading'
        return match[1] + replacement
    }
  },

  /** Inserts text into a formatted text enclosure (sprintf). */
  subPlaceholder(format, ...args) {
    let i = 0;
    return format.replace(/%s/g, () => String(args[i++] ?? ''))
  },

  parseQuotedTextAttributes(str) {
    if (str.includes(ATTR_REF_HEAD)) str = this.subAttributes(str);
    // for compliance, only consider first positional attribute
    if (str.includes(',')) str = str.slice(0, str.indexOf(','));
    str = str.trim();
    if (!str) return {}
    if (
      (str.startsWith('.') || str.startsWith('#')) &&
      Compliance.shorthandPropertySyntax
    ) {
      const [before, , after] = partition(str, '#');
      const attrs = {};
      if (!after) {
        if (before.length > 1)
          attrs.role = before.slice(1).split('.').join(' ').trimStart();
      } else {
        const [id, , roles] = partition(after, '.');
        if (id) attrs.id = id;
        if (!roles) {
          if (before.length > 1)
            attrs.role = before.slice(1).split('.').join(' ').trimStart();
        } else if (before.length > 1) {
          attrs.role = `${before}.${roles}`
            .slice(1)
            .split('.')
            .join(' ')
            .trimStart();
        } else {
          attrs.role = roles.split('.').join(' ');
        }
      }
      return attrs
    }
    return { role: str }
  },

  normalizeText(
    text,
    normalizeWhitespace = null,
    unescapeClosingSquareBrackets = null
  ) {
    if (text && text.length > 0) {
      if (normalizeWhitespace) text = text.trim().split(LF$1).join(' ');
      if (unescapeClosingSquareBrackets && text.includes(R_SB)) {
        text = text.split(ESC_R_SB).join(R_SB);
      }
    }
    return text
  },

  splitSimpleCsv(str) {
    if (!str || str.length === 0) return []
    if (str.includes('"')) {
      const values = [];
      let accum = '';
      let quoteOpen = false;
      for (const c of str) {
        if (c === ',') {
          if (quoteOpen) {
            accum += c;
          } else {
            values.push(accum.trim());
            accum = '';
          }
        } else if (c === '"') {
          quoteOpen = !quoteOpen;
        } else {
          accum += c;
        }
      }
      values.push(accum.trim());
      return values
    }
    return str.split(',').map((item) => item.trim())
  },
};

// ESM conversion of load.rb
//
// Ruby-to-JavaScript notes:
//   - Ruby module methods on Asciidoctor → named exports load() and loadFile().
//   - Ruby File === input branch → Node.js fs.createReadStream / fs.readFileSync
//     adapted to check for an object with a .read() method (duck-typing).
//   - Ruby File.absolute_path / File.dirname / Helpers.basename / Helpers.extname
//     → implemented using Node's node:path and the helpers.js module.
//   - The timings option is passed through but its start/record calls are no-ops
//     unless a real Timings object is supplied (interface: { start(label), record(label) }).
//   - LoggerManager from logging.js is used to honour the :logger option.
//   - SpaceDelimiterRx / EscapedSpaceRx / NULL are imported from rx.js / constants.js
//     for string-form attributes parsing (mirrors the Ruby gsub/split dance).
//   - Circular dependencies (Document ↔ Parser, etc.) are resolved via static ESM imports
//     with live bindings; no lazy import() needed. Built-in converters are still loaded
//     lazily by Converter.create() and self-register on first use.


// Apply the Substitutors mixin to AbstractNode so that all nodes (Document,
// Section, Block, etc.) have subSpecialchars, subAttributes, etc. available.
Object.assign(AbstractNode.prototype, Substitutors);

// Register built-in syntax highlighters (mirrors Ruby's `register_for`).
SyntaxHighlighter.register(HighlightJsAdapter, 'highlightjs', 'highlight.js');
SyntaxHighlighter.register(HtmlPipelineAdapter, 'html-pipeline');

// ── load ──────────────────────────────────────────────────────────────────────

/**
 * Parse the AsciiDoc source input into a Document.
 *
 * Accepts input as a Node.js Readable stream (or any object with a read()
 * method), a String, or a String Array. If the input is a file descriptor
 * object produced by openFile() / Node's fs.openSync(), pass a plain object
 * with { path, read() } instead; the function sets docfile/docdir/docname
 * attributes automatically.
 *
 * @param {Buffer|string|string[]|{path?: string, read(): string|Promise<string>, mtime?: Date}} input - The AsciiDoc source.
 * @param {Object} [options={}] - Options to control processing. See Document for the full list.
 * @param {string|string[]|Object} [options.attributes] - Document attributes.
 * @param {boolean} [options.parse] - Set to false to skip parsing after Document creation.
 * @param {Object} [options.logger] - Logger instance to use for this call.
 * @param {{start(label: string): void, record(label: string): void}} [options.timings] - Timings object.
 * @returns {Promise<Document>} A Promise that resolves to the Document.
 */
async function load$1(input, options = {}) {
  // Shallow-copy options so we don't mutate the caller's object.
  options = Object.assign({}, options);

  // ── Logger override ───────────────────────────────────────────────────────
  // When a logger option is supplied, run the conversion in an async-local
  // context so the logger is scoped to this call only — no global mutation,
  // which makes concurrent callers (e.g. parallel Deno tests) safe.
  if ('logger' in options) {
    const newLogger = options.logger ?? new NullLogger();
    delete options.logger;
    return withLogger(newLogger, () => _doLoad(input, options, newLogger))
  }

  return _doLoad(input, options)
}

async function _doLoad(input, options, explicitLogger = null) {
  const timings = options.timings ?? null;
  if (timings) timings.start('read');

  // ── Attributes normalisation ──────────────────────────────────────────────
  let attrs = options.attributes;
  if (!attrs) {
    attrs = {};
  } else if (typeof attrs === 'string') {
    // Condense non-escaped whitespace runs to NULL, unescape escaped spaces, split on NULL.
    attrs = _parseAttributeString(attrs);
  } else if (Array.isArray(attrs)) {
    attrs = _parseAttributeArray(attrs);
  } else if (typeof attrs === 'object') {
    attrs = Object.assign({}, attrs);
  } else {
    throw new TypeError(`illegal type for attributes option: ${typeof attrs}`)
  }

  // ── Input reading ─────────────────────────────────────────────────────────
  let source;
  if (input && typeof input === 'object' && typeof input.read === 'function') {
    // Duck-typed file-like object: { path?, mtime?, read() }
    if (input.path) {
      // Treat it like a File object: resolve path, set docfile/docdir/docname.
      const nodePath = await _requirePath$1();
      const inputPath = nodePath.resolve(input.path);
      if (input.mtime) options.input_mtime = input.mtime;
      attrs.docfile = inputPath;
      attrs.docdir = nodePath.dirname(inputPath);
      const docfilesuffix = extname(inputPath);
      attrs.docfilesuffix = docfilesuffix;
      attrs.docname = basename(inputPath, docfilesuffix);
    }
    source = await _readStream(input);
  } else if (input instanceof Uint8Array) {
    // Covers both Node.js Buffer (a Uint8Array subclass) and browser Uint8Array shims.
    source = new TextDecoder('utf-8').decode(input);
  } else if (typeof input === 'string') {
    source = input;
  } else if (Array.isArray(input)) {
    source = input.slice();
  } else if (input) {
    throw new TypeError(`unsupported input type: ${typeof input}`)
  }

  if (timings) {
    timings.record('read');
    timings.start('parse');
  }

  options.attributes = attrs;

  // ── Document construction + optional parse ────────────────────────────────
  let doc;
  try {
    let backend = String(attrs.backend || options.backend || 'html5');
    // Strip soft-set modifier (@) and value-based soft-set (ending with @)
    if (backend.endsWith('@')) backend = backend.slice(0, -1);
    if (backend.startsWith('xhtml')) backend = `html${backend.slice(5)}`; // xhtml5 → html5
    backend = BACKEND_ALIASES[backend] ?? backend;
    await Converter.create(backend, {});
    // If template dirs are requested, pre-create the async template converter
    // so that _createConverter() can use it synchronously during Document construction.
    // (In Ruby, Converter.create is synchronous; in JS we bridge the gap here.)
    if (options.template_dir || options.template_dirs) {
      const templateDirs = [].concat(
        options.template_dirs ?? options.template_dir
      );
      const converterOpts = {
        template_dirs: templateDirs,
        template_cache: options.template_cache ?? true,
        template_engine: options.template_engine,
        template_engine_options: options.template_engine_options,
      };
      options._preCreatedConverter = await Converter.create(
        backend,
        converterOpts
      );
    }
    if (options.parse !== false) {
      doc = await Document.create(source, options);
    } else {
      doc = new Document(source, options);
    }
  } catch (e) {
    const docfile = attrs.docfile || '<stdin>';
    const context = `asciidoctor: FAILED: ${docfile}: Failed to load AsciiDoc document`;
    let wrapped;
    try {
      wrapped = new Error(`${context} - ${e.message}`);
      wrapped.stack = e.stack;
      wrapped.cause = e;
    } catch {
      wrapped = e;
    }
    throw wrapped
  }

  if (timings) timings.record('parse');

  // Persist the logger on the Document instance so that doc.convert()
  // (called by convert.js after the async-local context ends) still routes
  // logging through the caller-supplied logger.
  // ALS provides it in Node.js/Deno; the explicit parameter covers browser fallback.
  const contextLogger = getContextLogger() ?? explicitLogger;
  if (contextLogger) {
    Object.defineProperty(doc, 'logger', {
      get: () => contextLogger,
      configurable: true,
    });
  }

  return doc
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Parse a whitespace-delimited attribute string into a plain object.
 *
 * Mirrors the Ruby idiom:
 *   attrs.gsub(SpaceDelimiterRx, '\1' + NULL).gsub(EscapedSpaceRx, '\1').split(NULL)
 *
 * @param {string} str - The attribute string to parse.
 * @returns {Object} A plain object mapping attribute keys to values.
 * @internal
 */
function _parseAttributeString(str) {
  const condensed = str
    .replace(SpaceDelimiterRx, `$1${NULL}`)
    .replace(EscapedSpaceRx, '$1');
  const result = {};
  for (const entry of condensed.split(NULL)) {
    if (!entry) continue
    const eqIdx = entry.indexOf('=');
    if (eqIdx < 0) {
      result[entry] = '';
    } else {
      result[entry.slice(0, eqIdx)] = entry.slice(eqIdx + 1);
    }
  }
  return result
}

/**
 * Parse an array of "key=value" entries into a plain object.
 *
 * @param {string[]} arr - Array of "key=value" strings.
 * @returns {Object} A plain object mapping attribute keys to values.
 * @internal
 */
function _parseAttributeArray(arr) {
  const result = {};
  for (const entry of arr) {
    const eqIdx = entry.indexOf('=');
    if (eqIdx < 0) {
      result[entry] = '';
    } else {
      result[entry.slice(0, eqIdx)] = entry.slice(eqIdx + 1);
    }
  }
  return result
}

/**
 * Read all data from an object that has a .read() method.
 * Supports both synchronous (returns string) and async (returns Promise) variants.
 *
 * @param {{read(): string|Promise<string>}} readable - The readable object.
 * @returns {Promise<string>} A Promise that resolves to a String.
 * @internal
 */
async function _readStream(readable) {
  const data = readable.read();
  return data instanceof Promise ? data : Promise.resolve(data ?? '')
}

/**
 * Lazily import node:path to avoid issues in browser / Opal environments.
 *
 * @returns {Promise<typeof import('node:path')>} A Promise that resolves to the node:path module.
 * @internal
 */
async function _requirePath$1() {
  return import('node:path')
}

// Auto-generated from data/asciidoctor-default.css — run 'npm run build:data' to update
const defaultStylesheetData = "/*! Asciidoctor default stylesheet | MIT License | https://asciidoctor.org */\n/* Uncomment the following line when using as a custom stylesheet */\n/* @import \"https://fonts.googleapis.com/css?family=Open+Sans:300,300italic,400,400italic,600,600italic%7CNoto+Serif:400,400italic,700,700italic%7CDroid+Sans+Mono:400,700\"; */\nhtml{font-family:sans-serif;-webkit-text-size-adjust:100%}\na{background:none}\na:focus{outline:thin dotted}\na:active,a:hover{outline:0}\nh1{font-size:2em;margin:.67em 0}\nb,strong{font-weight:bold}\nabbr{font-size:.9em}\nabbr[title]{cursor:help;border-bottom:1px dotted #dddddf;text-decoration:none}\ndfn{font-style:italic}\nhr{height:0}\nmark{background:#ff0;color:#000}\ncode,kbd,pre,samp{font-family:monospace;font-size:1em}\npre{white-space:pre-wrap}\nq{quotes:\"\\201C\" \"\\201D\" \"\\2018\" \"\\2019\"}\nsmall{font-size:80%}\nsub,sup{font-size:75%;line-height:0;position:relative;vertical-align:baseline}\nsup{top:-.5em}\nsub{bottom:-.25em}\nimg{border:0}\nsvg:not(:root){overflow:hidden}\nfigure{margin:0}\naudio,video{display:inline-block}\naudio:not([controls]){display:none;height:0}\nfieldset{border:1px solid silver;margin:0 2px;padding:.35em .625em .75em}\nlegend{border:0;padding:0}\nbutton,input,select,textarea{font-family:inherit;font-size:100%;margin:0}\nbutton,input{line-height:normal}\nbutton,select{text-transform:none}\nbutton,html input[type=button],input[type=reset],input[type=submit]{-webkit-appearance:button;cursor:pointer}\nbutton[disabled],html input[disabled]{cursor:default}\ninput[type=checkbox],input[type=radio]{padding:0}\nbutton::-moz-focus-inner,input::-moz-focus-inner{border:0;padding:0}\ntextarea{overflow:auto;vertical-align:top}\ntable{border-collapse:collapse;border-spacing:0}\n*,::before,::after{box-sizing:border-box}\nhtml,body{font-size:100%}\nbody{background:#fff;color:rgba(0,0,0,.8);padding:0;margin:0;font-family:\"Noto Serif\",\"DejaVu Serif\",serif;line-height:1;position:relative;cursor:auto;-moz-tab-size:4;-o-tab-size:4;tab-size:4;word-wrap:anywhere;-moz-osx-font-smoothing:grayscale;-webkit-font-smoothing:antialiased}\na:hover{cursor:pointer}\nimg,object,embed{max-width:100%;height:auto}\nobject,embed{height:100%}\nimg{-ms-interpolation-mode:bicubic}\n.left{float:left!important}\n.right{float:right!important}\n.text-left{text-align:left!important}\n.text-right{text-align:right!important}\n.text-center{text-align:center!important}\n.text-justify{text-align:justify!important}\n.hide{display:none}\nimg,object,svg{display:inline-block;vertical-align:middle}\ntextarea{height:auto;min-height:50px}\nselect{width:100%}\n.subheader,.admonitionblock td.content>.title,.audioblock>.title,.exampleblock>.title,.imageblock>.title,.listingblock>.title,.literalblock>.title,.stemblock>.title,.openblock>.title,.paragraph>.title,.quoteblock>.title,table.tableblock>.title,.verseblock>.title,.videoblock>.title,.dlist>.title,.olist>.title,.ulist>.title,.qlist>.title,.hdlist>.title{line-height:1.45;color:#7a2518;font-weight:400;margin-top:0;margin-bottom:.25em}\ndiv,dl,dt,dd,ul,ol,li,h1,h2,h3,#toctitle,.sidebarblock>.content>.title,h4,h5,h6,pre,form,p,blockquote,th,td{margin:0;padding:0}\na{color:#2156a5;text-decoration:underline;line-height:inherit}\na:hover,a:focus{color:#1d4b8f}\na img{border:0}\np{line-height:1.6;margin-bottom:1.25em;text-rendering:optimizeLegibility}\np aside{font-size:.875em;line-height:1.35;font-style:italic}\nh1,h2,h3,#toctitle,.sidebarblock>.content>.title,h4,h5,h6{font-family:\"Open Sans\",\"DejaVu Sans\",sans-serif;font-weight:300;font-style:normal;color:#ba3925;text-rendering:optimizeLegibility;margin-top:1em;margin-bottom:.5em;line-height:1.0125em}\nh1 small,h2 small,h3 small,#toctitle small,.sidebarblock>.content>.title small,h4 small,h5 small,h6 small{font-size:60%;color:#e99b8f;line-height:0}\nh1{font-size:2.125em}\nh2{font-size:1.6875em}\nh3,#toctitle,.sidebarblock>.content>.title{font-size:1.375em}\nh4,h5{font-size:1.125em}\nh6{font-size:1em}\nhr{border:solid #dddddf;border-width:1px 0 0;clear:both;margin:1.25em 0 1.1875em}\nem,i{font-style:italic;line-height:inherit}\nstrong,b{font-weight:bold;line-height:inherit}\nsmall{font-size:60%;line-height:inherit}\ncode{font-family:\"Droid Sans Mono\",\"DejaVu Sans Mono\",monospace;font-weight:400;color:rgba(0,0,0,.9)}\nul,ol,dl{line-height:1.6;margin-bottom:1.25em;list-style-position:outside;font-family:inherit}\nul,ol{margin-left:1.5em}\nul li ul,ul li ol{margin-left:1.25em;margin-bottom:0}\nul.circle{list-style-type:circle}\nul.disc{list-style-type:disc}\nul.square{list-style-type:square}\nul.circle ul:not([class]),ul.disc ul:not([class]),ul.square ul:not([class]){list-style:inherit}\nol li ul,ol li ol{margin-left:1.25em;margin-bottom:0}\ndl dt{margin-bottom:.3125em;font-weight:bold}\ndl dd{margin-bottom:1.25em}\nblockquote{margin:0 0 1.25em;padding:.5625em 1.25em 0 1.1875em;border-left:1px solid #ddd}\nblockquote,blockquote p{line-height:1.6;color:rgba(0,0,0,.85)}\n@media screen and (min-width:768px){h1,h2,h3,#toctitle,.sidebarblock>.content>.title,h4,h5,h6{line-height:1.2}\n  h1{font-size:2.75em}\n  h2{font-size:2.3125em}\n  h3,#toctitle,.sidebarblock>.content>.title{font-size:1.6875em}\n  h4{font-size:1.4375em}}\ntable{background:#fff;margin-bottom:1.25em;border:1px solid #dedede;word-wrap:normal}\ntable thead,table tfoot{background:#f7f8f7}\ntable thead tr th,table thead tr td,table tfoot tr th,table tfoot tr td{padding:.5em .625em .625em;font-size:inherit;color:rgba(0,0,0,.8);text-align:left}\ntable tr th,table tr td{padding:.5625em .625em;font-size:inherit;color:rgba(0,0,0,.8)}\ntable tr.even,table tr.alt{background:#f8f8f7}\ntable thead tr th,table tfoot tr th,table tbody tr td,table tr td,table tfoot tr td{line-height:1.6}\nh1,h2,h3,#toctitle,.sidebarblock>.content>.title,h4,h5,h6{line-height:1.2;word-spacing:-.05em}\nh1 strong,h2 strong,h3 strong,#toctitle strong,.sidebarblock>.content>.title strong,h4 strong,h5 strong,h6 strong{font-weight:400}\n.center{margin-left:auto;margin-right:auto}\n.stretch{width:100%}\n.clearfix::before,.clearfix::after,.float-group::before,.float-group::after{content:\" \";display:table}\n.clearfix::after,.float-group::after{clear:both}\n:not(pre).nobreak{word-wrap:normal}\n:not(pre).nowrap{white-space:nowrap}\n:not(pre).pre-wrap{white-space:pre-wrap}\n:not(pre):not([class^=L])>code{font-size:.9375em;font-style:normal!important;letter-spacing:0;padding:.1em .5ex;word-spacing:-.15em;background:#f7f7f8;border-radius:4px;line-height:1.45;text-rendering:optimizeSpeed}\npre{color:rgba(0,0,0,.9);font-family:\"Droid Sans Mono\",\"DejaVu Sans Mono\",monospace;line-height:1.45;text-rendering:optimizeSpeed}\npre code,pre pre{color:inherit;font-size:inherit;line-height:inherit}\npre.nowrap,pre.nowrap pre{white-space:pre;word-wrap:normal}\nem em{font-style:normal}\nstrong strong{font-weight:400}\n.keyseq{color:rgba(51,51,51,.8)}\nkbd{font-family:\"Droid Sans Mono\",\"DejaVu Sans Mono\",monospace;display:inline-block;color:rgba(0,0,0,.8);font-size:.65em;line-height:1.45;background:#f7f7f7;border:1px solid #ccc;border-radius:3px;box-shadow:0 1px 0 rgba(0,0,0,.2),inset 0 0 0 .1em #fff;margin:0 .15em;padding:.2em .5em;vertical-align:middle;position:relative;top:-.1em;white-space:nowrap}\n.keyseq kbd:first-child{margin-left:0}\n.keyseq kbd:last-child{margin-right:0}\n.menuseq,.menuref{color:#000}\n.menuseq b:not(.caret),.menuref{font-weight:inherit}\n.menuseq{word-spacing:-.02em}\n.menuseq b.caret{font-size:1.25em;line-height:.8}\n.menuseq i.caret{font-weight:bold;text-align:center;width:.45em}\nb.button::before,b.button::after{position:relative;top:-1px;font-weight:400}\nb.button::before{content:\"[\";padding:0 3px 0 2px}\nb.button::after{content:\"]\";padding:0 2px 0 3px}\np a>code:hover{color:rgba(0,0,0,.9)}\n#header,#content,#footnotes,#footer{width:100%;margin:0 auto;max-width:62.5em;*zoom:1;position:relative;padding-left:.9375em;padding-right:.9375em}\n#header::before,#header::after,#content::before,#content::after,#footnotes::before,#footnotes::after,#footer::before,#footer::after{content:\" \";display:table}\n#header::after,#content::after,#footnotes::after,#footer::after{clear:both}\n#content{margin-top:1.25em}\n#content::before{content:none}\n#header>h1:first-child{color:rgba(0,0,0,.85);margin-top:2.25rem;margin-bottom:0}\n#header>h1:first-child+#toc{margin-top:8px;border-top:1px solid #dddddf}\n#header>h1:only-child{border-bottom:1px solid #dddddf;padding-bottom:8px}\n#header .details{border-bottom:1px solid #dddddf;line-height:1.45;padding-top:.25em;padding-bottom:.25em;padding-left:.25em;color:rgba(0,0,0,.6);display:flex;flex-flow:row wrap}\n#header .details span:first-child{margin-left:-.125em}\n#header .details span.email a{color:rgba(0,0,0,.85)}\n#header .details br{display:none}\n#header .details br+span::before{content:\"\\00a0\\2013\\00a0\"}\n#header .details br+span.author::before{content:\"\\00a0\\22c5\\00a0\";color:rgba(0,0,0,.85)}\n#header .details br+span#revremark::before{content:\"\\00a0|\\00a0\"}\n#header #revnumber{text-transform:capitalize}\n#header #revnumber::after{content:\"\\00a0\"}\n#content>h1:first-child:not([class]){color:rgba(0,0,0,.85);border-bottom:1px solid #dddddf;padding-bottom:8px;margin-top:0;padding-top:1rem;margin-bottom:1.25rem}\n#toc{border-bottom:1px solid #e7e7e9;padding-bottom:.5em}\n#toc>ul{margin-left:.125em}\n#toc ul.sectlevel0>li>a{font-style:italic}\n#toc ul.sectlevel0 ul.sectlevel1{margin:.5em 0}\n#toc ul{font-family:\"Open Sans\",\"DejaVu Sans\",sans-serif;list-style-type:none}\n#toc li{line-height:1.3334;margin-top:.3334em}\n#toc a{text-decoration:none}\n#toc a:active{text-decoration:underline}\n#toctitle{color:#7a2518;font-size:1.2em}\n@media screen and (min-width:768px){#toctitle{font-size:1.375em}\n  body.toc2{padding-left:15em;padding-right:0}\n  body.toc2 #header>h1:nth-last-child(2){border-bottom:1px solid #dddddf;padding-bottom:8px}\n  #toc.toc2{margin-top:0!important;background:#f8f8f7;position:fixed;width:15em;left:0;top:0;border-right:1px solid #e7e7e9;border-top-width:0!important;border-bottom-width:0!important;z-index:1000;padding:1.25em 1em;height:100%;overflow:auto}\n  #toc.toc2 #toctitle{margin-top:0;margin-bottom:.8rem;font-size:1.2em}\n  #toc.toc2>ul{font-size:.9em;margin-bottom:0}\n  #toc.toc2 ul ul{margin-left:0;padding-left:1em}\n  #toc.toc2 ul.sectlevel0 ul.sectlevel1{padding-left:0;margin-top:.5em;margin-bottom:.5em}\n  body.toc2.toc-right{padding-left:0;padding-right:15em}\n  body.toc2.toc-right #toc.toc2{border-right-width:0;border-left:1px solid #e7e7e9;left:auto;right:0}}\n@media screen and (min-width:1280px){body.toc2{padding-left:20em;padding-right:0}\n  #toc.toc2{width:20em}\n  #toc.toc2 #toctitle{font-size:1.375em}\n  #toc.toc2>ul{font-size:.95em}\n  #toc.toc2 ul ul{padding-left:1.25em}\n  body.toc2.toc-right{padding-left:0;padding-right:20em}}\n#content #toc{border:1px solid #e0e0dc;margin-bottom:1.25em;padding:1.25em;background:#f8f8f7;border-radius:4px}\n#content #toc>:first-child{margin-top:0}\n#content #toc>:last-child{margin-bottom:0}\n#footer{max-width:none;background:rgba(0,0,0,.8);padding:1.25em}\n#footer-text{color:hsla(0,0%,100%,.8);line-height:1.44}\n#content{margin-bottom:.625em}\n.sect1{padding-bottom:.625em}\n@media screen and (min-width:768px){#content{margin-bottom:1.25em}\n  .sect1{padding-bottom:1.25em}}\n.sect1:last-child{padding-bottom:0}\n.sect1+.sect1{border-top:1px solid #e7e7e9}\n#content h1>a.anchor,h2>a.anchor,h3>a.anchor,#toctitle>a.anchor,.sidebarblock>.content>.title>a.anchor,h4>a.anchor,h5>a.anchor,h6>a.anchor{position:absolute;z-index:1001;width:1.5ex;margin-left:-1.5ex;display:block;text-decoration:none!important;visibility:hidden;text-align:center;font-weight:400}\n#content h1>a.anchor::before,h2>a.anchor::before,h3>a.anchor::before,#toctitle>a.anchor::before,.sidebarblock>.content>.title>a.anchor::before,h4>a.anchor::before,h5>a.anchor::before,h6>a.anchor::before{content:\"\\00A7\";font-size:.85em;display:block;padding-top:.1em}\n#content h1:hover>a.anchor,#content h1>a.anchor:hover,h2:hover>a.anchor,h2>a.anchor:hover,h3:hover>a.anchor,#toctitle:hover>a.anchor,.sidebarblock>.content>.title:hover>a.anchor,h3>a.anchor:hover,#toctitle>a.anchor:hover,.sidebarblock>.content>.title>a.anchor:hover,h4:hover>a.anchor,h4>a.anchor:hover,h5:hover>a.anchor,h5>a.anchor:hover,h6:hover>a.anchor,h6>a.anchor:hover{visibility:visible}\n#content h1>a.link,h2>a.link,h3>a.link,#toctitle>a.link,.sidebarblock>.content>.title>a.link,h4>a.link,h5>a.link,h6>a.link{color:#ba3925;text-decoration:none}\n#content h1>a.link:hover,h2>a.link:hover,h3>a.link:hover,#toctitle>a.link:hover,.sidebarblock>.content>.title>a.link:hover,h4>a.link:hover,h5>a.link:hover,h6>a.link:hover{color:#a53221}\ndetails,.audioblock,.imageblock,.literalblock,.listingblock,.stemblock,.videoblock{margin-bottom:1.25em}\ndetails{margin-left:1.25rem}\ndetails>summary{cursor:pointer;display:block;position:relative;line-height:1.6;margin-bottom:.625rem;outline:none;-webkit-tap-highlight-color:transparent}\ndetails>summary::-webkit-details-marker{display:none}\ndetails>summary::before{content:\"\";border:solid transparent;border-left:solid;border-width:.3em 0 .3em .5em;position:absolute;top:.5em;left:-1.25rem;transform:translateX(15%)}\ndetails[open]>summary::before{border:solid transparent;border-top:solid;border-width:.5em .3em 0;transform:translateY(15%)}\ndetails>summary::after{content:\"\";width:1.25rem;height:1em;position:absolute;top:.3em;left:-1.25rem}\n.admonitionblock td.content>.title,.audioblock>.title,.exampleblock>.title,.imageblock>.title,.listingblock>.title,.literalblock>.title,.stemblock>.title,.openblock>.title,.paragraph>.title,.quoteblock>.title,table.tableblock>.title,.verseblock>.title,.videoblock>.title,.dlist>.title,.olist>.title,.ulist>.title,.qlist>.title,.hdlist>.title{text-rendering:optimizeLegibility;text-align:left;font-family:\"Noto Serif\",\"DejaVu Serif\",serif;font-size:1rem;font-style:italic}\ntable.tableblock.fit-content>caption.title{white-space:nowrap;width:0}\n.paragraph.lead>p,#preamble>.sectionbody>[class=paragraph]:first-of-type p{font-size:1.21875em;line-height:1.6;color:rgba(0,0,0,.85)}\n.admonitionblock>table{border-collapse:separate;border:0;background:none;width:100%}\n.admonitionblock>table td.icon{text-align:center;width:80px}\n.admonitionblock>table td.icon img{max-width:none}\n.admonitionblock>table td.icon .title{font-weight:bold;font-family:\"Open Sans\",\"DejaVu Sans\",sans-serif;text-transform:uppercase}\n.admonitionblock>table td.content{padding-left:1.125em;padding-right:1.25em;border-left:1px solid #dddddf;color:rgba(0,0,0,.6);word-wrap:anywhere}\n.admonitionblock>table td.content>:last-child>:last-child{margin-bottom:0}\n.exampleblock>.content{border:1px solid #e6e6e6;margin-bottom:1.25em;padding:1.25em;background:#fff;border-radius:4px}\n.sidebarblock{border:1px solid #dbdbd6;margin-bottom:1.25em;padding:1.25em;background:#f3f3f2;border-radius:4px}\n.sidebarblock>.content>.title{color:#7a2518;margin-top:0;text-align:center}\n.exampleblock>.content>:first-child,.sidebarblock>.content>:first-child{margin-top:0}\n.exampleblock>.content>:last-child,.exampleblock>.content>:last-child>:last-child,.exampleblock>.content .olist>ol>li:last-child>:last-child,.exampleblock>.content .ulist>ul>li:last-child>:last-child,.exampleblock>.content .qlist>ol>li:last-child>:last-child,.sidebarblock>.content>:last-child,.sidebarblock>.content>:last-child>:last-child,.sidebarblock>.content .olist>ol>li:last-child>:last-child,.sidebarblock>.content .ulist>ul>li:last-child>:last-child,.sidebarblock>.content .qlist>ol>li:last-child>:last-child{margin-bottom:0}\n.literalblock pre,.listingblock>.content>pre{border-radius:4px;overflow-x:auto;padding:1em;font-size:.8125em}\n@media screen and (min-width:768px){.literalblock pre,.listingblock>.content>pre{font-size:.90625em}}\n@media screen and (min-width:1280px){.literalblock pre,.listingblock>.content>pre{font-size:1em}}\n.literalblock pre,.listingblock>.content>pre:not(.highlight),.listingblock>.content>pre[class=highlight],.listingblock>.content>pre[class^=\"highlight \"]{background:#f7f7f8}\n.literalblock.output pre{color:#f7f7f8;background:rgba(0,0,0,.9)}\n.listingblock>.content{position:relative}\n.listingblock pre>code{display:block}\n.listingblock code[data-lang]::before{display:none;content:attr(data-lang);position:absolute;font-size:.75em;top:.425rem;right:.5rem;line-height:1;text-transform:uppercase;color:inherit;opacity:.5}\n.listingblock:hover code[data-lang]::before{display:block}\n.listingblock.terminal pre .command::before{content:attr(data-prompt);padding-right:.5em;color:inherit;opacity:.5}\n.listingblock.terminal pre .command:not([data-prompt])::before{content:\"$\"}\n.listingblock pre.highlightjs{padding:0}\n.listingblock pre.highlightjs>code{padding:1em;border-radius:4px}\n.listingblock pre.prettyprint{border-width:0}\n.prettyprint{background:#f7f7f8}\npre.prettyprint .linenums{line-height:1.45;margin-left:2em}\npre.prettyprint li{background:none;list-style-type:inherit;padding-left:0}\npre.prettyprint li code[data-lang]::before{opacity:1}\npre.prettyprint li:not(:first-child) code[data-lang]::before{display:none}\ntable.linenotable{border-collapse:separate;border:0;margin-bottom:0;background:none}\ntable.linenotable td[class]{color:inherit;vertical-align:top;padding:0;line-height:inherit;white-space:normal}\ntable.linenotable td.code{padding-left:.75em}\ntable.linenotable td.linenos,pre.pygments .linenos{border-right:1px solid;opacity:.35;padding-right:.5em;-webkit-user-select:none;-moz-user-select:none;-ms-user-select:none;user-select:none}\npre.pygments span.linenos{display:inline-block;margin-right:.75em}\n.quoteblock{margin:0 1em 1.25em 1.5em;display:table}\n.quoteblock:not(.excerpt)>.title{margin-left:-1.5em;margin-bottom:.75em}\n.quoteblock blockquote,.quoteblock p{color:rgba(0,0,0,.85);font-size:1.15rem;line-height:1.75;word-spacing:.1em;letter-spacing:0;font-style:italic;text-align:justify}\n.quoteblock blockquote{margin:0;padding:0;border:0}\n.quoteblock blockquote::before{content:\"\\201c\";float:left;font-size:2.75em;font-weight:bold;line-height:.6em;margin-left:-.6em;color:#7a2518;text-shadow:0 1px 2px rgba(0,0,0,.1)}\n.quoteblock blockquote>.paragraph:last-child p{margin-bottom:0}\n.quoteblock .attribution{margin-top:.75em;margin-right:.5ex;text-align:right}\n.verseblock{margin:0 1em 1.25em}\n.verseblock pre{font-family:\"Open Sans\",\"DejaVu Sans\",sans-serif;font-size:1.15rem;color:rgba(0,0,0,.85);font-weight:300;text-rendering:optimizeLegibility}\n.verseblock pre strong{font-weight:400}\n.verseblock .attribution{margin-top:1.25rem;margin-left:.5ex}\n.quoteblock .attribution,.verseblock .attribution{font-size:.9375em;line-height:1.45;font-style:italic}\n.quoteblock .attribution br,.verseblock .attribution br{display:none}\n.quoteblock .attribution cite,.verseblock .attribution cite{display:block;letter-spacing:-.025em;color:rgba(0,0,0,.6)}\n.quoteblock.abstract blockquote::before,.quoteblock.excerpt blockquote::before,.quoteblock .quoteblock blockquote::before{display:none}\n.quoteblock.abstract blockquote,.quoteblock.abstract p,.quoteblock.excerpt blockquote,.quoteblock.excerpt p,.quoteblock .quoteblock blockquote,.quoteblock .quoteblock p{line-height:1.6;word-spacing:0}\n.quoteblock.abstract{margin:0 1em 1.25em;display:block}\n.quoteblock.abstract>.title{margin:0 0 .375em;font-size:1.15em;text-align:center}\n.quoteblock.excerpt>blockquote,.quoteblock .quoteblock{padding:0 0 .25em 1em;border-left:.25em solid #dddddf}\n.quoteblock.excerpt,.quoteblock .quoteblock{margin-left:0}\n.quoteblock.excerpt blockquote,.quoteblock.excerpt p,.quoteblock .quoteblock blockquote,.quoteblock .quoteblock p{color:inherit;font-size:1.0625rem}\n.quoteblock.excerpt .attribution,.quoteblock .quoteblock .attribution{color:inherit;font-size:.85rem;text-align:left;margin-right:0}\np.tableblock:last-child{margin-bottom:0}\ntd.tableblock>.content{margin-bottom:1.25em;word-wrap:anywhere}\ntd.tableblock>.content>:last-child{margin-bottom:-1.25em}\ntable.tableblock,th.tableblock,td.tableblock{border:0 solid #dedede}\ntable.grid-all>*>tr>*{border-width:1px}\ntable.grid-cols>*>tr>*{border-width:0 1px}\ntable.grid-rows>*>tr>*{border-width:1px 0}\ntable.frame-all{border-width:1px}\ntable.frame-ends{border-width:1px 0}\ntable.frame-sides{border-width:0 1px}\ntable.frame-none>colgroup+*>:first-child>*,table.frame-sides>colgroup+*>:first-child>*{border-top-width:0}\ntable.frame-none>:last-child>:last-child>*,table.frame-sides>:last-child>:last-child>*{border-bottom-width:0}\ntable.frame-none>*>tr>:first-child,table.frame-ends>*>tr>:first-child{border-left-width:0}\ntable.frame-none>*>tr>:last-child,table.frame-ends>*>tr>:last-child{border-right-width:0}\ntable.stripes-all>*>tr,table.stripes-odd>*>tr:nth-of-type(odd),table.stripes-even>*>tr:nth-of-type(even),table.stripes-hover>*>tr:hover{background:#f8f8f7}\nth.halign-left,td.halign-left{text-align:left}\nth.halign-right,td.halign-right{text-align:right}\nth.halign-center,td.halign-center{text-align:center}\nth.valign-top,td.valign-top{vertical-align:top}\nth.valign-bottom,td.valign-bottom{vertical-align:bottom}\nth.valign-middle,td.valign-middle{vertical-align:middle}\ntable thead th,table tfoot th{font-weight:bold}\ntbody tr th{background:#f7f8f7}\ntbody tr th,tbody tr th p,tfoot tr th,tfoot tr th p{color:rgba(0,0,0,.8);font-weight:bold}\np.tableblock>code:only-child{background:none;padding:0}\np.tableblock{font-size:1em}\nol{margin-left:1.75em}\nul li ol{margin-left:1.5em}\ndl dd{margin-left:1.125em}\ndl dd:last-child,dl dd:last-child>:last-child{margin-bottom:0}\nli p,ul dd,ol dd,.olist .olist,.ulist .ulist,.ulist .olist,.olist .ulist{margin-bottom:.625em}\nul.checklist,ul.none,ol.none,ul.no-bullet,ol.no-bullet,ol.unnumbered,ul.unstyled,ol.unstyled{list-style-type:none}\nul.no-bullet,ol.no-bullet,ol.unnumbered{margin-left:.625em}\nul.unstyled,ol.unstyled{margin-left:0}\nli>p:empty:only-child::before{content:\"\";display:inline-block}\nul.checklist>li>p:first-child{margin-left:-1em}\nul.checklist>li>p:first-child>.fa-square-o:first-child,ul.checklist>li>p:first-child>.fa-check-square-o:first-child{width:1.25em;font-size:.8em;position:relative;bottom:.125em}\nul.checklist>li>p:first-child>input[type=checkbox]:first-child{margin-right:.25em}\nul.inline{display:flex;flex-flow:row wrap;list-style:none;margin:0 0 .625em -1.25em}\nul.inline>li{margin-left:1.25em}\n.unstyled dl dt{font-weight:400;font-style:normal}\nol.arabic{list-style-type:decimal}\nol.decimal{list-style-type:decimal-leading-zero}\nol.loweralpha{list-style-type:lower-alpha}\nol.upperalpha{list-style-type:upper-alpha}\nol.lowerroman{list-style-type:lower-roman}\nol.upperroman{list-style-type:upper-roman}\nol.lowergreek{list-style-type:lower-greek}\n.hdlist>table,.colist>table{border:0;background:none}\n.hdlist>table>tbody>tr,.colist>table>tbody>tr{background:none}\ntd.hdlist1,td.hdlist2{vertical-align:top;padding:0 .625em}\ntd.hdlist1{font-weight:bold;padding-bottom:1.25em}\ntd.hdlist2{word-wrap:anywhere}\n.literalblock+.colist,.listingblock+.colist{margin-top:-.5em}\n.colist td:not([class]):first-child{padding:.4em .75em 0;line-height:1;vertical-align:top}\n.colist td:not([class]):first-child img{max-width:none}\n.colist td:not([class]):last-child{padding:.25em 0}\n.thumb,.th{line-height:0;display:inline-block;border:4px solid #fff;box-shadow:0 0 0 1px #ddd}\n.imageblock.left{margin:.25em .625em 1.25em 0}\n.imageblock.right{margin:.25em 0 1.25em .625em}\n.imageblock>.title{margin-bottom:0}\n.imageblock.thumb,.imageblock.th{border-width:6px}\n.imageblock.thumb>.title,.imageblock.th>.title{padding:0 .125em}\n.image.left,.image.right{margin-top:.25em;margin-bottom:.25em;display:inline-block;line-height:0}\n.image.left{margin-right:.625em}\n.image.right{margin-left:.625em}\na.image{text-decoration:none;display:inline-block}\na.image object{pointer-events:none}\nsup.footnote,sup.footnoteref{font-size:.875em;position:static;vertical-align:super}\nsup.footnote a,sup.footnoteref a{text-decoration:none}\nsup.footnote a:active,sup.footnoteref a:active,#footnotes .footnote a:first-of-type:active{text-decoration:underline}\n#footnotes{padding-top:.75em;padding-bottom:.75em;margin-bottom:.625em}\n#footnotes hr{width:20%;min-width:6.25em;margin:-.25em 0 .75em;border-width:1px 0 0}\n#footnotes .footnote{padding:0 .375em 0 .225em;line-height:1.3334;font-size:.875em;margin-left:1.2em;margin-bottom:.2em}\n#footnotes .footnote a:first-of-type{font-weight:bold;text-decoration:none;margin-left:-1.05em}\n#footnotes .footnote:last-of-type{margin-bottom:0}\n#content #footnotes{margin-top:-.625em;margin-bottom:0;padding:.75em 0}\ndiv.unbreakable{page-break-inside:avoid}\n.big{font-size:larger}\n.small{font-size:smaller}\n.underline{text-decoration:underline}\n.overline{text-decoration:overline}\n.line-through{text-decoration:line-through}\n.aqua{color:#00bfbf}\n.aqua-background{background:#00fafa}\n.black{color:#000}\n.black-background{background:#000}\n.blue{color:#0000bf}\n.blue-background{background:#0000fa}\n.fuchsia{color:#bf00bf}\n.fuchsia-background{background:#fa00fa}\n.gray{color:#606060}\n.gray-background{background:#7d7d7d}\n.green{color:#006000}\n.green-background{background:#007d00}\n.lime{color:#00bf00}\n.lime-background{background:#00fa00}\n.maroon{color:#600000}\n.maroon-background{background:#7d0000}\n.navy{color:#000060}\n.navy-background{background:#00007d}\n.olive{color:#606000}\n.olive-background{background:#7d7d00}\n.purple{color:#600060}\n.purple-background{background:#7d007d}\n.red{color:#bf0000}\n.red-background{background:#fa0000}\n.silver{color:#909090}\n.silver-background{background:#bcbcbc}\n.teal{color:#006060}\n.teal-background{background:#007d7d}\n.white{color:#bfbfbf}\n.white-background{background:#fafafa}\n.yellow{color:#bfbf00}\n.yellow-background{background:#fafa00}\nspan.icon>.fa{cursor:default}\na span.icon>.fa{cursor:inherit}\n.admonitionblock td.icon [class^=\"fa icon-\"]{font-size:2.5em;text-shadow:1px 1px 2px rgba(0,0,0,.5);cursor:default}\n.admonitionblock td.icon .icon-note::before{content:\"\\f05a\";color:#19407c}\n.admonitionblock td.icon .icon-tip::before{content:\"\\f0eb\";text-shadow:1px 1px 2px rgba(155,155,0,.8);color:#111}\n.admonitionblock td.icon .icon-warning::before{content:\"\\f071\";color:#bf6900}\n.admonitionblock td.icon .icon-caution::before{content:\"\\f06d\";color:#bf3400}\n.admonitionblock td.icon .icon-important::before{content:\"\\f06a\";color:#bf0000}\n.conum[data-value]{display:inline-block;color:#fff!important;background:rgba(0,0,0,.8);border-radius:50%;text-align:center;font-size:.75em;width:1.67em;height:1.67em;line-height:1.67em;font-family:\"Open Sans\",\"DejaVu Sans\",sans-serif;font-style:normal;font-weight:bold}\n.conum[data-value] *{color:#fff!important}\n.conum[data-value]+b{display:none}\n.conum[data-value]::after{content:attr(data-value)}\npre .conum[data-value]{position:relative;top:-.125em}\nb.conum *{color:inherit!important}\n.conum:not([data-value]):empty{display:none}\ndt,th.tableblock,td.content,div.footnote{text-rendering:optimizeLegibility}\nh1,h2,p,td.content,span.alt,summary{letter-spacing:-.01em}\np strong,td.content strong,div.footnote strong{letter-spacing:-.005em}\np,blockquote,dt,td.content,td.hdlist1,span.alt,summary{font-size:1.0625rem}\np{margin-bottom:1.25rem}\n.sidebarblock p,.sidebarblock dt,.sidebarblock td.content,p.tableblock{font-size:1em}\n.exampleblock>.content{background:#fffef7;border-color:#e0e0dc;box-shadow:0 1px 4px #e0e0dc}\n.print-only{display:none!important}\n@page{margin:1.25cm .75cm}\n@media print{*{box-shadow:none!important;text-shadow:none!important}\n  html{font-size:80%}\n  a{color:inherit!important;text-decoration:underline!important}\n  a.bare,a[href^=\"#\"],a[href^=\"mailto:\"]{text-decoration:none!important}\n  a[href^=\"http:\"]:not(.bare)::after,a[href^=\"https:\"]:not(.bare)::after{content:\"(\" attr(href) \")\";display:inline-block;font-size:.875em;padding-left:.25em}\n  abbr[title]{border-bottom:1px dotted}\n  abbr[title]::after{content:\" (\" attr(title) \")\"}\n  pre,blockquote,tr,img,object,svg{page-break-inside:avoid}\n  thead{display:table-header-group}\n  svg{max-width:100%}\n  p,blockquote,dt,td.content{font-size:1em;orphans:3;widows:3}\n  h2,h3,#toctitle,.sidebarblock>.content>.title{page-break-after:avoid}\n  #header,#content,#footnotes,#footer{max-width:none}\n  #toc,.sidebarblock,.exampleblock>.content{background:none!important}\n  #toc{border-bottom:1px solid #dddddf!important;padding-bottom:0!important}\n  body.book #header{text-align:center}\n  body.book #header>h1:first-child{border:0!important;margin:2.5em 0 1em}\n  body.book #header .details{border:0!important;display:block;padding:0!important}\n  body.book #header .details span:first-child{margin-left:0!important}\n  body.book #header .details br{display:block}\n  body.book #header .details br+span::before{content:none!important}\n  body.book #toc{border:0!important;text-align:left!important;padding:0!important;margin:0!important}\n  body.book #toc,body.book #preamble,body.book h1.sect0,body.book .sect1>h2{page-break-before:always}\n  .listingblock code[data-lang]::before{display:block}\n  #footer{padding:0 .9375em}\n  .hide-on-print{display:none!important}\n  .print-only{display:block!important}\n  .hide-for-print{display:none!important}\n  .show-for-print{display:inherit!important}}\n@media amzn-kf8,print{#header>h1:first-child{margin-top:1.25rem}\n  .sect1{padding:0!important}\n  .sect1+.sect1{border:0}\n  #footer{background:none}\n  #footer-text{color:rgba(0,0,0,.6);font-size:.9em}}\n@media amzn-kf8{#header,#content,#footnotes,#footer{padding:0}}";

// ESM port of lib/asciidoctor/stylesheets.rb
//
// Ruby-to-JavaScript notes:
//   - Singleton: Ruby @__instance__ = new → module-level instance exported as Stylesheets.instance
//   - primary_stylesheet_data memoisation: Ruby ||= → the CSS is a static import; no lazy load needed
//   - File.read(...).rstrip → CSS is inlined at build time in src/data/stylesheet-data.js
//   - STYLESHEETS_DIR = File.join(DATA_DIR, 'stylesheets') → not needed; CSS is a JS module
//   - coderay / pygments methods → omitted (SyntaxHighlighter.for not needed here)


class StylesheetsClass {
  static DEFAULT_STYLESHEET_NAME = 'asciidoctor.css'

  get primaryStylesheetName() {
    return StylesheetsClass.DEFAULT_STYLESHEET_NAME
  }

  async primaryStylesheetData() {
    return defaultStylesheetData
  }

  async embedPrimaryStylesheet() {
    return `<style>\n${defaultStylesheetData}\n</style>`
  }

  async writePrimaryStylesheet(stylesoutdir) {
    try {
      const { writeFile } = await import('node:fs/promises');
      const { join } = await import('node:path');
      await writeFile(
        join(stylesoutdir, StylesheetsClass.DEFAULT_STYLESHEET_NAME),
        defaultStylesheetData,
        'utf8'
      );
      return true
    } catch {
      return false
    }
  }
}

const Stylesheets = {
  instance: new StylesheetsClass(),
};

// ESM conversion of convert.rb
//
// Ruby-to-JavaScript notes:
//   - Ruby module methods on Asciidoctor → named exports convert() and convertFile()
//     (deprecated aliases: render, renderFile).
//   - Ruby File === input → duck-type: any object with a .path property is treated as a file.
//   - Ruby File.absolute_path / File.dirname / File.expand_path → node:path.resolve / .dirname.
//   - Ruby Dir.pwd → process.cwd().
//   - Ruby File.directory? → async _isDirectory() helper via node:fs/promises.
//   - Ruby File.file? → async _isFile() helper via node:fs/promises.
//   - Ruby File.write → async writeFile() via node:fs/promises.
//   - Ruby Helpers.mkdir_p → mkdirP() from helpers.js.
//   - Ruby Helpers.uriish? → isUriish() from helpers.js.
//   - Ruby Stylesheets.instance.write_primary_stylesheet → Stylesheets.instance.writePrimaryStylesheet() in stylesheets.js; returns false in browser environments.
//   - Ruby doc.syntax_highlighter → doc.syntaxHighlighter.
//   - Ruby syntax_hl.write_stylesheet? doc → syntaxHl.writeStylesheet(doc).
//   - Ruby syntax_hl.write_stylesheet doc, dir → syntaxHl.writeStylesheetToDisk(doc, dir).
//   - Ruby doc.normalize_system_path → doc.normalizeSystemPath.
//   - Ruby doc.attr? 'x' → doc.hasAttribute('x').
//   - Ruby doc.attr 'x' → doc.getAttribute('x').
//   - Ruby doc.basebackend? 'html' → doc.basebackend('html').
//   - The entire function is async because load() is async.


// ── convert ───────────────────────────────────────────────────────────────────

/**
 * Parse the AsciiDoc source input into a Document and convert it to the specified backend format.
 *
 * Accepts input as a Node.js Readable stream (or any object with a read() method), a String,
 * or a String Array. If the input is a file-like object with a `.path` property, it is treated
 * as a file: the output is written to a file adjacent to the input by default.
 *
 * If `to_file` is true or omitted and the input is a file-like object, the output is written
 * next to the input file. If `to_file` is a String path, the output is written there.
 * If `to_file` is false, the converted String is returned.
 * If `to_file` is `'/dev/null'`, the document is loaded but neither converted nor written.
 *
 * @param {string|string[]|object} input - the AsciiDoc source (String, Array, Readable, or
 *   file-like object with a `.path` property)
 * @param {object} [options={}] - a plain Object of options (mirrors Ruby API):
 *   - `to_file` {string|boolean|object} - String path, Boolean, stream object, or `'/dev/null'`
 *   - `to_dir` {string} - output directory
 *   - `mkdirs` {boolean} - create missing directories if true
 *   - `standalone` {boolean} - include header/footer
 *   - `header_footer` {boolean} - deprecated alias for `standalone`
 *   - `base_dir` {string} - base directory
 * @returns {Promise<import('./document.js').Document|string>} the Document if output was written to a file, otherwise the converted String
 */
async function convert(input, options = {}) {
  options = Object.assign({}, options);
  delete options.parse;
  const toDir = options.to_dir;
  delete options.to_dir;
  const mkdirs = options.mkdirs;
  delete options.mkdirs;

  let toFile = options.to_file;
  delete options.to_file;
  let siblingPath = null;
  let writeToTarget = null;
  let streamOutput = false;

  if (toFile === true || toFile == null) {
    writeToTarget = toDir || null;
    if (!writeToTarget && input && typeof input === 'object' && input.path) {
      const nodePath = await _requirePath();
      siblingPath = nodePath.resolve(input.path);
    }
    toFile = null;
  } else if (toFile === false) {
    toFile = null;
  } else if (toFile === '/dev/null') {
    return load$1(input, options)
  } else {
    if (typeof toFile === 'object' && typeof toFile.write === 'function') {
      streamOutput = true;
    } else {
      options.to_file = toFile;
      writeToTarget = toFile;
    }
  }

  // Normalise :header_footer → :standalone when writing to a target.
  if (!('standalone' in options)) {
    if (siblingPath || writeToTarget) {
      options.standalone =
        'header_footer' in options ? options.header_footer : true;
    } else if ('header_footer' in options) {
      options.standalone = options.header_footer;
    }
  }

  // NOTE outfile may be controlled by document attributes, so resolve outfile after loading.
  // NOTE the :to_dir option is always set when outputting to a file.
  // NOTE the :to_file option is only passed if assigned an explicit path.
  if (siblingPath) {
    const nodePath = await _requirePath();
    options.to_dir = nodePath.dirname(siblingPath);
  } else if (writeToTarget) {
    const nodePath = await _requirePath();
    if (toDir) {
      if (toFile) {
        options.to_dir = nodePath.dirname(nodePath.resolve(toDir, toFile));
      } else {
        options.to_dir = nodePath.resolve(toDir);
      }
    } else if (toFile) {
      options.to_dir = nodePath.dirname(nodePath.resolve(toFile));
    }
  }

  const doc = await load$1(input, options);

  let outfile, outdir;

  if (siblingPath) {
    const nodePath = await _requirePath();
    outdir = nodePath.dirname(siblingPath);
    outfile = nodePath.join(
      outdir,
      `${doc.attributes.docname}${doc.outfilesuffix}`
    );
    if (outfile === siblingPath) {
      throw new Error(
        `input file and output file cannot be the same: ${outfile}`
      )
    }
  } else if (writeToTarget) {
    const nodePath = await _requirePath();
    const workingDir = options.base_dir
      ? nodePath.resolve(options.base_dir)
      : process.cwd();
    // QUESTION should the jail be workingDir or doc.baseDir?
    const jail = doc.safe >= SafeMode.SAFE ? workingDir : null;

    if (toDir) {
      outdir = doc.normalizeSystemPath(toDir, workingDir, jail, {
        targetName: 'to_dir',
        recover: false,
      });
      if (toFile) {
        outfile = doc.normalizeSystemPath(toFile, outdir, null, {
          targetName: 'to_dir',
          recover: false,
        });
        // reestablish outdir as the final target directory (in case to_file had directory segments)
        outdir = nodePath.dirname(outfile);
      } else {
        outfile = nodePath.join(
          outdir,
          `${doc.attributes.docname}${doc.outfilesuffix}`
        );
      }
    } else if (toFile) {
      outfile = doc.normalizeSystemPath(toFile, workingDir, jail, {
        targetName: 'to_dir',
        recover: false,
      });
      // establish outdir as the final target directory (in case to_file had directory segments)
      outdir = nodePath.dirname(outfile);
    }

    if (input && typeof input === 'object' && input.path) {
      const absInputPath = nodePath.resolve(input.path);
      if (nodePath.normalize(outfile) === nodePath.normalize(absInputPath)) {
        throw new Error(
          `input file and output file cannot be the same: ${outfile}`
        )
      }
    }

    if (mkdirs) {
      await mkdirP(outdir);
    } else {
      if (!(await _isDirectory(outdir))) {
        // NOTE we intentionally refer to the directory as it was passed to the API
        throw new Error(
          `target directory does not exist: ${toDir} (hint: set mkdirs option)`
        )
      }
    }
  } else {
    // write to stream
    outfile = streamOutput ? toFile : null;
    outdir = null;
  }

  let output;
  if (outfile && !streamOutput) {
    output = await doc.convert({ outfile, outdir });
  } else {
    output = await doc.convert();
  }

  if (outfile) {
    await doc.write(output, outfile);

    // NOTE document cannot control this behavior if safe >= SafeMode.SERVER
    // NOTE skip if stylesdir is a URI
    if (
      !streamOutput &&
      doc.safe < SafeMode.SECURE &&
      doc.hasAttribute('linkcss') &&
      doc.hasAttribute('copycss') &&
      doc.basebackend('html') &&
      !(
        doc.getAttribute('stylesdir') && isUriish(doc.getAttribute('stylesdir'))
      )
    ) {
      let copyAsciidoctorStylesheet = false;
      let copyUserStylesheet = false;
      const stylesheet = doc.getAttribute('stylesheet');
      if (stylesheet != null) {
        if (DEFAULT_STYLESHEET_KEYS.has(stylesheet)) {
          copyAsciidoctorStylesheet = true;
        } else if (!isUriish(stylesheet)) {
          copyUserStylesheet = true;
        }
      }
      const syntaxHl = doc.syntaxHighlighter;
      const copySyntaxHlStylesheet = syntaxHl?.writeStylesheet(doc);

      if (
        copyAsciidoctorStylesheet ||
        copyUserStylesheet ||
        copySyntaxHlStylesheet
      ) {
        const stylesdir = doc.getAttribute('stylesdir');
        const stylesoutdir = doc.normalizeSystemPath(
          stylesdir,
          outdir,
          doc.safe >= SafeMode.SAFE ? outdir : null
        );
        if (mkdirs) {
          await mkdirP(stylesoutdir);
        } else {
          if (!(await _isDirectory(stylesoutdir))) {
            throw new Error(
              `target stylesheet directory does not exist: ${stylesoutdir} (hint: set mkdirs option)`
            )
          }
        }

        if (copyAsciidoctorStylesheet) {
          if (
            !(await Stylesheets.instance.writePrimaryStylesheet(stylesoutdir))
          ) {
            doc.logger.info(
              'skipping default stylesheet copy: filesystem writes are not supported in this environment'
            );
          }
        } else if (copyUserStylesheet) {
          let stylesheetSrc = doc.getAttribute('copycss');
          if (stylesheetSrc === '' || stylesheetSrc === true) {
            stylesheetSrc = doc.normalizeSystemPath(stylesheet);
          } else {
            // NOTE in this case, copycss is a source location (but cannot be a URI)
            stylesheetSrc = doc.normalizeSystemPath(String(stylesheetSrc));
          }
          const stylesheetDest = doc.normalizeSystemPath(
            stylesheet,
            stylesoutdir,
            doc.safe >= SafeMode.SAFE ? outdir : null
          );
          // NOTE don't warn if src can't be read and dest already exists (see #2323)
          if (stylesheetSrc !== stylesheetDest) {
            const warnOnFailure = !(await _isFile(stylesheetDest));
            const stylesheetData = await doc.readAsset(stylesheetSrc, {
              warnOnFailure,
              label: 'stylesheet',
            });
            if (stylesheetData) {
              const { writeFile } = await import('node:fs/promises');
              const nodePath = await _requirePath();
              const stylesheetOutdir = nodePath.dirname(stylesheetDest);
              if (
                stylesheetOutdir !== stylesoutdir &&
                !(await _isDirectory(stylesheetOutdir))
              ) {
                if (!mkdirs) {
                  throw new Error(
                    `target stylesheet directory does not exist: ${stylesheetOutdir} (hint: set mkdirs option)`
                  )
                }
                await mkdirP(stylesheetOutdir);
              }
              await writeFile(stylesheetDest, stylesheetData, 'utf8');
            }
          }
        }
        if (copySyntaxHlStylesheet) {
          await syntaxHl.writeStylesheetToDisk(doc, stylesoutdir);
        }
      }
    }
    return doc
  } else {
    return output
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * @internal
 * Lazily import node:path to avoid issues in browser / Opal environments.
 */
async function _requirePath() {
  return import('node:path')
}

/**
 * @internal
 * @param {string} dir
 * @returns {Promise<boolean>}
 */
async function _isDirectory(dir) {
  try {
    const { stat } = await import('node:fs/promises');
    return (await stat(dir)).isDirectory()
  } catch {
    return false
  }
}

/**
 * @internal
 * @param {string} path
 * @returns {Promise<boolean>}
 */
async function _isFile(path) {
  try {
    const { stat } = await import('node:fs/promises');
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

// ESM conversion of timings.rb
//
// Ruby-to-JavaScript notes:
//   - Process.clock_gettime(CLOCK_MONOTONIC) → performance.now() (ms, not s).
//     All stored values are in milliseconds.
//   - print_report writes to a stream; in JS the default is console.log.
//     Pass a { write(line) } object to customise the output destination.

class Timings {
  static create() {
    return new Timings()
  }

  constructor() {
    this._log = {};
    this._timers = {};
  }

  start(key) {
    this._timers[key] = this._now();
  }

  record(key) {
    this._log[key] = this._now() - (this._timers[key] ?? 0);
    delete this._timers[key];
  }

  time(...keys) {
    const total = keys.reduce((sum, key) => sum + (this._log[key] || 0), 0);
    return total > 0 ? total : null
  }

  read() {
    return this.time('read')
  }
  parse() {
    return this.time('parse')
  }
  readParse() {
    return this.time('read', 'parse')
  }
  convert() {
    return this.time('convert')
  }
  readParseConvert() {
    return this.time('read', 'parse', 'convert')
  }
  write() {
    return this.time('write')
  }
  total() {
    return this.time('read', 'parse', 'convert', 'write')
  }

  /**
   * Print a summary report.
   * @param {{ write?: (s: string) => void, log?: (s: string) => void }} [out=console] - Output sink.
   * @param {string|null} [subject=null] - Optional label for the input file.
   */
  printReport(out = console, subject = null) {
    const writeln =
      typeof out.write === 'function'
        ? (s) => out.write(`${s}\n`)
        : (s) => out.log(s);
    if (subject) writeln(`Input file: ${subject}`);
    writeln(
      `  Time to read and parse source: ${(this.readParse() ?? 0).toFixed(5)}`
    );
    writeln(`  Time to convert document: ${(this.convert() ?? 0).toFixed(5)}`);
    writeln(
      `  Total time (read, parse and convert): ${(this.readParseConvert() ?? 0).toFixed(5)}`
    );
  }

  _now() {
    return typeof performance !== 'undefined' ? performance.now() : Date.now()
  }
}

// ESM port of converter/html5.rb
//
// Ruby-to-JavaScript notes:
//   - @xml_mode / @void_element_slash → this._xmlMode / this._voidSlash
//   - Ruby symbol keys in QUOTE_TAGS → plain string keys
//   - node.attr?  → node.hasAttribute()
//   - node.option? → node.hasOption()
//   - node.title? → node.hasTitle()
//   - node.sections? → node.hasSections()
//   - node.blocks? → node.hasBlocks()
//   - node.footnotes? → node.hasFootnotes()
//   - node.noheader/notitle/nofooter → node.isNoheader()/isNotitle()/isNofooter()
//   - node.sections → node.sections() (method)
//   - await node.content() → await node.content() (method on Block/Document)
//   - alias convert_pass content_only → convert_pass delegates to this.contentOnly()
//   - Stylesheets.instance.primary_stylesheet_data → Stylesheets.instance.primaryStylesheetData() (camelCase, async)
//   - read_svg_contents uses readContents (supports local and remote URIs via allow-uri-read)


// ── Local regex constants ─────────────────────────────────────────────────────

const DropAnchorRx = /<(?:a\b[^>]*|\/a)>/g;
const LeadingAnchorsRx = /^(?:<a id="[^"]+"><\/a>)+/;
const StemBreakRx = / *\\\n(?:\\?\n)*|\n\n+/g;
// NOTE In JavaScript ^ matches start of string when the m flag is not set (same as Opal)
const SvgPreambleRx = /^[\s\S]*?(?=<svg[\s>])/;
const SvgStartTagRx = /^<svg(?:\s[^>]*)?>/;
const DimensionAttributeRx = /\s(?:width|height|style)=(["'])[\s\S]*?\1/g;

// ── Quote tag table ───────────────────────────────────────────────────────────

const QUOTE_TAGS$1 = {
  monospaced: ['<code>', '</code>', true],
  emphasis: ['<em>', '</em>', true],
  strong: ['<strong>', '</strong>', true],
  double: ['&#8220;', '&#8221;'],
  single: ['&#8216;', '&#8217;'],
  mark: ['<mark>', '</mark>', true],
  superscript: ['<sup>', '</sup>', true],
  subscript: ['<sub>', '</sub>', true],
  asciimath: ['\\$', '\\$'],
  latexmath: ['\\(', '\\)'],
};
const DEFAULT_QUOTE_TAG = ['', ''];

// ── Html5Converter ────────────────────────────────────────────────────────────

class Html5Converter extends ConverterBase {
  /**
   * Create a new Html5Converter instance.
   * @param {string} [backend='html5']
   * @param {Object} [opts={}]
   * @returns {Html5Converter}
   */
  static create(backend = 'html5', opts = {}) {
    return new this(backend, opts)
  }

  constructor(backend, opts = {}) {
    super(backend, opts);
    let syntax;
    if (opts.htmlsyntax === 'xml') {
      syntax = 'xml';
      this._xmlMode = true;
      this._voidSlash = '/';
    } else {
      syntax = 'html';
      this._xmlMode = false;
      this._voidSlash = '';
    }
    this.initBackendTraits({
      basebackend: 'html',
      filetype: 'html',
      htmlsyntax: syntax,
      outfilesuffix: '.html',
      supportsTemplates: true,
    });
  }

  async convert_document(node) {
    const slash = this._voidSlash;
    const br = `<br${slash}>`;
    let assetUriScheme = node.getAttribute('asset-uri-scheme', 'https');
    if (assetUriScheme) assetUriScheme = `${assetUriScheme}:`;
    const cdnBaseUrl = `${assetUriScheme}//cdnjs.cloudflare.com/ajax/libs`;
    const linkcss = node.hasAttribute('linkcss');
    const maxWidthAttr = node.hasAttribute('max-width')
      ? ` style="max-width: ${node.getAttribute('max-width')};"`
      : '';
    const result = ['<!DOCTYPE html>'];
    const langAttribute = node.hasAttribute('nolang')
      ? ''
      : ` lang="${node.getAttribute('lang', 'en')}"`;
    result.push(
      `<html${this._xmlMode ? ' xmlns="http://www.w3.org/1999/xhtml"' : ''}${langAttribute}>`
    );
    result.push(`<head>
<meta charset="${node.getAttribute('encoding', 'UTF-8')}"${slash}>
<meta http-equiv="X-UA-Compatible" content="IE=edge"${slash}>
<meta name="viewport" content="width=device-width, initial-scale=1.0"${slash}>`);
    let reproducible;
    if (!(reproducible = node.hasAttribute('reproducible'))) {
      result.push(
        `<meta name="generator" content="Asciidoctor.js ${node.getAttribute('asciidoctor-version')}"${slash}>`
      );
    }
    if (node.hasAttribute('app-name')) {
      result.push(
        `<meta name="application-name" content="${node.getAttribute('app-name')}"${slash}>`
      );
    }
    if (node.hasAttribute('description')) {
      result.push(
        `<meta name="description" content="${node.getAttribute('description')}"${slash}>`
      );
    }
    if (node.hasAttribute('keywords')) {
      result.push(
        `<meta name="keywords" content="${node.getAttribute('keywords')}"${slash}>`
      );
    }
    if (node.hasAttribute('authors')) {
      let authors = node.subReplacements(node.getAttribute('authors'));
      if (authors.includes('<')) authors = authors.replace(XmlSanitizeRx, '');
      result.push(`<meta name="author" content="${authors}"${slash}>`);
    }
    if (node.hasAttribute('copyright')) {
      result.push(
        `<meta name="copyright" content="${node.getAttribute('copyright')}"${slash}>`
      );
    }
    if (node.hasAttribute('favicon')) {
      // Access raw attribute value to detect empty string (set without value)
      let iconHref = 'favicon' in node.attributes ? node.attributes.favicon : '';
      let iconType;
      if (!iconHref) {
        iconHref = 'favicon.ico';
        iconType = 'image/x-icon';
      } else {
        const iconExt = extname(iconHref, null);
        if (iconExt) {
          iconType =
            iconExt === '.ico' ? 'image/x-icon' : `image/${iconExt.slice(1)}`;
        } else {
          iconType = 'image/x-icon';
        }
      }
      result.push(
        `<link rel="icon" type="${iconType}" href="${iconHref}"${slash}>`
      );
    }
    result.push(
      `<title>${node.doctitle({ sanitize: true, use_fallback: true })}</title>`
    );

    // Access raw attribute value; '' means "use default stylesheet"
    const stylesheetRawVal =
      'stylesheet' in node.attributes ? node.attributes.stylesheet : null;
    if (DEFAULT_STYLESHEET_KEYS.has(stylesheetRawVal)) {
      if (node.hasAttribute('webfonts')) {
        const webfonts = node.attributes.webfonts ?? '';
        const fontFamily =
          webfonts ||
          'Open+Sans:300,300italic,400,400italic,600,600italic%7CNoto+Serif:400,400italic,700,700italic%7CNoto+Sans+Mono:400,700';
        result.push(
          `<link rel="stylesheet" href="${assetUriScheme}//fonts.googleapis.com/css?family=${fontFamily}"${slash}>`
        );
      }
      if (linkcss) {
        result.push(
          `<link rel="stylesheet" href="${node.normalizeWebPath(DEFAULT_STYLESHEET_NAME, node.getAttribute('stylesdir'), false)}"${slash}>`
        );
      } else {
        result.push(
          `<style>\n${await Stylesheets.instance.primaryStylesheetData()}\n</style>`
        );
      }
    } else if (node.hasAttribute('stylesheet')) {
      if (linkcss) {
        result.push(
          `<link rel="stylesheet" href="${node.normalizeWebPath(node.getAttribute('stylesheet'), node.getAttribute('stylesdir'))}"${slash}>`
        );
      } else {
        const cssPath = node.normalizeSystemPath(
          node.getAttribute('stylesheet'),
          node.getAttribute('stylesdir')
        );
        const cssData =
          (await node.readAsset(cssPath, {
            warnOnFailure: true,
            label: 'stylesheet',
          })) ?? '';
        result.push(`<style>\n${cssData}\n</style>`);
      }
    }

    if (node.hasAttribute('icons', 'font')) {
      if (node.hasAttribute('iconfont-remote')) {
        const cdnUrl =
          node.getAttribute('iconfont-cdn') ??
          `${cdnBaseUrl}/font-awesome/${FONT_AWESOME_VERSION}/css/font-awesome.min.css`;
        result.push(`<link rel="stylesheet" href="${cdnUrl}"${slash}>`);
      } else {
        const iconfontStylesheet = `${node.getAttribute('iconfont-name', 'font-awesome')}.css`;
        result.push(
          `<link rel="stylesheet" href="${node.normalizeWebPath(iconfontStylesheet, node.getAttribute('stylesdir'), false)}"${slash}>`
        );
      }
    }

    const syntaxHl = node.syntaxHighlighter;
    let syntaxHlDocinfoHeadIdx;
    if (syntaxHl) {
      syntaxHlDocinfoHeadIdx = result.length;
      result.push(''); // placeholder; replaced or spliced out below
    }

    const docinfoContent = await node.docinfo();
    if (docinfoContent) result.push(docinfoContent);

    result.push('</head>');

    const idAttr = node.id ? ` id="${node.id}"` : '';
    const sectioned = node.hasSections();
    let classes;
    if (
      sectioned &&
      node.hasAttribute('toc-class') &&
      node.hasAttribute('toc') &&
      node.hasAttribute('toc-placement', 'auto')
    ) {
      classes = [
        node.doctype,
        node.getAttribute('toc-class'),
        `toc-${node.getAttribute('toc-position', 'header')}`,
      ];
    } else {
      classes = [node.doctype];
    }
    if (node.role) classes.push(node.role);
    result.push(`<body${idAttr} class="${classes.join(' ')}">`);

    const headerDocinfo = await node.docinfo('header');
    if (headerDocinfo) result.push(headerDocinfo);

    if (!node.isNoheader()) {
      result.push(`<div id="header"${maxWidthAttr}>`);
      if (node.doctype === 'manpage') {
        result.push(`<h1>${node.doctitle()} Manual Page</h1>`);
        if (
          sectioned &&
          node.hasAttribute('toc') &&
          node.hasAttribute('toc-placement', 'auto')
        ) {
          result.push(`<div id="toc" class="${node.getAttribute('toc-class', 'toc')}">
<div id="toctitle">${node.getAttribute('toc-title')}</div>
${await node.converter.convert(node, 'outline')}
</div>`);
        }
        if (node.hasAttribute('manpurpose'))
          result.push(this._generateMannameSection(node));
      } else {
        if (node.hasHeader()) {
          if (!node.isNotitle()) result.push(`<h1>${node.header.title}</h1>`);
          const details = [];
          let idx = 1;
          for (const author of node.authors()) {
            details.push(
              `<span id="author${idx > 1 ? idx : ''}" class="author">${node.subReplacements(author.name)}</span>${br}`
            );
            if (author.email) {
              details.push(
                `<span id="email${idx > 1 ? idx : ''}" class="email">${await node.subMacros(author.email)}</span>${br}`
              );
            }
            idx++;
          }
          if (node.hasAttribute('revnumber')) {
            const versionLabel = (
              node.getAttribute('version-label') || ''
            ).toLowerCase();
            details.push(
              `<span id="revnumber">${versionLabel} ${node.getAttribute('revnumber')}${node.hasAttribute('revdate') ? ',' : ''}</span>`
            );
          }
          if (node.hasAttribute('revdate')) {
            details.push(
              `<span id="revdate">${node.getAttribute('revdate')}</span>`
            );
          }
          if (node.hasAttribute('revremark')) {
            details.push(
              `${br}<span id="revremark">${node.getAttribute('revremark')}</span>`
            );
          }
          if (details.length > 0) {
            result.push('<div class="details">');
            result.push(...details);
            result.push('</div>');
          }
        }
        if (
          sectioned &&
          node.hasAttribute('toc') &&
          node.hasAttribute('toc-placement', 'auto')
        ) {
          result.push(`<div id="toc" class="${node.getAttribute('toc-class', 'toc')}">
<div id="toctitle">${node.getAttribute('toc-title')}</div>
${await node.converter.convert(node, 'outline')}
</div>`);
        }
      }
      result.push('</div>');
    }

    result.push(`<div id="content"${maxWidthAttr}>
${await node.content()}
</div>`);

    if (node.hasFootnotes() && !node.hasAttribute('nofootnotes')) {
      result.push(`<div id="footnotes"${maxWidthAttr}>
<hr${slash}>`);
      for (const footnote of node.footnotes) {
        result.push(`<div class="footnote" id="_footnotedef_${footnote.index}">
<a href="#_footnoteref_${footnote.index}">${footnote.index}</a>. ${footnote.text}
</div>`);
      }
      result.push('</div>');
    }

    if (!node.isNofooter()) {
      result.push(`<div id="footer"${maxWidthAttr}>`);
      result.push('<div id="footer-text">');
      if (node.hasAttribute('revnumber')) {
        result.push(
          `${node.getAttribute('version-label')} ${node.getAttribute('revnumber')}${br}`
        );
      }
      if (node.hasAttribute('last-update-label') && !reproducible) {
        result.push(
          `${node.getAttribute('last-update-label')} ${node.getAttribute('docdatetime')}`
        );
      }
      result.push('</div>');
      result.push('</div>');
    }

    // JavaScript (and auxiliary stylesheets) loaded at end of body for performance
    if (syntaxHl) {
      if (syntaxHl.hasDocinfo('head')) {
        result[syntaxHlDocinfoHeadIdx] = syntaxHl.docinfo('head', node, {
          cdn_base_url: cdnBaseUrl,
          linkcss,
          self_closing_tag_slash: slash,
        });
      } else {
        result.splice(syntaxHlDocinfoHeadIdx, 1);
      }
      if (syntaxHl.hasDocinfo('footer')) {
        result.push(
          syntaxHl.docinfo('footer', node, {
            cdn_base_url: cdnBaseUrl,
            linkcss,
            self_closing_tag_slash: slash,
          })
        );
      }
    }

    if (node.hasAttribute('stem')) {
      let eqnumsVal = node.getAttribute('eqnums', 'none');
      if (!eqnumsVal) eqnumsVal = 'AMS';
      const eqnumsOpt = ` equationNumbers: { autoNumber: "${eqnumsVal}" } `;
      // IMPORTANT inspect calls on delimiter arrays are intentional for JavaScript compat (emulates JSON.stringify)
      result.push(`<script type="text/x-mathjax-config">
MathJax.Hub.Config({
  messageStyle: "none",
  tex2jax: {
    inlineMath: [${JSON.stringify(INLINE_MATH_DELIMITERS.latexmath)}],
    displayMath: [${JSON.stringify(BLOCK_MATH_DELIMITERS.latexmath)}],
    ignoreClass: "nostem|nolatexmath"
  },
  asciimath2jax: {
    delimiters: [${JSON.stringify(BLOCK_MATH_DELIMITERS.asciimath)}],
    ignoreClass: "nostem|noasciimath"
  },
  TeX: {${eqnumsOpt}}
})
MathJax.Hub.Register.StartupHook("AsciiMath Jax Ready", function () {
  MathJax.InputJax.AsciiMath.postfilterHooks.Add(function (data, node) {
    if ((node = data.script.parentNode) && (node = node.parentNode) && node.classList.contains("stemblock")) {
      data.math.root.display = "block"
    }
    return data
  })
})
</script>
<script src="${cdnBaseUrl}/mathjax/${MATHJAX_VERSION}/MathJax.js?config=TeX-MML-AM_CHTML"></script>`);
    }

    const footerDocinfo = await node.docinfo('footer');
    if (footerDocinfo) result.push(footerDocinfo);

    result.push('</body>');
    result.push('</html>');
    return result.join(LF$1)
  }

  async convert_embedded(node) {
    const result = [];
    if (node.doctype === 'manpage') {
      if (!node.isNotitle()) {
        const idAttr = node.id ? ` id="${node.id}"` : '';
        result.push(`<h1${idAttr}>${node.doctitle()} Manual Page</h1>`);
      }
      if (node.hasAttribute('manpurpose'))
        result.push(this._generateMannameSection(node));
    } else if (node.hasHeader() && !node.isNotitle()) {
      const idAttr = node.id ? ` id="${node.id}"` : '';
      result.push(`<h1${idAttr}>${node.header.title}</h1>`);
    }

    if (node.hasSections() && node.hasAttribute('toc')) {
      const tocP = node.getAttribute('toc-placement');
      if (tocP !== 'macro' && tocP !== 'preamble') {
        result.push(`<div id="toc" class="toc">
<div id="toctitle">${node.getAttribute('toc-title')}</div>
${await node.converter.convert(node, 'outline')}
</div>`);
      }
    }

    result.push(await node.content());

    if (node.hasFootnotes() && !node.hasAttribute('nofootnotes')) {
      result.push(`<div id="footnotes">
<hr${this._voidSlash}>`);
      for (const footnote of node.footnotes) {
        result.push(`<div class="footnote" id="_footnotedef_${footnote.index}">
<a href="#_footnoteref_${footnote.index}">${footnote.index}</a>. ${footnote.text}
</div>`);
      }
      result.push('</div>');
    }

    return result.join(LF$1)
  }

  async convert_outline(node, opts = {}) {
    if (!node.hasSections()) return null
    const sections = node.sections();
    const parts = node.context === 'document' && node.isMultipart();
    const sectlevel = parts ? 0 : sections[0].level;
    const sectnumlevels =
      opts.sectnumlevels ??
      parseInt(node.document.attributes.sectnumlevels || 3, 10);

    let toclevels = opts.toclevels ?? null;
    if (toclevels == null) {
      const toclevelAttr = node.document.attributes.toclevels;
      if (toclevelAttr) {
        toclevels = parseInt(toclevelAttr, 10);
        if (toclevels < 1 && !parts) toclevels = 1;
      } else {
        toclevels = 2;
      }
    }

    const result = [`<ul class="sectlevel${sectlevel}">`];
    for (const section of sections) {
      const slevel = section.level;
      const stoclevels = section.hasAttribute('toclevels')
        ? parseInt(section.getAttribute('toclevels'), 10)
        : toclevels;
      if (slevel > stoclevels) continue

      let stitle;
      if (section.caption) {
        stitle = section.captionedTitle();
      } else if (section.numbered && slevel <= sectnumlevels) {
        if (slevel < 2 && node.document.doctype === 'book') {
          const sectname = section.sectname;
          if (sectname === 'chapter') {
            const signifier = node.document.attributes['chapter-signifier'];
            stitle = `${signifier ? `${signifier} ` : ''}${section.sectnum()} ${section.title}`;
          } else if (sectname === 'part') {
            const signifier = node.document.attributes['part-signifier'];
            stitle = `${signifier ? `${signifier} ` : ''}${section.sectnum(null, ':')} ${section.title}`;
          } else {
            stitle = `${section.sectnum()} ${section.title}`;
          }
        } else {
          stitle = `${section.sectnum()} ${section.title}`;
        }
      } else {
        stitle = section.title;
      }

      if (stitle?.includes('<a')) {
        stitle = stitle.replace(new RegExp(DropAnchorRx.source, 'g'), '');
      }

      const otag =
        slevel === sectlevel ? '<li>' : `<li class="sectlevel${slevel}">`;
      if (slevel < stoclevels) {
        const childTocLevel = await this.convert_outline(section, {
          toclevels: stoclevels,
          sectnumlevels,
        });
        if (childTocLevel) {
          result.push(`${otag}<a href="#${section.id}">${stitle}</a>`);
          result.push(childTocLevel);
          result.push('</li>');
          continue
        }
      }
      result.push(`${otag}<a href="#${section.id}">${stitle}</a></li>`);
    }
    result.push('</ul>');
    return result.join(LF$1)
  }

  async convert_section(node) {
    const docAttrs = node.document.attributes;
    const level = node.level;
    let title;
    if (node.caption) {
      title = node.captionedTitle();
    } else if (
      node.numbered &&
      level <= parseInt(docAttrs.sectnumlevels || 3, 10)
    ) {
      if (level < 2 && node.document.doctype === 'book') {
        const sectname = node.sectname;
        if (sectname === 'chapter') {
          const signifier = docAttrs['chapter-signifier'];
          title = `${signifier ? `${signifier} ` : ''}${node.sectnum()} ${node.title}`;
        } else if (sectname === 'part') {
          const signifier = docAttrs['part-signifier'];
          title = `${signifier ? `${signifier} ` : ''}${node.sectnum(null, ':')} ${node.title}`;
        } else {
          title = `${node.sectnum()} ${node.title}`;
        }
      } else {
        title = `${node.sectnum()} ${node.title}`;
      }
    } else {
      title = node.title;
    }

    let idAttr = '';
    if (node.id) {
      const id = node.id;
      idAttr = ` id="${id}"`;
      if ('sectlinks' in docAttrs) {
        let m;
        if (title.startsWith('<a ') && (m = title.match(LeadingAnchorsRx))) {
          title = `${m[0]}<a class="link" href="#${id}">${title.slice(m[0].length)}</a>`;
        } else {
          title = `<a class="link" href="#${id}">${title}</a>`;
        }
      }
      if ('sectanchors' in docAttrs) {
        if (docAttrs.sectanchors === 'after') {
          title = `${title}<a class="anchor" href="#${id}"></a>`;
        } else {
          title = `<a class="anchor" href="#${id}"></a>${title}`;
        }
      }
    }

    const role = node.role;
    if (level === 0) {
      return `<h1${idAttr} class="sect0${role ? ` ${role}` : ''}">${title}</h1>
${await node.content()}`
    }
    return `<div class="sect${level}${role ? ` ${role}` : ''}">
<h${level + 1}${idAttr}>${title}</h${level + 1}>
${
  level === 1
    ? `<div class="sectionbody">
${await node.content()}
</div>`
    : await node.content()
}
</div>`
  }

  async convert_admonition(node) {
    const idAttr = node.id ? ` id="${node.id}"` : '';
    const name = node.getAttribute('name');
    const titleElement = node.hasTitle()
      ? `<div class="title">${node.title}</div>\n`
      : '';
    let label;
    if (node.document.hasAttribute('icons')) {
      if (
        node.document.hasAttribute('icons', 'font') &&
        !node.hasAttribute('icon')
      ) {
        label = `<i class="fa icon-${name}" title="${node.getAttribute('textlabel')}"></i>`;
      } else {
        label = `<img src="${await node.iconUri(name)}" alt="${node.getAttribute('textlabel')}"${this._voidSlash}>`;
      }
    } else {
      label = `<div class="title">${node.getAttribute('textlabel')}</div>`;
    }
    return `<div${idAttr} class="admonitionblock ${name}${node.role ? ` ${node.role}` : ''}">
<table>
<tr>
<td class="icon">
${label}
</td>
<td class="content">
${titleElement}${await node.content()}
</td>
</tr>
</table>
</div>`
  }

  async convert_audio(node) {
    const xml = this._xmlMode;
    const idAttribute = node.id ? ` id="${node.id}"` : '';
    const classes = ['audioblock', node.role].filter(Boolean);
    const classAttribute = ` class="${classes.join(' ')}"`;
    const titleElement = node.hasTitle()
      ? `<div class="title">${node.title}</div>\n`
      : '';
    const startT = node.getAttribute('start');
    const endT = node.getAttribute('end');
    const timeAnchor =
      startT || endT ? `#t=${startT || ''}${endT ? `,${endT}` : ''}` : '';
    return `<div${idAttribute}${classAttribute}>
${titleElement}<div class="content">
<audio src="${node.mediaUri(node.getAttribute('target'))}${timeAnchor}"${node.hasOption('autoplay') ? this._appendBooleanAttr('autoplay', xml) : ''}${node.hasOption('nocontrols') ? '' : this._appendBooleanAttr('controls', xml)}${node.hasOption('loop') ? this._appendBooleanAttr('loop', xml) : ''}>
Your browser does not support the audio tag.
</audio>
</div>
</div>`
  }

  async convert_colist(node) {
    const result = [];
    const idAttribute = node.id ? ` id="${node.id}"` : '';
    const classes = ['colist', node.style, node.role].filter(Boolean);
    const classAttribute = ` class="${classes.join(' ')}"`;

    result.push(`<div${idAttribute}${classAttribute}>`);
    if (node.hasTitle()) result.push(`<div class="title">${node.title}</div>`);

    if (node.document.hasAttribute('icons')) {
      result.push('<table>');
      const fontIcons = node.document.hasAttribute('icons', 'font');
      let num = 0;
      for (const item of node.getItems()) {
        num++;
        let numLabel;
        if (fontIcons) {
          numLabel = `<i class="conum" data-value="${num}"></i><b>${num}</b>`;
        } else {
          numLabel = `<img src="${await node.iconUri(`callouts/${num}`)}" alt="${num}"${this._voidSlash}>`;
        }
        result.push(`<tr>
<td>${numLabel}</td>
<td>${item.getText()}${item.hasBlocks() ? LF$1 + (await item.content()) : ''}</td>
</tr>`);
      }
      result.push('</table>');
    } else {
      result.push('<ol>');
      for (const item of node.getItems()) {
        result.push(`<li>
<p>${item.getText()}</p>${item.hasBlocks() ? LF$1 + (await item.content()) : ''}
</li>`);
      }
      result.push('</ol>');
    }

    result.push('</div>');
    return result.join(LF$1)
  }

  async convert_dlist(node) {
    const result = [];
    const idAttribute = node.id ? ` id="${node.id}"` : '';
    let classes;
    switch (node.style) {
      case 'qanda':
        classes = ['qlist', 'qanda', node.role];
        break
      case 'horizontal':
        classes = ['hdlist', node.role];
        break
      default:
        classes = ['dlist', node.style, node.role];
    }
    const classAttribute = ` class="${classes.filter(Boolean).join(' ')}"`;

    result.push(`<div${idAttribute}${classAttribute}>`);
    if (node.hasTitle()) result.push(`<div class="title">${node.title}</div>`);

    switch (node.style) {
      case 'qanda':
        result.push('<ol>');
        for (const [terms, dd] of node.getItems()) {
          result.push('<li>');
          for (const dt of terms) {
            result.push(`<p><em>${dt.getText()}</em></p>`);
          }
          if (dd) {
            if (dd.hasText()) result.push(`<p>${dd.getText()}</p>`);
            if (dd.hasBlocks()) result.push(await dd.content());
          }
          result.push('</li>');
        }
        result.push('</ol>');
        break
      case 'horizontal': {
        const slash = this._voidSlash;
        result.push('<table>');
        if (node.hasAttribute('labelwidth') || node.hasAttribute('itemwidth')) {
          result.push('<colgroup>');
          const labelWidthAttr = node.hasAttribute('labelwidth')
            ? ` width="${node.getAttribute('labelwidth').replace(/%$/, '')}%"`
            : '';
          result.push(`<col${labelWidthAttr}${slash}>`);
          const itemWidthAttr = node.hasAttribute('itemwidth')
            ? ` width="${node.getAttribute('itemwidth').replace(/%$/, '')}%"`
            : '';
          result.push(`<col${itemWidthAttr}${slash}>`);
          result.push('</colgroup>');
        }
        for (const [terms, dd] of node.getItems()) {
          result.push('<tr>');
          result.push(
            `<td class="hdlist1${node.hasOption('strong') ? ' strong' : ''}">`
          );
          let firstTerm = true;
          for (const dt of terms) {
            if (!firstTerm) result.push(`<br${slash}>`);
            result.push(dt.getText());
            firstTerm = false;
          }
          result.push('</td>');
          result.push('<td class="hdlist2">');
          if (dd) {
            if (dd.hasText()) result.push(`<p>${dd.getText()}</p>`);
            if (dd.hasBlocks()) result.push(await dd.content());
          }
          result.push('</td>');
          result.push('</tr>');
        }
        result.push('</table>');
        break
      }
      default: {
        result.push('<dl>');
        const dtStyleAttribute = node.style ? '' : ' class="hdlist1"';
        for (const [terms, dd] of node.getItems()) {
          for (const dt of terms) {
            result.push(`<dt${dtStyleAttribute}>${dt.getText()}</dt>`);
          }
          if (!dd) continue
          result.push('<dd>');
          if (dd.hasText()) result.push(`<p>${dd.getText()}</p>`);
          if (dd.hasBlocks()) result.push(await dd.content());
          result.push('</dd>');
        }
        result.push('</dl>');
      }
    }

    result.push('</div>');
    return result.join(LF$1)
  }

  async convert_example(node) {
    const idAttribute = node.id ? ` id="${node.id}"` : '';
    if (node.hasOption('collapsible')) {
      const classAttribute = node.role ? ` class="${node.role}"` : '';
      const summaryElement = node.hasTitle()
        ? `<summary class="title">${node.title}</summary>`
        : '<summary class="title">Details</summary>';
      return `<details${idAttribute}${classAttribute}${node.hasOption('open') ? ' open' : ''}>
${summaryElement}
<div class="content">
${await node.content()}
</div>
</details>`
    }
    const titleElement = node.hasTitle()
      ? `<div class="title">${node.captionedTitle()}</div>\n`
      : '';
    const role = node.role;
    return `<div${idAttribute} class="exampleblock${role ? ` ${role}` : ''}">
${titleElement}<div class="content">
${await node.content()}
</div>
</div>`
  }

  async convert_floating_title(node) {
    const tagName = `h${node.level + 1}`;
    const idAttribute = node.id ? ` id="${node.id}"` : '';
    const classes = [node.style, node.role].filter(Boolean);
    return `<${tagName}${idAttribute} class="${classes.join(' ')}">${node.title}</${tagName}>`
  }

  async convert_image(node) {
    const target = node.getAttribute('target');
    const widthAttr = node.hasAttribute('width')
      ? ` width="${node.getAttribute('width')}"`
      : '';
    const heightAttr = node.hasAttribute('height')
      ? ` height="${node.getAttribute('height')}"`
      : '';
    const slash = this._voidSlash;
    let img, src;
    if (
      (node.hasAttribute('format', 'svg') ||
        target.includes('.svg') ||
        target.startsWith('data:image/svg+xml')) &&
      node.document.safe < SafeMode.SECURE
    ) {
      if (node.hasOption('inline')) {
        img =
          (await this.readSvgContents(node, target)) ||
          `<span class="alt">${node.getAlt()}</span>`;
      } else if (node.hasOption('interactive')) {
        const fallback = node.hasAttribute('fallback')
          ? `<img src="${await node.imageUri(node.getAttribute('fallback'))}" alt="${this._encodeAttrValue(node.getAlt())}"${widthAttr}${heightAttr}${slash}>`
          : `<span class="alt">${node.getAlt()}</span>`;
        src = await node.imageUri(target);
        img = `<object type="image/svg+xml" data="${src}"${widthAttr}${heightAttr}>${fallback}</object>`;
      } else {
        src = await node.imageUri(target);
        img = `<img src="${src}" alt="${this._encodeAttrValue(node.getAlt())}"${widthAttr}${heightAttr}${slash}>`;
      }
    } else {
      src = await node.imageUri(target);
      img = `<img src="${src}" alt="${this._encodeAttrValue(node.getAlt())}"${widthAttr}${heightAttr}${slash}>`;
    }

    if (node.hasAttribute('link')) {
      let hrefAttrVal = node.getAttribute('link');
      if (hrefAttrVal === 'self') hrefAttrVal = src;
      if (hrefAttrVal) {
        img = `<a class="image" href="${hrefAttrVal}"${this._appendLinkConstraintAttrs(node).join('')}>${img}</a>`;
      }
    }

    const idAttr = node.id ? ` id="${node.id}"` : '';
    const classes = ['imageblock'];
    if (node.hasAttribute('float')) classes.push(node.getAttribute('float'));
    if (node.hasAttribute('align'))
      classes.push(`text-${node.getAttribute('align')}`);
    if (node.role) classes.push(node.role);
    const classAttr = ` class="${classes.join(' ')}"`;
    const titleEl = node.hasTitle()
      ? `\n<div class="title">${node.captionedTitle()}</div>`
      : '';
    return `<div${idAttr}${classAttr}>
<div class="content">
${img}
</div>${titleEl}
</div>`
  }

  async convert_listing(node) {
    const nowrap =
      node.hasOption('nowrap') || !node.document.hasAttribute('prewrap');
    let preOpen, preClose, syntaxHl, lang, opts;
    if (node.style === 'source') {
      lang = node.getAttribute('language');
      syntaxHl = node.document.syntaxHighlighter;
      if (syntaxHl) {
        if (syntaxHl.handlesHighlighting()) {
          const docAttrs = node.document.attributes;
          opts = {
            css_mode: docAttrs[`${syntaxHl.name}-css`] || 'class',
            style: docAttrs[`${syntaxHl.name}-style`],
          };
        } else {
          opts = {};
        }
        opts.nowrap = nowrap;
      } else {
        preOpen = `<pre class="highlight${nowrap ? ' nowrap' : ''}"><code${lang ? ` class="language-${lang}" data-lang="${lang}"` : ''}>`;
        preClose = '</code></pre>';
      }
    } else {
      preOpen = `<pre${nowrap ? ' class="nowrap"' : ''}>`;
      preClose = '</pre>';
    }
    const idAttribute = node.id ? ` id="${node.id}"` : '';
    const titleElement = node.hasTitle()
      ? `<div class="title">${node.captionedTitle()}</div>\n`
      : '';
    const role = node.role;
    const inner = syntaxHl
      ? await syntaxHl.format(node, lang, opts)
      : `${preOpen}${await node.content()}${preClose}`;
    return `<div${idAttribute} class="listingblock${role ? ` ${role}` : ''}">
${titleElement}<div class="content">
${inner}
</div>
</div>`
  }

  async convert_literal(node) {
    const idAttribute = node.id ? ` id="${node.id}"` : '';
    const titleElement = node.hasTitle()
      ? `<div class="title">${node.title}</div>\n`
      : '';
    const nowrap =
      !node.document.hasAttribute('prewrap') || node.hasOption('nowrap');
    const role = node.role;
    return `<div${idAttribute} class="literalblock${role ? ` ${role}` : ''}">
${titleElement}<div class="content">
<pre${nowrap ? ' class="nowrap"' : ''}>${await node.content()}</pre>
</div>
</div>`
  }

  async convert_stem(node) {
    const idAttribute = node.id ? ` id="${node.id}"` : '';
    const titleElement = node.hasTitle()
      ? `<div class="title">${node.title}</div>\n`
      : '';
    const style = node.style;
    const [open, close] = BLOCK_MATH_DELIMITERS[style] ?? ['', ''];
    let equation = await node.content();
    if (equation) {
      if (style === 'asciimath' && equation.includes(LF$1)) {
        const br = `${LF$1}<br${this._voidSlash}>`;
        equation = equation.replace(StemBreakRx, (match) => {
          const newlineCount = (match.match(/\n/g) || []).length;
          // Blank lines (\n\n+) produce newlineCount <br>; escaped newlines produce newlineCount - 1.
          const brCount = match[0] === '\n' ? newlineCount : newlineCount - 1;
          return `${close}${br.repeat(brCount)}${LF$1}${open}`
        });
      }
      if (!equation.startsWith(open) || !equation.endsWith(close)) {
        equation = `${open}${equation}${close}`;
      }
    } else {
      equation = '';
    }
    const role = node.role;
    return `<div${idAttribute} class="stemblock${role ? ` ${role}` : ''}">
${titleElement}<div class="content">
${equation}
</div>
</div>`
  }

  async convert_olist(node) {
    const result = [];
    const idAttribute = node.id ? ` id="${node.id}"` : '';
    const classes = ['olist', node.style, node.role].filter(Boolean);
    const classAttribute = ` class="${classes.join(' ')}"`;

    result.push(`<div${idAttribute}${classAttribute}>`);
    if (node.hasTitle()) result.push(`<div class="title">${node.title}</div>`);

    const keyword = node.listMarkerKeyword();
    const typeAttribute = keyword ? ` type="${keyword}"` : '';
    const startAttribute = node.hasAttribute('start')
      ? ` start="${node.getAttribute('start')}"`
      : '';
    const reversedAttribute = node.hasOption('reversed')
      ? this._appendBooleanAttr('reversed', this._xmlMode)
      : '';
    result.push(
      `<ol class="${node.style}"${typeAttribute}${startAttribute}${reversedAttribute}>`
    );

    for (const item of node.getItems()) {
      if (item.id) {
        result.push(
          `<li id="${item.id}"${item.role ? ` class="${item.role}"` : ''}>`
        );
      } else if (item.role) {
        result.push(`<li class="${item.role}">`);
      } else {
        result.push('<li>');
      }
      result.push(`<p>${item.getText()}</p>`);
      if (item.hasBlocks()) result.push(await item.content());
      result.push('</li>');
    }

    result.push('</ol>');
    result.push('</div>');
    return result.join(LF$1)
  }

  async convert_open(node) {
    const style = node.style;
    if (style === 'abstract') {
      if (
        node.getParent() === node.document &&
        node.document.doctype === 'book'
      ) {
        this.logger.warn(
          'abstract block cannot be used in a document without a doctitle when doctype is book. Excluding block content.'
        );
        return ''
      }
      const idAttr = node.id ? ` id="${node.id}"` : '';
      const titleEl = node.hasTitle()
        ? `<div class="title">${node.title}</div>\n`
        : '';
      const role = node.role;
      return `<div${idAttr} class="quoteblock abstract${role ? ` ${role}` : ''}">
${titleEl}<blockquote>
${await node.content()}
</blockquote>
</div>`
    }
    if (
      style === 'partintro' &&
      (node.level > 0 ||
        node.getParent().context !== 'section' ||
        node.document.doctype !== 'book')
    ) {
      this.logger.error(
        'partintro block can only be used when doctype is book and must be a child of a book part. Excluding block content.'
      );
      return ''
    }
    const idAttr = node.id ? ` id="${node.id}"` : '';
    const titleEl = node.hasTitle()
      ? `<div class="title">${node.title}</div>\n`
      : '';
    const role = node.role;
    return `<div${idAttr} class="openblock${style && style !== 'open' ? ` ${style}` : ''}${role ? ` ${role}` : ''}">
${titleEl}<div class="content">
${await node.content()}
</div>
</div>`
  }

  async convert_page_break(_node) {
    return '<div class="page-break"></div>'
  }

  async convert_paragraph(node) {
    let attributes;
    if (node.role) {
      attributes = `${node.id ? ` id="${node.id}"` : ''} class="paragraph ${node.role}"`;
    } else if (node.id) {
      attributes = ` id="${node.id}" class="paragraph"`;
    } else {
      attributes = ' class="paragraph"';
    }
    if (node.hasTitle()) {
      return `<div${attributes}>
<div class="title">${node.title}</div>
<p>${await node.content()}</p>
</div>`
    }
    return `<div${attributes}>
<p>${await node.content()}</p>
</div>`
  }

  // alias convert_pass → content_only
  async convert_pass(node) {
    return this.contentOnly(node)
  }

  async convert_preamble(node) {
    let toc = '';
    const doc = node.document;
    if (
      doc.hasAttribute('toc-placement', 'preamble') &&
      doc.hasSections() &&
      doc.hasAttribute('toc')
    ) {
      toc = `
<div id="toc" class="${doc.getAttribute('toc-class', 'toc')}">
<div id="toctitle">${doc.getAttribute('toc-title')}</div>
${await doc.converter.convert(doc, 'outline')}
</div>`;
    }
    return `<div id="preamble">
<div class="sectionbody">
${await node.content()}
</div>${toc}
</div>`
  }

  async convert_quote(node) {
    const idAttribute = node.id ? ` id="${node.id}"` : '';
    const classes = ['quoteblock', node.role].filter(Boolean);
    const classAttribute = ` class="${classes.join(' ')}"`;
    const titleElement = node.hasTitle()
      ? `\n<div class="title">${node.title}</div>`
      : '';
    const attribution = node.hasAttribute('attribution')
      ? node.getAttribute('attribution')
      : null;
    const citetitle = node.hasAttribute('citetitle')
      ? node.getAttribute('citetitle')
      : null;
    let attributionElement = '';
    if (attribution || citetitle) {
      const citeElement = citetitle ? `<cite>${citetitle}</cite>` : '';
      const attributionText = attribution
        ? `&#8212; ${attribution}${citetitle ? `<br${this._voidSlash}>\n` : ''}`
        : '';
      attributionElement = `\n<div class="attribution">\n${attributionText}${citeElement}\n</div>`;
    }
    return `<div${idAttribute}${classAttribute}>${titleElement}
<blockquote>
${await node.content()}
</blockquote>${attributionElement}
</div>`
  }

  async convert_thematic_break(node) {
    const classAttribute = node.role ? ` class="${node.role}"` : '';
    return `<hr${classAttribute}${this._voidSlash}>`
  }

  async convert_sidebar(node) {
    const idAttribute = node.id ? ` id="${node.id}"` : '';
    const titleElement = node.hasTitle()
      ? `<div class="title">${node.title}</div>\n`
      : '';
    const role = node.role;
    return `<div${idAttribute} class="sidebarblock${role ? ` ${role}` : ''}">
<div class="content">
${titleElement}${await node.content()}
</div>
</div>`
  }

  async convert_table(node) {
    const result = [];
    const idAttribute = node.id ? ` id="${node.id}"` : '';
    let frame = node.getAttribute('frame', 'all', 'table-frame');
    if (frame === 'topbot') frame = 'ends';
    const classes = [
      'tableblock',
      `frame-${frame}`,
      `grid-${node.getAttribute('grid', 'all', 'table-grid')}`,
    ];
    const stripes = node.getAttribute('stripes', null, 'table-stripes');
    if (stripes) classes.push(`stripes-${stripes}`);
    let widthAttribute = '';
    const autowidth = node.hasOption('autowidth');
    if (autowidth && !node.hasAttribute('width')) {
      classes.push('fit-content');
    } else {
      const tablewidth = node.getAttribute('tablepcwidth');
      if (Number(tablewidth) === 100) {
        classes.push('stretch');
      } else {
        widthAttribute = ` width="${tablewidth}%"`;
      }
    }
    if (node.hasAttribute('float')) classes.push(node.getAttribute('float'));
    if (node.role) classes.push(node.role);
    const classAttribute = ` class="${classes.join(' ')}"`;

    result.push(`<table${idAttribute}${classAttribute}${widthAttribute}>`);
    if (node.hasTitle())
      result.push(`<caption class="title">${node.captionedTitle()}</caption>`);

    if (node.getAttribute('rowcount') > 0) {
      const slash = this._voidSlash;
      result.push('<colgroup>');
      if (autowidth) {
        for (let i = 0; i < node.columns.length; i++)
          result.push(`<col${slash}>`);
      } else {
        for (const col of node.columns) {
          result.push(
            col.hasOption('autowidth')
              ? `<col${slash}>`
              : `<col width="${col.getAttribute('colpcwidth')}%"${slash}>`
          );
        }
      }
      result.push('</colgroup>');

      for (const [tsec, rows] of node.rows.bySection()) {
        if (rows.length === 0) continue
        result.push(`<t${tsec}>`);
        for (const row of rows) {
          result.push('<tr>');
          for (const cell of row) {
            let cellContent;
            if (tsec === 'head') {
              cellContent = cell.text;
            } else {
              switch (cell.style) {
                case 'asciidoc':
                  cellContent = `<div class="content">${await cell.content()}</div>`;
                  break
                case 'literal':
                  cellContent = `<div class="literal"><pre>${cell.text}</pre></div>`;
                  break
                default: {
                  const parts = await cell.content();
                  cellContent =
                    parts.length === 0
                      ? ''
                      : `<p class="tableblock">${parts.join('</p>\n<p class="tableblock">')}</p>`;
                }
              }
            }
            const cellTagName =
              tsec === 'head' || cell.style === 'header' ? 'th' : 'td';
            const cellClassAttr = ` class="tableblock halign-${cell.getAttribute('halign')} valign-${cell.getAttribute('valign')}"`;
            const cellColspanAttr = cell.colspan
              ? ` colspan="${cell.colspan}"`
              : '';
            const cellRowspanAttr = cell.rowspan
              ? ` rowspan="${cell.rowspan}"`
              : '';
            // Use the per-cell captured cellbgcolor (set by {set:cellbgcolor:...} in cell text
            // during precomputeText). Fall back to the current document attribute if not captured.
            const cellbgcolor =
              '_cellbgcolor' in cell
                ? cell._cellbgcolor
                : node.document.attributes.cellbgcolor;
            const cellStyleAttr = cellbgcolor
              ? ` style="background-color: ${cellbgcolor};"`
              : '';
            result.push(
              `<${cellTagName}${cellClassAttr}${cellColspanAttr}${cellRowspanAttr}${cellStyleAttr}>${cellContent}</${cellTagName}>`
            );
          }
          result.push('</tr>');
        }
        result.push(`</t${tsec}>`);
      }
    }
    result.push('</table>');
    return result.join(LF$1)
  }

  async convert_toc(node) {
    const doc = node.document;
    if (
      !doc.hasAttribute('toc-placement', 'macro') ||
      !doc.hasSections() ||
      !doc.hasAttribute('toc')
    ) {
      return '<!-- toc disabled -->'
    }
    let idAttr, titleIdAttr;
    if (node.id) {
      idAttr = ` id="${node.id}"`;
      titleIdAttr = ` id="${node.id}title"`;
    } else {
      idAttr = ' id="toc"';
      titleIdAttr = ' id="toctitle"';
    }
    const title = node.hasTitle() ? node.title : doc.getAttribute('toc-title');
    const levels = node.hasAttribute('levels')
      ? parseInt(node.getAttribute('levels'), 10)
      : null;
    const role = node.hasRoleAttribute()
      ? node.role
      : doc.getAttribute('toc-class', 'toc');
    return `<div${idAttr} class="${role}">
<div${titleIdAttr} class="title">${title}</div>
${await doc.converter.convert(doc, 'outline', levels != null ? { toclevels: levels } : {})}
</div>`
  }

  async convert_ulist(node) {
    const result = [];
    const idAttribute = node.id ? ` id="${node.id}"` : '';
    const divClasses = ['ulist', node.style, node.role].filter(Boolean);
    let markerChecked = '';
    let markerUnchecked = '';
    let ulClassAttribute;
    const checklist = node.hasOption('checklist');
    if (checklist) {
      divClasses.splice(1, 0, 'checklist');
      ulClassAttribute = ' class="checklist"';
      if (node.hasOption('interactive')) {
        if (this._xmlMode) {
          markerChecked =
            '<input type="checkbox" data-item-complete="1" checked="checked"/> ';
          markerUnchecked = '<input type="checkbox" data-item-complete="0"/> ';
        } else {
          markerChecked =
            '<input type="checkbox" data-item-complete="1" checked> ';
          markerUnchecked = '<input type="checkbox" data-item-complete="0"> ';
        }
      } else if (node.document.hasAttribute('icons', 'font')) {
        markerChecked = '<i class="fa fa-check-square-o"></i> ';
        markerUnchecked = '<i class="fa fa-square-o"></i> ';
      } else {
        markerChecked = '&#10003; ';
        markerUnchecked = '&#10063; ';
      }
    } else {
      ulClassAttribute = node.style ? ` class="${node.style}"` : '';
    }
    result.push(`<div${idAttribute} class="${divClasses.join(' ')}">`);
    if (node.hasTitle()) result.push(`<div class="title">${node.title}</div>`);
    result.push(`<ul${ulClassAttribute}>`);

    for (const item of node.getItems()) {
      if (item.id) {
        result.push(
          `<li id="${item.id}"${item.role ? ` class="${item.role}"` : ''}>`
        );
      } else if (item.role) {
        result.push(`<li class="${item.role}">`);
      } else {
        result.push('<li>');
      }
      if (checklist && item.hasAttribute('checkbox')) {
        result.push(
          `<p>${item.hasAttribute('checked') ? markerChecked : markerUnchecked}${item.getText()}</p>`
        );
      } else {
        result.push(`<p>${item.getText()}</p>`);
      }
      if (item.hasBlocks()) result.push(await item.content());
      result.push('</li>');
    }

    result.push('</ul>');
    result.push('</div>');
    return result.join(LF$1)
  }

  async convert_verse(node) {
    const idAttribute = node.id ? ` id="${node.id}"` : '';
    const classes = ['verseblock', node.role].filter(Boolean);
    const classAttribute = ` class="${classes.join(' ')}"`;
    const titleElement = node.hasTitle()
      ? `\n<div class="title">${node.title}</div>`
      : '';
    const attribution = node.hasAttribute('attribution')
      ? node.getAttribute('attribution')
      : null;
    const citetitle = node.hasAttribute('citetitle')
      ? node.getAttribute('citetitle')
      : null;
    let attributionElement = '';
    if (attribution || citetitle) {
      const citeElement = citetitle ? `<cite>${citetitle}</cite>` : '';
      const attributionText = attribution
        ? `&#8212; ${attribution}${citetitle ? `<br${this._voidSlash}>\n` : ''}`
        : '';
      attributionElement = `\n<div class="attribution">\n${attributionText}${citeElement}\n</div>`;
    }
    return `<div${idAttribute}${classAttribute}>${titleElement}
<pre class="content">${await node.content()}</pre>${attributionElement}
</div>`
  }

  async convert_video(node) {
    const xml = this._xmlMode;
    const idAttribute = node.id ? ` id="${node.id}"` : '';
    const classes = ['videoblock'];
    if (node.hasAttribute('float')) classes.push(node.getAttribute('float'));
    if (node.hasAttribute('align'))
      classes.push(`text-${node.getAttribute('align')}`);
    if (node.role) classes.push(node.role);
    const classAttribute = ` class="${classes.join(' ')}"`;
    const titleElement = node.hasTitle()
      ? `\n<div class="title">${node.title}</div>`
      : '';
    const widthAttribute = node.hasAttribute('width')
      ? ` width="${node.getAttribute('width')}"`
      : '';
    const heightAttribute = node.hasAttribute('height')
      ? ` height="${node.getAttribute('height')}"`
      : '';

    switch (node.getAttribute('poster')) {
      case 'vimeo': {
        let assetUriScheme = node.document.getAttribute(
          'asset-uri-scheme',
          'https'
        );
        if (assetUriScheme) assetUriScheme = `${assetUriScheme}:`;
        const startAnchor = node.hasAttribute('start')
          ? `#at=${node.getAttribute('start')}`
          : '';
        const delimiter = ['?'];
        let [target, hash] = node.getAttribute('target').split('/', 2);
        hash ||= node.getAttribute('hash');
        const hashParam = hash ? `${delimiter.pop() || '&amp;'}h=${hash}` : '';
        const autoplayParam = node.hasOption('autoplay')
          ? `${delimiter.pop() || '&amp;'}autoplay=1`
          : '';
        const loopParam = node.hasOption('loop')
          ? `${delimiter.pop() || '&amp;'}loop=1`
          : '';
        const mutedParam = node.hasOption('muted')
          ? `${delimiter.pop() || '&amp;'}muted=1`
          : '';
        return `<div${idAttribute}${classAttribute}>${titleElement}
<div class="content">
<iframe${widthAttribute}${heightAttribute} src="${assetUriScheme}//player.vimeo.com/video/${target}${hashParam}${autoplayParam}${loopParam}${mutedParam}${startAnchor}" frameborder="0"${node.hasOption('nofullscreen') ? '' : this._appendBooleanAttr('allowfullscreen', xml)}></iframe>
</div>
</div>`
      }
      case 'youtube': {
        let assetUriScheme = node.document.getAttribute(
          'asset-uri-scheme',
          'https'
        );
        if (assetUriScheme) assetUriScheme = `${assetUriScheme}:`;
        const relParamVal = node.hasOption('related') ? 1 : 0;
        const startParam = node.hasAttribute('start')
          ? `&amp;start=${node.getAttribute('start')}`
          : '';
        const endParam = node.hasAttribute('end')
          ? `&amp;end=${node.getAttribute('end')}`
          : '';
        const autoplayParam = node.hasOption('autoplay')
          ? '&amp;autoplay=1'
          : '';
        const hasLoopParam = node.hasOption('loop');
        const loopParam = hasLoopParam ? '&amp;loop=1' : '';
        const muteParam = node.hasOption('muted') ? '&amp;mute=1' : '';
        const controlsParam = node.hasOption('nocontrols')
          ? '&amp;controls=0'
          : '';
        let fsParam, fsAttribute;
        if (node.hasOption('nofullscreen')) {
          fsParam = '&amp;fs=0';
          fsAttribute = '';
        } else {
          fsParam = '';
          fsAttribute = this._appendBooleanAttr('allowfullscreen', xml);
        }
        const modestParam = node.hasOption('modest')
          ? '&amp;modestbranding=1'
          : '';
        const themeParam = node.hasAttribute('theme')
          ? `&amp;theme=${node.getAttribute('theme')}`
          : '';
        const hlParam = node.hasAttribute('lang')
          ? `&amp;hl=${node.getAttribute('lang')}`
          : '';
        let [target, list] = node.getAttribute('target').split('/', 2);
        list ||= node.getAttribute('list');
        let listParam;
        if (list) {
          listParam = `&amp;list=${list}`;
        } else {
          let playlist;
          const videoParts = target.split(',');
          target = videoParts[0];
          playlist =
            videoParts.length > 1 ? videoParts.slice(1).join(',') : null;
          playlist ||= node.getAttribute('playlist');
          if (playlist) {
            listParam = `&amp;playlist=${target},${playlist}`;
          } else {
            listParam = hasLoopParam ? `&amp;playlist=${target}` : '';
          }
        }
        return `<div${idAttribute}${classAttribute}>${titleElement}
<div class="content">
<iframe${widthAttribute}${heightAttribute} src="${assetUriScheme}//www.youtube.com/embed/${target}?rel=${relParamVal}${startParam}${endParam}${autoplayParam}${loopParam}${muteParam}${controlsParam}${listParam}${fsParam}${modestParam}${themeParam}${hlParam}" frameborder="0"${fsAttribute}></iframe>
</div>
</div>`
      }
      case 'wistia': {
        let assetUriScheme = node.document.getAttribute(
          'asset-uri-scheme',
          'https'
        );
        if (assetUriScheme) assetUriScheme = `${assetUriScheme}:`;
        const delimiter = ['?'];
        const startAnchor = node.hasAttribute('start')
          ? `${delimiter.pop() || '&amp;'}time=${node.getAttribute('start')}`
          : '';
        const endVideoBehaviorParam = node.hasOption('loop')
          ? `${delimiter.pop() || '&amp;'}endVideoBehavior=loop`
          : node.hasOption('reset')
            ? `${delimiter.pop() || '&amp;'}endVideoBehavior=reset`
            : '';
        const target = node.getAttribute('target');
        const autoplayParam = node.hasOption('autoplay')
          ? `${delimiter.pop() || '&amp;'}autoPlay=true`
          : '';
        const mutedParam = node.hasOption('muted')
          ? `${delimiter.pop() || '&amp;'}muted=true`
          : '';
        return `<div${idAttribute}${classAttribute}>${titleElement}
<div class="content">
<iframe${widthAttribute}${heightAttribute} src="${assetUriScheme}//fast.wistia.com/embed/iframe/${target}${startAnchor}${autoplayParam}${endVideoBehaviorParam}${mutedParam}" frameborder="0"${node.hasOption('nofullscreen') ? '' : this._appendBooleanAttr('allowfullscreen', xml)} class="wistia_embed" name="wistia_embed"></iframe>
</div>
</div>`
      }
      default: {
        const posterVal = node.getAttribute('poster');
        const posterAttribute = !posterVal
          ? ''
          : ` poster="${node.mediaUri(posterVal)}"`;
        const preloadVal = node.getAttribute('preload');
        const preloadAttribute = !preloadVal ? '' : ` preload="${preloadVal}"`;
        const startT = node.getAttribute('start');
        const endT = node.getAttribute('end');
        const timeAnchor =
          startT || endT ? `#t=${startT || ''}${endT ? `,${endT}` : ''}` : '';
        return `<div${idAttribute}${classAttribute}>${titleElement}
<div class="content">
<video src="${node.mediaUri(node.getAttribute('target'))}${timeAnchor}"${widthAttribute}${heightAttribute}${posterAttribute}${node.hasOption('autoplay') ? this._appendBooleanAttr('autoplay', xml) : ''}${node.hasOption('muted') ? this._appendBooleanAttr('muted', xml) : ''}${node.hasOption('nocontrols') ? '' : this._appendBooleanAttr('controls', xml)}${node.hasOption('loop') ? this._appendBooleanAttr('loop', xml) : ''}${preloadAttribute}>
Your browser does not support the video tag.
</video>
</div>
</div>`
      }
    }
  }

  async convert_inline_anchor(node) {
    switch (node.type) {
      case 'xref': {
        let attrs, text;
        if (node.attributes.path) {
          attrs = this._appendLinkConstraintAttrs(
            node,
            node.role ? [` class="${node.role}"`] : []
          ).join('');
          text = node.text || node.attributes.path;
        } else {
          attrs = node.role ? ` class="${node.role}"` : '';
          if (!(text = node.text)) {
            const refs = (this._refs ??= node.document.catalog.refs);
            const refid = node.attributes.refid;
            let top;
            const ref =
              refs[refid] ??
              (!refid ? (top = this._getRootDocument(node)) : null);
            if (ref instanceof AbstractNode) {
              const resolvingSet = (this._resolvingXrefs ??= new Set());
              if (!resolvingSet.has(refid)) {
                resolvingSet.add(refid);
                const resolved = await ref.xreftext(
                  node.getAttribute('xrefstyle', null, true)
                );
                resolvingSet.delete(refid);
                if (resolved) {
                  text = resolved.includes('<a')
                    ? resolved.replace(new RegExp(DropAnchorRx.source, 'g'), '')
                    : resolved;
                } else {
                  text = top ? '[^top]' : `[${refid}]`;
                }
              } else {
                text = top ? '[^top]' : `[${refid}]`;
              }
            } else {
              text = `[${refid}]`;
            }
          }
        }
        return `<a href="${node.target}"${attrs}>${text}</a>`
      }
      case 'ref':
        return `<a id="${node.id}"></a>`
      case 'link': {
        const attrs = node.id ? [` id="${node.id}"`] : [];
        if (node.role) attrs.push(` class="${node.role}"`);
        if (node.hasAttribute('title'))
          attrs.push(` title="${node.getAttribute('title')}"`);
        return `<a href="${node.target}"${this._appendLinkConstraintAttrs(node, attrs).join('')}>${node.text ?? ''}</a>`
      }
      case 'bibref':
        return `<a id="${node.id}"></a>[${node.reftext || node.id}]`
      default:
        this.logger.warn(`unknown anchor type: ${node.type}`);
        return null
    }
  }

  async convert_inline_break(node) {
    return `${node.text}<br${this._voidSlash}>`
  }

  async convert_inline_button(node) {
    return `<b class="button">${node.text}</b>`
  }

  async convert_inline_callout(node) {
    if (node.document.hasAttribute('icons', 'font')) {
      return `<i class="conum" data-value="${node.text}"></i><b>(${node.text})</b>`
    }
    if (node.document.hasAttribute('icons')) {
      const src = await node.iconUri(`callouts/${node.text}`);
      return `<img src="${src}" alt="${node.text}"${this._voidSlash}>`
    }
    const guard = node.attributes.guard;
    if (Array.isArray(guard)) {
      return `&lt;!--<b class="conum">(${node.text})</b>--&gt;`
    }
    return `${guard ?? ''}<b class="conum">(${node.text})</b>`
  }

  async convert_inline_footnote(node) {
    const index = node.getAttribute('index');
    if (index) {
      if (node.type === 'xref') {
        return `<sup class="footnoteref">[<a class="footnote" href="#_footnotedef_${index}" title="View footnote.">${index}</a>]</sup>`
      }
      const idAttr = node.id ? ` id="_footnote_${node.id}"` : '';
      return `<sup class="footnote"${idAttr}>[<a id="_footnoteref_${index}" class="footnote" href="#_footnotedef_${index}" title="View footnote.">${index}</a>]</sup>`
    }
    if (node.type === 'xref') {
      return `<sup class="footnoteref red" title="Unresolved footnote reference.">[${node.text}]</sup>`
    }
    return null
  }

  async convert_inline_image(node) {
    const target = node.target;
    const type = node.type || 'image';
    let img, src;
    if (type === 'icon') {
      const icons = node.document.getAttribute('icons');
      if (icons === 'font') {
        let iClassAttrVal = `fa fa-${target}`;
        if (node.hasAttribute('size'))
          iClassAttrVal += ` fa-${node.getAttribute('size')}`;
        if (node.hasAttribute('flip')) {
          iClassAttrVal += ` fa-flip-${node.getAttribute('flip')}`;
        } else if (node.hasAttribute('rotate')) {
          iClassAttrVal += ` fa-rotate-${node.getAttribute('rotate')}`;
        }
        const titleAttr = node.hasAttribute('title')
          ? ` title="${node.getAttribute('title')}"`
          : '';
        img = `<i class="${iClassAttrVal}"${titleAttr}></i>`;
      } else if (icons != null) {
        let attrs = node.hasAttribute('width')
          ? ` width="${node.getAttribute('width')}"`
          : '';
        if (node.hasAttribute('height'))
          attrs += ` height="${node.getAttribute('height')}"`;
        if (node.hasAttribute('title'))
          attrs += ` title="${node.getAttribute('title')}"`;
        img = `<img src="${await node.iconUri(target)}" alt="${this._encodeAttrValue(node.getAlt())}"${attrs}${this._voidSlash}>`;
      } else {
        img = `[${node.getAlt()}&#93;`;
      }
    } else {
      let attrs = node.hasAttribute('width')
        ? ` width="${node.getAttribute('width')}"`
        : '';
      if (node.hasAttribute('height'))
        attrs += ` height="${node.getAttribute('height')}"`;
      if (node.hasAttribute('title'))
        attrs += ` title="${node.getAttribute('title')}"`;
      if (
        (node.hasAttribute('format', 'svg') ||
          target.includes('.svg') ||
          target.startsWith('data:image/svg+xml')) &&
        node.document.safe < SafeMode.SECURE
      ) {
        if (node.hasOption('inline')) {
          img =
            (await this.readSvgContents(node, target)) ||
            `<span class="alt">${node.getAlt()}</span>`;
        } else if (node.hasOption('interactive')) {
          const fallback = node.hasAttribute('fallback')
            ? `<img src="${await node.imageUri(node.getAttribute('fallback'))}" alt="${this._encodeAttrValue(node.getAlt())}"${attrs}${this._voidSlash}>`
            : `<span class="alt">${node.getAlt()}</span>`;
          src = await node.imageUri(target);
          img = `<object type="image/svg+xml" data="${src}"${attrs}>${fallback}</object>`;
        } else {
          src = await node.imageUri(target);
          img = `<img src="${src}" alt="${this._encodeAttrValue(node.getAlt())}"${attrs}${this._voidSlash}>`;
        }
      } else {
        src = await node.imageUri(target);
        img = `<img src="${src}" alt="${this._encodeAttrValue(node.getAlt())}"${attrs}${this._voidSlash}>`;
      }
    }

    if (node.hasAttribute('link')) {
      let hrefAttrVal = node.getAttribute('link');
      if (hrefAttrVal === 'self') hrefAttrVal = src;
      if (hrefAttrVal) {
        img = `<a class="image" href="${hrefAttrVal}"${this._appendLinkConstraintAttrs(node).join('')}>${img}</a>`;
      }
    }

    const idAttr = node.id ? ` id="${node.id}"` : '';
    let classAttrVal = type;
    const role = node.role;
    if (role) {
      classAttrVal = node.hasAttribute('float')
        ? `${classAttrVal} ${node.getAttribute('float')} ${role}`
        : `${classAttrVal} ${role}`;
    } else if (node.hasAttribute('float')) {
      classAttrVal = `${classAttrVal} ${node.getAttribute('float')}`;
    }
    return `<span${idAttr} class="${classAttrVal}">${img}</span>`
  }

  async convert_inline_indexterm(node) {
    return node.type === 'visible' ? node.text : ''
  }

  async convert_inline_kbd(node) {
    const keys = node.getAttribute('keys');
    if (keys.length === 1) {
      return `<kbd>${keys[0]}</kbd>`
    }
    return `<span class="keyseq"><kbd>${keys.join('</kbd>+<kbd>')}</kbd></span>`
  }

  async convert_inline_menu(node) {
    const caret = node.document.hasAttribute('icons', 'font')
      ? '&#160;<i class="fa fa-angle-right caret"></i> '
      : '&#160;<b class="caret">&#8250;</b> ';
    const submenuJoiner = `</b>${caret}<b class="submenu">`;
    const menu = node.getAttribute('menu');
    const submenus = node.getAttribute('submenus');
    if (!submenus || submenus.length === 0) {
      const menuitem = node.getAttribute('menuitem');
      if (menuitem) {
        return `<span class="menuseq"><b class="menu">${menu}</b>${caret}<b class="menuitem">${menuitem}</b></span>`
      }
      return `<b class="menuref">${menu}</b>`
    }
    return `<span class="menuseq"><b class="menu">${menu}</b>${caret}<b class="submenu">${submenus.join(submenuJoiner)}</b>${caret}<b class="menuitem">${node.getAttribute('menuitem')}</b></span>`
  }

  async convert_inline_quoted(node) {
    const [open, close, tag] = QUOTE_TAGS$1[node.type] ?? DEFAULT_QUOTE_TAG;
    if (node.id) {
      const classAttr = node.role ? ` class="${node.role}"` : '';
      if (tag) {
        return `${open.slice(0, -1)} id="${node.id}"${classAttr}>${node.text}${close}`
      }
      return `<span id="${node.id}"${classAttr}>${open}${node.text}${close}</span>`
    }
    if (node.role) {
      if (tag) {
        return `${open.slice(0, -1)} class="${node.role}">${node.text}${close}`
      }
      return `<span class="${node.role}">${open}${node.text}${close}</span>`
    }
    return `${open}${node.text}${close}`
  }

  // NOTE expose readSvgContents for Bespoke converter
  async readSvgContents(node, target) {
    // A data-URI carries the SVG in the target itself (e.g. an embedded diagram
    // produced with `:data-uri:`), so decode it directly rather than trying to
    // read it as a file or remote URI.
    let svg = target.startsWith('data:')
      ? this._decodeDataUri(target)
      : await node.readContents(target, {
          start: node.document.getAttribute('imagesdir'),
          normalize: true,
          label: 'SVG',
          warnIfEmpty: true,
        });
    if (!svg) return null
    if (!svg.startsWith('<svg')) svg = svg.replace(SvgPreambleRx, '');
    // Fix incomplete SVG start tag (missing closing >) by inserting > before the first child element.
    // This handles cases like: <svg width="500"\n<circle .../> where the > is missing.
    svg = svg.replace(
      /^(<svg\b[^<>]*?)(\s*<[^/!])/s,
      (_, pre, rest) => `${pre.trimEnd()}>${rest}`
    );
    let oldStartTag = null;
    let newStartTag = null;
    let startTagMatch = null;
    for (const dim of ['width', 'height']) {
      if (!node.hasAttribute(dim)) continue
      if (!newStartTag) {
        if (startTagMatch === null)
          startTagMatch = svg.match(SvgStartTagRx) || false;
        if (!startTagMatch) continue
        oldStartTag = startTagMatch[0];
        newStartTag = oldStartTag.replace(
          new RegExp(DimensionAttributeRx.source, 'g'),
          ''
        );
      }
      newStartTag = `${newStartTag.slice(0, -1)} ${dim}="${node.getAttribute(dim)}">`;
    }
    if (newStartTag) svg = `${newStartTag}${svg.slice(oldStartTag.length)}`;
    return svg
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  /**
   * Decode an inline `data:` URI to its text contents (e.g. an SVG document) so
   * an image whose target is a data-URI can be embedded inline. Supports both
   * Base64 (`;base64,`) and percent-encoded payloads. Returns null when the
   * payload is missing.
   *
   * @internal
   * @private
   */
  _decodeDataUri(target) {
    const comma = target.indexOf(',');
    if (comma === -1) return null
    const meta = target.slice('data:'.length, comma);
    const data = target.slice(comma + 1);
    if (/;base64\b/i.test(meta)) {
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      return new TextDecoder('utf-8').decode(bytes)
    }
    return decodeURIComponent(data)
  }

  /**
   * @internal
   * @private
   */
  _appendBooleanAttr(name, xml) {
    return xml ? ` ${name}="${name}"` : ` ${name}`
  }

  /**
   * @internal
   * @private
   */
  _appendLinkConstraintAttrs(node, attrs = []) {
    const rel = node.hasOption('nofollow') ? 'nofollow' : null;
    const window = node.attributes.window;
    if (window) {
      attrs.push(` target="${window}"`);
      if (window === '_blank' || node.hasOption('noopener')) {
        attrs.push(rel ? ` rel="${rel} noopener"` : ' rel="noopener"');
      }
    } else if (rel) {
      attrs.push(` rel="${rel}"`);
    }
    return attrs
  }

  /**
   * @internal
   * @private
   */
  _encodeAttrValue(val) {
    return val.includes('"') ? val.replace(/"/g, '&quot;') : val
  }

  /**
   * @internal
   * @private
   */
  _generateMannameSection(node) {
    let mannameTitle = node.getAttribute('manname-title', 'Name');
    const sections = node.sections();
    if (sections.length > 0) {
      const nextSectionTitle = sections[0].title;
      if (nextSectionTitle === nextSectionTitle.toUpperCase()) {
        mannameTitle = mannameTitle.toUpperCase();
      }
    }
    const mannameId = node.getAttribute('manname-id');
    const mannameIdAttr = mannameId ? ` id="${mannameId}"` : '';
    return `<h2${mannameIdAttr}>${mannameTitle}</h2>
<div class="sectionbody">
<p>${node.getAttribute('mannames').join(', ')} - ${node.getAttribute('manpurpose')}</p>
</div>`
  }

  /**
   * @internal
   * @private
   */
  _getRootDocument(node) {
    while ((node = node.document).isNested()) {
      node = node.parentDocument;
    }
    return node
  }
}

Html5Converter.registerFor('html5');

const html5 = /*#__PURE__*/Object.freeze({
  __proto__: null,
  default: Html5Converter
});

const ASCIIDOCTOR_CORE_VERSION = '2.0.26';

/**
 * Get the version of Asciidoctor.js.
 *
 * @returns {string} - the version of Asciidoctor.js
 */
function getVersion() {
  return packageJson.version
}

/**
 * Get Asciidoctor core version number.
 *
 * @returns {string} - the version of Asciidoctor core (Ruby)
 */
function getCoreVersion() {
  return ASCIIDOCTOR_CORE_VERSION
}

/**
 * Parse the AsciiDoc source input into a Document.
 *
 * @param {string|string[]|Buffer} input - the AsciiDoc source as a String, String Array, or Buffer
 * @param {Object} [options={}] - a plain object of options to control processing
 * @returns {Promise<Document>} - the parsed Document
 */
async function load(input, options = {}) {
  return load$1(input, options)
}

// Browser-specific asset reading via Fetch API.
//
// In a browser environment the document base directory is resolved as an HTTP URL,
// so "local" assets are served over HTTP rather than from the filesystem.
// This module provides a fetch-based fallback used by readContents when the
// resolved path is an HTTP/HTTPS URI (i.e. docdir was set to a browser URL).

/**
 * Fetch the text content of a URI.
 *
 * @param {string} uri - The URI to fetch.
 * @returns {Promise<string|null>} the response text, or null on failure.
 */
async function readBrowserAsset(uri) {
  try {
    const response = await fetch(uri);
    if (!response.ok) return null
    return response.text()
  } catch {
    return null
  }
}

const asset = /*#__PURE__*/Object.freeze({
  __proto__: null,
  readBrowserAsset: readBrowserAsset
});

// ESM conversion of converter/composite.rb
//
// Ruby-to-JavaScript notes:
//   - Ruby Hash.new { |h,k| h[k] = find_converter(k) } → Map with lazy population in converterFor().
//   - Ruby respond_to?(:composed) → typeof converter.composed === 'function'.
//   - Ruby raise → throw new Error(…).
//   - backend_traits_source keyword arg → options object { backendTraitsSource }.
//   - init_backend_traits(source.backend_traits) → this.initBackendTraits(source.backendInfo()).


// ── CompositeConverter ────────────────────────────────────────────────────────
// Delegates to the first converter in the chain that handles a given transform.

class CompositeConverter {
  constructor(backend, ...args) {
    // Last argument may be an options object { backendTraitsSource }
    let opts = {};
    if (
      args.length > 0 &&
      args[args.length - 1] !== null &&
      typeof args[args.length - 1] === 'object' &&
      !args[args.length - 1].convert
    ) {
      opts = args.pop();
    }
    this.backend = backend;
    this.converters = args;
    applyBackendTraits(this);
    for (const converter of this.converters) {
      if (typeof converter.composed === 'function') converter.composed(this);
    }
    if (opts.backendTraitsSource) {
      this.initBackendTraits(opts.backendTraitsSource.backendInfo());
    }
    this._converterCache = new Map();
  }

  /**
   * Delegates to the first converter that handles the given transform.
   * @param {object} node - the AbstractNode to convert
   * @param {string|null} [transform=null] - the optional transform (default: node.nodeName)
   * @param {object|null} [opts=null] - optional hints passed to the delegate's convert method
   * @returns {Promise<string>} the result from the delegate's convert method
   */
  convert(node, transform = null, opts = null) {
    const t = transform ?? node.nodeName;
    return this.converterFor(t).convert(node, t, opts)
  }

  /**
   * Retrieve the converter for the specified transform (cached).
   * @param {string} transform
   * @returns {object} the matching converter
   */
  converterFor(transform) {
    if (this._converterCache.has(transform))
      return this._converterCache.get(transform)
    const converter = this._findConverter(transform);
    this._converterCache.set(transform, converter);
    return converter
  }

  /**
   * Find the converter for the specified transform.
   * @param {string} transform
   * @returns {object} the matching converter
   * @throws {Error} if no converter handles the transform
   * @internal
   */
  _findConverter(transform) {
    for (const candidate of this.converters) {
      if (
        typeof candidate.handles === 'function' &&
        candidate.handles(transform)
      )
        return candidate
    }
    throw new Error(
      `Could not find a converter to handle transform: ${transform}`
    )
  }
}

const composite = /*#__PURE__*/Object.freeze({
  __proto__: null,
  CompositeConverter: CompositeConverter
});

class TemplateConverter { static async create() { throw new Error("TemplateConverter is not supported in browser environments") } }

const _browser_templateConverter = /*#__PURE__*/Object.freeze({
  __proto__: null,
  TemplateConverter: TemplateConverter
});

// ESM conversion of converter/docbook5.rb
// Translated from the Ruby Asciidoctor::Converter::DocBook5Converter.
// Translation notes:
//   - Ruby symbols (:compound) → strings ('compound')
//   - Ruby predicate methods (title?, attr?, option?, has_role?, blocks?) → hasTitle(), hasAttr(), hasOption(), hasRole(), hasBlocks()
//   - Ruby `node.image_uri` → `await node.imageUri()`; `node.icon_uri` → `await node.iconUri()`
//   - common_attributes(id, role, reftext) kept as private _commonAttributes(id, role, reftext)
//   - blockquote_tag uses a content callback instead of Ruby block
//   - Ruby LF constant → '\n'
//   - document.nested? → doc.isNested(); doc.noheader → doc.isNoheader(); doc.notitle → doc.isNotitle()


const LF = '\n';

// default represents variablelist
const DLIST_TAGS = {
  qanda: {
    list: 'qandaset',
    entry: 'qandaentry',
    label: 'question',
    term: 'simpara',
    item: 'answer',
  },
  glossary: {
    list: null,
    entry: 'glossentry',
    term: 'glossterm',
    item: 'glossdef',
  },
};
const DLIST_TAGS_DEFAULT = {
  list: 'variablelist',
  entry: 'varlistentry',
  term: 'term',
  item: 'listitem',
};

const QUOTE_TAGS = {
  monospaced: ['<literal>', '</literal>'],
  emphasis: ['<emphasis>', '</emphasis>', true],
  strong: ['<emphasis role="strong">', '</emphasis>', true],
  double: ['<quote role="double">', '</quote>', true],
  single: ['<quote role="single">', '</quote>', true],
  mark: ['<emphasis role="marked">', '</emphasis>'],
  superscript: ['<superscript>', '</superscript>'],
  subscript: ['<subscript>', '</subscript>'],
};
const QUOTE_TAGS_DEFAULT = ['', '', true];

const MANPAGE_SECTION_TAGS = {
  section: 'refsection',
  synopsis: 'refsynopsisdiv',
};
const TABLE_PI_NAMES = ['dbhtml', 'dbfo', 'dblatex'];

const CopyrightRx = /^(.+?)(?: ((?:\d{4}-)?\d{4}))?$/;

class DocBook5Converter extends ConverterBase {
  constructor(backend, opts = {}) {
    super(backend, opts);
  }

  async convert_document(node) {
    const result = ['<?xml version="1.0" encoding="UTF-8"?>'];
    if (node.hasAttribute('toc')) {
      result.push(
        node.hasAttribute('toclevels')
          ? `<?asciidoc-toc maxdepth="${node.getAttribute('toclevels')}"?>`
          : '<?asciidoc-toc?>'
      );
    }
    if (node.hasAttribute('sectnums')) {
      result.push(
        node.hasAttribute('sectnumlevels')
          ? `<?asciidoc-numbered maxdepth="${node.getAttribute('sectnumlevels')}"?>`
          : '<?asciidoc-numbered?>'
      );
    }
    const langAttribute = node.hasAttribute('nolang')
      ? ''
      : ` xml:lang="${node.getAttribute('lang', 'en')}"`;
    let rootTagName = node.doctype;
    let manpage = false;
    if (rootTagName === 'manpage') {
      manpage = true;
      rootTagName = 'article';
    }
    const rootTagIdx = result.length;
    const id = node.id;
    const abstract = this._findRootAbstract(node);
    if (!node.isNoheader())
      result.push(await this._documentInfoTag(node, abstract));
    if (manpage) {
      result.push('<refentry>');
      result.push('<refmeta>');
      if (node.hasAttribute('mantitle'))
        result.push(
          `<refentrytitle>${await node.applyReftextSubs(node.getAttribute('mantitle'))}</refentrytitle>`
        );
      if (node.hasAttribute('manvolnum'))
        result.push(`<manvolnum>${node.getAttribute('manvolnum')}</manvolnum>`);
      result.push(
        `<refmiscinfo class="source">${node.getAttribute('mansource', '&#160;')}</refmiscinfo>`
      );
      result.push(
        `<refmiscinfo class="manual">${node.getAttribute('manmanual', '&#160;')}</refmiscinfo>`
      );
      result.push('</refmeta>');
      result.push('<refnamediv>');
      if (node.hasAttribute('mannames')) {
        for (const n of node.getAttribute('mannames'))
          result.push(`<refname>${n}</refname>`);
      }
      if (node.hasAttribute('manpurpose'))
        result.push(
          `<refpurpose>${node.getAttribute('manpurpose')}</refpurpose>`
        );
      result.push('</refnamediv>');
    }
    const headerDocinfo = await node.docinfo('header');
    if (headerDocinfo) result.push(headerDocinfo);
    const extractedAbstract = abstract
      ? this._extractAbstract(node, abstract)
      : null;
    if (node.hasBlocks()) {
      const blockResults = [];
      for (const b of node.blocks) blockResults.push(await b.convert());
      result.push(blockResults.filter((s) => s != null).join(LF));
    }
    if (extractedAbstract) this._restoreAbstract(extractedAbstract);
    const footerDocinfo = await node.docinfo('footer');
    if (footerDocinfo) result.push(footerDocinfo);
    if (manpage) result.push('</refentry>');
    // defer adding root tag in case document ID is auto-generated on demand
    const nodeId = id ?? node.id ?? this._rootDocId;
    result.splice(
      rootTagIdx,
      0,
      `<${rootTagName} xmlns="http://docbook.org/ns/docbook" xmlns:xl="http://www.w3.org/1999/xlink" version="5.0"${langAttribute}${this._commonAttributes(nodeId)}>`
    );
    result.push(`</${rootTagName}>`);
    return result.join(LF)
  }

  async convert_embedded(node) {
    // NOTE in DocBook 5, the root abstract must be in the info tag and is thus not part of the body
    let abstract = null;
    if (this.backend === 'docbook5') {
      abstract = this._findRootAbstract(node);
      if (abstract) this._extractAbstract(node, abstract);
    }
    const blockParts = [];
    for (const b of node.blocks) blockParts.push(await b.convert());
    const result = blockParts.filter((s) => s != null).join(LF);
    if (abstract) this._restoreAbstract(abstract);
    return result
  }

  async convert_section(node) {
    let tagName = node.sectname;
    if (node.document.doctype === 'manpage') {
      tagName = MANPAGE_SECTION_TAGS[tagName] ?? tagName;
    }
    const titleEl =
      node.special && (node.hasOption('notitle') || node.hasOption('untitled'))
        ? ''
        : `<title>${node.title}</title>\n`;
    return `<${tagName}${this._commonAttributes(node.id, node.role, node.reftext)}>\n${titleEl}${await node.content()}\n</${tagName}>`
  }

  async convert_admonition(node) {
    const tagName = node.getAttribute('name');
    return `<${tagName}${this._commonAttributes(node.id, node.role, node.reftext)}>\n${this._titleTag(node)}${await this._encloseContent(node)}\n</${tagName}>`
  }

  async convert_audio(_node) {
    return ''
  }

  async convert_colist(node) {
    const result = [];
    result.push(
      `<calloutlist${this._commonAttributes(node.id, node.role, node.reftext)}>`
    );
    if (node.hasTitle()) result.push(`<title>${node.title}</title>`);
    for (const item of node.getItems()) {
      result.push(`<callout arearefs="${item.getAttribute('coids')}">`);
      result.push(`<para>${item.getText()}</para>`);
      if (item.hasBlocks()) result.push(await item.content());
      result.push('</callout>');
    }
    result.push('</calloutlist>');
    return result.join(LF)
  }

  async convert_dlist(node) {
    const result = [];
    if (node.style === 'horizontal') {
      const tagName = node.hasTitle() ? 'table' : 'informaltable';
      result.push(
        `<${tagName}${this._commonAttributes(node.id, node.role, node.reftext)} tabstyle="horizontal" frame="none" colsep="0" rowsep="0">`
      );
      result.push(`${this._titleTag(node)}<tgroup cols="2">`);
      result.push(
        `<colspec colwidth="${node.getAttribute('labelwidth', 15)}*"/>`
      );
      result.push(
        `<colspec colwidth="${node.getAttribute('itemwidth', 85)}*"/>`
      );
      result.push('<tbody valign="top">');
      for (const [terms, dd] of node.getItems()) {
        result.push('<row>\n<entry>');
        for (const dt of terms)
          result.push(`<simpara>${dt.getText()}</simpara>`);
        result.push('</entry>\n<entry>');
        if (dd) {
          if (dd.hasText()) result.push(`<simpara>${dd.getText()}</simpara>`);
          if (dd.hasBlocks()) result.push(await dd.content());
        }
        result.push('</entry>\n</row>');
      }
      result.push(`</tbody>\n</tgroup>\n</${tagName}>`);
    } else {
      const tags = DLIST_TAGS[node.style] ?? DLIST_TAGS_DEFAULT;
      const {
        list: listTag,
        entry: entryTag,
        label: labelTag,
        term: termTag,
        item: itemTag,
      } = tags;
      if (listTag) {
        result.push(
          `<${listTag}${this._commonAttributes(node.id, node.role, node.reftext)}>`
        );
        if (node.hasTitle()) result.push(`<title>${node.title}</title>`);
      }
      for (const [terms, dd] of node.getItems()) {
        result.push(`<${entryTag}>`);
        if (labelTag) result.push(`<${labelTag}>`);
        for (const dt of terms)
          result.push(`<${termTag}>${dt.getText()}</${termTag}>`);
        if (labelTag) result.push(`</${labelTag}>`);
        result.push(`<${itemTag}>`);
        if (dd) {
          if (dd.hasText()) result.push(`<simpara>${dd.getText()}</simpara>`);
          if (dd.hasBlocks()) result.push(await dd.content());
        }
        result.push(`</${itemTag}>`);
        result.push(`</${entryTag}>`);
      }
      if (listTag) result.push(`</${listTag}>`);
    }
    return result.join(LF)
  }

  async convert_example(node) {
    const commonAttrs = this._commonAttributes(node.id, node.role, node.reftext);
    if (node.hasTitle()) {
      return `<example${commonAttrs}>\n<title>${node.title}</title>\n${await this._encloseContent(node)}\n</example>`
    }
    return `<informalexample${commonAttrs}>\n${await this._encloseContent(node)}\n</informalexample>`
  }

  async convert_floating_title(node) {
    return `<bridgehead${this._commonAttributes(node.id, node.role, node.reftext)} renderas="sect${node.level}">${node.title}</bridgehead>`
  }

  async convert_image(node) {
    const alignAttribute = node.hasAttribute('align')
      ? ` align="${node.getAttribute('align')}"`
      : '';
    const mediaobject = `<mediaobject>\n<imageobject>\n<imagedata fileref="${await node.imageUri(node.getAttribute('target'))}"${this._imageSizeAttributes(node.attributes)}${alignAttribute}/>\n</imageobject>\n<textobject><phrase>${node.getAlt()}</phrase></textobject>\n</mediaobject>`;
    const commonAttrs = this._commonAttributes(node.id, node.role, node.reftext);
    if (node.hasTitle()) {
      return `<figure${commonAttrs}>\n<title>${node.title}</title>\n${mediaobject}\n</figure>`
    }
    return `<informalfigure${commonAttrs}>\n${mediaobject}\n</informalfigure>`
  }

  async convert_listing(node) {
    const informal = !node.hasTitle();
    const commonAttrs = this._commonAttributes(node.id, node.role, node.reftext);
    let wrappedContent;
    if (node.style === 'source') {
      const attrs = node.attributes;
      let numberingAttrs;
      if (node.hasOption('linenums')) {
        numberingAttrs =
          'start' in attrs
            ? ` linenumbering="numbered" startinglinenumber="${parseInt(attrs.start, 10)}"`
            : ' linenumbering="numbered"';
      } else {
        numberingAttrs = ' linenumbering="unnumbered"';
      }
      if ('language' in attrs) {
        wrappedContent = `<programlisting${informal ? commonAttrs : ''} language="${attrs.language}"${numberingAttrs}>${await node.content()}</programlisting>`;
      } else {
        wrappedContent = `<screen${informal ? commonAttrs : ''}${numberingAttrs}>${await node.content()}</screen>`;
      }
    } else {
      wrappedContent = `<screen${informal ? commonAttrs : ''}>${await node.content()}</screen>`;
    }
    if (informal) return wrappedContent
    return `<formalpara${commonAttrs}>\n<title>${node.title}</title>\n<para>\n${wrappedContent}\n</para>\n</formalpara>`
  }

  async convert_literal(node) {
    const commonAttrs = this._commonAttributes(node.id, node.role, node.reftext);
    if (node.hasTitle()) {
      return `<formalpara${commonAttrs}>\n<title>${node.title}</title>\n<para>\n<literallayout class="monospaced">${await node.content()}</literallayout>\n</para>\n</formalpara>`
    }
    return `<literallayout${commonAttrs} class="monospaced">${await node.content()}</literallayout>`
  }

  async convert_pass(node) {
    return await node.content()
  }

  async convert_stem(node) {
    let equation;
    const idx = node.subs ? node.subs.indexOf('specialcharacters') : -1;
    if (idx !== -1) {
      node.subs.splice(idx, 1);
      equation = await node.content();
      node.subs.splice(idx, 0, 'specialcharacters');
    } else {
      equation = await node.content();
    }
    let equationData;
    if (node.style === 'asciimath') {
      // NOTE: No AsciiMath-to-MathML conversion available in JS; use CDATA fallback
      equationData = `<mathphrase><![CDATA[${equation}]]></mathphrase>`;
    } else {
      // unhandled math (latexmath); pass source to alt and required mathphrase — dblatex will process alt as LaTeX math
      equationData = `<alt><![CDATA[${equation}]]></alt>\n<mathphrase><![CDATA[${equation}]]></mathphrase>`;
    }
    const commonAttrs = this._commonAttributes(node.id, node.role, node.reftext);
    if (node.hasTitle()) {
      return `<equation${commonAttrs}>\n<title>${node.title}</title>\n${equationData}\n</equation>`
    }
    return `<informalequation${commonAttrs}>\n${equationData}\n</informalequation>`
  }

  async convert_olist(node) {
    const result = [];
    const numAttribute = node.style ? ` numeration="${node.style}"` : '';
    const startAttribute = node.hasAttribute('start')
      ? ` startingnumber="${node.getAttribute('start')}"`
      : '';
    result.push(
      `<orderedlist${this._commonAttributes(node.id, node.role, node.reftext)}${numAttribute}${startAttribute}>`
    );
    if (node.hasTitle()) result.push(`<title>${node.title}</title>`);
    for (const item of node.getItems()) {
      result.push(`<listitem${this._commonAttributes(item.id, item.role)}>`);
      result.push(`<simpara>${item.getText()}</simpara>`);
      if (item.hasBlocks()) result.push(await item.content());
      result.push('</listitem>');
    }
    result.push('</orderedlist>');
    return result.join(LF)
  }

  async convert_open(node) {
    const id = node.id;
    const role = node.role;
    const reftext = node.reftext;
    switch (node.style) {
      case 'abstract': {
        if (
          node.getParent() === node.document &&
          node.document.doctype === 'book'
        ) {
          this.logger.warn(
            'abstract block cannot be used in a document without a doctitle when doctype is book. Excluding block content.'
          );
          return ''
        }
        let res = `<abstract>\n${this._titleTag(node)}${await this._encloseContent(node)}\n</abstract>`;
        const parent = node.getParent();
        if (
          this.backend === 'docbook5' &&
          !node.hasOption('root') &&
          (parent.context === 'open'
            ? parent.style === 'partintro'
            : parent.context === 'section' &&
              parent.sectname === 'partintro') &&
          parent.blocks[0] === node
        ) {
          res = `<info>\n${res}\n</info>`;
        }
        return res
      }
      case 'partintro': {
        if (
          node.level === 0 &&
          node.getParent().context === 'section' &&
          node.document.doctype === 'book'
        ) {
          return `<partintro${this._commonAttributes(id, role, reftext)}>\n${this._titleTag(node)}${await this._encloseContent(node)}\n</partintro>`
        }
        this.logger.error(
          'partintro block can only be used when doctype is book and must be a child of a book part. Excluding block content.'
        );
        return ''
      }
      default: {
        if (node.hasTitle()) {
          const contentSpacer = node.contentModel === 'compound' ? LF : '';
          return `<formalpara${this._commonAttributes(id, role, reftext)}>\n<title>${node.title}</title>\n<para>${contentSpacer}${await node.content()}${contentSpacer}</para>\n</formalpara>`
        } else if (id || role) {
          if (node.contentModel === 'compound') {
            return `<para${this._commonAttributes(id, role, reftext)}>\n${await node.content()}\n</para>`
          }
          return `<simpara${this._commonAttributes(id, role, reftext)}>${await node.content()}</simpara>`
        }
        return await this._encloseContent(node)
      }
    }
  }

  async convert_page_break(_node) {
    return '<simpara><?asciidoc-pagebreak?></simpara>'
  }

  async convert_paragraph(node) {
    const commonAttrs = this._commonAttributes(node.id, node.role, node.reftext);
    if (node.hasTitle()) {
      return `<formalpara${commonAttrs}>\n<title>${node.title}</title>\n<para>${await node.content()}</para>\n</formalpara>`
    }
    return `<simpara${commonAttrs}>${await node.content()}</simpara>`
  }

  async convert_preamble(node) {
    if (node.document.doctype === 'book') {
      return `<preface${this._commonAttributes(node.id, node.role, node.reftext)}>\n${this._titleTag(node, false)}${await node.content()}\n</preface>`
    }
    return await node.content()
  }

  async convert_quote(node) {
    return await this._blockquoteTag(
      node,
      node.hasRole('epigraph') ? 'epigraph' : null,
      async () => await this._encloseContent(node)
    )
  }

  async convert_thematic_break(_node) {
    return '<simpara><?asciidoc-hr?></simpara>'
  }

  async convert_sidebar(node) {
    return `<sidebar${this._commonAttributes(node.id, node.role, node.reftext)}>\n${this._titleTag(node)}${await this._encloseContent(node)}\n</sidebar>`
  }

  async convert_table(node) {
    let hasBody = false;
    const result = [];
    const pgwideAttribute = node.hasOption('pgwide') ? ' pgwide="1"' : '';
    let frame = node.getAttribute('frame', 'all', 'table-frame');
    if (frame === 'ends') frame = 'topbot';
    const grid = node.getAttribute('grid', null, 'table-grid');
    const tagName = node.hasTitle() ? 'table' : 'informaltable';
    const orientAttr = node.hasAttribute(
      'orientation',
      'landscape',
      'table-orientation'
    )
      ? ' orient="land"'
      : '';
    result.push(
      `<${tagName}${this._commonAttributes(node.id, node.role, node.reftext)}${pgwideAttribute} frame="${frame}" rowsep="${['none', 'cols'].includes(grid) ? 0 : 1}" colsep="${['none', 'rows'].includes(grid) ? 0 : 1}"${orientAttr}>`
    );
    if (node.hasOption('unbreakable')) {
      result.push('<?dbfo keep-together="always"?>');
    } else if (node.hasOption('breakable')) {
      result.push('<?dbfo keep-together="auto"?>');
    }
    if (tagName === 'table') result.push(`<title>${node.title}</title>`);
    let colWidthKey;
    const width = node.hasAttribute('width') ? node.getAttribute('width') : null;
    if (width) {
      for (const piName of TABLE_PI_NAMES)
        result.push(`<?${piName} table-width="${width}"?>`);
      colWidthKey = 'colabswidth';
    } else {
      colWidthKey = 'colpcwidth';
    }
    result.push(`<tgroup cols="${node.getAttribute('colcount')}">`);
    for (const col of node.columns) {
      result.push(
        `<colspec colname="col_${col.getAttribute('colnumber')}" colwidth="${col.getAttribute(colWidthKey)}*"/>`
      );
    }
    for (const [tsec, sectionRows] of node.rows.bySection()) {
      if (!sectionRows || sectionRows.length === 0) continue
      if (tsec === 'body') hasBody = true;
      result.push(`<t${tsec}>`);
      for (const row of sectionRows) {
        result.push('<row>');
        for (const cell of row) {
          const colspanAttribute = cell.colspan
            ? ` namest="col_${cell.column.getAttribute('colnumber')}" nameend="col_${cell.column.getAttribute('colnumber') + cell.colspan - 1}"`
            : '';
          const rowspanAttribute = cell.rowspan
            ? ` morerows="${cell.rowspan - 1}"`
            : '';
          const entryStart = `<entry align="${cell.getAttribute('halign')}" valign="${cell.getAttribute('valign')}"${colspanAttribute}${rowspanAttribute}>`;
          let cellContent;
          if (tsec === 'head') {
            cellContent = cell.text;
          } else {
            switch (cell.style) {
              case 'asciidoc':
                cellContent = await cell.content();
                break
              case 'literal':
                cellContent = `<literallayout class="monospaced">${cell.text}</literallayout>`;
                break
              case 'header': {
                const parts = await cell.content();
                cellContent =
                  parts.length === 0
                    ? ''
                    : `<simpara><emphasis role="strong">${parts.join('</emphasis></simpara><simpara><emphasis role="strong">')}</emphasis></simpara>`;
                break
              }
              default: {
                const parts = await cell.content();
                cellContent =
                  parts.length === 0
                    ? ''
                    : `<simpara>${parts.join('</simpara><simpara>')}</simpara>`;
              }
            }
          }
          const entryEnd = node.document.hasAttribute('cellbgcolor')
            ? `<?dbfo bgcolor="${node.document.getAttribute('cellbgcolor')}"?></entry>`
            : '</entry>';
          result.push(`${entryStart}${cellContent}${entryEnd}`);
        }
        result.push('</row>');
      }
      result.push(`</t${tsec}>`);
    }
    result.push('</tgroup>');
    result.push(`</${tagName}>`);
    if (!hasBody) this.logger.warn('tables must have at least one body row');
    return result.join(LF)
  }

  async convert_toc(_node) {
    return ''
  }

  async convert_ulist(node) {
    const result = [];
    if (node.style === 'bibliography') {
      result.push(
        `<bibliodiv${this._commonAttributes(node.id, node.role, node.reftext)}>`
      );
      if (node.hasTitle()) result.push(`<title>${node.title}</title>`);
      for (const item of node.getItems()) {
        result.push('<bibliomixed>');
        result.push(`<bibliomisc>${item.getText()}</bibliomisc>`);
        if (item.hasBlocks()) result.push(await item.content());
        result.push('</bibliomixed>');
      }
      result.push('</bibliodiv>');
    } else {
      const checklist = node.hasOption('checklist');
      const markType = checklist ? 'none' : node.style;
      const markAttribute = markType ? ` mark="${markType}"` : '';
      result.push(
        `<itemizedlist${this._commonAttributes(node.id, node.role, node.reftext)}${markAttribute}>`
      );
      if (node.hasTitle()) result.push(`<title>${node.title}</title>`);
      for (const item of node.getItems()) {
        const textMarker =
          checklist && item.hasAttribute('checkbox')
            ? item.hasAttribute('checked')
              ? '&#10003; '
              : '&#10063; '
            : '';
        result.push(`<listitem${this._commonAttributes(item.id, item.role)}>`);
        result.push(`<simpara>${textMarker}${item.getText()}</simpara>`);
        if (item.hasBlocks()) result.push(await item.content());
        result.push('</listitem>');
      }
      result.push('</itemizedlist>');
    }
    return result.join(LF)
  }

  async convert_verse(node) {
    return await this._blockquoteTag(
      node,
      node.hasRole('epigraph') ? 'epigraph' : null,
      async () => `<literallayout>${await node.content()}</literallayout>`
    )
  }

  async convert_video(_node) {
    return ''
  }

  async convert_inline_anchor(node) {
    switch (node.type) {
      case 'ref':
        return `<anchor${this._commonAttributes(node.id, null, node.reftext || `[${node.id}]`)}/>`
      case 'xref': {
        const path = node.attributes.path;
        if (path) {
          return `<link xl:href="${node.target}">${node.text || path}</link>`
        }
        let linkend = node.attributes.refid;
        if (!linkend) {
          const rootDoc = this._getRootDocument(node);
          linkend =
            rootDoc.id ??
            (this._rootDocId ??= this._generateDocumentId(rootDoc));
        }
        return node.text
          ? `<link linkend="${linkend}">${node.text}</link>`
          : `<xref linkend="${linkend}"/>`
      }
      case 'link':
        return `<link xl:href="${node.target}">${node.text}</link>`
      case 'bibref': {
        const text = `[${node.reftext || node.id}]`;
        return `<anchor${this._commonAttributes(node.id, null, text)}/>${text}`
      }
      default:
        this.logger.warn(`unknown anchor type: ${node.type}`);
        return null
    }
  }

  async convert_inline_break(node) {
    return `${node.text}<?asciidoc-br?>`
  }

  async convert_inline_button(node) {
    return `<guibutton>${node.text}</guibutton>`
  }

  async convert_inline_callout(node) {
    return `<co${this._commonAttributes(node.id)}/>`
  }

  async convert_inline_footnote(node) {
    if (node.type === 'xref') {
      return `<footnoteref linkend="${node.target}"/>`
    }
    return `<footnote${this._commonAttributes(node.id)}><simpara>${node.text}</simpara></footnote>`
  }

  async convert_inline_image(node) {
    const fileref =
      node.type === 'icon'
        ? await node.iconUri(node.target)
        : await node.imageUri(node.target);
    const img = `<inlinemediaobject${this._commonAttributes(node.id, node.role)}>\n<imageobject>\n<imagedata fileref="${fileref}"${this._imageSizeAttributes(node.attributes)}/>\n</imageobject>\n<textobject><phrase>${node.getAlt()}</phrase></textobject>\n</inlinemediaobject>`;
    if (node.type !== 'icon' && node.hasAttribute('link')) {
      const linkHref = node.getAttribute('link');
      return `<link xl:href="${linkHref === 'self' ? fileref : linkHref}">${img}</link>`
    }
    return img
  }

  async convert_inline_indexterm(node) {
    let rel = '';
    const see = node.getAttribute('see');
    if (see) {
      rel = `\n<see>${see}</see>`;
    } else {
      const seeAlsoList = node.getAttribute('see-also');
      if (seeAlsoList) {
        rel = seeAlsoList.map((s) => `\n<seealso>${s}</seealso>`).join('');
      }
    }
    if (node.type === 'visible') {
      return `<indexterm>\n<primary>${node.text}</primary>${rel}\n</indexterm>${node.text}`
    }
    const terms = node.getAttribute('terms');
    const numterms = terms.length;
    const indexPromote = node.document.hasOption('indexterm-promotion');
    if (numterms > 2) {
      return `<indexterm>\n<primary>${terms[0]}</primary><secondary>${terms[1]}</secondary><tertiary>${terms[2]}</tertiary>${rel}\n</indexterm>${indexPromote ? `\n<indexterm>\n<primary>${terms[1]}</primary><secondary>${terms[2]}</secondary>\n</indexterm>\n<indexterm>\n<primary>${terms[2]}</primary>\n</indexterm>` : ''}`
    } else if (numterms > 1) {
      return `<indexterm>\n<primary>${terms[0]}</primary><secondary>${terms[1]}</secondary>${rel}\n</indexterm>${indexPromote ? `\n<indexterm>\n<primary>${terms[1]}</primary>\n</indexterm>` : ''}`
    }
    return `<indexterm>\n<primary>${terms[0]}</primary>${rel}\n</indexterm>`
  }

  async convert_inline_kbd(node) {
    const keys = node.getAttribute('keys');
    if (keys.length === 1) {
      return `<keycap>${keys[0]}</keycap>`
    }
    return `<keycombo><keycap>${keys.join('</keycap><keycap>')}</keycap></keycombo>`
  }

  async convert_inline_menu(node) {
    const menu = node.getAttribute('menu');
    const submenus = node.getAttribute('submenus');
    if (!submenus || submenus.length === 0) {
      const menuitem = node.getAttribute('menuitem');
      if (menuitem) {
        return `<menuchoice><guimenu>${menu}</guimenu> <guimenuitem>${menuitem}</guimenuitem></menuchoice>`
      }
      return `<guimenu>${menu}</guimenu>`
    }
    return `<menuchoice><guimenu>${menu}</guimenu> <guisubmenu>${submenus.join('</guisubmenu> <guisubmenu>')}</guisubmenu> <guimenuitem>${node.getAttribute('menuitem')}</guimenuitem></menuchoice>`
  }

  async convert_inline_quoted(node) {
    const type = node.type;
    if (type === 'asciimath' || type === 'latexmath') {
      const equation = node.text;
      if (type === 'asciimath') {
        return `<inlineequation><mathphrase><![CDATA[${equation}]]></mathphrase></inlineequation>`
      }
      return `<inlineequation><alt><![CDATA[${equation}]]></alt><mathphrase><![CDATA[${equation}]]></mathphrase></inlineequation>`
    }
    const [open, close, supportsPhrase] = QUOTE_TAGS[type] ?? QUOTE_TAGS_DEFAULT;
    const text = node.text;
    let quotedText;
    if (node.role) {
      if (supportsPhrase) {
        quotedText = `${open}<phrase role="${node.role}">${text}</phrase>${close}`;
      } else {
        // chop the closing > from open tag to insert role attribute
        quotedText = `${open.slice(0, -1)} role="${node.role}">${text}${close}`;
      }
    } else {
      quotedText = `${open}${text}${close}`;
    }
    return node.id
      ? `<anchor${this._commonAttributes(node.id)}/>${quotedText}`
      : quotedText
  }

  // Private helpers

  /**
   * @internal
   * @private
   */
  _commonAttributes(id, role = null, reftext = null) {
    let attrs = '';
    if (id) {
      attrs = ` xml:id="${id}"${role ? ` role="${role}"` : ''}`;
    } else if (role) {
      attrs = ` role="${role}"`;
    }
    if (reftext) {
      let sanitized = reftext;
      if (sanitized.includes('<')) {
        sanitized = sanitized.replace(XmlSanitizeRx, '');
        if (sanitized.includes(' '))
          sanitized = sanitized.replace(/ {2,}/g, ' ').trim();
      }
      if (sanitized.includes('"')) sanitized = sanitized.replace(/"/g, '&quot;');
      return `${attrs} xreflabel="${sanitized}"`
    }
    return attrs
  }

  /**
   * @internal
   * @private
   */
  _imageSizeAttributes(attributes) {
    if ('scaledwidth' in attributes) {
      return ` width="${attributes.scaledwidth}"`
    } else if ('scale' in attributes) {
      return ` scale="${attributes.scale}"`
    }
    const widthAttr =
      'width' in attributes ? ` contentwidth="${attributes.width}"` : '';
    const depthAttr =
      'height' in attributes ? ` contentdepth="${attributes.height}"` : '';
    return `${widthAttr}${depthAttr}`
  }

  /**
   * @internal
   * @private
   */
  _authorTag(doc, author) {
    const result = ['<author>', '<personname>'];
    if (author.firstname)
      result.push(
        `<firstname>${doc.subReplacements(author.firstname)}</firstname>`
      );
    if (author.middlename)
      result.push(
        `<othername>${doc.subReplacements(author.middlename)}</othername>`
      );
    if (author.lastname)
      result.push(`<surname>${doc.subReplacements(author.lastname)}</surname>`);
    result.push('</personname>');
    if (author.email) result.push(`<email>${author.email}</email>`);
    result.push('</author>');
    return result.join(LF)
  }

  /**
   * @internal
   * @private
   */
  async _documentInfoTag(doc, abstract) {
    const result = ['<info>'];
    if (!doc.isNotitle()) {
      const title = doc.doctitle({ partition: true, use_fallback: true });
      if (title?.subtitle) {
        result.push(
          `<title>${title.main}</title>\n<subtitle>${title.subtitle}</subtitle>`
        );
      } else if (title) {
        result.push(`<title>${title}</title>`);
      }
    }
    const date = doc.hasAttribute('revdate')
      ? doc.getAttribute('revdate')
      : doc.hasAttribute('reproducible')
        ? null
        : doc.getAttribute('docdate');
    if (date) result.push(`<date>${date}</date>`);
    if (doc.hasAttribute('copyright')) {
      const m = CopyrightRx.exec(doc.getAttribute('copyright'));
      if (m) {
        result.push('<copyright>');
        result.push(`<holder>${m[1]}</holder>`);
        if (m[2]) result.push(`<year>${m[2]}</year>`);
        result.push('</copyright>');
      }
    }
    if (doc.hasHeader()) {
      const authors = doc.authors();
      if (authors.length > 0) {
        if (authors.length > 1) {
          result.push('<authorgroup>');
          for (const author of authors)
            result.push(this._authorTag(doc, author));
          result.push('</authorgroup>');
        } else {
          const author = authors[0];
          result.push(this._authorTag(doc, author));
          if (author.initials)
            result.push(`<authorinitials>${author.initials}</authorinitials>`);
        }
      }
      if (
        doc.hasAttribute('revdate') &&
        (doc.hasAttribute('revnumber') || doc.hasAttribute('revremark'))
      ) {
        result.push('<revhistory>\n<revision>');
        if (doc.hasAttribute('revnumber'))
          result.push(`<revnumber>${doc.getAttribute('revnumber')}</revnumber>`);
        if (doc.hasAttribute('revdate'))
          result.push(`<date>${doc.getAttribute('revdate')}</date>`);
        if (doc.hasAttribute('authorinitials'))
          result.push(
            `<authorinitials>${doc.getAttribute('authorinitials')}</authorinitials>`
          );
        if (doc.hasAttribute('revremark'))
          result.push(`<revremark>${doc.getAttribute('revremark')}</revremark>`);
        result.push('</revision>\n</revhistory>');
      }
      if (
        doc.hasAttribute('front-cover-image') ||
        doc.hasAttribute('back-cover-image')
      ) {
        const backCoverTag = await this._coverTag(doc, 'back');
        if (backCoverTag) {
          result.push(await this._coverTag(doc, 'front', true));
          result.push(backCoverTag);
        } else {
          const frontCoverTag = await this._coverTag(doc, 'front');
          if (frontCoverTag) result.push(frontCoverTag);
        }
      }
      if (doc.hasAttribute('orgname'))
        result.push(`<orgname>${doc.getAttribute('orgname')}</orgname>`);
      const docinfo = await doc.docinfo();
      if (docinfo) result.push(docinfo);
    }
    if (abstract) {
      abstract.setAttribute('root-option', '');
      result.push(await this.convert(abstract, abstract.nodeName));
      abstract.removeAttribute('root-option');
    }
    result.push('</info>');
    return result.join(LF)
  }

  /**
   * @internal
   * @private
   */
  _findRootAbstract(doc) {
    if (!doc.hasBlocks()) return null
    let firstBlock = doc.blocks[0];
    if (firstBlock.context === 'preamble') {
      if (!firstBlock.hasBlocks()) return null
      firstBlock = firstBlock.blocks[0];
    } else if (firstBlock.context === 'section') {
      if (firstBlock.sectname === 'abstract') return firstBlock
      if (firstBlock.sectname !== 'preface' || !firstBlock.hasBlocks())
        return null
      firstBlock = firstBlock.blocks[0];
    }
    return firstBlock.style === 'abstract' && firstBlock.context === 'open'
      ? firstBlock
      : null
  }

  /**
   * @internal
   * @private
   */
  _extractAbstract(document, abstract) {
    let parent = abstract.getParent();
    let toDelete = abstract;
    while (parent !== document && parent.blocks.length === 1) {
      toDelete = parent;
      parent = parent.getParent();
    }
    parent.blocks.splice(parent.blocks.indexOf(toDelete), 1);
    return abstract
  }

  /**
   * @internal
   * @private
   */
  _restoreAbstract(abstract) {
    abstract.getParent().blocks.unshift(abstract);
  }

  /**
   * @internal
   * @private
   */
  _getRootDocument(node) {
    let doc = node.document;
    while (doc.isNested()) doc = doc.parentDocument;
    return doc
  }

  /**
   * @internal
   * @private
   */
  _generateDocumentId(doc) {
    return `__${doc.doctype}-root__`
  }

  /**
   * @internal
   * @private
   */
  async _encloseContent(node) {
    return node.contentModel === 'compound'
      ? await node.content()
      : `<simpara>${await node.content()}</simpara>`
  }

  /**
   * @internal
   * @private
   */
  _titleTag(node, optional = true) {
    if (optional && !node.hasTitle()) return ''
    return `<title>${node.title ?? ''}</title>\n`
  }

  /**
   * @internal
   * @private
   */
  async _coverTag(doc, face, usePlaceholder = false) {
    const coverImage = doc.getAttribute(`${face}-cover-image`);
    if (coverImage) {
      let fileref = coverImage;
      const sizeAttrs = '';
      // Check if it's an image macro (contains ':')
      if (coverImage.includes(':')) {
        const m = /^image::?(\S|\S.*?\S)\[(.*?)?\]$/.exec(coverImage);
        if (m) {
          fileref = await doc.imageUri(m[1]);
          // size attrs parsing omitted for simplicity
        }
      }
      return `<cover role="${face}">\n<mediaobject>\n<imageobject>\n<imagedata fileref="${fileref}"${sizeAttrs}/>\n</imageobject>\n</mediaobject>\n</cover>`
    }
    if (usePlaceholder) return `<cover role="${face}"/>`
    return null
  }

  /**
   * @internal
   * @private
   */
  async _blockquoteTag(node, tagName, contentFn) {
    const tag = tagName || 'blockquote';
    const result = [
      `<${tag}${this._commonAttributes(node.id, node.role, node.reftext)}>`,
    ];
    if (node.hasTitle()) result.push(`<title>${node.title}</title>`);
    if (node.hasAttribute('attribution') || node.hasAttribute('citetitle')) {
      result.push('<attribution>');
      if (node.hasAttribute('attribution'))
        result.push(node.getAttribute('attribution'));
      if (node.hasAttribute('citetitle'))
        result.push(`<citetitle>${node.getAttribute('citetitle')}</citetitle>`);
      result.push('</attribution>');
    }
    result.push(await contentFn());
    result.push(`</${tag}>`);
    return result.join(LF)
  }
}

const docbook5 = /*#__PURE__*/Object.freeze({
  __proto__: null,
  DocBook5Converter: DocBook5Converter,
  default: DocBook5Converter
});

// ESM conversion of converter/manpage.rb
//
// Ruby-to-JavaScript notes:
//   - Ruby module constants (WHITESPACE, ESC, …) → module-level const
//   - Ruby symbol keys (:preserve, :normalize, :collapse) → plain strings
//   - node.attr?  → node.hasAttribute()
//   - node.title? → node.hasTitle()
//   - node.blocks? → node.hasBlocks()
//   - node.footnotes? → node.hasFootnotes()
//   - node.noheader → node.isNoheader()
//   - node.authors → node.authors() (method call)
//   - node.footnotes → node.footnotes (getter)
//   - await node.content() → await node.content() (method call)
//   - node.text → node.text (property/getter)
//   - node.captioned_title → node.captionedTitle()
//   - node.content_model == :compound → node.contentModel === 'compound'
//   - node.rows.to_h.each { |tsec, rows| } → for (const [tsec, rows] of node.rows.bySection())
//   - node.media_uri target → node.mediaUri(target)
//   - AbstractNode === ref → ref instanceof AbstractNode
//   - node.context === :section → node.context === 'section'
//   - node.document.catalog[:refs] → node.document.catalog.refs
//   - Ruby gsub blocks with $1, $2 → replace callbacks with (m, $1, $2, ...)
//   - Ruby str.tr_s(WHITESPACE, ' ') → str.replace(/[\n\t ]+/g, ' ')
//   - Ruby str.rstrip → str.trimEnd()
//   - Ruby str.lstrip → str.trimStart()
//   - self.write_alternate_pages → static writeAlternatePages; uses lazy node:fs import
//   - (^)? capture of zero-width anchor: Ruby empty string is truthy, JS empty string is falsy
//     → use ($1 !== undefined) instead of ($1) in preserve-whitespace handler

const ET = ' '.repeat(8); // expand tab to 8 spaces
const ESC = '\u001b'; // troff leader marker
const ESC_BS = `${ESC}\\`; // escaped backslash (troff formatting sequence)
const ESC_FS = `${ESC}.`; // escaped full stop (troff macro)

// ── Module-level regular expressions ─────────────────────────────────────────

// Matches a literal backslash at string start (^\\) OR an optionally ESC-prefixed backslash
// Replacement rule: if ESC-prefixed ($1 set) → keep as-is; otherwise → \\(rs
const LiteralBackslashRx = /^\\|(\u001b)?\\/g;

// Matches a leading period on any line (troff macro indicator)
const LeadingPeriodRx = /^\./gm;

// Matches a full escaped URL/MTO macro line (possibly prefixed by orphaned \c line)
const EscapedMacroRx =
  /^(?:\u001b\\c\n)?\u001b\.((?:URL|MTO) ".*?" ".*?" )( |[^\s]*)(.*?)(?: *\u001b\\c)?$/gm;

// Matches malformed escaped macros (orphaned \c followed by ESC macro without newline)
const MalformedEscapedMacroRx = /(\u001b\\c) (\u001b\.(?:URL|MTO) )/g;

// Matches mock XML boundary markers used to avoid artificial word-breaks
const MockMacroRx = /<\/?([\u001b]\\[^>]+)>/g;

// HTML entity references for em-dash and ellipsis
const EmDashCharRefRx = /&#8212;(?:&#8203;)?/g;
const EllipsisCharRefRx = /&#8230;(?:&#8203;)?/g;

// Whitespace normalisation: optional blanks around a newline → single newline
const WrappedIndentRx = /[ \t]*\n[ \t]*/g;

// Detects any XML/entity markup in a string (used by uppercase_pcdata)
const XMLMarkupRx = /&#?[a-z\d]+;|</;

// Splits a string into entity refs / fake-XML spans / monospaced spans / plain text
const PCDATAFilterRx =
  /(&#?[a-z\d]+;|<\u001b\\f\(CR[\s\S]*?<\/\u001b\\fP>|<[^>]+>)|([^&<]+)/g;

// ── ManPageConverter ──────────────────────────────────────────────────────────

class ManPageConverter extends ConverterBase {
  constructor(backend, opts = {}) {
    super(backend, opts);
    this.initBackendTraits({
      basebackend: 'manpage',
      filetype: 'man',
      outfilesuffix: '.man',
      supportsTemplates: true,
    });
  }

  async convert_document(node) {
    if (!node.hasAttribute('mantitle')) {
      throw new Error(
        'asciidoctor: ERROR: doctype must be set to manpage when using manpage backend'
      )
    }
    const mantitle = node
      .getAttribute('mantitle')
      .replace(InvalidSectionIdCharsRx, '');
    const manvolnum = node.getAttribute('manvolnum', '1');
    const manname = node.getAttribute('manname', mantitle);
    const manmanual = node.getAttribute('manmanual');
    const mansource = node.getAttribute('mansource');
    const docdate = node.hasAttribute('reproducible')
      ? null
      : node.getAttribute('docdate');

    // NOTE the first line enables the table (tbl) preprocessor, necessary for non-Linux systems
    const result = [
      `'\\" t
.\\"     Title: ${mantitle}
.\\"    Author: ${node.hasAttribute('authors') ? node.getAttribute('authors') : '[see the "AUTHOR(S)" section]'}
.\\" Generator: Asciidoctor.js ${node.getAttribute('asciidoctor-version')}`,
    ];

    if (docdate) result.push(`.\\"      Date: ${docdate}`);

    result.push(`.\\"    Manual: ${manmanual ? manmanual.replace(/[\n\t ]+/g, ' ') : '\\ \\&'}
.\\"    Source: ${mansource ? mansource.replace(/[\n\t ]+/g, ' ') : '\\ \\&'}
.\\"  Language: English
.\\"`);

    // TODO add document-level setting to disable capitalization of manname
    result.push(
      `.TH "${this.manify(manname.toUpperCase())}" "${manvolnum}" "${docdate ?? ''}" "${mansource ? this.manify(mansource) : '\\ \\&'}" "${manmanual ? this.manify(manmanual) : '\\ \\&'}"`
    );

    // define portability settings
    // see http://bugs.debian.org/507673
    // see http://lists.gnu.org/archive/html/groff/2009-02/msg00013.html
    result.push('.ie \\n(.g .ds Aq \\(aq');
    result.push(".el       .ds Aq '");
    // set sentence_space_size to 0 to prevent extra space between sentences separated by a newline
    result.push('.ss \\n[.ss] 0');
    // disable hyphenation
    result.push('.nh');
    // disable justification (adjust text to left margin only)
    result.push('.ad l');
    // define URL macro for portability
    // see http://web.archive.org/web/20060102165607/http://people.debian.org/~branden/talks/wtfm/wtfm.pdf
    //
    // Usage
    //
    // .URL "http://www.debian.org" "Debian" "."
    //
    // * First argument: the URL
    // * Second argument: text to be hyperlinked
    // * Third (optional) argument: text that needs to immediately trail the hyperlink without intervening whitespace
    result.push(`.de URL
\\fI\\\\$2\\fP <\\\\$1>\\\\$3
..
.als MTO URL
.if \\n[.g] \\{\\
.  mso www.tmac
.  am URL
.    ad l
.  .
.  am MTO
.    ad l
.  .`);
    result.push(
      `.  LINKSTYLE ${node.getAttribute('man-linkstyle', 'blue R < >')}`
    );
    result.push('.\\}');

    if (!node.isNoheader()) {
      if (node.hasAttribute('manpurpose')) {
        const mannames = node.getAttribute('mannames', [manname]);
        result.push(`.SH "${(node.getAttribute('manname-title', 'NAME')).toUpperCase()}"
${mannames.map((n) => this.manify(n).replace(/\\-/g, '-')).join(', ')} \\- ${this.manify(node.getAttribute('manpurpose'), { whitespace: 'normalize' })}`);
      }
    }

    result.push(await node.content());

    // QUESTION should NOTES come after AUTHOR(S)?
    this._appendFootnotes(result, node);

    const authors = node.authors();
    if (authors.length > 0) {
      if (authors.length > 1) {
        result.push('.SH "AUTHORS"');
        for (const author of authors) {
          result.push(`.sp\n${author.name}`);
        }
      } else {
        result.push(`.SH "AUTHOR"\n.sp\n${authors[0].name}`);
      }
    }

    return result.join(LF$1)
  }

  // NOTE embedded doesn't really make sense in the manpage backend
  async convert_embedded(node) {
    const result = [await node.content()];
    this._appendFootnotes(result, node);
    // QUESTION should we add an AUTHOR(S) section?
    return result.join(LF$1)
  }

  async convert_section(node) {
    let macro, stitle;
    if (node.level > 1) {
      macro = 'SS';
      // QUESTION why captioned title? why not when level == 1?
      stitle = node.captionedTitle();
    } else {
      macro = 'SH';
      stitle = this._uppercasePcdata(node.title);
    }
    return `.${macro} "${this.manify(stitle)}"\n${await node.content()}`
  }

  async convert_admonition(node) {
    const titleSuffix = node.hasTitle()
      ? `\\fP: ${this.manify(node.title)}`
      : '';
    return `.if n .sp
.RS 4
.it 1 an-trap
.nr an-no-space-flag 1
.nr an-break-flag 1
.br
.ps +1
.B ${node.getAttribute('textlabel')}${titleSuffix}
.ps -1
.br
${await this._encloseContent(node)}
.sp .5v
.RE`
  }

  async convert_colist(node) {
    const result = [];
    if (node.hasTitle()) {
      result.push(`.sp\n.B ${this.manify(node.title)}\n.br`);
    }
    result.push('.TS\ntab(:);\nr lw(\\n(.lu*75u/100u).');

    let num = 0;
    for (const item of node.getItems()) {
      result.push(`\\fB(${++num})\\fP\\h'-2n':T{`);
      result.push(this.manify(item.getText(), { whitespace: 'normalize' }));
      if (item.hasBlocks()) result.push(await item.content());
      result.push('T}');
    }
    result.push('.TE');
    return result.join(LF$1)
  }

  // TODO implement horizontal (if it makes sense)
  async convert_dlist(node) {
    const result = [];
    if (node.hasTitle()) {
      result.push(`.sp\n.B ${this.manify(node.title)}\n.br`);
    }
    let counter = 0;
    for (const [terms, dd] of node.getItems()) {
      counter++;
      if (node.style === 'qanda') {
        result.push(
          `.sp\n${counter}. ${this.manify(terms.map((dt) => dt.getText()).join(' '))}\n.RS 4`
        );
      } else {
        result.push(
          `.sp\n${this.manify(terms.map((dt) => dt.getText()).join(', '), { whitespace: 'normalize' })}\n.RS 4`
        );
      }
      if (dd) {
        let hasText = false;
        if (dd.hasText()) {
          result.push(this.manify(dd.getText(), { whitespace: 'normalize' }));
          hasText = true;
        }
        if (dd.hasBlocks()) {
          let ddContent = await dd.content();
          if (!hasText && ddContent.startsWith('.sp\n')) {
            ddContent = ddContent.slice(4);
          }
          result.push(ddContent);
        }
      }
      result.push('.RE');
    }
    return result.join(LF$1)
  }

  async convert_example(node) {
    const titleBlock = node.hasTitle()
      ? `.sp\n.B ${this.manify(node.captionedTitle())}\n.br`
      : '.sp';
    return `${titleBlock}\n.RS 4\n${await this._encloseContent(node)}\n.RE`
  }

  async convert_floating_title(node) {
    return `.SS "${this.manify(node.title)}"`
  }

  async convert_image(node) {
    const titleBlock = node.hasTitle()
      ? `.sp\n.B ${this.manify(node.captionedTitle())}\n.br`
      : '.sp';
    return `${titleBlock}\n[${this.manify(node.getAttribute('alt'))}]`
  }

  async convert_listing(node) {
    const result = [];
    if (node.hasTitle()) {
      result.push(`.sp\n.B ${this.manify(node.captionedTitle())}\n.br`);
    }
    result.push(`.sp
.if n .RS 4
.nf
.fam C
${this.manify(await node.content(), { whitespace: 'preserve' })}
.fam
.fi
.if n .RE`);
    return result.join(LF$1)
  }

  async convert_literal(node) {
    const result = [];
    if (node.hasTitle()) {
      result.push(`.sp\n.B ${this.manify(node.title)}\n.br`);
    }
    result.push(`.sp
.if n .RS 4
.nf
.fam C
${this.manify(await node.content(), { whitespace: 'preserve' })}
.fam
.fi
.if n .RE`);
    return result.join(LF$1)
  }

  async convert_sidebar(node) {
    const titleBlock = node.hasTitle()
      ? `.sp\n.B ${this.manify(node.title)}\n.br`
      : '.sp';
    return `${titleBlock}\n.RS 4\n${await this._encloseContent(node)}\n.RE`
  }

  async convert_olist(node) {
    const result = [];
    if (node.hasTitle()) {
      result.push(`.sp\n.B ${this.manify(node.title)}\n.br`);
    }

    const start = parseInt(node.getAttribute('start', 1), 10);
    let idx = 0;
    for (const item of node.getItems()) {
      const numeral = idx + start;
      const listText = this.manify(item.getText(), { whitespace: 'normalize' });
      result.push(`.sp
.RS 4
.ie n \\{\\
\\h'-04' ${numeral}.\\h'+01'\\c
.\\}
.el \\{\\
.  sp -1
.  IP " ${numeral}." 4.2
.\\}${listText === '' ? '' : LF$1 + listText}`);
      if (item.hasBlocks()) {
        let itemContent = await item.content();
        if (listText === '' && itemContent.startsWith('.sp\n')) {
          itemContent = itemContent.slice(4);
        }
        result.push(itemContent);
      }
      result.push('.RE');
      idx++;
    }
    return result.join(LF$1)
  }

  async convert_open(node) {
    if (node.style === 'abstract' || node.style === 'partintro') {
      return this._encloseContent(node)
    }
    return await node.content()
  }

  async convert_page_break(_node) {
    return '.bp'
  }

  async convert_paragraph(node) {
    if (node.hasTitle()) {
      return `.sp\n.B ${this.manify(node.title)}\n.br\n${this.manify(await node.content(), { whitespace: 'normalize' })}`
    }
    return `.sp\n${this.manify(await node.content(), { whitespace: 'normalize' })}`
  }

  async convert_pass(node) {
    return this.contentOnly(node)
  }

  async convert_preamble(node) {
    return this.contentOnly(node)
  }

  async convert_quote(node) {
    const result = [];
    if (node.hasTitle()) {
      result.push(`.sp\n.RS 3\n.B ${this.manify(node.title)}\n.br\n.RE`);
    }
    let attributionLine = node.hasAttribute('citetitle')
      ? `${node.getAttribute('citetitle')} `
      : null;
    if (node.hasAttribute('attribution')) {
      attributionLine = `${attributionLine ?? ''}\\(em ${node.getAttribute('attribution')}`;
    } else {
      attributionLine = null;
    }
    result.push(
      `.RS 3\n.ll -.6i\n${await this._encloseContent(node)}\n.br\n.RE\n.ll`
    );
    if (attributionLine) {
      result.push(`.RS 5\n.ll -.10i\n${attributionLine}\n.RE\n.ll`);
    }
    return result.join(LF$1)
  }

  async convert_stem(node) {
    const result = [];
    result.push(
      node.hasTitle() ? `.sp\n.B ${this.manify(node.title)}\n.br` : '.sp'
    );
    const style = node.style;
    const [open, close] = BLOCK_MATH_DELIMITERS[style] ?? ['', ''];
    let equation = await node.content();
    if (equation.startsWith(open) && equation.endsWith(close)) {
      equation = equation.slice(open.length, equation.length - close.length);
    }
    result.push(
      `${this.manify(equation, { whitespace: 'preserve' })} (${style})`
    );
    return result.join(LF$1)
  }

  // NOTE This handler inserts empty cells to account for colspans and rowspans.
  // In order to support colspans and rowspans properly, that information must
  // be computed up front and consulted when rendering the cell as this information
  // is not available on the cell itself.
  async convert_table(node) {
    const result = [];
    if (node.hasTitle()) {
      result.push(`.sp
.it 1 an-trap
.nr an-no-space-flag 1
.nr an-break-flag 1
.br
.B ${this.manify(node.captionedTitle())}
`);
    }
    result.push(`.TS\nallbox tab(:);`);

    const rowHeader = [];
    const rowText = [];
    let rowIndex = 0;

    for (const [tsec, rows] of node.rows.bySection()) {
      if (rows.length === 0) continue
      for (const row of rows) {
        rowHeader[rowIndex] = rowHeader[rowIndex] ?? [];
        rowText[rowIndex] = rowText[rowIndex] ?? [];
        let remainingCells = row.length;
        let cellIndex = 0;
        for (const cell of row) {
          remainingCells--;
          rowHeader[rowIndex][cellIndex] = rowHeader[rowIndex][cellIndex] ?? [];
          // add an empty cell as a placeholder if this is a rowspan cell
          if (
            JSON.stringify(rowHeader[rowIndex][cellIndex]) ===
            JSON.stringify(['^t'])
          ) {
            rowText[rowIndex].push(`T{${LF$1}T}:`);
          }
          rowText[rowIndex].push(`T{${LF$1}`);
          const cellHalign = (cell.getAttribute('halign', 'left') ?? 'left')[0];
          if (tsec === 'body') {
            if (
              rowHeader[rowIndex].length === 0 ||
              rowHeader[rowIndex][cellIndex].length === 0
            ) {
              rowHeader[rowIndex][cellIndex].push(`${cellHalign}t`);
            } else {
              rowHeader[rowIndex][cellIndex + 1] =
                rowHeader[rowIndex][cellIndex + 1] ?? [];
              rowHeader[rowIndex][cellIndex + 1].push(`${cellHalign}t`);
            }
            let cellContent;
            if (cell.style === 'asciidoc') {
              cellContent = await cell.content();
            } else if (cell.style === 'literal') {
              cellContent = `.nf${LF$1}${this.manify(cell.text, { whitespace: 'preserve' })}${LF$1}.fi`;
            } else {
              cellContent = (await cell.content())
                .map((p) => this.manify(p, { whitespace: 'normalize' }))
                .join(`${LF$1}.sp${LF$1}`);
            }
            rowText[rowIndex].push(`${cellContent}${LF$1}`);
          } else {
            // tsec === 'head' || tsec === 'foot'
            if (
              rowHeader[rowIndex].length === 0 ||
              rowHeader[rowIndex][cellIndex].length === 0
            ) {
              rowHeader[rowIndex][cellIndex].push(`${cellHalign}tB`);
            } else {
              rowHeader[rowIndex][cellIndex + 1] =
                rowHeader[rowIndex][cellIndex + 1] ?? [];
              rowHeader[rowIndex][cellIndex + 1].push(`${cellHalign}tB`);
            }
            rowText[rowIndex].push(
              `${this.manify(cell.text, { whitespace: 'normalize' })}${LF$1}`
            );
          }
          if (cell.colspan && cell.colspan > 1) {
            for (let i = 0; i < cell.colspan - 1; i++) {
              if (
                rowHeader[rowIndex].length === 0 ||
                rowHeader[rowIndex][cellIndex].length === 0
              ) {
                rowHeader[rowIndex][cellIndex + i].push('st');
              } else {
                rowHeader[rowIndex][cellIndex + 1 + i] =
                  rowHeader[rowIndex][cellIndex + 1 + i] ?? [];
                rowHeader[rowIndex][cellIndex + 1 + i].push('st');
              }
            }
          }
          if (cell.rowspan && cell.rowspan > 1) {
            for (let i = 0; i < cell.rowspan - 1; i++) {
              rowHeader[rowIndex + 1 + i] = rowHeader[rowIndex + 1 + i] ?? [];
              if (
                rowHeader[rowIndex + 1 + i].length === 0 ||
                (rowHeader[rowIndex + 1 + i][cellIndex] ?? []).length === 0
              ) {
                rowHeader[rowIndex + 1 + i][cellIndex] =
                  rowHeader[rowIndex + 1 + i][cellIndex] ?? [];
                rowHeader[rowIndex + 1 + i][cellIndex].push('^t');
              } else {
                rowHeader[rowIndex + 1 + i][cellIndex + 1] =
                  rowHeader[rowIndex + 1 + i][cellIndex + 1] ?? [];
                rowHeader[rowIndex + 1 + i][cellIndex + 1].push('^t');
              }
            }
          }
          if (remainingCells >= 1) {
            rowText[rowIndex].push('T}:');
          } else {
            rowText[rowIndex].push(`T}${LF$1}`);
          }
          cellIndex++;
        }
        rowIndex++;
      }
    }

    let rowTextSlice = rowText;
    if (node.hasHeaderOption && rowText[0]) {
      result.push(`${LF$1}${rowHeader[0].join(' ')}.`);
      result.push(`${LF$1}${rowText[0].join('')}`);
      result.push('.T&');
      rowTextSlice = rowText.slice(1);
    }
    result.push(`${LF$1}${rowHeader[0].map(() => 'lt').join(' ')}.${LF$1}`);
    for (const row of rowTextSlice) result.push(row.join(''));
    result.push(`.TE${LF$1}.sp`);
    return result.join('')
  }

  async convert_thematic_break(_node) {
    return `.sp
.ce
\\l'\\n(.lu*25u/100u\\(ap'`
  }

  async convert_toc(_node) {
    // skip
  }

  async convert_ulist(node) {
    const result = [];
    if (node.hasTitle()) {
      result.push(`.sp\n.B ${this.manify(node.title)}\n.br`);
    }
    for (const item of node.getItems()) {
      const listText = this.manify(item.getText(), { whitespace: 'normalize' });
      result.push(`.sp
.RS 4
.ie n \\{\\
\\h'-04'\\(bu\\h'+03'\\c
.\\}
.el \\{\\
.  sp -1
.  IP \\(bu 2.3
.\\}${listText === '' ? '' : LF$1 + listText}`);
      if (item.hasBlocks()) {
        let itemContent = await item.content();
        if (listText === '' && itemContent.startsWith('.sp\n')) {
          itemContent = itemContent.slice(4);
        }
        result.push(itemContent);
      }
      result.push('.RE');
    }
    return result.join(LF$1)
  }

  async convert_verse(node) {
    const result = [];
    if (node.hasTitle()) {
      result.push(`.sp\n.B ${this.manify(node.title)}\n.br`);
    }
    let attributionLine = node.hasAttribute('citetitle')
      ? `${node.getAttribute('citetitle')} `
      : null;
    if (node.hasAttribute('attribution')) {
      attributionLine = `${attributionLine ?? ''}\\(em ${node.getAttribute('attribution')}`;
    } else {
      attributionLine = null;
    }
    result.push(
      `.sp\n.nf\n${this.manify(await node.content(), { whitespace: 'preserve' })}\n.fi\n.br`
    );
    if (attributionLine) {
      result.push(`.in +.5i\n.ll -.5i\n${attributionLine}\n.in\n.ll`);
    }
    return result.join(LF$1)
  }

  async convert_video(node) {
    const startParam = node.hasAttribute('start')
      ? `&start=${node.getAttribute('start')}`
      : '';
    const endParam = node.hasAttribute('end')
      ? `&end=${node.getAttribute('end')}`
      : '';
    const titleBlock = node.hasTitle()
      ? `.sp\n.B ${this.manify(node.title)}\n.br`
      : '.sp';
    return `${titleBlock}\n<${node.mediaUri(node.getAttribute('target'))}${startParam}${endParam}> (video)`
  }

  async convert_inline_anchor(node) {
    const target = node.target;
    switch (node.type) {
      case 'link': {
        let macro;
        let resolvedTarget = target;
        if (target.startsWith('mailto:')) {
          macro = 'MTO';
          resolvedTarget = target.slice(7);
        } else {
          macro = 'URL';
        }
        let text = node.text;
        if (text === resolvedTarget) {
          text = '';
        } else {
          text = text.replace(/"/g, `${ESC_BS}(dq`);
        }
        if (macro === 'MTO') {
          resolvedTarget = resolvedTarget.replace('@', `${ESC_BS}(at`);
        }
        return `${ESC_BS}c${LF$1}${ESC_FS}${macro} "${resolvedTarget}" "${text}" `
      }
      case 'xref': {
        let text = node.text;
        if (!text) {
          const refs = (this._refs ??= node.document.catalog.refs);
          const refid = node.attributes.refid;
          let top;
          const ref =
            refs[refid] ?? (!refid ? (top = this._getRootDocument(node)) : null);
          if (ref instanceof AbstractNode) {
            const resolvingSet = (this._resolvingXrefs ??= new Set());
            if (!resolvingSet.has(refid)) {
              resolvingSet.add(refid);
              const resolved = await ref.xreftext(
                node.getAttribute('xrefstyle', null, true)
              );
              resolvingSet.delete(refid);
              if (resolved) {
                text = resolved;
                if (
                  ref.context === 'section' &&
                  ref.level < 2 &&
                  text === ref.title
                ) {
                  text = this._uppercasePcdata(text);
                }
              } else {
                text = top ? '[^top]' : `[${refid}]`;
              }
            } else {
              text = top ? '[^top]' : `[${refid}]`;
            }
          } else {
            text = `[${refid}]`;
          }
        }
        return text
      }
      case 'ref':
      case 'bibref':
        // These are anchor points, which shouldn't be visible
        return ''
      default:
        this.logger.warn(`unknown anchor type: ${node.type}`);
        return null
    }
  }

  async convert_inline_break(node) {
    return `${node.text}${LF$1}${ESC_FS}br`
  }

  async convert_inline_button(node) {
    return `<${ESC_BS}fB>[${ESC_BS}0${node.text}${ESC_BS}0]</${ESC_BS}fP>`
  }

  async convert_inline_callout(node) {
    return `<${ESC_BS}fB>(${node.text})<${ESC_BS}fP>`
  }

  async convert_inline_footnote(node) {
    const index = node.getAttribute('index');
    if (index) return `[${index}]`
    if (node.type === 'xref') return `[${node.text}]`
    return null
  }

  async convert_inline_image(node) {
    return node.hasAttribute('link')
      ? `[${node.getAttribute('alt')}] <${node.getAttribute('link')}>`
      : `[${node.getAttribute('alt')}]`
  }

  async convert_inline_indexterm(node) {
    return node.type === 'visible' ? node.text : ''
  }

  async convert_inline_kbd(node) {
    const keys = node.getAttribute('keys');
    return `<${ESC_BS}f(CR>${keys.length === 1 ? keys[0] : keys.join(`${ESC_BS}0+${ESC_BS}0`)}</${ESC_BS}fP>`
  }

  async convert_inline_menu(node) {
    const caret = `${ESC_BS}0${ESC_BS}(fc${ESC_BS}0`;
    const menu = node.getAttribute('menu');
    const submenus = node.getAttribute('submenus');
    if (submenus && submenus.length > 0) {
      const submenuPath = submenus
        .map((item) => `<${ESC_BS}fI>${item}</${ESC_BS}fP>`)
        .join(caret);
      return `<${ESC_BS}fI>${menu}</${ESC_BS}fP>${caret}${submenuPath}${caret}<${ESC_BS}fI>${node.getAttribute('menuitem')}</${ESC_BS}fP>`
    } else if (node.getAttribute('menuitem')) {
      return `<${ESC_BS}fI>${menu}${caret}${node.getAttribute('menuitem')}</${ESC_BS}fP>`
    } else {
      return `<${ESC_BS}fI>${menu}</${ESC_BS}fP>`
    }
  }

  // NOTE use fake XML elements to prevent creating artificial word boundaries
  async convert_inline_quoted(node) {
    switch (node.type) {
      case 'emphasis':
        return `<${ESC_BS}fI>${node.text}</${ESC_BS}fP>`
      case 'strong':
        return `<${ESC_BS}fB>${node.text}</${ESC_BS}fP>`
      case 'monospaced':
        return `<${ESC_BS}f(CR>${node.text}</${ESC_BS}fP>`
      case 'single':
        return `<${ESC_BS}(oq>${node.text}</${ESC_BS}(cq>`
      case 'double':
        return `<${ESC_BS}(lq>${node.text}</${ESC_BS}(rq>`
      default:
        return node.text
    }
  }

  // Class method: write stub man pages for alternate names
  static async writeAlternatePages(mannames, manvolnum, target) {
    if (!mannames || mannames.length <= 1) return
    mannames = mannames.slice(1);
    const manvolext = `.${manvolnum}`;
    const { dirname, basename, join } = await import('node:path');
    const { writeFile } = await import('node:fs/promises');
    const dir = dirname(target);
    const base = basename(target);
    for (const manname of mannames) {
      await writeFile(join(dir, `${manname}${manvolext}`), `.so ${base}`);
    }
  }

  // ── Private helpers ───────────────────────────────────────────────────────────

  /**
   * @internal
   * @private
   */
  _appendFootnotes(result, node) {
    if (!node.hasFootnotes() || node.hasAttribute('nofootnotes')) return
    result.push('.SH "NOTES"');
    for (const fn of node.footnotes) {
      result.push(`.IP [${fn.index}]`);
      // NOTE restore newline in escaped macro that gets removed by normalize_text in substitutor
      let text = fn.text;
      if (text.includes(`${ESC}\\c ${ESC}.`)) {
        text = this.manify(
          `${text.replace(MalformedEscapedMacroRx, `$1${LF$1}$2`)} `,
          { whitespace: 'normalize' }
        ).replace(/ $/, '');
      } else {
        text = this.manify(text, { whitespace: 'normalize' });
      }
      result.push(text);
    }
  }

  /**
   * Converts HTML entity references back to their original form, escapes
   * special man characters and strips trailing whitespace.
   *
   * It's crucial that text only ever pass through manify once.
   *
   * @param {string} str - the string to convert
   * @param {Object} [opts={}] - options to control processing
   * @param {'preserve'|'normalize'|'collapse'} [opts.whitespace='collapse'] - how to handle whitespace:
   *   `'preserve'` preserves spaces (only expanding tabs);
   *   `'normalize'` removes spaces around newlines;
   *   `'collapse'` collapses adjacent whitespace to a single space
   * @param {boolean} [opts.append_newline=false] - append a newline to the result
   * @returns {string} the manified string
   */
  manify(str, opts = {}) {
    const whitespace = opts.whitespace ?? 'collapse';
    if (whitespace === 'preserve') {
      // expand tabs, then escape leading indentation (2+ spaces not at line start)
      str = str
        .replace(/\t/g, ET)
        .replace(/ {2,}/g, (m, offset, str) =>
          offset === 0 || str[offset - 1] === '\n' ? m : `${ESC_BS}&${m}`
        );
    } else if (whitespace === 'normalize') {
      str = str.replace(WrappedIndentRx, LF$1);
    } else {
      // collapse: replace any run of whitespace chars with a single space
      str = str.replace(/[\n\t ]+/g, ' ');
    }

    str = str
      // literal backslash (not a troff escape sequence)
      .replace(LiteralBackslashRx, (m, $1) => ($1 ? m : '\\(rs'))
      // horizontal ellipsis (emulate appearance)
      .replace(EllipsisCharRefRx, '.\\|.\\|.')
      // leading . used in troff for macro call; replace with \&.
      .replace(LeadingPeriodRx, '\\&.')
      // drop orphaned \c escape lines, unescape troff macro, quote adjacent char, isolate macro line
      .replace(EscapedMacroRx, (_m, $1, $2, $3) => {
        const rest = $3.trimStart();
        return rest === ''
          ? `.${$1}"${$2}"`
          : `.${$1}"${$2.trimEnd()}"\n${rest}`
      })
      .replace(/-/g, '\\-')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#43;/g, '+') // plus sign
      .replace(/&#160;/g, '\\~') // non-breaking space
      .replace(/&#169;/g, '\\(co') // copyright sign
      .replace(/&#174;/g, '\\(rg') // registered sign
      .replace(/&#8482;/g, '\\(tm') // trademark sign
      .replace(/&#176;/g, '\\(de') // degree sign
      .replace(/&#8201;/g, ' ') // thin space
      .replace(/&#8211;/g, '\\(en') // en dash
      .replace(EmDashCharRefRx, '\\(em') // em dash
      .replace(/&#8216;/g, '\\(oq') // left single quotation mark
      .replace(/&#8217;/g, '\\(cq') // right single quotation mark
      .replace(/&#8220;/g, '\\(lq') // left double quotation mark
      .replace(/&#8221;/g, '\\(rq') // right double quotation mark
      .replace(/&#8592;/g, '\\(<-') // leftwards arrow
      .replace(/&#8594;/g, '\\(->') // rightwards arrow
      .replace(/&#8656;/g, '\\(lA') // leftwards double arrow
      .replace(/&#8658;/g, '\\(rA') // rightwards double arrow
      .replace(/&#8203;/g, '\\:') // zero width space
      .replace(/&amp;/g, '&') // literal ampersand (must come after other & replacements)
      .replace(/'/g, '\\*(Aq') // apostrophe / neutral single quote
      .replace(MockMacroRx, '$1') // remove mock boundary markers
      .replace(/\u001b\\/g, '\\') // unescape troff backslash (ESC_BS → \)
      .replace(/\u001b\./g, '.') // unescape full stop in troff commands (ESC_FS → .)
      .trimEnd(); // strip trailing space

    return opts.append_newline ? `${str}${LF$1}` : str
  }

  /**
   * @internal
   * @private
   */
  _uppercasePcdata(string) {
    if (!XMLMarkupRx.test(string)) return string.toUpperCase()
    // Reset lastIndex since XMLMarkupRx is stateless (no /g flag) but test() advances for sticky
    return string.replace(PCDATAFilterRx, (_m, $1, $2) =>
      $2 ? $2.toUpperCase() : $1
    )
  }

  /**
   * @internal
   * @private
   */
  async _encloseContent(node) {
    return node.contentModel === 'compound'
      ? await node.content()
      : `.sp\n${this.manify(await node.content(), { whitespace: 'normalize' })}`
  }

  /**
   * @internal
   * @private
   */
  _getRootDocument(node) {
    while ((node = node.document).isNested()) {
      node = node.parentDocument;
    }
    return node
  }
}

ManPageConverter.registerFor('manpage');

const manpage = /*#__PURE__*/Object.freeze({
  __proto__: null,
  default: ManPageConverter
});

export { AbstractBlock, AbstractNode, Author, Block, BlockMacroProcessor, BlockProcessor, ContentModel, ConverterBase, CustomFactory$1 as ConverterCustomFactory, Converter as ConverterFactory, Cursor, DefaultFactory$1 as DefaultConverterFactory, DefaultFactory as DefaultSyntaxHighlighterFactory, DocinfoProcessor, Document, DocumentTitle, Extensions, Footnote, Html5Converter, HttpCache, HttpCacheManager, ImageReference, IncludeProcessor, Inline, InlineMacroProcessor, List, ListItem, LogMessage, Logger, LoggerManager, MemoryHttpCache, MemoryLogger, NullLogger, Postprocessor, Preprocessor, Processor, ProcessorExtension, Reader, Registry, RevisionInfo, SafeMode, Section, Severity, SyntaxHighlighter, SyntaxHighlighterBase, Timings, TreeProcessor, convert, deriveBackendTraits, getCoreVersion, getVersion, load };
