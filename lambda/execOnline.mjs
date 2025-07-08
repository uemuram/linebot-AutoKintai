import { validateSignature } from "@line/bot-sdk";
import { askGemini } from './geminiUtil.mjs';
import { registKintai, roundDownTo15Min, roundUpTo15Min } from './chronusUtil.mjs';
import { putItemToDB, deleteItemFromDB, getItemFromDB } from './dynamoDbUtil.mjs';
import { replyMessage, pushMessage, showLoadingAnimation } from './lineUtil.mjs';
import fs from 'fs/promises';

const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const LINE_MY_USER_ID = process.env.LINE_MY_USER_ID;

// TODO 日付が変わっても時刻がリセットされない場合があるのでプロンプト改善 (例: 2日後の勤怠入れて 9時から → 明日の勤怠入れて → 9時の情報が保持されてしまう)
// TODO バッチに対して部分的な時刻変更が聴かない場合があるのでプロンプト改善(例： 7/8にバッチ稼働 → 「7/7 0845～1800で登録しますか?」 → 9時からで → 18時の情報が消えてしまう  日付けが変わっているから?)
// TODO 過去情報は渡さずに、今のメッセージから判定してマージはロジック側でやるのが結局いいのかも
export async function execOnline(req) {

  // 署名の検証（LINEからの接続か）
  const signature = req.headers["x-line-signature"];
  const bool = validateSignature(req.body, LINE_CHANNEL_SECRET, signature);
  if (!bool) throw new Error("invalid signature");

  // LINEからの受け渡し情報の取得
  const body = JSON.parse(req.body);
  console.log(JSON.stringify(body));
  if (!body.events || body.events.length === 0) {
    return;
  }
  const replyToken = body.events[0].replyToken;
  if (!replyToken || typeof replyToken === 'undefined') {
    return;
  }

  // 自身(管理者)のユーザIDのみリクエストを受け付ける(個人用Botのため)
  const userId = body.events[0].source.userId;
  if (userId != LINE_MY_USER_ID) {
    console.log('管理者以外からのアクセスのため終了');
    return;
  }

  // とりあえずローディングする
  await showLoadingAnimation(LINE_MY_USER_ID);

  // 現在の日付データを取得しておく
  let preRegistDateTime;
  try {
    preRegistDateTime = await getItemFromDB(LINE_MY_USER_ID);
  } catch (err) {
    await replyMessage(replyToken, 'DBアクセスでエラーが発生しました');
    return;
  }

  // 日付時刻がどの程度決まっているかを確認し、プロンプトを生成
  const preRegistDateTimeType = getPreRegistDateTimeType(preRegistDateTime);
  const messageText = body.events[0].message.text;
  console.log(`preRegistDateTimeType : ${preRegistDateTimeType}`);
  let promptStr = '';
  switch (preRegistDateTimeType) {
    case 1:
      // 登録候補の日時が全て決まっている場合
      promptStr = await renderTemplate('./prompt/prompt1.txt',
        {
          messageText: messageText, today: getTodayString(),
          kintaiInfo: formatKintaiInfo(preRegistDateTime.date, preRegistDateTime.startTime, preRegistDateTime.endTime)
        });
      break;
    case 2:
      // 登録候補の日時が一部分決まっている場合
      promptStr = await renderTemplate('./prompt/prompt2.txt',
        {
          messageText: messageText, today: getTodayString(),
          kintaiInfo: formatKintaiInfo(preRegistDateTime.date, preRegistDateTime.startTime, preRegistDateTime.endTime)
        });
      break;
    case 3:
      // 登録候補の日時が決まっていない場合
      promptStr = await renderTemplate('./prompt/prompt3.txt',
        { messageText: messageText, today: getTodayString(), });
      break;
    default:
      break;
  }
  console.log(`プロンプト : ${promptStr}`)

  // Geminiに要求メッセージ解析をリクエスト
  let replyFromAIStr;
  try {
    replyFromAIStr = await askGemini(promptStr);
  } catch (err) {
    console.log(err.message);
    console.log(err.stack);
    await replyMessage(replyToken, 'リクエストの解析で予期せぬエラーが発生しました');
    return;
  }

  // 応答をjsオブジェクトに変換
  let replyFromAIObj;
  console.log(replyFromAIStr);
  try {
    replyFromAIObj = JSON.parse(replyFromAIStr.replace(/```json|```/g, '').trim());
  } catch (err) {
    console.log(err.message);
    console.log(err.stack);
    await replyMessage(replyToken, 'リクエストの解析で文法エラーが発生しました');
    return;
  }
  console.log(replyFromAIObj);

  // type=d(その他のメッセージ) の場合はそのまま返却して終了。状態はリセット
  if (replyFromAIObj.type == 'd') {
    await replyMessage(replyToken, replyFromAIObj.res);
    await deleteItemFromDB(LINE_MY_USER_ID);
    return;
  }

  // type=b(否定、拒否) の場合は了解した旨を返却して終了。状態はリセット
  else if (replyFromAIObj.type == 'b') {
    await replyMessage(replyToken, '了解しました');
    await deleteItemFromDB(LINE_MY_USER_ID);
    return;
  }

  // type=c(登録日時が一部、もしくは全体的に確定)場合は、追加情報を促す、もしくは登録日時を宣言した上で登録実施
  else if (replyFromAIObj.type == 'c') {

    // AIの判定結果をチェック
    const validateResult = validateWorkTime(replyFromAIObj.date, replyFromAIObj.startTime, replyFromAIObj.endTime);
    if (!validateResult.status) {
      await replyMessage(replyToken, validateResult.msg);
      // 分かっている情報は保存しておく
      await putItemToDB(LINE_MY_USER_ID, {
        date: replyFromAIObj.date,
        startTime: replyFromAIObj.startTime,
        endTime: replyFromAIObj.endTime
      });
      return;
    }

    // 登録時刻を15分単位で切り上げる / 丸める
    const roundTimes = {
      startTime: roundUpTo15Min(replyFromAIObj.startTime),
      endTime: roundDownTo15Min(replyFromAIObj.endTime),
    };
    console.log(`登録時刻(補正後) : ${roundTimes.startTime}-${roundTimes.endTime}`);

    // 時刻の整合性がとれていない(開始と終了が同じ or 終了の方が手前)ならエラー
    if (roundTimes.startTime === roundTimes.endTime || parseInt(roundTimes.endTime, 10) < parseInt(roundTimes.startTime, 10)) {
      await replyMessage(replyToken, '労働時間の計算でエラーが発生しました');
      return;
    }

    // 登録時刻を通知する
    const year = replyFromAIObj.date.slice(0, 4);
    const month = String(parseInt(replyFromAIObj.date.slice(4, 6), 10)); // ゼロ除去
    const day = String(parseInt(replyFromAIObj.date.slice(6, 8), 10));   // ゼロ除去
    const readyMessage = `${year}/${month}/${day}  ${roundTimes.startTime}～${roundTimes.endTime}で勤怠を登録します`;
    await replyMessage(replyToken, readyMessage);

    // ローディング表示
    await showLoadingAnimation(LINE_MY_USER_ID);

    // 勤怠登録
    let result;
    try {
      result = await registKintai(replyFromAIObj.date, roundTimes.startTime, roundTimes.endTime);
      console.log(result);
    } catch (err) {
      console.log(err.message);
      console.log(err.stack);
      result = { success: false, msg: 'クロノスの操作で予期せぬエラーが発生しました' };
    }

    // 完了通知
    await pushMessage(LINE_MY_USER_ID, result.success ? "登録が完了しました" : result.msg);
    await deleteItemFromDB(LINE_MY_USER_ID);
    return;
  }

  // 登録候補日時があらかじめ全て埋まっており、type=a(同意) の場合、即座に登録。状態はリセット
  else if (preRegistDateTimeType == 1 && replyFromAIObj.type == 'a') {
    // ローディング表示
    await showLoadingAnimation(LINE_MY_USER_ID);

    // 勤怠登録
    let result;
    try {
      result = await registKintai(preRegistDateTime.date, preRegistDateTime.startTime, preRegistDateTime.endTime);
      console.log(result);
    } catch (err) {
      console.log(err.message);
      console.log(err.stack);
      result = { success: false, msg: 'クロノスの操作で予期せぬエラーが発生しました' };
    }

    // 完了通知
    await replyMessage(replyToken, result.success ? "登録が完了しました" : result.msg);
    await deleteItemFromDB(LINE_MY_USER_ID);
    return;
  }

  // 登録候補日時の情報がなく、type=a(同意、依頼) の場合、当日の9時～現在時刻での登録を提案
  else if (preRegistDateTimeType == 3 && replyFromAIObj.type == 'a') {
    // ローディング表示
    await showLoadingAnimation(LINE_MY_USER_ID);

    // 今日の9時～現在時刻を登録日時とする
    const startTime = '0900';
    const endTime = roundDownTo15Min(getCurrentTimeHHMM());

    // 今日の9時～現在時刻を登録日時とできるか判定
    let registDateTime = { date: getTodayCompactString(), startTime: "", endTime: "" };
    let replyText;
    if (parseInt(startTime, 10) < parseInt(endTime, 10)) {
      // 9時～現在時刻が指定可能な場合
      registDateTime.startTime = startTime;
      registDateTime.startTime = endTime;
      replyText = `${getTodayString()}  ${startTime}～${endTime}で勤怠を登録しますか?`;
    } else {
      // 9時～現在時刻が指定できない場合(9時より前にこのフローに入った場合)
      replyText = validateWorkTime(registDateTime.date, "", "").msg;
    }
    // 通知
    await replyMessage(replyToken, replyText);
    // DB登録
    await putItemToDB(LINE_MY_USER_ID, { registDateTime });
    return;
  }

  // 基本ここには到達しないが、もし到達したらエラーを返す
  else {
    await replyMessage(replyToken, '処理分岐エラーが発生しました');
    return;
  }
}

