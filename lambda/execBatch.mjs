import { validateSignature } from "@line/bot-sdk";
import { askGemini } from './geminiUtil.mjs';
import { registKintai } from './chronusUtil.mjs';

const LINE_MY_USER_ID = process.env.LINE_MY_USER_ID;

// TODO Qiitaには、自分用のbotを作る、というスタンスにする
// TODO dialogflowで何かできる? https://ledge.ai/articles/dialogflow-try-3

export async function execBatch(lineClient) {

  // // LINEへ返信
  // const replyText = result.success ? "勤怠を登録しました" : `勤怠登録でエラーが発生しました。エラーメッセージ:${result.msg}`;
  const pushText = "プッシュ通知テスト"
  // await lineClient.pushMessage(LINE_MY_USER_ID, [{ type: "text", text: pushText },]);

  return;
}

