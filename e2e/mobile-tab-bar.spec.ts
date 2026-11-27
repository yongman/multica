import { expect, test, type Page } from "@playwright/test";

const LABELS = ["Inbox", "Issues", "Projects", "Chat", "Pinned", "More"];

async function measureTabBar(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  return page.getByRole("tab").evaluateAll((tabs, labels) => {
    const issues: string[] = [];
    const measurements = tabs.map((tab, index) => {
      const text = labels[index];
      if (!text) throw new Error(`Unexpected tab at position ${index + 1}`);
      const label = [...tab.querySelectorAll<HTMLElement>("*")].find(
        (element) => element.textContent === text && element.childElementCount === 0,
      );
      if (!label) throw new Error(`Missing label: ${text}`);
      const box = tab.getBoundingClientRect();
      const labelBox = label.getBoundingClientRect();
      const style = getComputedStyle(label);
      const fullText = document.createElement("span");
      // DOM text remains complete when ellipsized. Measure an unconstrained
      // copy, then account for clipping by the label and its ancestors.
      Object.assign(fullText.style, {
        position: "absolute",
        visibility: "hidden",
        whiteSpace: "pre",
        font: style.font,
        letterSpacing: style.letterSpacing,
        textTransform: style.textTransform,
      });
      fullText.textContent = text;
      document.body.append(fullText);
      const requiredWidth = fullText.getBoundingClientRect().width;
      fullText.remove();
      let visibleLeft = labelBox.left + parseFloat(style.paddingLeft);
      let visibleRight = labelBox.right - parseFloat(style.paddingRight);
      for (let parent = label.parentElement; parent; parent = parent.parentElement) {
        if (["hidden", "clip", "scroll", "auto"].includes(getComputedStyle(parent).overflowX)) {
          const parentBox = parent.getBoundingClientRect();
          visibleLeft = Math.max(visibleLeft, parentBox.left + parent.clientLeft);
          visibleRight = Math.min(visibleRight, parentBox.left + parent.clientLeft + parent.clientWidth);
        }
      }
      const availableWidth = Math.max(0, visibleRight - visibleLeft);
      if (requiredWidth > availableWidth + 0.5) {
        issues.push(`${text}: text needs ${requiredWidth}px, label has ${availableWidth}px`);
      }
      if (labelBox.left < box.left - 0.5 || labelBox.right > box.right + 0.5) {
        issues.push(`${text}: label extends outside its touch target`);
      }
      if (box.width < 44 || box.height < 44) {
        issues.push(`${text}: touch target is smaller than 44px`);
      }
      if (box.left < 0 || box.right > innerWidth + 0.5) {
        issues.push(`${text}: touch target extends outside the viewport`);
      }
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      if (!hit || !tab.contains(hit)) issues.push(`${text}: touch target is obstructed`);
      return { text, requiredWidth, availableWidth, left: box.left, right: box.right };
    });
    for (let index = 1; index < measurements.length; index++) {
      if (measurements[index - 1]!.right > measurements[index]!.left + 0.5) {
        issues.push(`${measurements[index - 1]!.text}/${measurements[index]!.text}: touch targets overlap`);
      }
    }
    return { issues, measurements };
  }, LABELS);
}

function fixture() {
  return `<style>
    body { margin: 0; }
    [role=tablist] { display: flex; width: 320px; }
    [role=tab] { flex: 1; min-width: 0; height: 49px; border: 0; padding: 5px; }
    span { display: block; font: 500 10px system-ui; white-space: nowrap; }
  </style><div role="tablist">${LABELS.map(
    (label) => `<button role="tab"><span>${label}</span></button>`,
  ).join("")}</div>`;
}

test("detects an ellipsis while the DOM contains the complete label", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.setContent(fixture());
  await page.getByRole("tab", { name: "Projects" }).locator("span").evaluate((label) => {
    Object.assign(label.style, {
      display: "-webkit-box",
      webkitBoxOrient: "vertical",
      webkitLineClamp: "1",
      overflow: "hidden",
      width: "24px",
    });
  });
  const label = page.getByRole("tab", { name: "Projects" }).locator("span");
  await expect(label).toHaveText("Projects");
  expect((await measureTabBar(page)).issues).toContainEqual(expect.stringMatching(/^Projects: text needs/));
});

test("detects ancestor clipping that the label's scrollWidth misses", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.setContent(fixture());
  const label = page.getByRole("tab", { name: "Projects" }).locator("span");
  await label.evaluate((label) => {
    const clip = document.createElement("div");
    Object.assign(clip.style, { width: "24px", overflow: "hidden" });
    label.replaceWith(clip);
    clip.append(label);
    label.style.width = "max-content";
  });
  expect(await label.evaluate((element) => element.scrollWidth === element.clientWidth)).toBe(true);
  expect((await measureTabBar(page)).issues).toContainEqual(expect.stringMatching(/^Projects: text needs/));
});

test("detects overlapping touch targets", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.setContent(fixture());
  await page.getByRole("tab").nth(1).evaluate((tab) => {
    (tab as HTMLElement).style.transform = "translateX(-10px)";
  });
  expect((await measureTabBar(page)).issues).toContain("Inbox/Issues: touch targets overlap");
});

test("accepts complete labels in separate touch targets", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.setContent(fixture());
  expect((await measureTabBar(page)).issues).toEqual([]);
});

for (const theme of ["light", "dark"] as const) {
  test(`mobile English labels fit at 320px in ${theme} mode`, async ({ page }, testInfo) => {
    const url = process.env.MOBILE_PREVIEW_URL;
    test.skip(!url, "Set MOBILE_PREVIEW_URL to an authenticated Expo Web preview.");
    await page.setViewportSize({ width: 320, height: 640 });
    await page.emulateMedia({ colorScheme: theme });
    await page.addInitScript((theme) => {
      localStorage.setItem("mobile.locale_preference", "en");
      localStorage.setItem("theme-preference", theme);
    }, theme);
    await page.goto(url!);
    const tabs = page.getByRole("tab");
    await expect(tabs).toHaveCount(LABELS.length);
    for (let index = 0; index < LABELS.length; index++) {
      await expect(tabs.nth(index)).toContainText(LABELS[index]!);
    }
    const result = await measureTabBar(page);
    expect(result.issues).toEqual([]);
    await tabs.nth(2).click();
    await expect(page).toHaveURL(/\/projects$/);
    await tabs.nth(4).click();
    await expect(page).toHaveURL(/\/pins$/);
    await expect(tabs.nth(4)).toHaveAttribute("aria-selected", "true");
    await testInfo.attach("label-widths", { body: JSON.stringify(result, null, 2), contentType: "application/json" });
    await testInfo.attach("tab-bar", { body: await page.screenshot({ animations: "disabled" }), contentType: "image/png" });
  });
}
