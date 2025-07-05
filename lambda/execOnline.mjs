import { validateSignature } from "@line/bot-sdk";
import { askGemini } from './geminiUtil.mjs';
import { registKintai } from './chronusUtil.mjs';

const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const LINE_MY_USER_ID = process.env.LINE_MY_USER_ID;

// TODO Qiitaには、自分用のbotを作る、というスタンスにする
// TODO dialogflowで何かできる? https://ledge.ai/articles/dialogflow-try-3

export async function execOnline(req, lineClient) {

  // 署名の検証（LINEからの接続であるか）
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

  // 生成AI向けメッセージを組み立て
  const messageText = body.events[0].message.text;
  const prompt = `これから渡すメッセージに対して、以下のルールでjsonフォーマットで応答を返してください`
    + `・メッセージは、「同意、依頼、単純指示の文言」(はい、よろしく、入れて、つけて、お願いします、等)または「勤怠システムへの入力依頼や勤怠時刻の指定」である可能性があります`
    + `・勤怠システムの名前は「クロノス(chronus)」です`
    + `・メッセージが「同意、依頼、単純指示の文言」である場合は、type=1としてください`
    + `・メッセージが「勤怠システムへの入力依頼や勤怠時刻の指定」である場合は、type=2としてください`
    + `・メッセージが上記どちらでもない場合は、type=3としてください`
    + `・type=1の場合は、date、startTime、endTimeを空文字としてください`
    + `・type=2の場合は、dateをメッセージから読み取れる勤務日付、startTimeをメッセージから読み取れる勤務開始時刻、endTimeをメッセージから読み取れる勤務開始時刻としてください。指定がない項目はそれぞれ空文字にしてください`
    + `・type=3の場合は、resをメッセージに対する自然な返答(ただし質問文ではない)としてください`
    + `・今日の日付は${getTodayString()}です`
    + `・応答のフォーマット(JSON)は{type:数字型、date:文字列型(yyyymmdd形式)、startTime:文字列型(24時間のhhmm形式)、endTime:文字列型(24時間のhhmm形式)、res:文字列型}としてください`
    + `・メッセージは「${messageText}」です`;
  console.log(prompt);
  // TODO 「上記以外の指示」の場合は、その機能はありません、という応答を返す
  // TODO プロンプト生成は別ソースにして状態によって異なるプロンプトにするのがいいかも


  // Geminiに要求メッセージ解析をリクエスト
  let replyFromAIStr;
  try {
    replyFromAIStr = await askGemini(prompt);
  } catch (err) {
    console.log(err.message);
    console.log(err.stack);
    await lineClient.replyMessage(replyToken, [{ type: "text", text: 'リクエストの解析で予期せぬエラーが発生しました' },]);
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
    await lineClient.replyMessage(replyToken, [{ type: "text", text: 'リクエストの解析で文法エラーが発生しました' },]);
    return;
  }
  console.log(replyFromAIObj);

  // type=3 の場合はそのまま返却して終了
  if (replyFromAIObj.type != 1 && replyFromAIObj.type != 2) {
    await lineClient.replyMessage(replyToken, [{ type: "text", text: replyFromAIObj.res },]);
    return;
  }

  // 入力から日付けを調整
  const input = adjustInput(replyFromAIObj);
  console.log(input);

  // 日付けが不正だった場合はエラーを返す
  if (!input.success) {
    await lineClient.replyMessage(replyToken, [{ type: "text", text: '勤怠日付時刻を正しく計算できませんでした' },]);
    return;
  }

  // 勤怠計算前に一旦通知する
  const readyMessage = `${input.year}/${input.month}/${input.day}  ${input.startTime}～${input.endTime}で勤怠を登録します`;
  await lineClient.replyMessage(replyToken, [{ type: "text", text: readyMessage },]);

  // クロノスに勤怠を登録する
  let result;
  try {
    result = await registKintai(input.year, input.month, input.day, input.startTime, input.endTime);
    console.log(result);
  } catch (err) {
    console.log(err.message);
    console.log(err.stack);
    result = { success: false, msg: 'クロノスの操作で予期せぬエラーが発生しました' };
  }

  // LINEへ返信
  const replyText = result.success ? "勤怠を登録しました" : result.msg;
  await lineClient.pushMessage(LINE_MY_USER_ID, [{ type: "text", text: replyText },]);

  return;
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