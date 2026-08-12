import type {
  components,
  operations,
  paths
} from "../generated/growth-advisor-quote-roi.js";

export const GROWTH_CONTRACT_NAME = "growth-advisor-quote-roi";
export const GROWTH_CONTRACT_VERSION = "1.0.3";

export type GrowthPaths = paths;
export type GrowthOperations = operations;
export type GrowthComponents = components;

export type GrowthBootstrapResponse =
  components["schemas"]["GrowthBootstrapResponse"];
export type GrowthCatalogItem = components["schemas"]["CatalogItem"];
export type GrowthPackageVersion = components["schemas"]["PackageVersion"];
export type GrowthPricingPolicyVersion =
  components["schemas"]["PricingPolicyVersion"];
export type GrowthQuoteCase = components["schemas"]["QuoteCase"];
export type GrowthQuoteVersion = components["schemas"]["QuoteVersion"];
export type GrowthQuoteApproval = components["schemas"]["QuoteApproval"];
export type GrowthFinancialDataGapView =
  components["schemas"]["FinancialDataGapView"];
export type GrowthAdvisorTodayQuery =
  components["schemas"]["AdvisorTodayResponse_AdvisorTodayQuery"];
export type GrowthAdvisorTodayResponse =
  components["schemas"]["AdvisorTodayResponse"];
export type GrowthAdvisorRecommendation =
  components["schemas"]["AdvisorRecommendation"];
export type GrowthAdvisorRecommendationTransitionInput =
  components["schemas"]["AdvisorRecommendationTransitionInput"];
export type GrowthAdvisorRecommendedAction =
  components["schemas"]["AdvisorRecommendation_AdvisorRecommendedAction"];

export type GetAdvisorTodayOperation =
  operations["getAdvisorToday"];
export type AcceptAdvisorRecommendationOperation =
  operations["acceptAdvisorRecommendation"];
export type IgnoreAdvisorRecommendationOperation =
  operations["ignoreAdvisorRecommendation"];
export type CompleteAdvisorRecommendationOperation =
  operations["completeAdvisorRecommendation"];
