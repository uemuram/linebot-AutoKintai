import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { GetCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({ region: 'ap-northeast-1' });
const TABLE_NAME = "linebot_AutoKintai_state";

export async function putItemToDB(key, data) {
  console.log(`DB登録実行 : ${key} / ${JSON.stringify(data)}`);
  const command = new PutCommand({
    TableName: TABLE_NAME,
    Item: { userId: key, data: data, },
  });

  try {
    await client.send(command);
    console.log(`DB登録成功`);
  } catch (err) {
    console.error('DB登録エラー:', err);
    throw err;
  }
}

export async function deleteItemFromDB(key) {
  console.log(`DB削除実行 : ${key}`);
  const command = new DeleteCommand({
    TableName: TABLE_NAME,
    Key: { userId: key, },
  });

  try {
    await client.send(command);
    console.log(`DB削除成功`);
  } catch (err) {
    console.error('DB削除エラー:', err);
    throw err;
  }
}

export async function getItemFromDB(key) {
  console.log(`DB取得実行 : ${key}`);
  const command = new GetCommand({
    TableName: TABLE_NAME,
    Key: { userId: key },
  });

  try {
    const result = await client.send(command);
    const data = result.Item ? result.Item.data : null;
    console.log(`DB取得結果 : ${JSON.stringify(data)}`);
    return data;
  } catch (err) {
    console.error('DB取得エラー:', err);
    throw err;
  }
}


