// import { Client } from "@line/bot-sdk";
import { messagingApi } from "@line/bot-sdk";

const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;

// const lineClient = new Client({
//   channelAccessToken: LINE_CHANNEL_ACCESS_TOKEN,
//   channelSecret: LINE_CHANNEL_SECRET,
// });

const lineClient = new messagingApi.MessagingApiClient({
  channelAccessToken: LINE_CHANNEL_ACCESS_TOKEN,
});

export async function replyMessage(replyToken, msg) {
  console.log(`リプライ : ${msg}`);
  await lineClient.replyMessage({
    replyToken: replyToken,
    messages: [{ type: "text", text: msg }]
  });
}

export async function pushMessage(userId, msg) {
  console.log(`プッシュ : ${msg}`);
  await lineClient.pushMessage({
    to: userId,
    messages: [{ type: "text", text: msg }]
  });
}

export async function showLoadingAnimation(userId) {
  console.log(`ローディングアニメーション表示`);
  await lineClient.showLoadingAnimation({
    chatId: userId,
    loadingSeconds: 30
  });
}
