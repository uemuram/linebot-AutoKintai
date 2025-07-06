import { Client } from "@line/bot-sdk";

const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;

const lineClient = new Client({
  channelAccessToken: LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: LINE_CHANNEL_SECRET,
});

export async function replyMessage(replyToken, msg) {
  console.log(`リプライ : ${msg}`);
  await lineClient.replyMessage(replyToken, [{ type: "text", text: msg },]);
}

export async function pushMessage(userId, msg) {
  console.log(`プッシュ : ${msg}`);
  await lineClient.pushMessage(userId, [{ type: "text", text: msg },]);
}

