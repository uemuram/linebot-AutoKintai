import { Client } from "@line/bot-sdk";
import { execOnline } from './execOnline.mjs';
import { execBatch } from './execBatch.mjs';

const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const MODE = process.env.MODE;

// TODO Qiitaには、自分用のbotを作る、というスタンスにする
// TODO dialogflowで何かできる? https://ledge.ai/articles/dialogflow-try-3

export const handler = async (req) => {

  const lineClient = new Client({
    channelAccessToken: LINE_CHANNEL_ACCESS_TOKEN,
    channelSecret: LINE_CHANNEL_SECRET,
  });

  if (MODE == "batch") {
    console.log("処理開始(バッチモード)");
    const result = await execBatch(lineClient);
    return;
  } else {
    console.log("処理開始(オンラインモード)");
    const result = await execOnline(req, lineClient);
    return { statusCode: 200 };
  }

};
