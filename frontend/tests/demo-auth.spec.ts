import { expect, test } from "@playwright/test";

test("standalone frontend login enters the demo workspace without an API server", async ({ page }) => {
  await page.goto("/#acquisition");
  await page.locator("#loginButton").click();

  await expect(page.locator("body")).toHaveClass(/is-authenticated/);
  await expect(page.locator(".replica-shell")).toBeVisible();
  await expect(page.locator(".toast.error")).toHaveCount(0);
});

test("standalone frontend restores a saved demo session without calling the API", async ({ page }) => {
  const apiRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) apiRequests.push(request.url());
  });
  await page.addInitScript(() => {
    localStorage.setItem("gj_user", JSON.stringify({
      id: "demo-admin",
      name: "Admin",
      email: "admin@goodjob.com",
      role: "admin",
      teamId: "demo-team",
      avatar: "AD"
    }));
  });

  await page.goto("/#acquisition");

  await expect(page.locator("body")).toHaveClass(/is-authenticated/);
  expect(apiRequests).toEqual([]);
});

test("standalone frontend does not poll backend dashboards in demo mode", async ({ page }) => {
  const apiRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) apiRequests.push(request.url());
  });

  await page.goto("/#acquisition");
  await page.locator("#loginButton").click();
  await expect(page.locator("body")).toHaveClass(/is-authenticated/);
  await page.waitForTimeout(10_250);

  expect(apiRequests).toEqual([]);
});
