// Extract a concise summary of interactive elements from a page
// Returns a text representation that an LLM can use to plan DOM actions

export interface DomElement {
  index: number;
  tag: string;
  type?: string;
  text: string;
  selector: string;
  attributes: Record<string, string>;
}

export interface DomSnapshot {
  url: string;
  title: string;
  summary: string;       // Main visible text (truncated)
  elements: DomElement[];
}

export async function extractDom(page: any): Promise<DomSnapshot> {
  return page.evaluate(() => {
    const interactiveTags = new Set([
      "a", "button", "input", "textarea", "select", "details", "summary",
    ]);
    const interactiveRoles = new Set([
      "button", "link", "textbox", "checkbox", "radio", "combobox",
      "menuitem", "tab", "switch", "option", "searchbox",
    ]);

    const elements: any[] = [];
    let index = 1;

    // Walk the DOM for interactive elements
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_ELEMENT,
      {
        acceptNode(node: Element) {
          const el = node as HTMLElement;
          if (el.offsetWidth === 0 && el.offsetHeight === 0) return NodeFilter.FILTER_SKIP;
          if (el.getAttribute("aria-hidden") === "true") return NodeFilter.FILTER_SKIP;
          const tag = el.tagName.toLowerCase();
          const role = el.getAttribute("role") || "";
          const isClickable = el.onclick !== null || el.getAttribute("tabindex") !== null;
          if (interactiveTags.has(tag) || interactiveRoles.has(role) || isClickable) {
            return NodeFilter.FILTER_ACCEPT;
          }
          return NodeFilter.FILTER_SKIP;
        },
      }
    );

    while (walker.nextNode()) {
      const el = walker.currentNode as HTMLElement;
      const tag = el.tagName.toLowerCase();

      // Build a unique selector
      let selector = "";
      if (el.id) {
        selector = `#${el.id}`;
      } else if (el.getAttribute("name")) {
        selector = `${tag}[name="${el.getAttribute("name")}"]`;
      } else if (el.getAttribute("aria-label")) {
        selector = `${tag}[aria-label="${el.getAttribute("aria-label")}"]`;
      } else {
        // Use text content for buttons/links
        const text = (el.textContent || "").trim().slice(0, 30);
        if (text && (tag === "button" || tag === "a")) {
          selector = `${tag}:has-text("${text}")`;
        } else {
          // Fallback: nth-of-type
          const parent = el.parentElement;
          if (parent) {
            const siblings = Array.from(parent.querySelectorAll(`:scope > ${tag}`));
            const idx = siblings.indexOf(el);
            selector = `${tag}:nth-of-type(${idx + 1})`;
          } else {
            selector = tag;
          }
        }
      }

      const attrs: Record<string, string> = {};
      for (const attr of ["type", "placeholder", "value", "href", "aria-label", "role", "name"]) {
        const val = el.getAttribute(attr);
        if (val) attrs[attr] = val.slice(0, 100);
      }

      // Get visible text
      let text = "";
      if (tag === "input" || tag === "textarea") {
        text = (el as HTMLInputElement).placeholder || (el as HTMLInputElement).value || "";
      } else if (tag === "select") {
        const options = Array.from((el as HTMLSelectElement).options).map(o => o.text).slice(0, 5);
        text = `[${options.join(", ")}${(el as HTMLSelectElement).options.length > 5 ? "..." : ""}]`;
      } else {
        text = (el.textContent || "").trim().slice(0, 80);
      }

      elements.push({
        index: index++,
        tag,
        type: attrs.type,
        text,
        selector,
        attributes: attrs,
      });
    }

    // Get page summary text (first ~2000 chars of visible text)
    const bodyText = (document.body.innerText || "").trim().slice(0, 2000);

    return {
      url: window.location.href,
      title: document.title,
      summary: bodyText,
      elements,
    };
  });
}

export function formatDomSnapshot(snapshot: DomSnapshot): string {
  const lines: string[] = [
    `Page: ${snapshot.title}`,
    `URL: ${snapshot.url}`,
    "",
    "Interactive elements:",
  ];

  for (const el of snapshot.elements) {
    let desc = `[${el.index}] <${el.tag}`;
    if (el.type) desc += ` type="${el.type}"`;
    if (el.attributes.name) desc += ` name="${el.attributes.name}"`;
    if (el.attributes.placeholder) desc += ` placeholder="${el.attributes.placeholder}"`;
    if (el.attributes.href) desc += ` href="${el.attributes.href}"`;
    if (el.attributes["aria-label"]) desc += ` aria-label="${el.attributes["aria-label"]}"`;
    desc += `>`;
    if (el.text) desc += ` ${el.text}`;
    lines.push(desc);
  }

  if (snapshot.elements.length === 0) {
    lines.push("(no interactive elements found)");
  }

  return lines.join("\n");
}
