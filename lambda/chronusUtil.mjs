import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

export async function testYahooAccess() {
    const browser = await puppeteer.launch({
        args: chromium.args,
        defaultViewport: chromium.defaultViewport,
        executablePath: await chromium.executablePath(),
        headless: chromium.headless,
    });

    let page = await browser.newPage();
    await page.goto('https://www.yahoo.co.jp/');
    const pageTitle = await page.title();

    await page.waitForSelector('#tabpanelTopics1');
    const innerText = await page.evaluate(() => (document.querySelector('#tabpanelTopics1')).innerText);

    await browser.close();
    return pageTitle + "\n\n" + innerText;
}