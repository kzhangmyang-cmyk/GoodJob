import {
  InMemoryFinancialCouncilRepository
} from "./financial-council-repository.js";
import {
  registerFinancialCouncilRepositoryContract
} from "./financial-council-repository-contract-test.js";

registerFinancialCouncilRepositoryContract(
  "memory financial council repository",
  () => new InMemoryFinancialCouncilRepository()
);
