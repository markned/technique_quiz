import { expect, test, type Browser, type Page } from "@playwright/test";

const ROOM_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function e2eRoomCode(prefix: string): string {
  return `E2E${prefix}${Array.from({ length: 2 }, () => ROOM_CHARS[Math.floor(Math.random() * ROOM_CHARS.length)]).join("")}`;
}

async function joinPlayer(browser: Browser, code: string, name: string): Promise<Page> {
  const page = await browser.newPage();
  page.on("dialog", (dialog) => void dialog.accept());
  await page.goto(`/join/${code}`);
  // Keep native click hit-testing while removing the decorative perpetual shake.
  await page.addStyleTag({ content: ".quiz-option { animation: none !important; }" });
  await page.getByLabel("Имя").fill(name);
  await page.getByRole("button", { name: "Играть" }).click();
  await expect(
    page.getByRole("heading", { name: /Ждём ведущий экран|Восстанавливаем сессию/ }),
  ).toBeVisible();
  return page;
}

async function setupRoom(browser: Browser, code: string) {
  const host = await browser.newPage();
  host.on("dialog", (dialog) => void dialog.accept());
  await host.goto(`/room/${code}/host`);
  await expect(host.getByRole("heading", { name: code })).toBeVisible();
  await expect(host.getByRole("button", { name: "К выбору режима" })).toBeDisabled();
  const alice = await joinPlayer(browser, code, "Alice");
  const bob = await joinPlayer(browser, code, "Bob");
  const cara = await joinPlayer(browser, code, "Cara");
  await expect(host.getByText("Alice")).toBeVisible();
  await expect(host.getByText("Bob")).toBeVisible();
  await expect(host.getByText("Cara")).toBeVisible();
  await host.getByRole("button", { name: "К выбору режима" }).click();
  return { host, alice, bob, cara };
}

async function chooseInitialMode(host: Page, alice: Page, bob: Page, mode: "quiz" | "freestyle") {
  const label = mode === "quiz" ? "Викторина" : "Фристайл";
  await expect(alice.getByRole("heading", { name: "Выбираем режим" })).toBeVisible();
  await alice.getByRole("button", { name: label, exact: true }).click();
  await bob.getByRole("button", { name: label, exact: true }).click();
  await expect(host.getByRole("button", { name: "Начать игру" })).toBeVisible();
}

