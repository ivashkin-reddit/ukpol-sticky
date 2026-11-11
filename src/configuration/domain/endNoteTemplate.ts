// An end note can link the post that replaces the one it retires: the token below becomes a Markdown link, titled
// with the new post's title. The link is the post's relative permalink, which Reddit resolves on whichever site the
// reader is on, so old.reddit readers stay on old.reddit.
const NEW_POST_TOKEN = "{{new post}}";

// Backslashes and square brackets would end the link text early or escape its closing bracket.
const LINK_TEXT_SPECIAL = /[\[\\\]]/gv;

/** The post an end note links. */
export interface LinkedPost {
    readonly title: string;
    readonly permalink: string;
}

/** A Markdown link to `post`, titled with its title. */
export function markdownLink(post: LinkedPost): string {
    const linkText = post.title.replace(LINK_TEXT_SPECIAL, (character: string): string => `\\${character}`);
    return `[${linkText}](${post.permalink})`;
}

/** `endNote` with every `{{new post}}` replaced by a link to `newPost`. */
export function renderEndNote(endNote: string, newPost: LinkedPost): string {
    return endNote.split(NEW_POST_TOKEN).join(markdownLink(newPost));
}
