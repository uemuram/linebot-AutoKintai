import { validateSignature } from "@line/bot-sdk";
import { askGemini } from './geminiUtil.mjs';
import { registKintai, roundDownTo15Min, roundUpTo15Min } from './chronusUtil.mjs';
import { putItemToDB, deleteItemFromDB, getItemFromDB } from './dynamoDbUtil.mjs';
import { replyMessage, pushMessage, showLoadingAnimation } from './lineUtil.mjs';
import fs from 'fs/promises';

const CHRONUS_BASE_URL = process.env.CHRONUS_BASE_URL;
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const LINE_MY_USER_ID = process.env.LINE_MY_USER_ID;

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
  const preRegistDateTimeFillType = getDateTimeFillType(preRegistDateTime);
  const messageText = body.events[0].message.text;
  console.log(`preRegistDateTimeFillType : ${preRegistDateTimeFillType}`);
  const promptStr = await renderTemplate('./prompt/prompt1.txt', { messageText: messageText, today: getTodayString() });
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
  let replyFromAI;
  try {
    let jsonStr = '';
    // ```json ～ ``` に囲まれている場合は中身だけ抽出
    const fencedMatch = replyFromAIStr.match(/```json\s*([\s\S]*?)\s*```/);
    if (fencedMatch) {
      jsonStr = fencedMatch[1].trim();
    } else {
      // 囲いがない場合はそのままパースを試みる
      jsonStr = replyFromAIStr.trim();
    }
    replyFromAI = JSON.parse(jsonStr);
  } catch (err) {
    console.log('JSON解析エラー:', err.message);
    console.log(err.stack);
    await replyMessage(replyToken, 'リクエストの解析で文法エラーが発生しました');
    return;
  }
  console.log(replyFromAI);

  // -----------------------ここから結果判定 & 処理実施------------------------------------------------
  // type=d(その他のメッセージ) の場合はそのまま返却して終了。状態はリセット
  if (replyFromAI.type == 'd') {
    console.log('分岐:その他');
    await replyMessage(replyToken, replyFromAI.res);
    await deleteItemFromDB(LINE_MY_USER_ID);
  }

  // type=b(否定、拒否) の場合は了解した旨を返却して終了。状態はリセット
  else if (replyFromAI.type == 'b') {
    console.log('分岐:拒否');
    await replyMessage(replyToken, '了解しました');
    await deleteItemFromDB(LINE_MY_USER_ID);
  }

  // 登録候補日時があらかじめ全て埋まっており、type=a(同意) の場合、即座に登録。状態はリセット
  else if (preRegistDateTimeFillType == 1 && replyFromAI.type == 'a') {
    console.log('分岐:即時登録');

    // 勤怠登録
    let result;
    try {
      result = await registKintai(preRegistDateTime.date, preRegistDateTime.startTime, preRegistDateTime.endTime);
      console.log(result);
    } catch (err) {
      console.log(err.stack);
      result = { success: false, msg: 'クロノスの操作で予期せぬエラーが発生しました' };
    }

    // 完了通知
    await replyMessage(replyToken, result.success ? `登録が完了しました\n\n調整が必要な場合は以下から修正してください\n${CHRONUS_BASE_URL}&openExternalBrowser=1` : result.msg);
    await deleteItemFromDB(LINE_MY_USER_ID);
  }

  // それ以外の場合は登録日時の判明状況から判断
  else {
    console.log('分岐:詳細検討');

    // 全ての項目が空で、かつtype=c(勤怠入力依頼)場合は、現在時刻を利用した登録を提案
    if (preRegistDateTimeFillType == 3 && getDateTimeFillType(replyFromAI) == 3 && replyFromAI.type == 'c') {
      console.log('分岐2:当日時刻を提案');

      // 今日の9時～現在時刻を登録日時とする
      const startTime = '0900';
      const endTime = roundDownTo15Min(getCurrentTimeHHMM());

      // 今日の9時～現在時刻を登録日時とできるか判定
      let registDateTime = { date: getTodayCompactString(), startTime: "", endTime: "" };
      let replyText;
      if (parseInt(startTime, 10) < parseInt(endTime, 10)) {
        // 9時～現在時刻が指定可能な場合
        registDateTime.startTime = startTime;
        registDateTime.endTime = endTime;
        replyText = `${getTodayString()}  ${registDateTime.startTime}～${registDateTime.endTime}で勤怠を登録しますか?`;
      } else {
        // 9時～現在時刻が指定できない場合(9時より前にこのフローに入った場合)
        replyText = validateWorkTime(registDateTime.date, "", "").msg;
      }
      await replyMessage(replyToken, replyText);
      await putItemToDB(LINE_MY_USER_ID, registDateTime);
    }

    // 1つでも日時情報がある場合は日時情報から判断
    else {
      console.log('分岐2:日時情報から判断');

      // 補正1 日付の指定が変わった場合は過去の勤怠候補時刻を捨てる
      console.log(`勤怠日時候補(補正前):${JSON.stringify(preRegistDateTime)}`);
      if (preRegistDateTime && replyFromAI.date && preRegistDateTime.date
        && replyFromAI.date != preRegistDateTime.date) {
        //両方に日付の指定があり、かつそれが異なっている場合
        preRegistDateTime.startTime = "";
        preRegistDateTime.endTime = "";
      }
      console.log(`勤怠日時候補(補正後):${JSON.stringify(preRegistDateTime)}`);

      // AIの判定と過去の勤怠日時候補をマージ
      const mergedDateTime = mergeDateTime(replyFromAI, preRegistDateTime);
      console.log("AIの判定/勤怠日時候補/マージ後(以下)");
      console.log(replyFromAI);
      console.log(preRegistDateTime);
      console.log(mergedDateTime);

      // ここまでの判定結果をチェック
      const validateResult = validateWorkTime(mergedDateTime.date, mergedDateTime.startTime, mergedDateTime.endTime);
      if (!validateResult.status) {
        // 欠落がある場合は、欠落部分の入力を促すメッセージを送信して終了
        await replyMessage(replyToken, validateResult.msg);
        // 分かっている情報は保存しておく
        await putItemToDB(LINE_MY_USER_ID, {
          date: mergedDateTime.date,
          startTime: mergedDateTime.startTime,
          endTime: mergedDateTime.endTime
        });
        return;
      }

      // 登録時刻を15分単位で切り上げる / 丸める
      const roundTimes = {
        startTime: roundUpTo15Min(mergedDateTime.startTime),
        endTime: roundDownTo15Min(mergedDateTime.endTime),
      };
      console.log(`登録時刻(補正後) : ${roundTimes.startTime}-${roundTimes.endTime}`);

      // 時刻の整合性がとれていない(開始と終了が同じ or 終了の方が手前)ならエラー
      if (roundTimes.startTime === roundTimes.endTime || parseInt(roundTimes.endTime, 10) < parseInt(roundTimes.startTime, 10)) {
        await replyMessage(replyToken, '勤務時間の計算でエラーが発生しました');
        return;
      }

      // 登録時刻を通知する
      const year = mergedDateTime.date.slice(0, 4);
      const month = String(parseInt(mergedDateTime.date.slice(4, 6), 10)); // ゼロ除去
      const day = String(parseInt(mergedDateTime.date.slice(6, 8), 10));   // ゼロ除去
      const readyMessage = `${year}/${month}/${day}  ${roundTimes.startTime}～${roundTimes.endTime}で勤怠を登録します`;
      await replyMessage(replyToken, readyMessage);

      // ローディング表示
      await showLoadingAnimation(LINE_MY_USER_ID);

      // 勤怠登録
      let result;
      try {
        result = await registKintai(mergedDateTime.date, roundTimes.startTime, roundTimes.endTime);
        console.log(result);
      } catch (err) {
        console.log(err.message);
        console.log(err.stack);
        result = { success: false, msg: 'クロノスの操作で予期せぬエラーが発生しました' };
      }

      // 完了通知
      await pushMessage(LINE_MY_USER_ID, result.success ? `登録が完了しました\n\n調整が必要な場合は以下から修正してください\n${CHRONUS_BASE_URL}&openExternalBrowser=1` : result.msg);
      await deleteItemFromDB(LINE_MY_USER_ID);
    }
  }
}

// オブジェクトのタイプ判定
// { date: "20250703", startTime: "0900", endTime: "1915" } -> 1
// { date: "20250703", startTime: "", endTime: null } -> 2
// null、{} -> 3
function getDateTimeFillType(input) {
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

// 欠落項目に応じたメッセージを返す。欠落がなければstatus=true、欠落があれば欠落項目を埋めるメッセージを返す
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

// DBからの取得結果とAIの判定結果をマージ(AI側を優先)
function mergeDateTime(replyFromAI, preRegistDateTime) {
  const fields = ["date", "startTime", "endTime"];
  const result = {};

  fields.forEach((key) => {
    const replyVal = replyFromAI?.[key] ?? "";
    const preVal = preRegistDateTime?.[key] ?? "";

    result[key] = replyVal !== "" ? replyVal
      : preVal !== "" ? preVal
        : "";
  });

  return result;
}