import { Fragment } from "react";

const URL_PATTERN = /https?:\/\/[^\s<>"']+/g;

/** Sentence punctuation that ends a URL in prose without belonging to it. A
 * closing bracket counts only when the URL has no opener for it, so
 * `…/wiki/Rust_(language)` keeps its parenthesis and `(see https://x.dev)`
 * does not gain one. */
function trimTrailingPunctuation(url: string): string {
  let end = url.length;
  for (; end > 0; end--) {
    const ch = url[end - 1];
    if (".,;:!?".includes(ch)) continue;
    const opener = { ")": "(", "]": "[", "}": "{" }[ch];
    if (opener && !url.slice(0, end - 1).includes(opener)) continue;
    break;
  }
  return url.slice(0, end);
}

/**
 * Plain text with its http(s) URLs drawn as links that open in a new tab.
 *
 * The text is written by an agent or pasted by the user, so it is untrusted:
 * only the two web schemes are recognized, which keeps `javascript:` and
 * `data:` URLs inert, and everything else renders as text, never as markup.
 */
export function Linkified({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const url = trimTrailingPunctuation(match[0]);
    parts.push(
      <Fragment key={match.index}>
        {text.slice(last, match.index)}
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline underline-offset-2 hover:no-underline"
        >
          {url}
        </a>
      </Fragment>,
    );
    last = match.index + url.length;
  }
  parts.push(text.slice(last));
  return <>{parts}</>;
}
