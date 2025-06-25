import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const CHRONUS_BASE_URL = process.env.CHRONUS_BASE_URL;
const CHRONUS_PERSON_CODE = process.env.CHRONUS_PERSON_CODE;
const CHRONUS_PERSON_PASSWORD = process.env.CHRONUS_PERSON_PASSWORD;

// 勤怠登録
export async function registKintai(year, month, day, startTime, endTime) {
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
        const msg = '指定日付の勤怠ぺージに遷移できませんでした。すでに勤怠が承認済みの可能性があります';
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

    // -------------------- 登録用データ整理 --------------------
    const workingTime = calculateWorkingTime(startTime, endTime);
    console.log(`業務時間 : ${year}/${month}/${day} ${startTime}-${endTime}`);
    console.log(`工数合計 : ${workingTime}`);

    await browser.close();
    return { success: true };
}

// 業務開始時刻と終了時刻から業務時間を計算
function calculateWorkingTime(startTime, endTime) {
    // 時と分を数値に変換
    const startHour = parseInt(startTime.substring(0, 2), 10);
    const startMin = parseInt(startTime.substring(2, 4), 10);
    const endHour = parseInt(endTime.substring(0, 2), 10);
    const endMin = parseInt(endTime.substring(2, 4), 10);

    // 分単位の時間に変換
    const startTotalMin = startHour * 60 + startMin;
    const endTotalMin = endHour * 60 + endMin;

    // 業務時間（分）
    let workingMin = endTotalMin - startTotalMin;

    // 休憩時間（12:00〜13:00 の被り分）を引く
    const breakStart = 12 * 60;
    const breakEnd = 13 * 60;

    const overlapStart = Math.max(startTotalMin, breakStart);
    const overlapEnd = Math.min(endTotalMin, breakEnd);

    if (overlapStart < overlapEnd) {
        workingMin -= (overlapEnd - overlapStart);
    }

    // 時と分に戻す
    const hh = Math.floor(workingMin / 60);
    const mm = workingMin % 60;

    // 4 桁文字列 (HHMM) に整形
    const result = `${hh.toString().padStart(2, '0')}${mm.toString().padStart(2, '0')}`;

    return result;
}

// export async function testYahooAccess() {
//     const browser = await puppeteer.launch({
//         args: chromium.args,
//         defaultViewport: chromium.defaultViewport,
//         executablePath: await chromium.executablePath(),
//         headless: chromium.headless,
//     });

//     let page = await browser.newPage();
//     await page.goto('https://www.yahoo.co.jp/');
//     const pageTitle = await page.title();

//     await page.waitForSelector('#tabpanelTopics1');
//     const innerText = await page.evaluate(() => (document.querySelector('#tabpanelTopics1')).innerText);

//     await browser.close();
//     return pageTitle + "\n\n" + innerText;
// }