// brand.html 의 아트보드를 PNG로 캡처 (채널 프로필 로고)
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const launchOpts = { args: ["--no-sandbox"] };
if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE)
  launchOpts.executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;

const browser = await chromium.launch(launchOpts);
const page = await browser.newPage({ viewport: { width: 1080, height: 1080 }, deviceScaleFactor: 1 });
await page.goto("file://" + path.join(__dirname, "brand.html"));
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(300);

for (const [id, file] of [["a", "out/logo_navy.png"], ["b", "out/logo_cream.png"]]) {
  const el = await page.$("#" + id);
  await el.screenshot({ path: path.join(__dirname, file) });
  console.log("✔", file);
}
await browser.close();
