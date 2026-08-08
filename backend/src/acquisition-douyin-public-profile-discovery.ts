import { createHash } from "node:crypto";
import {
  classifyDouyinPublicSource
} from "./acquisition-douyin-public-source.js";
import {
  isVerifiedAcquisitionPublicProfileUrl,
  normalizeAcquisitionPublicUrl
} from "./acquisition-public-identity-resolver.js";
import {
  fetchProviderHttpWithRedirectTrace,
  type ProviderHttpRedirectTrace
} from "./provider-http-client.js";
import { ProviderContractError, type ProviderNetworkPolicy } from "./provider-contract.js";

const DOUYIN_PUBLIC_PROFILE_POLICY: ProviderNetworkPolicy = {
  allowedHosts: [
    "douyin.com",
    "www.douyin.com",
    "v.douyin.com",
    "iesdouyin.com",
    "www.iesdouyin.com"
  ],
  redirectHosts: [
    "douyin.com",
    "www.douyin.com",
    "v.douyin.com",
    "iesdouyin.com",
    "www.iesdouyin.com"
  ],
  allowedPathPrefixes: ["/"],
  allowedMethods: ["GET"]
};

const EXACT_DOUYIN_HOSTS = new Set(DOUYIN_PUBLIC_PROFILE_POLICY.allowedHosts);
const RESTRICTED_PAGE = /(?:login|verify|captcha|登录|验证|安全校验)/iu;

export type DouyinPublicProfileDiscoveryResult =
  | {
      status: "succeeded";
      redirectChain: string[];
      publicProfileUrls: string[];
      rawArtifactHash: string;
      contentHash: string;
    }
  | {
      status: "access_restricted" | "redirect_not_allowed" | "not_found";
      redirectChain: string[];
      publicProfileUrls: [];
    };

export interface AcquisitionDouyinPublicProfileDiscoveryPort {
  discover(input: {
    sourceUrl: string;
    sourceEvidenceId: string;
    signal?: AbortSignal;
  }): Promise<DouyinPublicProfileDiscoveryResult>;
}

export interface AcquisitionDouyinPublicProfileDiscoveryOptions {
  fetchWithRedirectTrace?: (
    policy: ProviderNetworkPolicy,
    rawUrl: string,
    init?: RequestInit
  ) => Promise<ProviderHttpRedirectTrace>;
  hash?: (value: string) => string;
}

function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function exactAllowedPublicUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && !url.username
      && !url.password
      && !url.port
      && EXACT_DOUYIN_HOSTS.has(url.hostname.toLocaleLowerCase("en-US"));
  } catch {
    return false;
  }
}

function validSourceUrl(value: string) {
  if (!exactAllowedPublicUrl(value)) return false;
  const sourceType = classifyDouyinPublicSource(value)?.sourceType;
  return sourceType === "profile" || sourceType === "video" || sourceType === "short_link";
}

function normalizeProfileUrl(value: string) {
  try {
    const url = new URL(value);
    if (!exactAllowedPublicUrl(url.toString())) return null;
    url.search = "";
    url.hash = "";
    const normalized = normalizeAcquisitionPublicUrl(url.toString());
    return normalized
      && classifyDouyinPublicSource(normalized)?.sourceType === "profile"
      && isVerifiedAcquisitionPublicProfileUrl(normalized)
      ? normalized
      : null;
  } catch {
    return null;
  }
}

function explicitPublicUrls(html: string, pageUrl: string) {
  const candidates = new Set<string>();
  const patterns = [
    /\bhref\s*=\s*(["'])(.*?)\1/giu,
    /["'](?:canonical|url|profileUrl)["']\s*:\s*["']([^"']+)["']/giu
  ];
  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      const raw = match[2] || match[1] || "";
      try {
        const normalized = normalizeProfileUrl(new URL(raw, pageUrl).toString());
        if (normalized) candidates.add(normalized);
      } catch {
        // A malformed explicit URL is not evidence.
      }
    }
  }
  return [...candidates].sort((left, right) => left.localeCompare(right));
}

function restricted(response: Response, body: string, redirectChain: string[]) {
  return response.status === 401
    || response.status === 403
    || response.status === 429
    || redirectChain.some((url) => RESTRICTED_PAGE.test(new URL(url).pathname))
    || RESTRICTED_PAGE.test(body);
}

export function createAcquisitionDouyinPublicProfileDiscovery(
  options: AcquisitionDouyinPublicProfileDiscoveryOptions = {}
): AcquisitionDouyinPublicProfileDiscoveryPort {
  const fetchWithRedirectTrace = options.fetchWithRedirectTrace
    || fetchProviderHttpWithRedirectTrace;
  const hash = options.hash || sha256;

  return {
    async discover(input) {
      if (!validSourceUrl(input.sourceUrl)) {
        return {
          status: "redirect_not_allowed",
          redirectChain: [],
          publicProfileUrls: []
        };
      }
      let traced: ProviderHttpRedirectTrace;
      try {
        traced = await fetchWithRedirectTrace(
          DOUYIN_PUBLIC_PROFILE_POLICY,
          input.sourceUrl,
          { method: "GET", signal: input.signal }
        );
      } catch (error) {
        if (error instanceof ProviderContractError) {
          return {
            status: "redirect_not_allowed",
            redirectChain: [],
            publicProfileUrls: []
          };
        }
        return {
          status: "access_restricted",
          redirectChain: [],
          publicProfileUrls: []
        };
      }
      const redirectChain = traced.redirectChain;
      if (!redirectChain.every(exactAllowedPublicUrl)) {
        return { status: "redirect_not_allowed", redirectChain, publicProfileUrls: [] };
      }
      const body = await traced.response.text();
      if (restricted(traced.response, body, redirectChain)) {
        return { status: "access_restricted", redirectChain, publicProfileUrls: [] };
      }
      if (traced.response.status === 404) {
        return { status: "not_found", redirectChain, publicProfileUrls: [] };
      }
      if (!traced.response.ok) {
        return { status: "access_restricted", redirectChain, publicProfileUrls: [] };
      }
      const publicProfileUrls = explicitPublicUrls(body, redirectChain.at(-1) || input.sourceUrl);
      if (!publicProfileUrls.length) {
        return { status: "not_found", redirectChain, publicProfileUrls: [] };
      }
      return {
        status: "succeeded",
        redirectChain,
        publicProfileUrls,
        rawArtifactHash: hash(body),
        contentHash: hash(JSON.stringify(publicProfileUrls))
      };
    }
  };
}
