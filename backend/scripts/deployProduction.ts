const SERVICE_NAME = "agromarketkz-cloudflare-deploy";

const tokenResult = Bun.spawnSync([
  "security",
  "find-generic-password",
  "-s",
  SERVICE_NAME,
  "-w",
], { stdout: "pipe", stderr: "pipe" });

const keychainToken = tokenResult.exitCode === 0
  ? new TextDecoder().decode(tokenResult.stdout).trim()
  : "";
const token = keychainToken || process.env.CLOUDFLARE_API_TOKEN?.trim();
const env = { ...process.env };
if (token) {
  env.CLOUDFLARE_API_TOKEN = token;
} else {
  console.warn(
    `В Keychain нет deploy-токена «${SERVICE_NAME}»; используется текущая Wrangler OAuth-сессия. ` +
    "Если она истекла, один раз выполните `wrangler login`.",
  );
}

const child = Bun.spawn(["./node_modules/.bin/wrangler", "deploy"], {
  cwd: new URL("..", import.meta.url).pathname,
  env,
  stdout: "inherit",
  stderr: "inherit",
});

process.exit(await child.exited);
