import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,existsSync,copyFileSync} from 'node:fs';
const channelId='8396848', base='https://debao-api.denlaw.cn';
const secret=process.env.POLYV_APP_SECRET;
async function api(path,extra={},json) {
  const p={appId:process.env.POLYV_APP_ID,channelId,timestamp:String(Date.now()),...extra};
  p.sign=createHash('md5').update(secret+Object.keys(p).sort().map(k=>k+p[k]).join('')+secret).digest('hex').toUpperCase();
  const query=new URLSearchParams(p);
  const mutation=path.includes('update');
  const response=await fetch('https://api.polyv.net'+path+(!mutation||json?'?'+query:''),{method:mutation?'POST':'GET',...(mutation?{headers:{'Content-Type':json?'application/json':'application/x-www-form-urlencoded'},body:json?JSON.stringify(json):query}:{}),signal:AbortSignal.timeout(15000)});
  const r=await response.json();
  if(r.code!==200) throw new Error(path+' failed: '+r.code+' '+r.message);
  return r.data;
}
const auth=await api('/live/v3/channel/auth/get');
const callbacks=await api('/live/v3/channel/callback/get-setting');
const backup='/etc/debao/polyv-8396848-before-integration.json';
if(!existsSync(backup))writeFileSync(backup,JSON.stringify({auth,callbacks}),{mode:0o600});
console.log('Current callback inheritance: '+callbacks.globalSettingEnabled);
if(process.argv.includes('--apply')) {
  const customKey=auth.find(x=>x.rank===1)?.customKey;
  if(!customKey)throw new Error('Missing channel authorization key');
  const envPath='/etc/debao/api.env';
  if(!existsSync(envPath+'.before-polyv'))copyFileSync(envPath,envPath+'.before-polyv');
  let env=readFileSync(envPath,'utf8').replace(/^POLYV_AUTH_SECRET=.*\r?\n?/mg,'').replace(/^POLYV_AUTH_CALLBACK_URL=.*\r?\n?/mg,'');
  env+='\nPOLYV_AUTH_SECRET='+customKey+'\nPOLYV_AUTH_CALLBACK_URL='+base+'/v1/live/polyv/authorize\n';
  writeFileSync(envPath,env,{mode:0o600});
  await api('/live/v3/channel/callback/update-setting',{streamCallbackUrl:base+'/v1/webhooks/polyv/live',playbackCallbackUrl:base+'/v1/webhooks/polyv/playback'});
  // New-scene channels apply per-channel settings directly and reject this
  // legacy inheritance switch. Other errors must still stop configuration.
  const disableLegacyGlobal=async(type)=>{try {await api('/live/v3/channel/common/update-global-enabled',{globalEnabledType:type,enabled:'N'});} catch(e){if(!e.message.includes('new scene forbidden setting'))throw e;}};
  await disableLegacyGlobal('callback');
  await api('/live/v3/channel/auth/update',{}, {authSettings:[{rank:1,enabled:'Y',authType:'custom',customKey,customUri:base+'/v1/live/polyv/authorize'},{rank:2,enabled:'N'}]});
  await disableLegacyGlobal('auth');
}
const a=await api('/live/v3/channel/auth/get'), c=await api('/live/v3/channel/callback/get-setting');
console.log(JSON.stringify({channelId,auth:a.map(x=>({rank:x.rank,enabled:x.enabled,type:x.authType,url:x.customUri})),callbacks:{stream:c.streamCallbackUrl,playback:c.playbackCallbackUrl,global:c.globalSettingEnabled}}));
