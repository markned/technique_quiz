import { expect, test, type Browser, type Page } from "@playwright/test";

const ROOM_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function e2eRoomCode(prefix: string): string {
  return `E2E${prefix}${Array.from({ length: 2 }, () => ROOM_CHARS[Math.floor(Math.random() * ROOM_CHARS.length)]).join("")}`;
}

async function joinPlayer(browser: Browser, code: string, name: string): Promise<Page> {
  const page = await browser.newPage();
  await page.goto(`/join/${code}`);
  await page.getByLabel("Имя").fill(name);
  await page.getByRole("button", { name: "Играть" }).click();
  await expect(page.getByRole("heading", { name: /Ждём ведущий экран|Восстанавливаем сессию/ })).toBeVisible();
  return page;
}

async function setupRoom(browser: Browser, code: string) {
  const host = await browser.newPage();
  await host.goto(`/room/${code}/host`);
  await expect(host.getByRole("heading", { name: code })).toBeVisible();
  const alice = await joinPlayer(browser, code, "Alice");
  const bob = await joinPlayer(browser, code, "Bob");
  const cara = await joinPlayer(browser, code, "Cara");
  await expect(host.getByText("Alice")).toBeVisible();
  await expect(host.getByText("Bob")).toBeVisible();
  await expect(host.getByText("Cara")).toBeVisible();
  await host.getByRole("button", { name: "К выбору режима" }).click();
  return { host, alice, bob, cara };
}

async function clickWrongMc(page: Page, correctPattern: RegExp): Promise<string> {
  const buttons = page.locator(".multiplayer-answer-grid button");
  const count = await buttons.count();
  for (let i = 0; i < count; i += 1) {
    const text = (await buttons.nth(i).innerText()).trim();
    if (!correctPattern.test(text)) {
      await buttons.nth(i).click();
      return text;
    }
  }
  throw new Error("No wrong multiple-choice option was available");
}

test("multiplayer quiz supports joining, answering, scoring, leaderboard, and reconnect", async ({ browser }) => {
  const code = e2eRoomCode("Q");
  const { host, alice, bob, cara } = await setupRoom(browser, code);

  await host.getByText("Викторина").click();
  await host.getByRole("button", { name: "Начать игру" }).click();

  await expect(alice.getByText("Выбери ответ")).toBeVisible({ timeout: 20_000 });
  const correct = /Откуда в жопе бриллианты/;
  await alice.getByRole("button", { name: correct }).click();
  await clickWrongMc(bob, correct);
  await clickWrongMc(cara, correct);

  await expect(host.getByText("Верно: 1")).toBeVisible({ timeout: 15_000 });
  await expect(host.locator(".multiplayer-leaderboard").getByText("Alice")).toBeVisible();
  await host.reload();
  await expect(host.getByText(/Сессия восстановлена|Верно: 1|Alice/).first()).toBeVisible({ timeout: 15_000 });
  await alice.reload();
  await expect(
    alice.getByText(/Сессия восстановлена|Результаты на экране|Ждём ведущий экран|Выбери ответ|Собери порядок/).first(),
  ).toBeVisible({ timeout: 15_000 });
});

test("multiplayer freestyle supports anonymous voting, original reveal, similarity bonus, and leaderboard", async ({ browser }) => {
  const code = e2eRoomCode("F");
  const { host, alice, bob, cara } = await setupRoom(browser, code);

  await host.getByText("Фристайл").click();
  await host.getByRole("button", { name: "Начать игру" }).click();

  await expect(alice.getByText("Продолжи текст")).toBeVisible({ timeout: 20_000 });
  await alice.locator("textarea").fill("Откуда в жопе бриллианты");
  await bob.locator("textarea").fill("совсем другой ответ");
  await cara.locator("textarea").fill("третья версия");
  await alice.getByRole("button", { name: "Отправить" }).click();
  await bob.getByRole("button", { name: "Отправить" }).click();
  await cara.getByRole("button", { name: "Отправить" }).click();

  await expect(alice.getByText("Голосование")).toBeVisible({ timeout: 15_000 });
  await expect(alice.getByRole("button", { name: /Откуда в жопе бриллианты/ })).toHaveCount(0);
  await alice.getByRole("button", { name: /совсем другой ответ/ }).click();
  await bob.getByRole("button", { name: /Откуда в жопе бриллианты/ }).click();
  await cara.getByRole("button", { name: /Откуда в жопе бриллианты/ }).click();

  await expect(host.getByText("Оригинал")).toBeVisible({ timeout: 15_000 });
  await expect(host.getByText(/Откуда в жопе бриллианты/).first()).toBeVisible();
  await expect(host.getByText(/\+1 похожесть/)).toBeVisible();
  await expect(host.getByText(/победитель/)).toBeVisible();
});
