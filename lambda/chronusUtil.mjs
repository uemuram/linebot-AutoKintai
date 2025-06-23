import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

export async function testYahooAccess() {
    console.log("y1");


try{


    const browser = await puppeteer.launch({
        args: chromium.args,
        defaultViewport: chromium.defaultViewport,
        executablePath: await chromium.executablePath(),
        headless: chromium.headless,
    });

    console.log("y2");

    let page = await browser.newPage();

    console.log("y3");

    await page.goto('https://www.yahoo.co.jp/');
    const pageTitle = await page.title();

    console.log("y4");

    await page.waitForSelector('#tabpanelTopics1');
    const innerText = await page.evaluate(() => (document.querySelector('#tabpanelTopics1')).innerText);

    console.log("y5");

    await browser.close();

    console.log("y6");

    return pageTitle + "\n\n" + innerText;

    } catch (err) {
        console.error("error!:", err);
        throw err;  // Lambda にもエラーを返す
    }
}