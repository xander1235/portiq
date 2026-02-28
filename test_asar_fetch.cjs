const { app, net } = require('electron');
const path = require('path');
app.whenReady().then(async () => {
  const p = path.resolve(__dirname, 'release/mac-arm64/Commu.app/Contents/Resources/app.asar/dist/index.html');
  try {
    const res = await net.fetch('file://' + p);
    console.log(res.status);
  } catch (e) {
    console.log("FETCH FAILED: " + e.message);
  }
  app.quit();
});
