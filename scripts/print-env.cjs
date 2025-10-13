require('dotenv').config();
['BOT_TOKEN','BASE_URL','WEBHOOK_PATH','DATABASE_URL','PORT'].forEach(k=>{
  const v = process.env[k];
  console.log(k, '=', v ? (k==='BOT_TOKEN' ? v.slice(0,10)+'…' : v) : '(EMPTY)');
});
