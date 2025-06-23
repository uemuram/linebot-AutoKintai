import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const CHRONUS_BASE_URL = 'https://chronus-ext.tis.co.jp';

// 勤怠登録
export async function registKintai() {
    const browser = await puppeteer.launch({
        args: chromium.args,
        defaultViewport: chromium.defaultViewport,
        executablePath: await chromium.executablePath(),
        headless: chromium.headless,
    });

    let page = await browser.newPage();
    await page.goto(`${CHRONUS_BASE_URL}/Lysithea/JSP_Files/authentication/WC010_1.jsp?COMPANY_CODE=100`);

    // 社員番号入力
    await page.type('input[name="PersonCode"]', 'TIE302124');

    // パスワード入力
    await page.type('input[name="Password"]', '321mills');

    // ログインボタン (onclick="doLabel('LOGON');return false;" のリンク)
    await Promise.all([
        page.click('a[onclick="doLabel(\'LOGON\');return false;"]'),
        page.waitForNavigation({ waitUntil: 'networkidle0' })
    ]);

    // 確認: ログイン後のタイトル表示
    const title = await page.title();
    console.log(`ログイン後のタイトル: ${title}`);

    // ログイン後のフレーム取得
    const frames = page.frames();
    const menuFrame = frames.find(f => f.name() === 'MENU');

    if (!menuFrame) {
        console.log('MENU フレームが見つかりません。ログイン失敗の可能性があります。');
        await browser.close();
        return null;
    }

    // MENU
    const html = await menuFrame.content();
    console.log('MENU フレームのHTML:');
    console.log(html);


    await browser.close();
    return "ok";
}

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