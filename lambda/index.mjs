import { Client, validateSignature } from "@line/bot-sdk";

const channelSecret = process.env.LINE_CHANNEL_SECRET;
const lineClient = new Client({
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    channelSecret: channelSecret,
});

export const handler = async (req) => {
    // 署名の検証（LINEからの接続であるか）
    const signature = req.headers["x-line-signature"];
    const bool = validateSignature(req.body, channelSecret, signature);
    if (!bool) throw new Error("invalid signature");

    // LINEからの受け渡し情報の取得
    const body = JSON.parse(req.body);
    console.log(body);
    if (!body.events || body.events.length === 0) {
        return;
    }
    const replyToken = body.events[0].replyToken;
    if ( !replyToken || typeof replyToken === 'undefined' ) {
      return;
    }

    // 返信用メッセージを組み立て
    const messageTExt = body.events[0].message.text;
    const replyText = messageTExt;

    // LINEへ返信
    await lineClient.replyMessage(replyToken, [
        { type: "text", text: replyText },
    ]);
    return { statusCode: 200 };
};
