import { compact } from "lodash";
import { parseAllDocuments } from "yaml";
import { checkThreadConfigs } from "./domain/threadConfig.js";
import type { ConfigProblem, ThreadConfig } from "./domain/threadConfig.js";

/** A config problem in a config page revision: invalid YAML, or a problem in the thread configs it defines. */
export type ConfigPageProblem = ConfigProblem | Readonly<{ kind: "invalidYaml"; errors: readonly string[] }>;

/** Whether a config page revision can be accepted: its thread configs, or its first config problem. */
export type ConfigPageCheck =
    | Readonly<{ kind: "invalid"; problem: ConfigPageProblem }>
    | Readonly<{ kind: "valid"; configs: readonly ThreadConfig[] }>;

interface YamlDocument {
    readonly errors: readonly Readonly<{ message: string }>[];
    readonly toJSON: () => unknown;
}

/**
 * The documents' values, or the errors that kept documents from producing one. An alias to an anchor that does not
 * exist (or is in another document) parses without errors and only fails here.
 */
function documentValues(
    documents: readonly YamlDocument[],
): Readonly<{ errors: string[] }> | Readonly<{ values: unknown[] }> {
    const errors: string[] = [];
    const values: unknown[] = [];
    for (const [index, document] of documents.entries()) {
        try {
            values.push(document.toJSON());
        } catch (error: unknown) {
            if (!(error instanceof Error)) {
                throw error;
            }

            errors.push(`Document ${String(index + 1)}: ${error.message}`);
        }
    }

    return errors.length > 0 ? { errors } : { values };
}

/** The config page's YAML documents as values, or the errors in parsing them. */
function parseConfigPage(content: string): Readonly<{ errors: string[] }> | Readonly<{ values: unknown[] }> {
    const documents: readonly YamlDocument[] = parseAllDocuments(content);
    const parseErrors = documents.flatMap((document: YamlDocument, index: number): string[] =>
        document.errors.map(
            (error: Readonly<{ message: string }>): string => `Document ${String(index + 1)}: ${error.message}`,
        ),
    );
    return parseErrors.length > 0 ? { errors: parseErrors } : documentValues(documents);
}

/** Parses a config page revision's YAML documents and checks the thread configs they define. */
export function checkConfigPage(content: string): ConfigPageCheck {
    const parsed = parseConfigPage(content);
    if ("errors" in parsed) {
        return { kind: "invalid", problem: { kind: "invalidYaml", errors: parsed.errors } };
    }

    // Empty documents parse to null; compact drops them before checking.
    return checkThreadConfigs(compact(parsed.values));
}
