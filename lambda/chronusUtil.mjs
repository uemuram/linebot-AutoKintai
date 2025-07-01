import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const CHRONUS_BASE_URL = process.env.CHRONUS_BASE_URL;
const CHRONUS_PERSON_CODE = process.env.CHRONUS_PERSON_CODE;
const CHRONUS_PERSON_PASSWORD = process.env.CHRONUS_PERSON_PASSWORD;
const CHRONUS_PJCODE_INFO = process.env.CHRONUS_PJCODE_INFO;

// 勤怠登録
export async function registKintai(year, month, day, startTime, endTime) {
    const browser = await puppeteer.launch({
        args: chromium.args,
        defaultViewport: chromium.defaultViewport,
        executablePath: await chromium.executablePath(),
        headless: chromium.headless,
    });

    try {
        console.log('----------- ページオープン 開始 -----------');
        const page = await browser.newPage();
        await page.goto(`${CHRONUS_BASE_URL}/Lysithea/JSP_Files/authentication/WC010_1.jsp?COMPANY_CODE=100`);

        console.log('----------- ログイン 開始 -----------');
        const menuFrame = await login(page);
        if (!menuFrame) throw new Error('クロノスのログインに失敗しました');

        console.log('----------- 日付けクリック 開始 -----------');
        await resetPJCode(menuFrame);
        const operationFrame = await clickDate(menuFrame, page, year, month, day);
        if (!operationFrame) throw new Error('日付けリンクのクリックに失敗しました');

        console.log('----------- 勤怠登録 開始 -----------');
        const workingTime = calculateWorkingTime(startTime, endTime);
        console.log(`業務時間: ${year}/${month}/${day} ${startTime}-${endTime} → 工数: ${workingTime}`);
        await inputWorkDetails(operationFrame, startTime, endTime, '0001WAD', workingTime);

        let pjCodeInfo = JSON.parse(CHRONUS_PJCODE_INFO);
        console.log(`PJコード情報(時間計算前) : ${JSON.stringify(pjCodeInfo)}`);
        pjCodeInfo = allocateWorkingTime(workingTime, pjCodeInfo);
        console.log(`PJコード情報(時間計算後) : ${JSON.stringify(pjCodeInfo)}`);

        const success = await submitRegistration(operationFrame, page);
        if (!success) throw new Error('登録ボタンの押下に失敗しました');

        return { success: true };
    } catch (err) {
        console.error(err.message);
        return { success: false, msg: err.message };
    } finally {
        await browser.close();
    }
}

// ログインしてMENUフレームを返す
async function login(page) {
    await page.type('input[name="PersonCode"]', CHRONUS_PERSON_CODE);
    await page.type('input[name="Password"]', CHRONUS_PERSON_PASSWORD);

    await Promise.all([
        page.waitForNavigation({ waitUntil: ['load', 'networkidle0'] }),
        page.click('a[onclick="doLabel(\'LOGON\');return false;"]'),
    ]);

    return getFrameByName(page, 'MENU');
}

// PJコードチェックを外す
async function resetPJCode(menuFrame) {
    const checkbox = await menuFrame.$('input.InputCheck[name="costInputDivisionDisp"]');
    if (checkbox) await menuFrame.evaluate(el => (el.checked = false), checkbox);
}

// 日付クリック処理
async function clickDate(menuFrame, page, year, month, day) {
    const selector = `a[onclick="JavaScript:return  fnClickHizuke(${year},${month},${day},'PERSONAL');"]`;
    const dateLink = await menuFrame.$(selector);

    if (!dateLink) throw new Error('指定日付に遷移できません。勤怠が承認済みの可能性があります');

    await dateLink.click();

    await page.waitForFunction(() => {
        const frame = Array.from(window.frames).find(f => f.name === 'OPERATION');
        if (!frame) return false;
        const title = frame.document.querySelector('nobr.kinoutitle');
        return title?.textContent.trim() === '勤休内容登録';
    }, { timeout: 5000 });

    return getFrameByName(page, 'OPERATION');
}

