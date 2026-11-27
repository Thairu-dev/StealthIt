import { Nullish } from "builder-util-runtime";
export declare function isEmptyOrSpaces(s: string | Nullish): s is "" | Nullish;
/**
 * escape given string for usage as XML text or attribute value
 */
export declare function escapeForXml(raw?: string | null): string;
