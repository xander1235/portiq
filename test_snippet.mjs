import { chromium } from 'playwright';

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();

    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', err => console.log('PAGE ERROR:', err.message));

    await page.goto('http://localhost:5177/');

    try {
        // Wait for the URL input to be ready, standard load
        await page.waitForSelector('.url', { timeout: 5000 });

        // Type something in the URL
        await page.fill('.url input', 'https://example.com/api');

        // Click the Code button (has title="Generate Code Snippet")
        console.log("Clicking Code button...");
        await page.click('button[title="Generate Code Snippet"]');

        // Wait a sec to see if it crashes
        await page.waitForTimeout(2000);
        console.log("Finished script successfully.");
    } catch (e) {
        console.error("Script error:", e);
    } finally {
        await browser.close();
    }
})();
