import { Client, validateSignature } from "@line/bot-sdk";
import { askGemini } from './geminiUtil.mjs';
import { registKintai } from './chronusUtil.mjs';
import { testYahooAccess } from './chronusUtil.mjs';

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
    if (!replyToken || typeof replyToken === 'undefined') {
        return;
    }

    // LINEへ返信
    await lineClient.replyMessage(replyToken, [
        { type: "text", text: 'お待ちください…' },
    ]);

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

    // const replyText = await askGemini(prompt);
    // console.log(replyText);
    // const replyText = "OKです";

    // TODO Geminiの応答を整備(開始日などで補完)
    // TODO 日付けの整合性が撮れていない場合はエラー応答を返す
    // TODO 当月以外の場合はエラー応答を返す
    // TODO 日付けはGeminiから取得する
    const year = '2025';
    const month = '6';
    const day = '24';

    // クロノスに勤怠を登録する
    let result;
    try {
        result = await registKintai(year, month, day);
        console.log(result);
    } catch (e) {
        console.log(e.message);
        console.log(e.stack);
        result = { success: false, msg: '予期せぬエラーが発生しました' };
    }

    // LINEへ返信
    const replyText = result.success ? "勤怠を登録しました" : `勤怠登録でエラーが発生しました。エラーメッセージ:${result.msg}`;

    const userId = body.events[0].source.userId;
    await lineClient.pushMessage(userId, [
        { type: "text", text: replyText },
    ]);

    return { statusCode: 200 };
};

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