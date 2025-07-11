import { getDakoku, roundDownTo15Min, roundUpTo15Min } from './chronusUtil.mjs';
import { putItemToDB, deleteItemFromDB, getItemFromDB } from './dynamoDbUtil.mjs';
import { pushMessage } from './lineUtil.mjs';

const LINE_MY_USER_ID = process.env.LINE_MY_USER_ID;

// TODO 毎日実行にして、打刻が取れなければ何もしない、という方式にする
export async function execBatch() {

  // 昨日の日付を取得
  const targetDate = getYesterdayDate();
  //const targetDate = { year: '2025', month: '7', day: '4', };
  console.log(`対象日付 : ${targetDate.year}/${targetDate.month}/${targetDate.day}`);

  // クロノスから打刻を取得する
  let result;
  try {
    result = await getDakoku(targetDate.year, targetDate.month, targetDate.day);
  } catch (err) {
    console.log(err.message);
    console.log(err.stack);
    return;
  }

  // エラーであれば終了
  if (!result.success) {
    console.log('クロノスの操作でエラーが発生したため終了');
    return;
  }

  // どちらか一方でも取得できない場合は何もせず終了
  const timeStamps = result.timeStamps;
  console.log(`打刻 : ${timeStamps.start}-${timeStamps.end}`);
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

  // 同じ(勤務時間=0)なら終了
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
  await pushMessage(LINE_MY_USER_ID, pushText);

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

