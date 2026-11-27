/**
 * @import {ListItem, Paragraph, Parents} from 'mdast'
 * @import {
 *   CompileContext,
 *   Extension as FromMarkdownExtension,
 *   Handle as FromMarkdownHandle
 * } from 'mdast-util-from-markdown'
 * @import {
 *   Handle as ToMarkdownHandle,
 *   Join as ToMarkdownJoin,
 *   Options as ToMarkdownExtension
 * } from 'mdast-util-to-markdown'
 */

import {ok as assert} from 'devlop'
import {defaultHandlers} from 'mdast-util-to-markdown'

/**
 * Create an extension for `mdast-util-from-markdown` to enable GFM task
 * list items in markdown.
 *
 * @returns {FromMarkdownExtension}
 *   Extension for `mdast-util-from-markdown` to enable GFM task list items.
 */
export function gfmTaskListItemFromMarkdown() {
  return {
    exit: {
      taskListCheckValueChecked: exitCheck,
      taskListCheckValueUnchecked: exitCheck,
      paragraph: exitParagraphWithTaskListItem
    }
  }
}

/**
 * Create an extension for `mdast-util-to-markdown` to enable GFM task list
 * items in markdown.
 *
 * @returns {ToMarkdownExtension}
 *   Extension for `mdast-util-to-markdown` to enable GFM task list items.
 */
export function gfmTaskListItemToMarkdown() {
  return {
    handlers: {paragraph: paragraphWithTaskListItem},
    join: [joinDefinitionsBeforeTaskListItemParagraph]
  }
}

/**
 * Exit a check.
 *
 * @this {CompileContext}
 * @type {FromMarkdownHandle}
 */
function exitCheck(token) {
  // We’re always in a paragraph, in a list item.
  const node = this.stack[this.stack.length - 2]
  assert(node.type === 'listItem')
  node.checked = token.type === 'taskListCheckValueChecked'
}

/**
 * Exit a paragraph, removing the whitespace after a check.
 *
 * @this {CompileContext}
 * @type {FromMarkdownHandle}
 */
function exitParagraphWithTaskListItem(token) {
  const parent = this.stack[this.stack.length - 2]

  if (
    parent &&
    parent.type === 'listItem' &&
    typeof parent.checked === 'boolean'
  ) {
    const node = this.stack[this.stack.length - 1]
    assert(node.type === 'paragraph')
    const head = node.children[0]

    if (head && head.type === 'text') {
      const siblings = parent.children
      let index = -1
      /** @type {Paragraph | undefined} */
      let firstParagraph

      while (++index < siblings.length) {
        const sibling = siblings[index]
        if (sibling.type === 'paragraph') {
          firstParagraph = sibling
          break
        }
      }

      if (firstParagraph === node) {
        // Must start with a space or a tab.
        head.value = head.value.slice(1)

        if (head.value.length === 0) {
          node.children.shift()
        } else if (
          node.position &&
          head.position &&
          typeof head.position.start.offset === 'number'
        ) {
          head.position.start.column++
          head.position.start.offset++
          node.position.start = {...head.position.start}
        }
      }
    }
  }

  this.exit(token)
}

/**
 * Serialize a paragraph,
 * with a check if it is the paragraph of a task list item.
 *
 * @type {ToMarkdownHandle}
 * @param {Paragraph} node
 *   Paragraph.
 * @param {Parents | undefined} parent
 *   Parent.
 */
function paragraphWithTaskListItem(node, parent, state, info) {
  if (
    !parent ||
    parent.type !== 'listItem' ||
    taskListItemParagraph(parent) !== node
  ) {
    return defaultHandlers.paragraph(node, parent, state, info)
  }

  const checkbox = '[' + (parent.checked ? 'x' : ' ') + '] '
  const tracker = state.createTracker(info)
  tracker.move(checkbox)
  // Check needs content after it, use an encoded space if there is no content
  // but there is `checked`.
  const value = defaultHandlers.paragraph(
    node.children.length > 0
      ? node
      : {type: 'paragraph', children: [{type: 'text', value: ' '}]},
    parent,
    state,
    {...info, ...tracker.current()}
  )

  return checkbox + value
}

/**
 * Join definitions before the paragraph of a task list item without blank
 * lines,
 * as a check is only seen at the start of the first content of a list item.
 *
 * @type {ToMarkdownJoin}
 */
function joinDefinitionsBeforeTaskListItemParagraph(left, _, parent) {
  if (!(left.type === 'definition' && parent.type === 'listItem')) {
    return
  }

  const paragraph = taskListItemParagraph(parent)

  if (
    paragraph &&
    parent.children.indexOf(left) < parent.children.indexOf(paragraph)
  ) {
    return 0
  }
}

/**
 * Find the paragraph of a task list item that can start with a check.
 *
 * @param {ListItem} node
 *   List item.
 * @returns {Paragraph | undefined}
 *   Paragraph, if `node` is checkable.
 */
function taskListItemParagraph(node) {
  if (typeof node.checked !== 'boolean') {
    return
  }

  for (const child of node.children) {
    if (child.type === 'paragraph') {
      return child
    }

    if (child.type !== 'definition') {
      return
    }
  }
}