// 工数入力・打刻入力処理
async function inputWorkDetails(frame, start, end, pjCode, workTime) {
    await frame.click('input[name="StartTime"]', { clickCount: 3 });
    await frame.type('input[name="StartTime"]', start);
    await frame.click('input[name="EndTime"]', { clickCount: 3 });
    await frame.type('input[name="EndTime"]', end);

    const result = await frame.evaluate((pjCode, workTime) => {
        const selects = document.querySelectorAll('select[name="CostNoItem"]');
        const details = document.querySelectorAll('input[name="CostDetailCode"]');
        const quantities = document.querySelectorAll('input[name="CostQuantity"]');

        const select = selects[0];
        const option = Array.from(select.options).find(o => o.textContent.includes(pjCode));
        if (!option) return { success: false, msg: `PJコード(${pjCode})が見つかりません` };

        select.value = option.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));

        details[0].value = '0099';
        details[0].dispatchEvent(new Event('blur', { bubbles: true }));

        quantities[0].value = workTime;
        quantities[0].dispatchEvent(new Event('blur', { bubbles: true }));

        return { success: true };
    }, pjCode, workTime);

    if (!result.success) throw new Error(result.msg);
}

// 登録ボタン押下と成功判定
async function submitRegistration(frame, page) {
    await frame.click('a[onclick="top.dosubmitRegister();return false;"]');
    await new Promise(resolve => setTimeout(resolve, 2000));

    const newFrame = getFrameByName(page, 'OPERATION');
    const html = await newFrame.content();

    const error = await newFrame.$('font[color="red"][size="4"]');
    if (error) {
        const msg = await newFrame.evaluate(el => el.textContent.trim(), error);
        throw new Error(msg);
    }

    return html.includes('△');
}

// 指定フレーム名でframeを取得
function getFrameByName(page, name) {
    return page.frames().find(f => f.name() === name);
}

// 業務時間の計算
function calculateWorkingTime(start, end) {
    const toMinutes = t => parseInt(t.slice(0, 2)) * 60 + parseInt(t.slice(2));
    const [startMin, endMin] = [toMinutes(start), toMinutes(end)];

    let duration = endMin - startMin;
    const breakStart = 12 * 60, breakEnd = 13 * 60;
    const overlap = Math.max(0, Math.min(endMin, breakEnd) - Math.max(startMin, breakStart));
    duration -= overlap;

    const hh = Math.floor(duration / 60);
    const mm = duration % 60;
    return `${hh.toString().padStart(2, '0')}${mm.toString().padStart(2, '0')}`;
}

// 業務時間を比率に従って分割する
function allocateWorkingTime(workingTime, projectInfo) {
    const toMinutes = (hhmm) => {
        const hours = parseInt(hhmm.slice(0, 2), 10);
        const minutes = parseInt(hhmm.slice(2), 10);
        return hours * 60 + minutes;
    };

    const toHHMM = (minutes) => {
        const hrs = Math.floor(minutes / 60);
        const mins = minutes % 60;
        return String(hrs).padStart(2, '0') + String(mins).padStart(2, '0');
    };

    const roundTo15 = (min) => Math.round(min / 15) * 15;

    const totalMinutes = toMinutes(workingTime);
    const pjcodes = projectInfo.pjcodes;
    const totalRatio = pjcodes.reduce((sum, p) => sum + p.ratio, 0);

    // 仮の分割結果（15分未満も含む）
    const rawAllocations = pjcodes.map(p => ({
        ...p,
        rawMinutes: (totalMinutes * p.ratio) / totalRatio
    }));

    // 四捨五入して15分単位に
    let allocated = rawAllocations.map(p => ({
        ...p,
        allocatedMinutes: roundTo15(p.rawMinutes)
    }));

    // 合計誤差を調整
    let adjustedTotal = allocated.reduce((sum, p) => sum + p.allocatedMinutes, 0);
    let diff = totalMinutes - adjustedTotal;

    // 差を15分単位で調整（±15分ずつ）
    const adjustUnit = 15;
    const sign = diff > 0 ? 1 : -1;

    while (diff !== 0) {
        for (let i = 0; i < allocated.length && diff !== 0; i++) {
            allocated[i].allocatedMinutes += sign * adjustUnit;
            diff -= sign * adjustUnit;
        }
    }

    // 結果を HHMM 形式で戻す
    return allocated.map(p => ({
        pjcode: p.pjcode,
        costDetailCode: p.costDetailCode,
        ratio: p.ratio,
        workingTime: toHHMM(p.allocatedMinutes)
    }));
}
