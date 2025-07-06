import { validateSignature } from "@line/bot-sdk";
import { askGemini } from './geminiUtil.mjs';
import { registKintai, roundDownTo15Min, roundUpTo15Min } from './chronusUtil.mjs';
import { putItemToDB, deleteItemFromDB, getItemFromDB } from './dynamoDbUtil.mjs';
import { replyMessage, pushMessage, showLoadingAnimation } from './lineUtil.mjs';
import fs from 'fs/promises';

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
          date: preRegistDateTime.date, startTime: preRegistDateTime.startTime, endTime: preRegistDateTime.endTime
        });
      break;
    case 2:
      // 登録候補の日時が一部分決まっている場合
      promptStr = await renderTemplate('./prompt/prompt2.txt',
        {
          messageText: messageText, today: getTodayString(),
          date: preRegistDateTime.date, startTime: preRegistDateTime.startTime, endTime: preRegistDateTime.endTime
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
  // replyFromAIStr = '```json { "type": 1, "date": "", "startTime": "", "endTime": "", "res": "" }  ```';
  // replyFromAIStr = '```json { "type": 2, "date": "20250625", "startTime": "0800", "endTime": "1700", "res": "" }  ```';
  // replyFromAIStr = '```json { "type": 3, "date": "20250625", "startTime": "", "endTime": "", "res": "意味がわかりませんでした。" }  ```';

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
  if (replyFromAIObj.type == 'b') {
    await replyMessage(replyToken, '了解しました');
    await deleteItemFromDB(LINE_MY_USER_ID);
    return;
  }

  // type=c2(日時に不明点がある) の場合は不明点の入力を促す
  if (replyFromAIObj.type == 'c2') {
    // 入力を促すメッセージを送信
    await replyMessage(replyToken, replyFromAIObj.res);
    // DB登録
    await putItemToDB(LINE_MY_USER_ID, {
      date: replyFromAIObj.date,
      startTime: replyFromAIObj.startTime,
      endTime: replyFromAIObj.endTime
    });
    return;
  }

  // 登録候補日時が全て埋まっており、type=a(同意) の場合、即座に登録。状態はリセット
  if (preRegistDateTimeType == 1 && replyFromAIObj.type == 'a') {
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
      await replyMessage(replyToken, 'クロノスの操作で予期せぬエラーが発生しました');
      return;
    }
    // 通知
    await replyMessage(replyToken, '登録が完了しました');
    await deleteItemFromDB(LINE_MY_USER_ID);
    return;
  }


  return;

  // 入力から日付けを調整
  const input = adjustInput(replyFromAIObj);
  console.log(input);

  // 日付けが不正だった場合はエラーを返す
  if (!input.success) {
    await replyMessage(replyToken, '勤怠日付時刻を正しく計算できませんでした');
    return;
  }

  // 勤怠計算前に一旦通知する
  const readyMessage = `${input.year}/${input.month}/${input.day}  ${input.startTime}～${input.endTime}で勤怠を登録します`;
  await replyMessage(replyToken, readyMessage);

  // クロノスに勤怠を登録する
  // let result;
  // try {
  //   result = await registKintai(input.year, input.month, input.day, input.startTime, input.endTime);
  //   console.log(result);
  // } catch (err) {
  //   console.log(err.message);
  //   console.log(err.stack);
  //   result = { success: false, msg: 'クロノスの操作で予期せぬエラーが発生しました' };
  // }
  let result = { success: true };
  // TODO クロノス登録を有効化

  // LINEへ返信
  const pushText = result.success ? "勤怠を登録しました" : result.msg;
  console.log(`プッシュメッセージ:${pushText}`);
  // TODO プッシュを有効化
  // await pushMessage(LINE_MY_USER_ID, pushText);


  return;
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

// インプット情報を調整して返す
// テストコード
// console.log(adjustInput({ type: 1, date: '', startTime: '', endTime: '', res: '' }));
// console.log(adjustInput({ type: 2, date: '20250626', startTime: '0900', endTime: '', res: '' }));
// console.log(adjustInput({ type: 2, date: '', startTime: '', endTime: '', res: '' }));
// console.log(adjustInput({ type: 2, date: '20250101', startTime: '', endTime: '', res: '' }));
// console.log(adjustInput({ type: 3, date: '', startTime: '', endTime: '', res: '' }));
function adjustInput(input) {
  const result = {
    success: true,
    year: '',
    month: '',
    day: '',
    startTime: '',
    endTime: ''
  };

  // 日本時間で現在時刻を取得
  const now = new Date();
  const jst = new Date(now.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }));

  const pad = (n, len = 2) => n.toString().padStart(len, '0');

  const yearStr = jst.getFullYear().toString();
  const monthNum = jst.getMonth() + 1;
  const dayNum = jst.getDate();
  const today = `${yearStr}${pad(monthNum)}${pad(dayNum)}`;
  const currentYearMonth = `${yearStr}${pad(monthNum)}`;

  // 時刻を15分単位に丸める関数（切り捨て）
  const getRoundedTime = (date) => {
    const hours = date.getHours();
    const minutes = Math.floor(date.getMinutes() / 15) * 15;
    return `${pad(hours)}${pad(minutes)}`;
  };

  // HHMM形式文字列 → Dateへの変換ユーティリティ
  const toRoundedTimeFromHHMM = (hhmm, baseDate) => {
    const h = parseInt(hhmm.substring(0, 2));
    const m = parseInt(hhmm.substring(2, 4));
    const date = new Date(baseDate);
    date.setHours(h);
    date.setMinutes(m);
    return getRoundedTime(date);
  };

  switch (input.type) {
    case 1:
      result.year = yearStr;
      result.month = monthNum.toString();
      result.day = dayNum.toString();
      result.startTime = '0900';

      const endTime1 = getRoundedTime(jst);
      if (parseInt(endTime1) < 900) {
        result.success = false;
        break;
      }

      result.endTime = endTime1;
      break;

    case 2:
      let inputDate = input.date || today;

      if (/^\d{8}$/.test(inputDate) && inputDate.substring(0, 6) === currentYearMonth) {
        result.year = inputDate.substring(0, 4);
        result.month = parseInt(inputDate.substring(4, 6)).toString();
        result.day = parseInt(inputDate.substring(6, 8)).toString();
      } else {
        result.success = false;
        break;
      }

      // startTime の処理（丸める）
      if (input.startTime) {
        result.startTime = toRoundedTimeFromHHMM(input.startTime, jst);
      } else {
        result.startTime = '0900';
      }

      // endTime の処理（丸める）
      if (input.endTime) {
        result.endTime = toRoundedTimeFromHHMM(input.endTime, jst);
      } else {
        result.endTime = getRoundedTime(jst);
      }

      // 時間順チェック
      if (parseInt(result.endTime) < parseInt(result.startTime)) {
        result.success = false;
      }

      break;

    default:
      result.success = false;
      break;
  }

  return result;
}

// 今日の日付をyyyy/mm/dd形式で返す
function getTodayString() {
  const now = new Date();

  // 日本時間に変換
  const nowJST = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));

  // 年・月・日を取得
  const year = nowJST.getFullYear();
  const month = String(nowJST.getMonth() + 1).padStart(2, '0'); // 月は0始まりなので+1
  const day = String(nowJST.getDate()).padStart(2, '0');

  // yyyy/mm/dd 形式の文字列を作成
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