import { expect, test, type Browser, type Page } from "@playwright/test";

async function search(browser: Browser, name: string, fast = true): Promise<Page> {
  const page = await browser.newPage();
  page.on("dialog", (dialog) => void dialog.accept());
  await page.addInitScript(
    (prefix) =>
      localStorage.getItem("technique_quiz_multiplayer_client_id") ||
      localStorage.setItem("technique_quiz_multiplayer_client_id", `${prefix}${crypto.randomUUID()}`),
    fast ? "E2E_" : "QA_REAL_",
  );
  await page.goto("/online?fresh=1");
  await page.getByLabel("Имя", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Найти игру", exact: true }).click();
  await expect(page).toHaveURL(/\/online\/[A-Z0-9]{6}$/);
  await expect(page.getByRole("heading", { name: "Лобби", exact: true })).toBeVisible();
  return page;
}

async function ready(...players: Page[]) {
  for (const p of players) await p.getByRole("button", { name: "Готов", exact: true }).click();
}

test("online quiz finds two opponents without host, skips mode voting, keeps replay personal and reconnects", async ({
  browser,
}) => {
  const alice = await search(browser, "Online Alice");
  const bob = await search(browser, "Online Bob");
  expect(alice.url()).toBe(bob.url());
  await alice.setViewportSize({ width: 390, height: 844 });
  await ready(alice, bob);
  await expect(alice.getByRole("button", { name: "Подтвердить ответ" })).toBeVisible({ timeout: 15000 });
  await expect(alice.getByText("Выберите режим", { exact: true })).toHaveCount(0);
  await alice.getByRole("button", { name: "Повторить фрагмент", exact: true }).click();
  await expect(alice.getByRole("button", { name: /Повтор ·/ })).toBeDisabled();
  await expect(bob.getByRole("button", { name: "Повторить фрагмент", exact: true })).toBeEnabled();
  await bob.reload();
  await expect(bob.getByRole("button", { name: "Подтвердить ответ" })).toBeVisible();
  await expect(bob.getByText("Пауза — ждём главный экран", { exact: true })).toHaveCount(0);
  expect(await alice.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test("online freestyle supports anonymous voting, five rounds and a same-player rematch", async ({
  browser,
}) => {
  const alice = await search(browser, "Freestyle Alice");
  const bob = await search(browser, "Freestyle Bob");
  const cara = await search(browser, "Freestyle Cara");
  expect(alice.url()).toBe(bob.url());
  expect(alice.url()).toBe(cara.url());
  await ready(alice, bob, cara);
  await alice.getByRole("button", { name: "Фристайл", exact: true }).click();
  await bob.getByRole("button", { name: "Фристайл", exact: true }).click();
  for (let round = 0; round < 5; round++) {
    await expect(alice.locator("textarea")).toBeVisible({ timeout: 15000 });
    for (const [p, text] of [
      [alice, "Первый произвольный ответ"],
      [bob, "Второй произвольный ответ"],
      [cara, "Третий произвольный ответ"],
    ] as const) {
      await p.locator("textarea").fill(text);
      await p.getByRole("button", { name: "Отправить", exact: true }).click();
    }
    await expect(alice.getByRole("button", { name: "Первый произвольный ответ", exact: true })).toHaveCount(
      0,
    );
    await alice.getByRole("button", { name: "Второй произвольный ответ", exact: true }).click();
    await bob.getByRole("button", { name: "Первый произвольный ответ", exact: true }).click();
    await cara.getByRole("button", { name: "Первый произвольный ответ", exact: true }).click();
    await expect(alice.getByRole("heading", { name: "Итоги раунда", exact: true })).toBeVisible();
    await expect(alice.getByLabel("Начисление очков")).toBeVisible();
  }
  await expect(alice.getByRole("button", { name: "Ещё матч с этими игроками", exact: true })).toBeVisible({
    timeout: 15000,
  });
  for (const p of [alice, bob, cara])
    await p.getByRole("button", { name: "Ещё матч с этими игроками", exact: true }).click();
  await expect(alice.getByRole("heading", { name: "Выбираем режим", exact: true })).toBeVisible();
});

test("online lobby ejects an unready player and starts the ready pair", async ({ browser }) => {
  const alice = await search(browser, "Ready Alice");
  const bob = await search(browser, "Ready Bob");
  const afk = await search(browser, "AFK");
  await ready(alice, bob);
  await expect(afk).toHaveURL(/\/online$/, { timeout: 25000 });
  await expect(alice.getByRole("button", { name: "Подтвердить ответ" })).toBeVisible({ timeout: 15000 });
  await expect(bob.getByRole("button", { name: "Подтвердить ответ" })).toBeVisible();
});

test("online normal timing loads music on both clients after their ready gesture", async ({ browser }) => {
  const alice = await search(browser, "Music Alice", false);
  const bob = await search(browser, "Music Bob", false);
  const audioRequests: string[] = [];
  alice.on("request", (r) => {
    if (/\/content\/audio\/music\//.test(r.url())) audioRequests.push(r.url());
  });
  await ready(alice, bob);
  await expect(alice.getByRole("heading", { name: "Слушаем фрагмент", exact: true })).toBeVisible({
    timeout: 25000,
  });
  await expect(bob.getByRole("heading", { name: "Слушаем фрагмент", exact: true })).toBeVisible();
  expect(audioRequests.length).toBeGreaterThan(0);
  await expect(alice.getByRole("alert")).toHaveCount(0);
  await expect(bob.getByRole("alert")).toHaveCount(0);
});
