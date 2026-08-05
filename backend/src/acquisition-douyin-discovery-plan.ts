import type {
  AcquisitionSubjectChannel,
  AcquisitionTargetPlatform
} from "./acquisition-plan-run-repository.js";

const SEARCH_TOOL_QUERY_MAX_LENGTH = 1_000;
const DOUYIN_ROOT_PREFIXES = [
  "site:douyin.com ",
  "site:iesdouyin.com "
] as const;
const ZERO_WIDTH_CHARACTERS =
  /[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/gu;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/gu;
const ZERO_WIDTH_CHARACTER_PRESENT =
  /[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u;
const CONTROL_CHARACTER_PRESENT = /[\u0000-\u001f\u007f-\u009f]/u;
const SITE_CLAUSES =
  /(?:^|(?<=[\s(]))[-+]?\s*site\s*:\s*(?:"[^"]*"|'[^']*'|[^\s)]+)/giu;
const SITE_CLAUSE_REMAINS =
  /(?:^|(?<=[\s(]))[-+]?\s*site\s*:/iu;
const SEMANTIC_CONTENT = /[\p{L}\p{N}]/u;

export interface AcquisitionDiscoveryQueryIntent {
  subjectChannel: AcquisitionSubjectChannel;
  query: string;
}

function normalizedSemanticQuery(value: string) {
  return value
    .normalize("NFKC")
    .replace(ZERO_WIDTH_CHARACTERS, "")
    .replace(CONTROL_CHARACTERS, " ")
    .replace(SITE_CLAUSES, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function boundedQuery(value: string, maxLength: number) {
  let result = value.slice(0, maxLength);
  const finalCodeUnit = result.charCodeAt(result.length - 1);
  if (finalCodeUnit >= 0xd800 && finalCodeUnit <= 0xdbff) {
    result = result.slice(0, -1);
  }
  return result.trimEnd();
}

function addUnique(
  output: AcquisitionDiscoveryQueryIntent[],
  seen: Set<string>,
  subjectChannel: AcquisitionSubjectChannel,
  query: string
) {
  const key = `${subjectChannel}\u0000${query}`;
  if (seen.has(key)) return;
  seen.add(key);
  output.push({ subjectChannel, query });
}

export function compileAcquisitionDiscoveryQueries(input: {
  targetPlatform: AcquisitionTargetPlatform;
  queryIntents: readonly AcquisitionDiscoveryQueryIntent[];
}): AcquisitionDiscoveryQueryIntent[] {
  const output: AcquisitionDiscoveryQueryIntent[] = [];
  const seen = new Set<string>();
  for (const intent of input.queryIntents) {
    const semanticQuery = normalizedSemanticQuery(intent.query);
    if (!semanticQuery || !SEMANTIC_CONTENT.test(semanticQuery)) {
      throw new Error("ACQUISITION_DISCOVERY_QUERY_EMPTY");
    }
    if (input.targetPlatform === "web") {
      addUnique(
        output,
        seen,
        intent.subjectChannel,
        boundedQuery(semanticQuery, SEARCH_TOOL_QUERY_MAX_LENGTH)
      );
      continue;
    }
    for (const prefix of DOUYIN_ROOT_PREFIXES) {
      const boundedSemantic = boundedQuery(
        semanticQuery,
        SEARCH_TOOL_QUERY_MAX_LENGTH - prefix.length
      );
      if (!boundedSemantic || !SEMANTIC_CONTENT.test(boundedSemantic)) {
        throw new Error("ACQUISITION_DISCOVERY_QUERY_EMPTY");
      }
      addUnique(
        output,
        seen,
        intent.subjectChannel,
        `${prefix}${boundedSemantic}`
      );
    }
  }
  return output;
}

export function isSafeDouyinSearchQuery(query: string) {
  if (!query
    || query.length > SEARCH_TOOL_QUERY_MAX_LENGTH
    || query !== query.normalize("NFKC")
    || ZERO_WIDTH_CHARACTER_PRESENT.test(query)
    || CONTROL_CHARACTER_PRESENT.test(query)) {
    return false;
  }
  const prefix = DOUYIN_ROOT_PREFIXES.find((candidate) =>
    query.startsWith(candidate)
  );
  if (!prefix) return false;
  const semanticQuery = query.slice(prefix.length);
  return semanticQuery.trim().length > 0
    && SEMANTIC_CONTENT.test(semanticQuery)
    && semanticQuery === semanticQuery.trim()
    && !SITE_CLAUSE_REMAINS.test(` ${semanticQuery}`);
}