// オブジェクトのタイプ判定
// { date: "20250703", startTime: "0900", endTime: "1915" } -> 1
// { date: "20250703", startTime: "", endTime: null } -> 2
// null、{} -> 3
function getPreRegistDateTimeType(input) {
  // null または 空文字 の場合
  if (input === null || input === '' || typeof input !== 'object') return 3;

  // 空オブジェクトチェック
  if (Object.keys(input).length === 0) return 3;

  // 各項目の存在確認（null/undefined/空文字を含む）
  const keys = ['date', 'startTime', 'endTime'];
  const filledCount = keys.filter(k => input[k] !== undefined && input[k] !== null && input[k] !== '').length;

  if (filledCount === 3) return 1;
  if (filledCount >= 1) return 2;
  return 3;
}

// 共通：日本時間の Date オブジェクトを取得
function getNowJST() {
  const now = new Date();
  return new Date(now.toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
}

// 今日の日付を yyyy/m/d 形式で返す（ゼロ埋めなし）
function getTodayString() {
  const nowJST = getNowJST();
  const year = nowJST.getFullYear();
  const month = nowJST.getMonth() + 1; // 0始まりなので+1
  const day = nowJST.getDate();
  return `${year}/${month}/${day}`;
}

// 今日の日付を YYYYMMDD 形式で返す
function getTodayCompactString() {
  const nowJST = getNowJST();
  const year = nowJST.getFullYear();
  const month = String(nowJST.getMonth() + 1).padStart(2, '0');
  const day = String(nowJST.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

// 現在時刻を HHMM 形式（日本時間）で返す
function getCurrentTimeHHMM() {
  const nowJST = getNowJST();
  const hour = String(nowJST.getHours()).padStart(2, '0');
  const minutes = String(nowJST.getMinutes()).padStart(2, '0');
  return `${hour}${minutes}`;
}

// YYYYMMDD形式を、YYYY/MM/DD形式(ただしゼロ埋めはしない)に変換する
function formatDateToSlashed(dateStr) {
  if (!/^\d{8}$/.test(dateStr)) {
    throw new Error('日付は8桁のYYYYMMDD形式で入力してください');
  }

  const year = dateStr.slice(0, 4);
  const month = String(parseInt(dateStr.slice(4, 6), 10)); // 例: "07" → 7 → "7"
  const day = String(parseInt(dateStr.slice(6, 8), 10));   // 例: "05" → 5 → "5"

  return `${year}/${month}/${day}`;
}

// テンプレートファイルを読み込む
async function renderTemplate(filePath, values) {
  try {
    // テンプレートファイル読み込み
    const template = await fs.readFile(filePath, 'utf-8');

    // テンプレート文字列を関数として評価
    const compiled = new Function(...Object.keys(values), `return \`${template}\`;`);

    // 関数を実行して変数を埋め込む
    return compiled(...Object.values(values));
  } catch (err) {
    console.error('テンプレート処理エラー:', err);
    throw err;
  }
}

// 勤怠情報を整形する 以下は例
// formatKintaiInfo("20250705", "0715", "1900"));
//    → "日付:2025/7/5、勤務開始時刻:7時15分、勤務終了時刻:19時0分"
// console.log(formatKintaiInfo("20250705", "0715", ""));
//    → "日付:2025/7/5、勤務開始時刻:7時15分"
// console.log(formatKintaiInfo("", "0715", ""));
//    → "勤務開始時刻:7時15分"
function formatKintaiInfo(date, startTime, endTime) {
  const parts = [];

  // 日付: YYYYMMDD → YYYY/M/D（ゼロ埋めなし）
  if (date && /^\d{8}$/.test(date)) {
    const year = date.slice(0, 4);
    const month = String(parseInt(date.slice(4, 6), 10));
    const day = String(parseInt(date.slice(6, 8), 10));
    parts.push(`日付:${year}/${month}/${day}`);
  }

  // 勤務開始時刻: HHMM → H時M分（ゼロ埋めなし）
  if (startTime && /^\d{4}$/.test(startTime)) {
    const hour = String(parseInt(startTime.slice(0, 2), 10));
    const minute = String(parseInt(startTime.slice(2, 4), 10));
    parts.push(`勤務開始時刻:${hour}時${minute}分`);
  }

  // 勤務終了時刻: HHMM → H時M分（ゼロ埋めなし）
  if (endTime && /^\d{4}$/.test(endTime)) {
    const hour = String(parseInt(endTime.slice(0, 2), 10));
    const minute = String(parseInt(endTime.slice(2, 4), 10));
    parts.push(`勤務終了時刻:${hour}時${minute}分`);
  }

  return parts.join('、');
}

// 欠落項目に応じたメッセージを返す
function validateWorkTime(date, startTime, endTime) {
  const missingFields = [];

  if (!date) missingFields.push("勤務日");
  if (!startTime) missingFields.push("開始時刻");
  if (!endTime) missingFields.push("終了時刻");

  if (missingFields.length === 0) {
    return {
      status: true,
      msg: ""
    };
  } else {
    return {
      status: false,
      msg: `${missingFields.join("、")}を教えてください`
    };
  }
}