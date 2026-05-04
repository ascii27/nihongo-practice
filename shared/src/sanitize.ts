import sanitizeHtml from "sanitize-html";

export function sanitizeRuby(input: string): string {
  return sanitizeHtml(input, {
    allowedTags: ["ruby", "rt", "rp"],
    allowedAttributes: {},
    disallowedTagsMode: "discard",
  });
}
