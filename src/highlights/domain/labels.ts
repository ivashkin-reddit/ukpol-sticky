// The labels Reddit shows under a highlight in new Reddit's row, of those Sticky Manager sets.

export const HIGHLIGHT_LABELS = ["megathread", "announcement", "event"] as const;
export type HighlightLabel = (typeof HIGHLIGHT_LABELS)[number];

const LABEL_NAMES: Readonly<Record<HighlightLabel, string>> = {
    megathread: "Megathread",
    announcement: "Announcement",
    event: "Event",
};

/** The label's name as moderators see it; undefined for none. */
export function labelName(label: HighlightLabel | undefined): string | undefined {
    return label === undefined ? undefined : LABEL_NAMES[label];
}

export function isHighlightLabel(value: string): value is HighlightLabel {
    return HIGHLIGHT_LABELS.some((label: HighlightLabel): boolean => label === value);
}
