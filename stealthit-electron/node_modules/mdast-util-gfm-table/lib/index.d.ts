/**
 * Create an extension for `mdast-util-from-markdown` to enable GFM tables in
 * markdown.
 *
 * @returns {FromMarkdownExtension}
 *   Extension for `mdast-util-from-markdown` to enable GFM tables.
 */
export function gfmTableFromMarkdown(): FromMarkdownExtension;
/**
 * Create an extension for `mdast-util-to-markdown` to enable GFM tables in
 * markdown.
 *
 * @param {Options | null | undefined} [options]
 *   Configuration.
 * @returns {ToMarkdownExtension}
 *   Extension for `mdast-util-to-markdown` to enable GFM tables.
 */
export function gfmTableToMarkdown(options?: Options | null | undefined): ToMarkdownExtension;
/**
 * Configuration.
 */
export type Options = {
    /**
     * Whether to add a space of padding between delimiters and cells (default:
     * `true`).
     */
    tableCellPadding?: boolean | null | undefined;
    /**
     * Whether to align the delimiters (default: `true`).
     */
    tablePipeAlign?: boolean | null | undefined;
    /**
     * Function to detect the length of table cell content, used when aligning
     * the delimiters between cells (optional).
     */
    stringLength?: MarkdownTableOptions["stringLength"] | null | undefined;
};
import type { Extension as FromMarkdownExtension } from 'mdast-util-from-markdown';
import type { Options as ToMarkdownExtension } from 'mdast-util-to-markdown';
import type { Options as MarkdownTableOptions } from 'markdown-table';
//# sourceMappingURL=index.d.ts.map