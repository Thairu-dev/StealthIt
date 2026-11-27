"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isEmptyOrSpaces = isEmptyOrSpaces;
exports.escapeForXml = escapeForXml;
function isEmptyOrSpaces(s) {
    return s == null || s.trim().length === 0;
}
/**
 * escape given string for usage as XML text or attribute value
 */
function escapeForXml(raw) {
    if (!raw) {
        return "";
    }
    return raw.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
//# sourceMappingURL=stringUtil.js.map