# mdast-util-gfm-task-list-item

[![Build][badge-build-image]][badge-build-url]
[![Coverage][badge-coverage-image]][badge-coverage-url]
[![Downloads][badge-downloads-image]][badge-downloads-url]
[![Size][badge-size-image]][badge-size-url]

[mdast][github-mdast] extensions to parse and serialize [GFM][spec-gfm]
task list items.

## Contents

* [What is this?](#what-is-this)
* [When to use this](#when-to-use-this)
* [Install](#install)
* [Use](#use)
* [API](#api)
  * [`gfmTaskListItemFromMarkdown()`](#gfmtasklistitemfrommarkdown)
  * [`gfmTaskListItemToMarkdown()`](#gfmtasklistitemtomarkdown)
* [HTML](#html)
* [Syntax](#syntax)
* [Syntax tree](#syntax-tree)
  * [Nodes](#nodes)
  * [Content model](#content-model)
* [Types](#types)
* [Compatibility](#compatibility)
* [Related](#related)
* [Contribute](#contribute)
* [License](#license)

## What is this?

This package contains two extensions that add support for GFM task list item
syntax in markdown to [mdast][github-mdast].
These extensions plug into
[`mdast-util-from-markdown`][github-mdast-util-from-markdown]
(to support parsing task lists in markdown into a syntax tree) and
[`mdast-util-to-markdown`][github-mdast-util-to-markdown]
(to support serializing task lists in syntax trees to markdown).

## When to use this

You can use these extensions when you are working with
`mdast-util-from-markdown` and `mdast-util-to-markdown` already.

When working with `mdast-util-from-markdown`, you must combine this package
with
[`micromark-extension-gfm-task-list-item`][github-extension].

When you don’t need a syntax tree, you can use [`micromark`][github-micromark]
directly with `micromark-extension-gfm-task-list-item`.

When you are working with syntax trees and want all of GFM, use
[`mdast-util-gfm`][github-mdast-util-gfm] instead.

All these packages are used in [`remark-gfm`][github-remark-gfm], which
focusses on making it easier to transform content by abstracting these
internals away.

This utility does not handle how markdown is turned to HTML.
That’s done by [`mdast-util-to-hast`][github-mdast-util-to-hast].

## Install

This package is [ESM only][github-gist-esm].
In Node.js (version 16+),
install with [npm][npmjs-install]:

```sh
npm install mdast-util-gfm-task-list-item
```

In browsers with [`esm.sh`][esmsh]:

```html
<script type="module">
  import {gfmTaskListItemFromMarkdown, gfmTaskListItemToMarkdown} from 'https://esm.sh/mdast-util-gfm-task-list-item@2?bundle'
</script>
```

## Use

Say our document `example.md` contains:

```markdown
* [ ] To do
* [x] Done

1. Mixed…
2. [x] …messages
```

…and our module `example.js` looks as follows:

```js
import fs from 'node:fs/promises'
import {gfmTaskListItem} from 'micromark-extension-gfm-task-list-item'
import {fromMarkdown} from 'mdast-util-from-markdown'
import {gfmTaskListItemFromMarkdown, gfmTaskListItemToMarkdown} from 'mdast-util-gfm-task-list-item'
import {toMarkdown} from 'mdast-util-to-markdown'

const doc = await fs.readFile('example.md')

const tree = fromMarkdown(doc, {
  extensions: [gfmTaskListItem()],
  mdastExtensions: [gfmTaskListItemFromMarkdown()]
})

console.log(tree)

const out = toMarkdown(tree, {extensions: [gfmTaskListItemToMarkdown()]})

console.log(out)
```

…now running `node example.js` yields (positional info removed for brevity):

```js
{
  type: 'root',
  children: [
    {
      type: 'list',
      ordered: false,
      start: null,
      spread: false,
      children: [
        {
          type: 'listItem',
          spread: false,
          checked: false,
          children: [
            {type: 'paragraph', children: [{type: 'text', value: 'To do'}]}
          ]
        },
        {
          type: 'listItem',
          spread: false,
          checked: true,
          children: [
            {type: 'paragraph', children: [{type: 'text', value: 'Done'}]}
          ]
        }
      ]
    },
    {
      type: 'list',
      ordered: true,
      start: 1,
      spread: false,
      children: [
        {
          type: 'listItem',
          spread: false,
          checked: null,
          children: [
            {type: 'paragraph', children: [{type: 'text', value: 'Mixed…'}]}
          ]
        },
        {
          type: 'listItem',
          spread: false,
          checked: true,
          children: [
            {type: 'paragraph', children: [{type: 'text', value: '…messages'}]}
          ]
        }
      ]
    }
  ]
 }
```

```markdown
* [ ] To do
* [x] Done

1. Mixed…
2. [x] …messages
```

## API

This package exports the identifiers
[`gfmTaskListItemFromMarkdown`][api-gfm-task-list-item-from-markdown] and
[`gfmTaskListItemToMarkdown`][api-gfm-task-list-item-to-markdown].
There is no default export.

### `gfmTaskListItemFromMarkdown()`

Create an extension for
[`mdast-util-from-markdown`][github-mdast-util-from-markdown]
to enable GFM task list items in markdown.

###### Returns

Extension for `mdast-util-from-markdown` to enable GFM task list items
([`FromMarkdownExtension`][github-mdast-util-from-markdown-extension]).

### `gfmTaskListItemToMarkdown()`

Create an extension for
[`mdast-util-to-markdown`][github-mdast-util-to-markdown]
to enable GFM task list items in markdown.

###### Returns

Extension for `mdast-util-to-markdown` to enable GFM task list items
([`ToMarkdownExtension`][github-mdast-util-to-markdown-options]).

## HTML

This utility does not handle how markdown is turned to HTML.
That’s done by [`mdast-util-to-hast`][github-mdast-util-to-hast].

## Syntax

See [Syntax in
`micromark-extension-gfm-task-list-item`][github-extension-syntax].

## Syntax tree

The following interfaces are added to **[mdast][github-mdast]** by this utility.

### Nodes

#### `ListItem` (GFM)

```idl
interface ListItemGfm <: ListItem {
  checked: boolean?
}
```

In GFM, a `checked` field can be present.
It represents whether the item is done (when `true`), not done (when `false`),
or indeterminate or not applicable (when `null` or not present).

### Content model

#### `ListContent` (GFM)

```idl
type ListContentGfm = ListItemGfm
```

## Types

This package is fully typed with [TypeScript][].
It does not export additional types.

The `ListItem` type of the mdast nodes are exposed from `@types/mdast`.

## Compatibility

Projects maintained by the unified collective are compatible with maintained
versions of Node.js.

When we cut a new major release,
we drop support for unmaintained versions of Node.
This means we try to keep the current release line,
`mdast-util-gfm-task-list-item@2`,
compatible with Node.js 16.

This utility works with `mdast-util-from-markdown` version 2+ and
`mdast-util-to-markdown` version 2+.

## Related

* [`remark-gfm`][github-remark-gfm]
  — remark plugin to support GFM
* [`mdast-util-gfm`][github-mdast-util-gfm]
  — same but all of GFM (autolink literals, footnotes, strikethrough, tables,
  tasklists)
* [`micromark-extension-gfm-task-list-item`][github-extension]
  — micromark extension to parse GFM task list items

## Contribute

See
[`contributing.md`][health-contributing]
in
[`syntax-tree/.github`][health]
for ways to get started.
See [`support.md`][health-support] for ways to get help.

This project has a [code of conduct][health-coc].
By interacting with this repository,
organization,
or community you agree to abide by its terms.

## License

[MIT][file-license] © [Titus Wormer][wooorm]

<!-- Definitions -->

[api-gfm-task-list-item-from-markdown]: #gfmtasklistitemfrommarkdown

[api-gfm-task-list-item-to-markdown]: #gfmtasklistitemtomarkdown

[badge-build-image]: https://github.com/syntax-tree/mdast-util-gfm-task-list-item/workflows/main/badge.svg

[badge-build-url]: https://github.com/syntax-tree/mdast-util-gfm-task-list-item/actions

[badge-coverage-image]: https://img.shields.io/codecov/c/github/syntax-tree/mdast-util-gfm-task-list-item.svg

[badge-coverage-url]: https://codecov.io/github/syntax-tree/mdast-util-gfm-task-list-item

[badge-downloads-image]: https://img.shields.io/npm/dm/mdast-util-gfm-task-list-item.svg

[badge-downloads-url]: https://www.npmjs.com/package/mdast-util-gfm-task-list-item

[badge-size-image]: https://img.shields.io/bundlejs/size/mdast-util-gfm-task-list-item

[badge-size-url]: https://bundlejs.com/?q=mdast-util-gfm-task-list-item

[esmsh]: https://esm.sh

[file-license]: license

[github-extension]: https://github.com/micromark/micromark-extension-gfm-task-list-item

[github-extension-syntax]: https://github.com/micromark/micromark-extension-gfm-task-list-item#syntax

[github-gist-esm]: https://gist.github.com/sindresorhus/a39789f98801d908bbc7ff3ecc99d99c

[github-mdast]: https://github.com/syntax-tree/mdast

[github-mdast-util-from-markdown]: https://github.com/syntax-tree/mdast-util-from-markdown

[github-mdast-util-from-markdown-extension]: https://github.com/syntax-tree/mdast-util-from-markdown#extension

[github-mdast-util-gfm]: https://github.com/syntax-tree/mdast-util-gfm

[github-mdast-util-to-hast]: https://github.com/syntax-tree/mdast-util-to-hast

[github-mdast-util-to-markdown]: https://github.com/syntax-tree/mdast-util-to-markdown

[github-mdast-util-to-markdown-options]: https://github.com/syntax-tree/mdast-util-to-markdown#options

[github-micromark]: https://github.com/micromark/micromark

[github-remark-gfm]: https://github.com/remarkjs/remark-gfm

[health]: https://github.com/syntax-tree/.github

[health-coc]: https://github.com/syntax-tree/.github/blob/main/code-of-conduct.md

[health-contributing]: https://github.com/syntax-tree/.github/blob/main/contributing.md

[health-support]: https://github.com/syntax-tree/.github/blob/main/support.md

[npmjs-install]: https://docs.npmjs.com/cli/install

[spec-gfm]: https://github.github.com/gfm/

[typescript]: https://www.typescriptlang.org

[wooorm]: https://wooorm.com