async function openMainModeChoice(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Начать" }).click();
  await page.getByRole("button", { name: "Пропустить интро" }).click();
  await expect(page.getByRole("button", { name: "Один игрок" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Мультиплеер" })).toBeVisible();
}

async function clickWrongMc(page: Page, correctPattern: RegExp): Promise<string> {
  const buttons = page.locator(".quiz-options-grid button");
  await expect(buttons).toHaveCount(4);
  const count = await buttons.count();
  for (let i = 0; i < count; i += 1) {
    const text = (await buttons.nth(i).innerText()).trim();
    if (!correctPattern.test(text)) {
      await buttons.nth(i).click();
      await page.getByRole("button", { name: "Подтвердить ответ" }).click();
      return text;
    }
  }
  throw new Error("No wrong multiple-choice option was available");
}

test("initial home screen keeps one start button and no mode choices", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Начать" })).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: /Один игрок|Мультиплеер|Singleplayer|Multiplayer/ }),
  ).toHaveCount(0);
});

test("intro skip opens main singleplayer/multiplayer choice", async ({ page }) => {
  await openMainModeChoice(page);
});

test("singleplayer starts quiz-only rules flow", async ({ page }) => {
  await openMainModeChoice(page);
  await page.getByRole("button", { name: "Один игрок" }).click();
  await expect(page.getByRole("heading", { name: "Об игре" })).toBeVisible();
  await expect(page.getByText("Фристайл")).toHaveCount(0);
  await page.getByRole("button", { name: "К управлению" }).click();
  await expect(page.getByRole("heading", { name: "Управление" })).toBeVisible();
  await expect(page.getByText("Выбор режима")).toHaveCount(0);
});

test("multiplayer entry supports create room and manual join by code", async ({ browser, page }) => {
  await openMainModeChoice(page);
  await page.getByRole("button", { name: "Мультиплеер" }).click();
  await expect(page.getByRole("button", { name: "Создать комнату" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Войти по коду" })).toBeVisible();

  await page.getByRole("button", { name: "Создать комнату" }).click();
  await expect(page).toHaveURL(/\/room\/[A-Z0-9]{6}\/host/);
  const code = page.url().match(/\/room\/([A-Z0-9]{6})\/host/)?.[1];
  if (!code) throw new Error("Create room did not navigate to a host room");
  await expect(page.getByRole("heading", { name: code })).toBeVisible();

  const player = await browser.newPage();
  await openMainModeChoice(player);
  await player.getByRole("button", { name: "Мультиплеер" }).click();
  await player.getByLabel("Код комнаты").fill(code.toLowerCase());
  await player.getByRole("button", { name: "Войти по коду" }).click();
  await expect(player).toHaveURL(new RegExp(`/join/${code}$`));
  await player.getByLabel("Имя").fill("Manual");
  await player.getByRole("button", { name: "Играть" }).click();
  await expect(player.getByText(/Ждём ведущий экран|Восстанавливаем сессию/).first()).toBeVisible();
  await expect(page.getByText("Manual")).toBeVisible();

  const directPlayer = await browser.newPage();
  await directPlayer.goto(`/room/${code}/player`);
  await directPlayer.getByLabel("Имя").fill("Direct");
  await directPlayer.getByRole("button", { name: "Играть" }).click();
  await expect(directPlayer.getByText(/Ждём ведущий экран|Восстанавливаем сессию/).first()).toBeVisible();
  await expect(page.getByText("Direct")).toBeVisible();
});

test("multiplayer quiz supports joining, answering, scoring, leaderboard, and reconnect", async ({
  browser,
}) => {
  const code = e2eRoomCode("Q");
  const { host, alice, bob, cara } = await setupRoom(browser, code);

  await chooseInitialMode(host, alice, bob, "quiz");
  await host.getByRole("button", { name: "Начать игру" }).click();

  await expect(alice.getByRole("button", { name: "Подтвердить ответ" })).toBeVisible({ timeout: 20_000 });
  const correct = /Откуда в жопе бриллианты/;
  await alice.getByRole("button", { name: correct }).click();
  await alice.getByRole("button", { name: "Подтвердить ответ" }).click();
  await clickWrongMc(bob, correct);
  await clickWrongMc(cara, correct);

  await expect(host.getByText("Верно: 1")).toBeVisible({ timeout: 15_000 });
  await expect(host.locator(".multiplayer-leaderboard").getByText("Alice")).toBeVisible();
  await host.reload();
  await expect(host.getByText(/Сессия восстановлена|Верно: 1|Alice/).first()).toBeVisible({
    timeout: 15_000,
  });
  await alice.reload();
  await expect(
    alice
      .getByText(
        /Сессия восстановлена|Итоги раунда|Слушаем фрагмент|Следующий раунд|Ждём ведущий экран|Ответ принят|Подтвердить ответ/,
      )
      .first(),
  ).toBeVisible({ timeout: 15_000 });
  await expect(host.getByRole("heading", { name: "Итоги игры" })).toBeVisible({ timeout: 35_000 });
  await expect(host.locator(".multiplayer-leaderboard").getByText("Alice")).toBeVisible();
  await alice.getByRole("button", { name: "Сыграть ещё" }).click();
  await bob.getByRole("button", { name: "Сыграть ещё" }).click();
  await expect(host.getByText(/Слушаем фрагмент|Следующий раунд|1\/3/).first()).toBeVisible({
    timeout: 15_000,
  });
});

test("multiplayer freestyle supports anonymous voting, original reveal, similarity bonus, and leaderboard", async ({
  browser,
}) => {
  // E2EF is reserved for full-catalog simulator runs; this fixture starts with round 1.
  const code = e2eRoomCode("S");
  const { host, alice, bob, cara } = await setupRoom(browser, code);

  await chooseInitialMode(host, alice, bob, "freestyle");
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

test("a lost main screen pauses the game and a recovery link resumes it on another device", async ({
  browser,
}) => {
  const code = e2eRoomCode("R");
  const { host, alice, bob } = await setupRoom(browser, code);
  const token = await host.evaluate(
    (roomCode) => localStorage.getItem(`technique_quiz_multiplayer_host_token:${roomCode}`),
    code,
  );
  await chooseInitialMode(host, alice, bob, "quiz");
  await host.getByRole("button", { name: "Начать игру" }).click();
  await expect(alice.getByRole("button", { name: "Подтвердить ответ" })).toBeVisible();
  await host.close();
  await expect(alice.getByRole("heading", { name: "Пауза — ждём главный экран" })).toBeVisible();
  const replacement = await browser.newPage();
  await replacement.goto(`/room/${code}/host#screen=${token}`);
  await expect(alice.getByRole("button", { name: "Подтвердить ответ" })).toBeVisible();
  await expect(replacement).not.toHaveURL(/#screen=/);
});

test("real music playback handles media errors and player refreshes", async ({ browser }) => {
  const code = `N${Date.now().toString(36).slice(-5).toUpperCase()}`;
  const host = await browser.newPage();
  host.on("dialog", (dialog) => void dialog.accept());
  await host.addInitScript(() => {
    const probe = { loads: 0, audio: null as HTMLMediaElement | null };
    Object.defineProperty(window, "__musicProbe", { value: probe });
    const load = HTMLMediaElement.prototype.load;
    HTMLMediaElement.prototype.load = function () {
      if (this.src.includes("/audio/music/")) {
        probe.loads++;
        probe.audio = this;
      }
      return load.call(this);
    };
  });
  const supportsAac = await host.evaluate(
    () => !!document.createElement("audio").canPlayType('audio/mp4; codecs="mp4a.40.2"'),
  );
  await host.goto(`/room/${code}/host`);
  await expect(host.getByRole("heading", { name: code })).toBeVisible();
  const alice = await joinPlayer(browser, code, "Alice");
  const bob = await joinPlayer(browser, code, "Bob");
  await joinPlayer(browser, code, "Cara");
  await host.getByRole("button", { name: "К выбору режима" }).click();
  await chooseInitialMode(host, alice, bob, "quiz");
  await host.getByRole("button", { name: "Начать игру" }).click();
  if (!supportsAac) {
    // Chromium without proprietary codecs must fail visibly and pause the room.
    // Run with PLAYWRIGHT_CHANNEL=chrome to exercise the original AAC playback.
    await expect(
      host.getByText("Не удалось воспроизвести музыку. Проверь звук и нажми «Повторить»."),
    ).toBeVisible();
    await expect(alice.getByRole("heading", { name: "Пауза — ждём главный экран" })).toBeVisible();
    await expect(host.getByRole("button", { name: "Повторить", exact: true })).toBeVisible();
    return;
  }
  const probe = () =>
    host.evaluate(() => {
      const data = (window as unknown as { __musicProbe: { loads: number; audio: HTMLMediaElement | null } })
        .__musicProbe;
      return {
        loads: data.loads,
        playing: !!data.audio && !data.audio.paused,
        time: data.audio?.currentTime ?? 0,
        error: data.audio?.error?.message,
        readyState: data.audio?.readyState,
        source: data.audio?.currentSrc,
      };
    });
  await expect
    .poll(async () => JSON.stringify(await probe()), { timeout: 20_000 })
    .toContain('"playing":true');
  const before = await probe();
  await alice.reload();
  await expect.poll(async () => (await probe()).time).toBeGreaterThan(before.time + 0.25);
  expect((await probe()).loads).toBe(before.loads);
});

test("two players skip initial voting and cannot switch to freestyle", async ({ browser }) => {
  const code = e2eRoomCode("D");
  const host = await browser.newPage();
  host.on("dialog", (dialog) => void dialog.accept());
  await host.goto(`/room/${code}/host`);
  const alice = await joinPlayer(browser, code, "Alice");
  await joinPlayer(browser, code, "Bob");
  await host.getByRole("button", { name: "К выбору режима" }).click();
  await expect(host.getByRole("button", { name: "Начать игру" })).toBeVisible();
  await expect(alice.getByRole("heading", { name: "Выбираем режим" })).toHaveCount(0);
  await host.getByRole("button", { name: "Начать игру" }).click();
  await expect(host.getByRole("heading", { name: "Итоги игры" })).toBeVisible({ timeout: 35_000 });
  await expect(alice.getByRole("button", { name: "Перейти во фристайл" })).toBeDisabled();
});

test("a new player joins through the home page using a room code", async ({ browser }) => {
  const code = e2eRoomCode("H");
  const host = await browser.newPage();
  host.on("dialog", (dialog) => void dialog.accept());
  await host.goto(`/room/${code}/host`);
  await expect(host.getByRole("heading", { name: code })).toBeVisible();
  const player = await browser.newPage();
  await openMainModeChoice(player);
  await player.getByRole("button", { name: "Мультиплеер" }).click();
  await player.getByLabel("Код комнаты").fill(code);
  await player.getByRole("button", { name: "Войти по коду" }).click();
  await player.getByLabel("Имя").fill("Fresh player");
  await player.getByRole("button", { name: "Играть", exact: true }).click();
  await expect(host.getByText("Fresh player")).toBeVisible();
  await expect(player.getByRole("heading", { name: "Ждём ведущий экран" })).toBeVisible();
});

test("host manual pause survives refresh, replay freezes time and answered players cannot replay", async ({
  browser,
}) => {
  const { host, alice, bob } = await setupRoom(browser, e2eRoomCode("P"));
  await chooseInitialMode(host, alice, bob, "quiz");
  await host.getByRole("button", { name: "Начать игру", exact: true }).click();
  await expect(alice.getByRole("button", { name: "Повторить фрагмент" })).toBeVisible({ timeout: 20000 });
  await host.getByRole("button", { name: "Пауза / меню" }).click();
  await expect(host.getByRole("heading", { name: "Игра на паузе" })).toBeVisible();
  await expect(alice.getByText("Ведущий поставил игру на паузу")).toBeVisible();
  await expect(alice.getByRole("button", { name: "Повторить фрагмент" })).toBeDisabled();
  await host.reload();
  await expect(host.getByRole("button", { name: "Продолжить игру" })).toBeVisible();
  await host.getByRole("button", { name: "Продолжить игру" }).click();
  await alice.getByRole("button", { name: "Повторить фрагмент" }).click();
  await expect(bob.getByRole("button", { name: /Готовим повтор|Повтор ·/ })).toBeDisabled();
  await alice.locator(".quiz-options-grid button").first().click();
  await alice.getByRole("button", { name: "Подтвердить ответ" }).click();
  await expect(alice.getByRole("button", { name: "Повторить фрагмент" })).toHaveCount(0);
});

test("menu back navigation and readable rules work on a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await openMainModeChoice(page);
  await page.getByRole("button", { name: "Мультиплеер", exact: true }).click();
  await page.getByRole("button", { name: "Назад" }).click();
  await expect(page.getByRole("button", { name: "Один игрок", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Один игрок", exact: true }).click();
  await page.getByRole("button", { name: "К управлению" }).click();
  await expect(page.getByRole("heading", { name: "Управление" })).toBeVisible();
  await page.getByRole("button", { name: "Назад" }).click();
  await expect(page.getByRole("heading", { name: "Об игре" })).toBeVisible();
  await expect(page.locator(".rules-screen-text")).toHaveCSS("font-size", /^(1[6-9]|[2-9][0-9])/);
});

test("cancelling browser back keeps the active singleplayer session", async ({ page }) => {
  await openMainModeChoice(page);
  await page.getByRole("button", { name: "Один игрок", exact: true }).click();
  await page.getByRole("button", { name: "К управлению" }).click();
  await page.getByRole("button", { name: "Начать игру", exact: true }).click();
  await expect(page).toHaveURL(/#singleplayer\/play$/);
  page.on("dialog", (dialog) => dialog.dismiss());
  await page.goBack();
  await expect(page).toHaveURL(/#singleplayer\/play$/);
  await expect(page.getByRole("heading", { name: "Управление", exact: true })).toHaveCount(0);
});
