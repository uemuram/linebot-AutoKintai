## deploy lanmbda function

echo "[deploy start]"
FUNCTION_NAME=linebot_AutoKintai
SCRIPT_DIR=$(cd $(dirname $0); pwd)


echo "[build]"
cd ${SCRIPT_DIR}/lambda
npm install
rm ${SCRIPT_DIR}/.deploy/lambda.zip
zip -rq ${SCRIPT_DIR}/.deploy/lambda.zip ./*


echo "[deploy]"
mkdir -p ${SCRIPT_DIR}/.deploy
cd ${SCRIPT_DIR}/.deploy
result=`aws lambda update-function-code --function-name ${FUNCTION_NAME} --zip-file fileb://lambda.zip`
echo "deploy ${result}"


echo "[deploy finish]"
