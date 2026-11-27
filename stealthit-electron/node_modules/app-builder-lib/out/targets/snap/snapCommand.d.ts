/**
 * Validates that a value is safe to embed in a double-quoted shell string.
 * Rejects characters that would be interpreted as shell metacharacters inside `"..."`:
 * `$`, backtick, `"`, `\`, and newlines.
 */
export declare function validateShellEmbeddable(value: string, fieldName: string): void;
/** Single-quote a shell argument, escaping any embedded single quotes. */
export declare function shellQuote(arg: string): string;
/**
 * Builds the contents of the launcher script that execs `$SNAP/app/<execName>` with the given args.
 * `$@` is forwarded so launch-time arguments still reach the app. The executable name is validated
 * against shell metacharacters and each arg is single-quoted, so embedded characters (e.g. `=`, quotes)
 * are passed literally.
 */
export declare function buildSnapCommandLauncherScript(opts: {
    execName: string;
    args: string[];
}): string;
