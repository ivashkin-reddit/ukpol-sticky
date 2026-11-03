import { format } from "date-fns";

// A title may contain one token such as `{{date yyyy-MM-dd}}`; the text after "date " is a date-fns format string.
const DATE_TOKEN = /\{\{date (?<dateFormat>.+)\}\}/u;

export interface DateToken {
    readonly text: string;
    readonly dateFormat: string;
}

export function findDateToken(title: string): DateToken | undefined {
    const match = DATE_TOKEN.exec(title);
    const dateFormat = match?.groups?.["dateFormat"];
    if (match === null || dateFormat === undefined) {
        return undefined;
    }

    return { text: match[0], dateFormat };
}

export function renderTitle(title: string, now: Date): string {
    const token = findDateToken(title);
    if (token === undefined) {
        return title;
    }

    // A replacer function, so `$` sequences in the formatted date are not read as replacement patterns.
    return title.replace(token.text, (): string => format(now, token.dateFormat));
}
