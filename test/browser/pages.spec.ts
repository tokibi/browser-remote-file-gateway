import { expect, test } from "@playwright/test";

test("demo and quickstart run from the built Pages subpath", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("demo/");
  await page.getByRole("button", { name: "Run HEAD + Range GET" }).click();
  await expect(page.locator("#status")).toHaveText("HEAD and Range GET succeeded");
  const demoResult = JSON.parse((await page.locator("#output").textContent()) ?? "null");
  expect(demoResult.uri).toMatch(
    /^http:\/\/127\.0\.0\.1:4174\/browser-remote-file-gateway\/remote-file-gateway\/objects\/demo-text-v1$/,
  );
  expect(demoResult.head.status).toBe(200);
  expect(demoResult.range.status).toBe(206);
  expect(demoResult.range.body).toBeTruthy();

  await page.goto("quickstart/");
  await page.locator("#run").click();
  await expect(page.locator("#result")).toContainText('"size"', { timeout: 30_000 });
  const quickstartResult = JSON.parse((await page.locator("#result").textContent()) ?? "null");
  expect(quickstartResult.range).toMatch(/^bytes 0-15\/\d+$/);
  expect(quickstartResult.text).toBeTruthy();
  expect(pageErrors).toEqual([]);
});
