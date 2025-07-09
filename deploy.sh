## deploy lanmbda function

echo "[deploy start]"
FUNCTION_NAME_1=linebot_AutoKintai
FUNCTION_NAME_2=linebot_AutoKintai_batch
SCRIPT_DIR=$(cd $(dirname $0); pwd)


echo "[build]"
cd ${SCRIPT_DIR}/lambda
mkdir -p ${SCRIPT_DIR}/.deploy
npm install
rm -f ${SCRIPT_DIR}/.deploy/lambda.zip
zip -rq ${SCRIPT_DIR}/.deploy/lambda.zip ./*


echo "[deploy]"
cd ${SCRIPT_DIR}/.deploy
result=`aws lambda update-function-code --function-name ${FUNCTION_NAME_1} --zip-file fileb://lambda.zip`
echo "deploy1 ${result}"

result=`aws lambda update-function-code --function-name ${FUNCTION_NAME_2} --zip-file fileb://lambda.zip`
echo "deploy2 ${result}"

echo "[deploy finish]"


echo "[archive module]"

mkdir -p ${SCRIPT_DIR}/module
rm -f ${SCRIPT_DIR}/module/*.zip

timestamp=$(date +%Y%m%d%H%M%S)
cp ${SCRIPT_DIR}/.deploy/lambda.zip ${SCRIPT_DIR}/module/lambda_${timestamp}.zip

echo "[archive complete] lambda_${timestamp}.zip"
