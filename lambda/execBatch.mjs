import { validateSignature } from "@line/bot-sdk";
import { askGemini } from './geminiUtil.mjs';
import { getDakoku } from './chronusUtil.mjs';

const LINE_MY_USER_ID = process.env.LINE_MY_USER_ID;

export async function execBatch(lineClient) {

  // TODO 日付けを計算
  const input = { year: '2025', month: '7', day: '4', };

  // クロノスから打刻を取得する
  let timeStamps;
  try {
    timeStamps = await getDakoku(input.year, input.month, input.day);
    console.log(`打刻 : ${timeStamps.start}-${timeStamps.end}`);
  } catch (e) {
    console.log(e.message);
    console.log(e.stack);
    return;
  }

  // TODO 時刻を計算
  // TODO 時刻をdynamoに登録
  // TODO ユーザに通知

  // // LINEへ返信
  // const replyText = result.success ? "勤怠を登録しました" : `勤怠登録でエラーが発生しました。エラーメッセージ:${result.msg}`;
  const pushText = "プッシュ通知テスト"
  // await lineClient.pushMessage(LINE_MY_USER_ID, [{ type: "text", text: pushText },]);

  return;
}

