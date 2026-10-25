const value = process.env.VITE_MULTIPLAYER_SERVER_URL?.trim();
if (!value)
  throw new Error(
    "Set GitHub repository variable MULTIPLAYER_SERVER_URL to the deployed production Worker HTTPS origin before publishing Pages.",
  );
const url = new URL(value);
if (
  url.protocol !== "https:" ||
  url.username ||
  url.password ||
  url.search ||
  url.hash ||
  url.pathname !== "/" ||
  ["localhost", "[::1]"].includes(url.hostname) ||
  /^127\./.test(url.hostname)
)
  throw new Error(
    "MULTIPLAYER_SERVER_URL must be a public HTTPS origin, without a path, credentials, query or fragment.",
  );
console.log(`Production multiplayer endpoint configured: ${url.origin}`);

if (process.env.DEPLOY_CHECK_HEALTH === "1") {
  const response = await fetch(new URL("/health", url), { signal: AbortSignal.timeout(10_000) });
  const health = await response.json();
  if (
    !response.ok ||
    health.service !== "technique-quiz" ||
    health.ok !== true ||
    health.testMode !== false ||
    health.appOrigin !== "https://technique.ink"
  )
    throw new Error(
      "Production Worker health check failed. Deploy the production Worker with APP_ORIGIN=https://technique.ink and TEST_MODE=false before publishing Pages.",
    );
  console.log("Production Worker health verified.");
}
