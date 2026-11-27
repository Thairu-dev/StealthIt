/**
 * @import {Delete} from 'mdast'
 * @import {
 *   CompileContext,
 *   Extension as FromMarkdownExtension,
 *   Handle as FromMarkdownHandle
 * } from 'mdast-util-from-markdown'
 * @import {
 *   Attention,
 *   ConstructName,
 *   Handle as ToMarkdownHandle,
 *   Options as ToMarkdownExtension
 * } from 'mdast-util-to-markdown'
 */

/**
 * List of constructs that occur in phrasing (paragraphs, headings), but cannot
 * contain strikethrough.
 * So they sort of cancel each other out.
 * Note: could use a better name.
 *
 * Note: keep in sync with: <https://github.com/syntax-tree/mdast-util-to-markdown/blob/8ce8dbf/lib/unsafe.js#L14>
 *
 * @type {Array<ConstructName>}
 */
const constructsWithoutStrikethrough = [
  'autolink',
  'destinationLiteral',
  'destinationRaw',
  'reference',
  'titleQuote',
  'titleApostrophe'
]

handleDelete.attention = attentionDelete
handleDelete.peek = peekDelete

/**
 * Create an extension for `mdast-util-from-markdown` to enable GFM
 * strikethrough in markdown.
 *
 * @returns {FromMarkdownExtension}
 *   Extension for `mdast-util-from-markdown` to enable GFM strikethrough.
 */
export function gfmStrikethroughFromMarkdown() {
  return {
    canContainEols: ['delete'],
    enter: {strikethrough: enterStrikethrough},
    exit: {strikethrough: exitStrikethrough}
  }
}

/**
 * Create an extension for `mdast-util-to-markdown` to enable GFM
 * strikethrough in markdown.
 *
 * @returns {ToMarkdownExtension}
 *   Extension for `mdast-util-to-markdown` to enable GFM strikethrough.
 */
export function gfmStrikethroughToMarkdown() {
  return {
    handlers: {delete: handleDelete},
    unsafe: [
      {
        character: '~',
        inConstruct: 'phrasing',
        notInConstruct: constructsWithoutStrikethrough
      }
    ]
  }
}

/**
 * Enter strikethrough.
 *
 * @this {CompileContext}
 * @type {FromMarkdownHandle}
 */
function enterStrikethrough(token) {
  this.enter({type: 'delete', children: [], position: undefined}, token)
}

/**
 * Exit strikethrough.
 *
 * @this {CompileContext}
 * @type {FromMarkdownHandle}
 */
function exitStrikethrough(token) {
  this.exit(token)
}

/**
 * Serialize a delete node.
 *
 * @type {ToMarkdownHandle}
 * @param {Delete} node
 *   Node to serialize.
 */
function handleDelete(node, _, state, info) {
  // To do: next major: empty this function, like emphasis and strong handlers,
  // this is no longer needed.
  const tracker = state.createTracker(info)
  const sequence = state.stack.includes('strikethrough') ? '~' : '~~'
  const exit = state.enter('strikethrough')
  let value = tracker.move(sequence)
  value += state.containerPhrasing(node, {
    ...tracker.current(),
    before: value,
    after: '~'
  })
  value += tracker.move(sequence)
  exit()
  return value
}

/**
 * Serialize a delete node as attention.
 *
 * @type {Attention}
 */
function attentionDelete() {
  return {construct: 'strikethrough', markers: ['~'], sizes: [2, 1]}
}

/**
 * Peek the first character of a delete node.
 *
 * @type {ToMarkdownHandle}
 */
function peekDelete() {
  return '~'
}
