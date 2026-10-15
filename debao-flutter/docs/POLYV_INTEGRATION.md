# 保利威直播接入

## 已接入的边界

后端直播场次现在支持 `provider=polyv`、保利威数字频道 ID 和回放视频 ID。学生进入直播前必须登录并拥有对应课程权益，服务端再返回本场频道信息。管理员可在直播排期中选择保利威频道，编辑场次并绑定回放。

Flutter 工程已声明保利威官方 `polyv_live_scenes` 0.0.3 插件。该插件打开保利威原生观看课堂，支持云课堂页面内已有的课件、聊天和互动能力。插件要求 Flutter 3.41+、Android API 24+、iOS 13+；Android 还需要保利威私有 Maven 仓库凭据。

课程详情中的直播课件已经接入排期接口：学生打开课程章节时读取该课程的直播场次，点击“进入直播间”前先调用得宝服务端的课程权限校验，再打开保利威原生观看页。未购买课程的账号不会拿到观看入口。

## 供应商开通后配置

在本机用户级 `~/.gradle/gradle.properties` 写入销售提供的凭据，不要提交到 Git：

```properties
android.useAndroidX=true
android.enableJetifier=true
polyvMavenUsername=...
polyvMavenPassword=...
```

服务端生产环境配置：

```text
POLYV_AUTH_SECRET=频道观看条件设置中的SecretKey
POLYV_AUTH_CALLBACK_URL=https://api.example.com/v1/live/polyv/authorize
```

`POLYV_AUTH_SECRET` 只允许存在服务端。保利威的观看授权签名涉及 `appSecret`，官方也建议在服务端生成授权令牌，客户端只接收短时授权信息。得宝的课程权益校验先于保利威授权，避免拿到频道号后绕过课程购买限制。

## 管理员录入

直播排期中：选择课程和直播课件，平台选择“保利威”，填写数字频道 ID；直播结束后再填回放视频 ID。一个保利威频道只能绑定一个得宝场次，避免不同章节串播。

## 尚需供应商确认

当前 pub.dev 插件的 `loginLiveRoom` 只接受 `appId/appSecret`，没有短期 token 参数。正式发布前需要保利威提供支持服务端签发短期凭证的原生接口，或确认该插件的生产鉴权方案。未确认前不要把长期 `appSecret` 编译进 App。

本地联调使用编译参数注入，不把密钥提交到仓库：

```powershell
flutter run `
  --dart-define=DEBAO_API_BASE_URL=https://debao-api.denlaw.cn `
  --dart-define=POLYV_APP_ID=<Polyv AppID> `
  --dart-define=POLYV_USER_ID=<Polyv UserID> `
  --dart-define=POLYV_APP_SECRET=<Polyv AppSecret>
```

当前插件的原生 SDK 仍会在 App 进程内接收 `appSecret`，因此这套方式适合联调和内测；正式发布前应让保利威确认短期凭证或官方安全接入方案。Android 首次打包还必须在用户级 `~/.gradle/gradle.properties` 配置 `polyvMavenUsername` 和 `polyvMavenPassword`。
