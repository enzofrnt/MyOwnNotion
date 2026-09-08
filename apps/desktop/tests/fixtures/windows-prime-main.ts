import { app } from "electron";

// Loaded only after the real bootstrap has committed and verified the OS key.
void app.whenReady().then(() => {
  console.info("windows-prime-parent-ready");
  app.quit();
});
