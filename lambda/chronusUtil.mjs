import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const CHRONUS_BASE_URL = process.env.CHRONUS_BASE_URL;
const CHRONUS_PERSON_CODE = process.env.CHRONUS_PERSON_CODE;
const CHRONUS_PERSON_PASSWORD = process.env.CHRONUS_PERSON_PASSWORD;

// 勤怠登録
export async function registKintai() {
    // デバッグ用
    let htmlString = '';

    // -------------------- ページオープン --------------------
    console.log('--- ページオープン 開始 ---');
    const browser = await puppeteer.launch({
        args: chromium.args,
        defaultViewport: chromium.defaultViewport,
        executablePath: await chromium.executablePath(),
        headless: chromium.headless,
    });
    let page = await browser.newPage();
    await page.goto(`${CHRONUS_BASE_URL}/Lysithea/JSP_Files/authentication/WC010_1.jsp?COMPANY_CODE=100`);
    console.log('--- ページオープン 終了 ---');

    // -------------------- ログイン --------------------
    console.log('--- ログイン 開始');
    // 社員番号入力
    await page.type('input[name="PersonCode"]', CHRONUS_PERSON_CODE);
    // パスワード入力
    await page.type('input[name="Password"]', CHRONUS_PERSON_PASSWORD);
    // ログインボタン (onclick="doLabel('LOGON');return false;" のリンク)
    await Promise.all([
        page.click('a[onclick="doLabel(\'LOGON\');return false;"]'),
        page.waitForNavigation({ waitUntil: 'networkidle0' })
    ]);

    // チェック
    // ログイン後のフレーム取得
    const frames = page.frames();
    const menuFrame = frames.find(f => f.name() === 'MENU');
    if (!menuFrame) {
        const msg = 'クロノスのログインに失敗しました';
        console.log(msg);
        await browser.close();
        return { success: false, msg: msg };
    }
    // html確認表示
    htmlString = await menuFrame.content();
    console.log(`MENUフレーム : ${htmlString}`);
    console.log('--- ログイン 終了 ---');


    await browser.close();
    return { success: true };
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