import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const CHRONUS_BASE_URL = process.env.CHRONUS_BASE_URL;
const CHRONUS_PERSON_CODE = process.env.CHRONUS_PERSON_CODE;
const CHRONUS_PERSON_PASSWORD = process.env.CHRONUS_PERSON_PASSWORD;

// 勤怠登録
export async function registKintai(year, month, day) {
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
    console.log('--- ログイン 開始 ---');
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

    // -------------------- PJコードリセット --------------------
    console.log('--- PJコードリセット 開始 ---');
    // 「工数票部分に前日以前と同じPJコード・工程区分を表示する」のチェックを外す
    const pjCodeDispCheckbox = await menuFrame.$('input.InputCheck[name="costInputDivisionDisp"]');
    await menuFrame.evaluate(el => el.checked = false, pjCodeDispCheckbox);
    console.log('--- PJコードリセット 終了 ---');

    // -------------------- 日付けクリック --------------------
    console.log('--- 日付けクリック 開始 ---');
    // 日付セルを取得
    const dateLinkOnclickValue = `JavaScript:return  fnClickHizuke(${year},${month},${day},'PERSONAL');`;
    const dateLinkSelector = `a[onclick="${dateLinkOnclickValue}"]`;
    const dateLink = await menuFrame.$(dateLinkSelector);
    // クリック可能なリンクが見つからない場合はエラーとする
    if (!dateLink) {
        const msg = '指定日付の勤怠ぺージに遷移できませんでした。すでに勤怠が登録済みの可能性があります';
        console.log(msg);
        await browser.close();
        return { success: false, msg: msg };
    }
    // クリック
    await dateLink.click();
    // OPERATIONフレームが更新されるのを待つ
    try {
        await page.waitForFunction(() => {
            const frame = Array.from(window.frames).find(f => f.name === 'OPERATION');
            if (!frame) return false;
            const nobr = frame.document.querySelector('nobr.kinoutitle');
            return nobr && nobr.textContent.trim() === '勤休内容登録';
        }, { timeout: 5000 });  // 最大5秒待つ
    } catch (e) {
        const msg = '勤怠ページへの遷移に失敗しました';
        console.log(msg);
        await browser.close();
        return { success: false, msg: msg };
    }
    const frames2 = page.frames();
    const operationFrame = frames2.find(f => f.name() === 'OPERATION');
    htmlString = await operationFrame.content();
    console.log(`OPERATIONフレーム : ${htmlString}`);
    console.log('--- 日付けクリック 終了 ---');

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