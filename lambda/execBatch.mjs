import { getDakoku } from './chronusUtil.mjs';
import { putItemToDB, deleteItemFromDB, getItemFromDB } from './dynamoDbUtil.mjs';

const LINE_MY_USER_ID = process.env.LINE_MY_USER_ID;

export async function execBatch(lineClient) {

  // 昨日の日付を取得
  // TODO 元に戻す
  // const targetDate = getYesterdayDate();
  const targetDate = { year: '2025', month: '7', day: '3', };
  console.log(`対象日付 : ${targetDate.year}/${targetDate.month}/${targetDate.day}`);

  // クロノスから打刻を取得する
  let timeStamps;
  try {
    timeStamps = await getDakoku(targetDate.year, targetDate.month, targetDate.day);
    console.log(`打刻 : ${timeStamps.start}-${timeStamps.end}`);
  } catch (err) {
    console.log(err.message);
    console.log(err.stack);
    return;
  }

  // どちらか一方でも取得できない場合は何もせず終了
  if (!timeStamps.start || !timeStamps.end) {
    console.log('打刻情報が取得できないため終了');
    return;
  }

  // 15分単位で切り上げる / 丸める
  const roundTimeStamps = {
    start: roundUpTo15Min(timeStamps.start),
    end: roundDownTo15Min(timeStamps.end),
  };
  console.log(`打刻(補正後) : ${roundTimeStamps.start}-${roundTimeStamps.end}`);

  // 同じ(労働時間=0)なら終了
  if (roundTimeStamps.start == roundTimeStamps.end) {
    console.log('開始時刻と終了時刻が同じなので終了');
    return;
  }

  // 時刻をdynamoに登録
  await putItemToDB(LINE_MY_USER_ID, {
    date: `${targetDate.year}${targetDate.month.padStart(2, '0')}${targetDate.day.padStart(2, '0')}`,
    startTime: roundTimeStamps.start,
    endTime: roundTimeStamps.end
  });

  // LINEへ通知
  const pushText = `昨日(${targetDate.year}/${targetDate.month}/${targetDate.day})の打刻は\n`
    + `${timeStamps.start}～${timeStamps.end}でした\n\n`
    + `${roundTimeStamps.start}～${roundTimeStamps.end}で勤怠を登録しますか?`;
  console.log(`通知テキスト : ${pushText}`);
  // TODO 元に戻す
  // await lineClient.pushMessage(LINE_MY_USER_ID, [{ type: "text", text: pushText },]);

  return;
}

// 昨日の日時を取得 例:{ year: '2025', month: '7', day: '4' }
function getYesterdayDate() {
  const now = new Date();

  // 日本時間に変換して1日前に
  const jstYesterday = new Date(now.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }));
  jstYesterday.setDate(jstYesterday.getDate() - 1);

  // 年月日を取り出す
  const date = {
    year: jstYesterday.getFullYear().toString(),
    month: (jstYesterday.getMonth() + 1).toString(), // 月は0ベースなので+1
    day: jstYesterday.getDate().toString()
  };
  return date;
}

// 時刻を15分単位で丸める
function roundDownTo15Min(hhmm) {
  if (!/^\d{4}$/.test(hhmm)) return ''; // フォーマットが不正なら空文字を返す

  const hour = parseInt(hhmm.slice(0, 2), 10);
  const min = parseInt(hhmm.slice(2, 4), 10);

  const roundedMin = Math.floor(min / 15) * 15;
  const roundedMinStr = roundedMin.toString().padStart(2, '0');
  const hourStr = hour.toString().padStart(2, '0');

  return `${hourStr}${roundedMinStr}`;
}

// 時刻を15分単位で切り上げる
function roundUpTo15Min(hhmm) {
  if (!/^\d{4}$/.test(hhmm)) return ''; // フォーマットが不正なら空文字を返す

  let hour = parseInt(hhmm.slice(0, 2), 10);
  let min = parseInt(hhmm.slice(2, 4), 10);

  // 切り上げ処理
  let roundedMin = Math.ceil(min / 15) * 15;

  if (roundedMin === 60) {
    hour += 1;
    roundedMin = 0;
  }

  const hourStr = hour.toString().padStart(2, '0');
  const roundedMinStr = roundedMin.toString().padStart(2, '0');

  return `${hourStr}${roundedMinStr}`;
}