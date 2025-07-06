import { messagingApi } from "@line/bot-sdk";

const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const LINE_SKIP_PUSH = process.env.LINE_SKIP_PUSH || 0;

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
  if (LINE_SKIP_PUSH == '1') {
    console.log(`節約のためプッシュをスキップ`);
    return;
  }
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
