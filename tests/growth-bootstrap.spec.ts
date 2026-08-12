import { expect, test } from "@playwright/test";
import {
  enterRealGrowth,
  growthContractScenario,
  installGrowthContractScenario
} from "./fixtures/growth-contract";

test("happy path enters real growth and renders the catalog workspace from typed fixtures", async ({ page }) => {
  const scenario = growthContractScenario("happy_path");
  const installed = await installGrowthContractScenario(page, scenario);
  await enterRealGrowth(page, "catalog");
  await expect(page.getByRole("heading", { name: "产品目录" })).toBeVisible();
  await expect(page.getByText("标准产品")).toBeVisible();
  expect(installed.requestsFor("GET", "/api/v1/growth/bootstrap").length).toBeGreaterThan(0);
  await installed.dispose();
});

test("contract mismatch fails closed with an unavailable state", async ({ page }) => {
  const scenario = growthContractScenario("contract_mismatch");
  const installed = await installGrowthContractScenario(page, scenario);
  await enterRealGrowth(page, "catalog");
  await expect(page.getByText("contract_mismatch")).toBeVisible();
  await expect(page.getByText("标准产品")).toHaveCount(0);
  await installed.dispose();
});

test("workspace selection required shows the unavailable gate", async ({ page }) => {
  const scenario = growthContractScenario("workspace_selection_required");
  const installed = await installGrowthContractScenario(page, scenario);
  await enterRealGrowth(page, "advisor");
  await expect(page.getByText("workspace_selection_required")).toBeVisible();
  await installed.dispose();
});

test("quote workbench loads a case and its immutable versions from typed fixtures", async ({ page }) => {
  const scenario = growthContractScenario("happy_path");
  const installed = await installGrowthContractScenario(page, scenario);
  await page.goto("/#growth/quotes?case=case-1");
  await expect(page.getByRole("heading", { name: "报价工作台" })).toBeVisible();
  await expect(page.locator('[data-version-id="quote-v1"]')).toBeVisible();
  expect(
    installed.requestsFor("GET", "/api/v1/quotes/cases/case-1").length
  ).toBeGreaterThan(0);
  await installed.dispose();
});
