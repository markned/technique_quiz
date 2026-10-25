import { expect, test } from "@playwright/test";

const backend = "http://localhost:1999";
const moderatorCredentials = { username: "local-moderator", password: "local-moderator-test-password" };
function wav() {
  const samples = 8000 * 3;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF");
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(8000, 24);
  buffer.writeUInt32LE(16000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++)
    buffer.writeInt16LE(Math.round(Math.sin((i * 2 * Math.PI * 220) / 8000) * 1000), 44 + i * 2);
  return buffer;
}

test("invited author uploads a track; moderator reviews revisions without replacing the published content", async ({
  request,
  browser,
}) => {
  let response = await request.post(`${backend}/api/setup`, {
    headers: { Authorization: "Bearer local-test-setup-only" },
    data: moderatorCredentials,
  });
  if (response.status() === 409)
    response = await request.post(`${backend}/api/login`, { data: moderatorCredentials });
  expect(response.ok(), await response.text()).toBe(true);
  const moderator = await response.json();
  expect((await request.get(`${backend}/api/rounds`)).status()).toBe(401);
  const modHeaders = { Authorization: `Bearer ${moderator.token}` };
  const invitation = await request.post(`${backend}/api/invites`, { headers: modHeaders });
  const { invite } = await invitation.json();
  const username = `author-${Date.now().toString(36)}`;
  const authorPage = await browser.newPage();
  await authorPage.goto("/community");
  await authorPage.getByRole("button", { name: "У меня есть приглашение" }).click();
  await authorPage.getByLabel("Логин").fill(username);
  await authorPage.getByLabel("Пароль (от 12 символов)").fill("author-testing-password");
  await authorPage.getByLabel("Код приглашения").fill(invite);
  await authorPage.getByRole("button", { name: "Создать аккаунт" }).click();
  await expect(authorPage.getByRole("button", { name: "Новый раунд" })).toBeVisible();
  // Incomplete work is a valid draft, but cannot be submitted.
  await authorPage.getByRole("button", { name: "Сохранить черновик" }).click();
  await expect(authorPage.getByRole("status")).toHaveText("Черновик сохранён.");
  await authorPage.getByRole("button", { name: "Отправить на проверку" }).click();
  await expect(authorPage.getByRole("alert")).toBeVisible();
  const title = `Community ${Date.now()}`;
  await authorPage.getByLabel("Название", { exact: true }).fill(title);
  await authorPage
    .locator('input[type="file"]')
    .setInputFiles({ name: "test.wav", mimeType: "audio/wav", buffer: wav() });
  await expect(authorPage.getByRole("status")).toHaveText(/Трек загружен/);
  await authorPage.getByLabel("Конец, сек.").fill("2.5");
  await authorPage.getByLabel("Строка 1", { exact: true }).fill("Подсказка для раунда");
  await authorPage.getByLabel("Строка 2", { exact: true }).fill("Правильный ответ");
  await authorPage.getByRole("button", { name: "Сохранить черновик" }).click();
  await expect(authorPage.getByRole("status")).toHaveText("Черновик сохранён.");
  await expect(authorPage.getByRole("button", { name: "Фрагмент", exact: true })).toBeEnabled();
  await authorPage.getByRole("button", { name: "Фрагмент", exact: true }).click();
  await authorPage.getByRole("button", { name: "Тест раунда", exact: true }).click();
  await expect(authorPage.locator(".preview-mode-banner")).toBeVisible();
  await authorPage.goto("/community");
  await expect(authorPage.getByLabel("Название", { exact: true })).toHaveValue(title);
  const authorToken = await authorPage.evaluate(() =>
    sessionStorage.getItem("technique_quiz_author_session"),
  );
  const authorHeaders = { Authorization: `Bearer ${authorToken}` };
  expect((await request.post(`${backend}/api/invites`, { headers: authorHeaders })).status()).toBe(403);
  const authorRounds = await (await request.get(`${backend}/api/rounds`, { headers: authorHeaders })).json();
  const privateMedia = authorRounds.rounds.find(
    (round: { content: { title: string } }) => round.content.title === title,
  ).content.audioFile;
  expect((await request.get(backend + privateMedia)).status()).toBe(401);
  await authorPage.getByRole("button", { name: "Отправить на проверку" }).click();
  await expect(authorPage.getByText(/На проверке · Версия/)).toBeVisible();
  const catalogBefore = await (await request.get(`${backend}/api/catalog`)).json();
  expect(catalogBefore.rounds.some((round: { title: string }) => round.title === title)).toBe(false);

  const moderatorPage = await browser.newPage();
  await moderatorPage.goto("/community");
  await moderatorPage.getByLabel("Логин").fill(moderatorCredentials.username);
  await moderatorPage.getByLabel("Пароль (от 12 символов)").fill(moderatorCredentials.password);
  await moderatorPage.getByRole("button", { name: "Войти", exact: true }).click();
  await moderatorPage.getByRole("button", { name: new RegExp(title) }).click();
  await expect(moderatorPage.getByRole("button", { name: "Фрагмент", exact: true })).toBeEnabled();
  await moderatorPage.screenshot({ path: test.info().outputPath("community-review.png"), fullPage: true });
  await moderatorPage.getByRole("button", { name: "Одобрить", exact: true }).click();
  await expect(moderatorPage.getByText(/Одобрен · Версия/)).toBeVisible();
  const catalog = await (await request.get(`${backend}/api/catalog`)).json();
  const published = catalog.rounds.find((round: { title: string }) => round.title === title);
  expect(published).toBeTruthy();
  // Range requests support audio seeking; draft tracks were not public before approval.
  const media = await request.get(backend + published.audioFile, { headers: { Range: "bytes=0-99" } });
  expect(media.status()).toBe(206);
  expect((await media.body()).length).toBe(100);

  await authorPage.getByRole("button", { name: "Обновить список" }).click();
  await authorPage.getByRole("button", { name: new RegExp(title) }).click();
  await authorPage.getByLabel("Название", { exact: true }).fill(`${title} edited`);
  await authorPage.getByRole("button", { name: "Сохранить черновик" }).click();
  await expect(authorPage.getByRole("status")).toHaveText("Черновик сохранён.");
  await authorPage.getByRole("button", { name: "Отправить на проверку" }).click();
  await expect(authorPage.getByText(/На проверке · Версия/)).toBeVisible();
  const oldCatalog = await (await request.get(`${backend}/api/catalog`)).json();
  expect(oldCatalog.rounds.find((round: { id: number }) => round.id === published.id).title).toBe(title);
  await moderatorPage.getByRole("button", { name: "Обновить список" }).click();
  await moderatorPage.getByRole("button", { name: new RegExp(`${title} edited`) }).click();
  await moderatorPage.getByLabel("Комментарий", { exact: true }).fill("Проверь тайминг.");
  await moderatorPage.getByRole("button", { name: "Вернуть с комментарием" }).click();
  await expect(moderatorPage.getByText("Комментарий модератора: Проверь тайминг.")).toBeVisible();
  await moderatorPage.getByRole("button", { name: "Снять с публикации" }).click();
  const removed = await (await request.get(`${backend}/api/catalog`)).json();
  expect(removed.rounds.some((round: { id: number }) => round.id === published.id)).toBe(false);
  const reuseInvite = await request.post(`${backend}/api/register`, {
    data: { username: `${username}-x`, password: "another-test-password", invite },
  });
  expect(reuseInvite.status()).toBe(403);
});
