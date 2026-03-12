import TurndownService from "turndown";

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
});

turndown.remove(["script", "style", "nav", "footer", "header"]);

export function htmlToMarkdown(html: string): string {
  return turndown.turndown(html);
}
