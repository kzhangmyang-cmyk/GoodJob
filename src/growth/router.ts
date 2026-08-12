export type GrowthRoute =
  | { name: "advisor" }
  | { name: "catalog" }
  | { name: "finance" }
  | {
      name: "quote";
      quoteCaseId?: string;
      candidateId?: string;
      dealId?: string;
    }
  | {
      name: "roi";
      cohortId?: string;
      currency?: string;
      closureVersionId?: string;
    };

export function parseGrowthHash(hash: string): GrowthRoute | null {
  const [pathname, query = ""] = hash.replace(/^#/, "").split("?", 2);
  const params = new URLSearchParams(query);
  if (pathname === "growth/advisor") return { name: "advisor" };
  if (pathname === "growth/catalog") return { name: "catalog" };
  if (pathname === "growth/finance") return { name: "finance" };
  if (pathname === "growth/quotes") {
    return Object.assign(
      { name: "quote" as const },
      params.get("case") ? { quoteCaseId: params.get("case")! } : null,
      params.get("candidate")
        ? { candidateId: params.get("candidate")! } : null,
      params.get("deal") ? { dealId: params.get("deal")! } : null
    );
  }
  if (pathname === "growth/roi") {
    return Object.assign(
      { name: "roi" as const },
      params.get("cohort") ? { cohortId: params.get("cohort")! } : null,
      params.get("currency") ? { currency: params.get("currency")! } : null,
      params.get("closure")
        ? { closureVersionId: params.get("closure")! } : null
    );
  }
  return null;
}

export function growthHash(route: GrowthRoute): string {
  switch (route.name) {
    case "advisor":
    case "catalog":
    case "finance":
      return `#growth/${route.name}`;
    case "quote": {
      const params = new URLSearchParams();
      if (route.quoteCaseId) params.set("case", route.quoteCaseId);
      if (route.candidateId) params.set("candidate", route.candidateId);
      if (route.dealId) params.set("deal", route.dealId);
      const query = params.toString();
      return query ? `#growth/quotes?${query}` : "#growth/quotes";
    }
    case "roi": {
      const params = new URLSearchParams();
      if (route.cohortId) params.set("cohort", route.cohortId);
      if (route.currency) params.set("currency", route.currency);
      if (route.closureVersionId) params.set("closure", route.closureVersionId);
      const query = params.toString();
      return query ? `#growth/roi?${query}` : "#growth/roi";
    }
  }
}
