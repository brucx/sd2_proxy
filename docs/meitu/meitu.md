# Seedance 2.0 & 2.0 fast API 参数介绍

本文介绍 Seedance 2.0 & 2.0 fast 模型相较于存量模型 **新增****/****配置有区别** 的 API 参数介绍，存量 API 参数的完整介绍参见 视频生成 API。

## 模型能力

Seedance 2.0 和 Seedance 2.0 fast 提供的模型能力一致，追求最高生成品质，推荐使用 **Seedance 2.0**；更注重成本与生成速度，不要求极限品质，推荐使用 **Seedance 2.0 fast**。

### Seedance 2.0 & 2.0 fast (有声视频/无声视频)

·       **多模态参考生视频：**输入参考图片（0~9）+参考视频（0~3）+ 参考音频（0~3）+ 文本提示词（可选）生成 1 个目标视频。支持生成全新视频、编辑视频、延长视频。  
_注意：不可单独输入音频，应至少包含_ _1_ _个参考视频或图片。_

·       **图生视频****-****首尾帧：**输入首帧图片+尾帧图片+文本提示词（可选）生成 1 个目标视频。

·       **图生视频****-****首帧：**输入首帧图片+文本提示词（可选）生成 1 个目标视频。

·       **文生视频：**输入文本提示词生成 1 个目标视频。

---

## Create - 创建视频生成任务

`POST` `[http://118.196.64.1/api/v1/doubao/create](http://ai.zhuque.me/api/v1/doubao/create)`

`请求方式` `POST`

`Content-Type application/json`

`模型``ID``：`

seedance-2.0-fast的模型ID:

### ep-20260307130821-xw5wf

seedance-2.0的模型ID:

### ep-20260307130721-bx7tv

### 请求参数

#### content object[] 必选

输入给模型，生成视频的信息，支持文本、图片、音频、视频、样片任务 ID。支持以下几种组合：

·       文本

·       文本（可选）+ 图片

·       文本（可选）+ 视频

·       文本（可选）+ 图片 + 音频

·       文本（可选）+ 图片 + 视频

·       文本（可选）+ 视频 + 音频

·       文本（可选）+ 图片 + 视频 + 音频

#### 文本信息 object

输入给模型的提示词信息。

|**参数**|**类型**|**必选**|**说明**|
|---|---|---|---|
|**content.type**|_string_|**必选**|输入内容的类型，此处应为 `text`|
|**content.text**|_string_|**必选**|输入给模型的文本提示词，描述期望生成的视频。支持中英文。建议中文不超过500字，英文不超过1000词。字数过多信息容易分散，模型可能因此忽略细节，只关注重点，造成视频缺失部分元素。提示词的更多使用技巧请参见 [Seedance 提示词指南](https://www.volcengine.com/docs/82379/1587797)。|

#### 图片信息 object

输入给模型的图片信息。

|**参数**|**类型**|**必选**|**说明**|
|---|---|---|---|
|**content.type**|_string_|**必选**|输入内容的类型，此处应为 `image_url`|
|**content.image_url**|_object_|**必选**|输入给模型的图片对象|
|**content.image_url.url**|_string_|**必选**|图片 URL、图片 Base64 编码、素材 ID：  <br>• 图片 URL：填入图片的公网 URL• Base64 编码：将本地文件转换为 Base64 编码字符串，然后提交给大模型。遵循格式：data:image/<图片格式>;base64,<Base64编码>，注意 <图片格式> 需小写，如 data:image/png;base64,{base64_image}。<br><br>  <br>• 素材 ID：用于视频生成的预置素材及虚拟人像的 ID，遵循格式：asset://<ASSET_ID> ，如：asset://asset-20260224190652-6g4vg，可从提交审核返回的素材获取ASSET_ID。|
|**content.role**|_string_|条件必填|图片的位置或用途|

**传入单张图片要求：**

·       格式：jpeg、png、webp、bmp、tiff、gif

·       宽高比（宽/高）：(0.4, 2.5)

·       宽高长度（px）：(300, 6000)

·       大小：单张图片小于 30 MB，请求体大小不超过 64 MB，大文件请勿使用 Base64 编码

·       图片数量：

o   图生视频-首帧：1 张

o   图生视频-首尾帧：2 张

o   Seedance 2.0 & 2.0 fast 多模态参考生视频：1~9 张

#### content.role string 条件必填

#### 图片的位置或用途。

o    

**注意：**图生视频-首帧、图生视频-首尾帧、多模态参考生视频（包括参考图、视频、音频）为 3 种互斥场景，不可混用。  
多模态参考生视频可通过提示词指定参考图片作为首帧/尾帧，间接实现"首尾帧+多模态参考"效果。若需严格保障首尾帧和指定图片一致，优先使用图生视频-首尾帧（配置 role 为 first_frame / last_frame）。

#### 图片 role 取值说明

|**场景**|**图片数量**|**role****取值**|
|---|---|---|
|**图生视频****-****首帧**|**1** **个** **image_url** **对象**|**first_frame** **或不填**|
|**图生视频****-****首尾帧**|**2** **个** **image_url** **对象**|**首帧：****first_frame****（必填）****尾帧：****last_frame****（必填）**|
|**图生视频****-****参考图**|**1~9** **个** **image_url** **对象**|**每张参考图：****reference_image****（必填）**|

#### 视频信息 object

输入给模型的视频信息。**仅** **Seedance 2.0 & 2.0 fast** **支持输入视频。**

|**参数**|**类型**|**必选**|**说明**|
|---|---|---|---|
|**content.type**|_string_|**必选**|输入内容的类型，此处应为 `video_url`|
|**content.video_url**|_object_|**必选**|输入给模型的视频对象|
|**content.video_url.url**|_string_|**必选**|视频 URL、素材 ID：  <br>• 视频 URL：填入视频的公网 URL• 素材 ID：格式 `asset://<ASSET_ID>`<br><br>可从[素材&虚拟人像库](https://console.volcengine.com/ark-stg/region:ark-stg+cn-beijing/experience/vision?modelId=doubao-seedance-2-0-260128)获取。|
|**content.role**|_string_|条件必填|视频的位置或用途，当前仅支持 `reference_video`|

**传入单个视频要求：**

·       视频格式：mp4、mov

·       分辨率：480p、720p

·       时长：单个视频时长 [2, 15] s，最多传入 3 个参考视频，所有视频总时长不超过 15s

·       宽高比（宽/高）：[0.4, 2.5]

·       宽高长度（px）：[300, 6000]

·       画面像素（宽 × 高）：[409600, 927408]，示例：

·       画面尺寸 640×640=409600 满足最小值 ；

·       画面尺寸 834×1112=927408 满足最大值。

·       大小：单个视频不超过 50 MB

·       帧率 (FPS)：[24, 60]

#### 音频信息 object

输入给模型的音频信息。**仅** **Seedance 2.0 & 2.0 fast** **支持输入音频。**

**注意：**不可单独输入音频，应至少包含 1 个参考视频或图片。

|**参数**|**类型**|**必选**|**说明**|
|---|---|---|---|
|**content.type**|_string_|**必选**|输入内容的类型，此处应为 `audio_url`|
|**content.audio_url**|_object_|**必选**|输入给模型的音频对象|
|**content.audio_url.url**|_string_|**必选**|音频 URL、音频 Base64 编码、素材 ID：  <br>• 音频 URL：填入音频的公网 URL• Base64 编码：将本地文件转换为 Base64 编码字符串，然后提交给大模型。遵循格式：data:audio/<音频格式>;base64,<Base64编码>，注意 <音频格式> 需小写，如 data:audio/wav;base64,{base64_audio}。  <br>• 素材 ID：用于视频生成的虚拟人的音频素材 ID，遵循格式：asset://<ASSET_ID>。可从[素材&虚拟人像库](https://console.volcengine.com/ark-stg/region:ark-stg+cn-beijing/experience/vision?modelId=doubao-seedance-2-0-260128)获取。|
|**content.role**|_string_|条件必填|音频的位置或用途，当前仅支持 `reference_audio`|

**传入单个音频要求：**

·       格式：wav、mp3

·       时长：单个音频时长 [2, 15] s，最多传入 3 段参考音频，所有音频总时长不超过 15 s

·       大小：单个音频不超过 15 MB，请求体大小不超过 64 MB，大文件请勿使用 Base64 编码

### 其他请求参数

|**参数**|**类型**|**默认值**|**说明**|
|---|---|---|---|
|**service_tier**|_string_|-|Seedance 2.0 & 2.0 fast 暂不支持|
|**generate_audio**|_boolean_|Seedance 2.0 & 2.0 fast 默认值：true|控制生成的视频是否包含与画面同步的声音：  <br>• `true`：模型输出的视频包含同步音频。模型会基于文本提示词与视觉内容，自动生成与之匹配的人声、音效及背景音乐。建议将对话部分置于双引号内。以优化音频生成效果。例如：男人叫住女人说：“你记住，以后不可以用手指指月亮。”  <br>• `false`：模型输出的视频为无声视频。  <br>_说明：生成的有声视频均为单声道，和传入的音频声道数无关。_|
|**draft**|_boolean_|-|Seedance 2.0 & 2.0 fast 暂不支持|
|**tools**|_object[]_|-|仅 Seedance 2.0 & 2.0 fast 支持。配置模型要调用的工具。  <br>`tools.type`：指定使用的工具类型，`web_search` 为联网搜索工具。  <br>_说明：开启联网搜索后，模型会根据用户的提示词自主判断是否搜索互联网内容（如商品、天气等）。可提升生成视频的时效性，但也会增加一定的时延。_<br><br>_实际搜索次数可通过_ _[查询视频生成任务 API](https://www.volcengine.com/docs/82379/1521309?lang=zh)_ _返回的_ _usage.tool_usage.web_search_ _字段获取，如果为_ _0_ _表示未搜索。_|
|**resolution**|_string_|Seedance 2.0 & 2.0 fast 默认值：720p|视频分辨率，取值范围：`480p`、`720p`、1`080p`|
|**ratio**|_string_|Seedance 2.0 & 2.0 fast 默认值：adaptive|生成视频的宽高比例：  <br>`16:9`、`4:3`、`1:1`、`3:4`、`9:16`、`21:9`、`adaptive`（根据输入自动选择最合适的宽高比）|
|**duration**|_integer_|Seedance 2.0 & 2.0 fast 默认值：5|生成视频时长，仅支持整数，单位：秒。取值范围：[4,15] 或设置为 -1• 指定具体时长：支持有效范围内的任一整数  <br>• 智能指定：设置为 -1，表示由模型在有效范围内自主选择合适的视频长度（整数秒）。实际生成视频的时长可通过 [查询视频生成任务 API](https://www.volcengine.com/docs/82379/1521309?lang=zh) 返回的 duration 字段获取。  <br>_注意：视频时长与计费相关，请谨慎设置。_|
|**frames**|_integer_|-|Seedance 2.0 & 2.0 fast 暂不支持|
|**camera_fixed**|_boolean_|-|Seedance 2.0 & 2.0 fast 暂不支持|

#### adaptive 适配规则

当配置 ratio 为 adaptive 时，模型会根据生成场景自动适配宽高比：实际生成的视频宽高比可通过 [查询视频生成任务 API](https://www.volcengine.com/docs/82379/1521309?lang=zh) 返回的 ratio 字段获取。

·       **文生视频：**根据输入的提示词，智能选择最合适的宽高比

·       **首帧** **/** **首尾帧生视频：**根据上传的首帧图片比例，自动选择最接近的宽高比

·       **多模态参考生视频：**根据用户提示词意图判断，如果是首帧生视频/编辑视频/延长视频，以该图片/视频为准选择最接近的宽高比；否则，以传入的第一个媒体文件为准（优先级：视频＞图片）选择最接近的宽高比

#### 不同宽高比对应的宽高像素值

**480p** **分辨率**

|**宽高比**|**宽高像素值**|
|---|---|
|16:9|864×496|
|4:3|752×560|
|1:1|640×640|
|3:4|560×752|
|9:16|496×864|
|21:9|992×432|

**720p** **分辨率**

|**宽高比**|**宽高像素值**|
|---|---|
|16:9|1280×720|
|4:3|1112×834|
|1:1|960×960|
|3:4|834×1112|
|9:16|720×1280|
|21:9|1470×630|

---

### 提交任务返回参数

#### 业务返回参数

|字段|类型|说明|
|---|---|---|
|id|string|任务ID，用于查询结果|

## Get - 查询视频生成任务/列表

**查询视频生成任务：**  
`POST [http://118.196.64.1/api/v1/doubao/get_result](http://ai.zhuque.me/api/v1/seedance/get_result)`

`认证方式`

`请求时需在` `Headers` `中添加以下参数：`

`headers = {    "Authorization": f"Bearer {token}",  # token``是密钥串`    `"Content-Type": "application/json"}`

`同一个任务``ID``该``接口查询间隔需不少于` `3` `秒，请控制调用频率`

`请求参数`

`请求参数汇总`

|`参数`|`类型`|`是否必选`|`说明`|
|---|---|---|---|
|`id`|`string`|`是`|`您需要查询的视频生成任务的` `ID`|

`参数说明`

`id string` `必选`

`您需要查询的视频生成任务的` `ID``。`

### 响应参数汇总

|   |   |   |
|---|---|---|
|**参数**|**类型**|**说明**|
|**id**|_string_|视频生成任务 ID|
|**model**|_string_|任务使用的模型名称和版本|
|**status**|_string_|任务状态|
|**error**|_object/null_|错误提示信息|
|**created_at**|_integer_|任务创建时间的 Unix 时间戳（秒）|
|**updated_at**|_integer_|任务当前状态更新时间的 Unix 时间戳（秒）|
|**content**|_object_|视频生成任务的输出内容|
|**seed**|_integer_|本次请求使用的种子整数值|
|**resolution**|_string_|生成视频的分辨率|
|**ratio**|_string_|生成视频的宽高比|
|**duration**|_integer/null_|生成视频的时长（秒）|
|**frames**|_integer/null_|生成视频的帧数|
|**framespersecond**|_integer_|生成视频的帧率|
|**fileformat**|_string/null_|生成视频的文件格式|
|**generate_audio**|_boolean_|生成的视频是否包含与画面同步的声音|
|**revised_prompt**|_string/null_|修订后的提示词|
|**draft**|_boolean_|生成的视频是否为 Draft 视频|
|**draft_task_id**|_string/null_|Draft 视频任务 ID|
|**subdivisionlevel**|_integer/null_|细分级别|
|**service_tier**|_string_|实际处理任务使用的服务等级|
|**execution_expires_after**|_integer_|任务超时阈值（秒）|
|**_request_id**|_string_|请求 ID|
|**usage**|_object_|本次请求的 token 用量|

### 参数说明

#### id string

视频生成任务 ID。

#### model string

任务使用的模型名称和版本，格式：模型名称-版本。

#### status string

任务状态，以及相关的信息：

·       `queued`：排队中

·       `running`：任务运行中

·       `cancelled`：取消任务，取消状态24h自动删除（只支持排队中状态的任务被取消）

·       `succeeded`：任务成功

·       `failed`：任务失败

·       `expired`：任务超时

#### error object/null

错误提示信息，任务成功返回 null，任务失败时返回错误数据。

|   |   |   |
|---|---|---|
|**参数**|**类型**|**说明**|
|**error.code**|_string_|错误码|
|**error.message**|_string_|错误提示信息|

#### created_at integer

任务创建时间的 Unix 时间戳（秒）。

#### updated_at integer

任务当前状态更新时间的 Unix 时间戳（秒）。

#### content object

视频生成任务的输出内容。

|   |   |   |
|---|---|---|
|**参数**|**类型**|**说明**|
|**content.video_url**|_string_|生成视频的 URL，格式为 mp4。为保障信息安全，生成的视频会在24小时后被清理，请及时转存。|
|**content.file_url**|_string/null_|生成文件的 URL。|
|**content.last_frame_url**|_string/null_|视频的尾帧图像 URL。有效期为 24小时，请及时转存。创建视频生成任务时设置 `"return_last_frame": true` 时，会返回该参数。|

#### seed integer

本次请求使用的种子整数值。

#### resolution string

生成视频的分辨率。

#### ratio string

生成视频的宽高比。

#### duration integer/null

生成视频的时长，单位：秒。

**TIP****：**duration 和 frames 参数只会返回一个。创建视频生成任务时未指定 frames，会返回 duration。

#### frames integer/null

生成视频的帧数。

**TIP****：**duration 和 frames 参数只会返回一个。创建视频生成任务时指定了 frames，会返回 frames。

#### framespersecond integer

生成视频的帧率。

#### fileformat string/null

生成视频的文件格式。

#### generate_audio boolean

生成的视频是否包含与画面同步的声音。

·       `true`：模型输出的视频包含同步音频

·       `false`：模型输出的视频为无声视频

#### revised_prompt string/null

修订后的提示词。

#### draft boolean

生成的视频是否为 Draft 视频。

·       `true`：表示当前输出为 Draft 视频

·       `false`：表示当前输出为正常视频

#### draft_task_id string/null

Draft 视频任务 ID。基于 Draft 视频生成正式视频时，会返回该参数。

#### subdivisionlevel integer/null

细分级别。

#### service_tier string

实际处理任务使用的服务等级。

#### execution_expires_after integer

任务超时阈值，单位：秒。

#### _request_id string

请求 ID。

#### usage object

本次请求的 token 用量。

|   |   |   |
|---|---|---|
|**参数**|**类型**|**说明**|
|**usage.completion_tokens**|_integer_|模型输出视频花费的 token 数量|

---

## 调用简介及示例

### 流程简介

任务接口是异步接口，视频生成任务流程：

1.     创建视频生成任务接口创建视频生成任务

2.     定时使用查询接口查询视频生成任务状态

o   任务 running，过段时间再查询任务状态

o   任务完成，返回视频链接，在24小时内下载生成的视频文件

## 调用简介及示例

### 流程简介

任务接口是异步接口，视频生成任务流程：

1.     创建视频生成任务接口创建视频生成任务

2.     定时使用查询接口查询视频生成任务状态

o   任务 running，过段时间再查询任务状态

o   任务完成，返回视频链接，在24小时内下载生成的视频文件

### 1. 创建视频生成任务

以下示例仅展示 Seedance 2.0 & 2.0 fast 新增能力，更多视频生成示例详见 创建视频生成任务 API。

#### 多模态参考

curl http://118.196.64.1/api/v1/doubao/create \

-H "Content-Type: application/json" \

-H "Authorization: Bearer $ARK_API_KEY" \

-d '{

  "model": "doubao-seedance-2-0-260128",

  "content": [

    {

      "type": "text",

      "text": "全程使用视频1的第一视角构图，全程使用音频1作为背景音乐。第一人称视角果茶宣传广告，seedance牌「苹苹安安」苹果果茶限定款；首帧为图片1，你的手摘下一颗带晨露的阿克苏红苹果，轻脆的苹果碰撞声；2-4 秒：快速切镜，你的手将苹果块投入雪克杯，加入冰块与茶底，用力摇晃，冰块碰撞声与摇晃声卡点轻快鼓点，背景音：「鲜切现摇」；4-6 秒：第一人称成品特写，分层果茶倒入透明杯，你的手轻挤奶盖在顶部铺展，在杯身贴上粉红包标，镜头拉近看奶盖与果茶的分层纹理；6-8 秒：第一人称手持举杯，你将图片2中的果茶举到镜头前（模拟递到观众面前的视角），杯身标签清晰可见，背景音「来一口鲜爽」，尾帧定格为图片2。背景声音统一为女生音色。"

    },

    {

      "type": "image_url",

      "image_url": {"url": "https://ark-project.tos-cn-beijing.volces.com/doc_image/r2v_tea_pic1.jpg"},

      "role": "reference_image"

    },

    {

      "type": "image_url",

      "image_url": {"url": "https://ark-project.tos-cn-beijing.volces.com/doc_image/r2v_tea_pic2.jpg"},

      "role": "reference_image"

    },

    {

      "type": "video_url",

      "video_url": {"url": "https://ark-project.tos-cn-beijing.volces.com/doc_video/r2v_tea_video1.mp4"},

      "role": "reference_video"

    },

    {

      "type": "audio_url",

      "audio_url": {"url": "https://ark-project.tos-cn-beijing.volces.com/doc_audio/r2v_tea_audio1.mp3"},

      "role": "reference_audio"

    }

  ],

  "generate_audio": true,

  "ratio": "16:9",

  "duration": 11,

  "watermark": false

}'

#### 编辑视频

curl http://118.196.64.1/api/v1/doubao/create \

-H "Content-Type: application/json" \

-H "Authorization: Bearer $ARK_API_KEY" \

-d '{

  "model": "doubao-seedance-2-0-260128",

  "content": [

    {

      "type": "text",

      "text": "将视频1礼盒中的香水替换成图片1中的面霜，运镜不变"

    },

    {

      "type": "image_url",

      "image_url": {"url": "https://ark-project.tos-cn-beijing.volces.com/doc_image/r2v_edit_pic1.jpg"},

      "role": "reference_image"

    },

    {

      "type": "video_url",

      "video_url": {"url": "https://ark-project.tos-cn-beijing.volces.com/doc_video/r2v_edit_video1.mp4"},

      "role": "reference_video"

    }

  ],

  "generate_audio": true,

  "ratio": "16:9",

  "duration": 5,

  "watermark": true

}'

#### 延长视频

curl http://118.196.64.1/api/v1/doubao/create \

-H "Content-Type: application/json" \

-H "Authorization: Bearer $ARK_API_KEY" \

-d '{

  "model": "doubao-seedance-2-0-260128",

  "content": [

    {

      "type": "text",

      "text": "视频1中的拱形窗户打开，进入美术馆室内，接视频2，之后镜头进入画内，接视频3"

    },

    {

      "type": "video_url",

      "video_url": {"url": "https://ark-project.tos-cn-beijing.volces.com/doc_video/r2v_extend_video1.mp4"},

      "role": "reference_video"

    },

    {

      "type": "video_url",

      "video_url": {"url": "https://ark-project.tos-cn-beijing.volces.com/doc_video/r2v_extend_video2.mp4"},

      "role": "reference_video"

    },

    {

      "type": "video_url",

      "video_url": {"url": "https://ark-project.tos-cn-beijing.volces.com/doc_video/r2v_extend_video3.mp4"},

      "role": "reference_video"

    }

  ],

  "generate_audio": true,

  "ratio": "16:9",

  "duration": 8,

  "watermark": true

}'

#### 使用联网搜索（仅支持文本生视频）

curl -X POST http://118.196.64.1/api/v1/doubao/create \

-H "Content-Type: application/json" \

-H "Authorization: Bearer $ARK_API_KEY" \

-d '{

  "model": "doubao-seedance-2-0-260128",

  "content": [

    {

      "type": "text",

      "text": "微距镜头对准叶片上翠绿的玻璃蛙。焦点逐渐从它光滑的皮肤，转移到它完全透明的腹部，一颗鲜红的心脏正在有力地、规律地收缩扩张。"

    }

  ],

  "generate_audio": true,

  "ratio": "16:9",

  "duration": 11,

  "watermark": true,

  "tools": [{"type": "web_search"}]

}'

### 2. 查询视频生成任务

// 请将 id 替换为创建视频生成任务时获得的任务ID

curl -X POST [http://118.196.64.1/api/v1/doubao/get_result](http://ai.zhuque.me/api/v1/seedance/get_result)

-H "Content-Type: application/json" \

-H "Authorization: Bearer $ARK_API_KEY"\

-d "{"id": $id}"

---

## 最佳实践 - 使用虚拟人像生成视频

平台提供虚拟人像素材库，目前您可以使用其中的图像素材来创建一个统一、完备的视频主角。帮助您更好地控制主角，并确保其形象在多段视频中保持一致，避免因为真人人脸限制导致角色无法统一的问题。

素材模态目前包含图片，并提供人物背景描述。每个素材对应一个独立素材 ID (asset ID)，在体验中心的视频生成任务中，指定角色人脸生成视频。

### 使用步骤

1.     在浏览器中打开体验中心，点击输入框下方的 **虚拟人像库** 页签。

2.     检索需要使用的人像，支持使用自然语言检索及筛选框组合筛选。

#### 示例输入

**文本输入：**  
图片1中美妆博主用中文进行介绍，妆容改为明艳大气，去掉脸部反光，笑容甜美，近景镜头，手持图片2的面霜面向镜头展示，清新简约背景，元气甜美风格。博主台词：挖到本命面霜了！质地像云朵一样软糯，一抹就吸收，熬夜急救、补水保湿全搞定，素颜都自带柔光感。  
  
**虚拟人像：**[图片]  
**产品图像：****[****图片****]**

**输出：****[****视频****]**

## CreateAsset - 创建真人素材

`POST` [http://118.196.64.1/api/v1/open/CreateAsset](http://118.196.64.1/api/v1/open/CreateAsset)

`请求方式` `POST`

`Content-Type application/json`

### 请求参数

URL string 必填​传入的Asset（素材资产）的公共可访问地址。​       

Name string ​Asset（素材资产）的名称，上限为64个字符，该字段仅用于使用 ListAssets 接口时模糊搜索素材。​

AssetType string 必填​Asset（素材资产）的类型，支持传入图像、音频、视频。

可选值：​   

•  Image：Asset（素材资产）的类型为图像。​   

•  Video：Asset（素材资产）的类型为视频。​   

•  Audio：Asset（素材资产）的类型为音频。​    ​

传入图像、音频、视频素材时，仅支持上传 URL ，不支持 base64。​   

传入单个图像要求​   

•  格式：jpeg、png、webp、bmp、tiff、gif、heic/heif​   

•  宽高比（宽/高）： (0.4, 2.5) ​  

•  宽高长度（px）：(300, 6000)​   

•  大小：单张图片小于 30 MB​   

传入单个视频要求:   

•  格式：mp4、mov​   

•  分辨率：480p、720p​  

•  时长：单个视频时长 [2, 15] s​   

•  尺寸：​  

•  宽高比（宽/高）：[0.4, 2.5]​   

•  宽高长度（px）：[300, 6000]​   

•  总像素数：[640×640=409600, 834×1112=927408]，即宽和高的乘积符合 [409600, 927408] 的区间要求。​    

•  大小：单个视频不超过 50 MB​   

•  帧率 (FPS)：[24, 60] ​   

传入单个音频要求​   

•  格式：wav、mp3​   

•  时长：单个音频时长 [2, 15] s​   

•  大小：单个音频不超过 15 MB​      ​      

### 返回参数

Id string ​      Asset（素材资产）的 Id。

## GetAsset - 查询真人素材

`POST` [http://118.196.64.1/api/v1/open/GetAsset](http://118.196.64.1/api/v1/open/GetAsset)

`[请求方式 POST](http://118.196.64.1/api/v1/open/GetAsset)`

`[Content-Type application/json](http://118.196.64.1/api/v1/open/GetAsset)`

### 请求参数

Id string 必填 Asset（素材资产）的 Id。

返回参数

Id string Asset（素材资产）的 Id。

Name string       Asset（素材资产）的名称，上限为64个字符。

URL string          Asset（素材资产）的访问地址。有效期为12小时，请及时保存。

AssetType string Asset（素材资产）的类型，支持传入图像、音频、视频。支持类型：

Image：Asset（素材资产）的类型为图像。

Video：Asset（素材资产）的类型为视频。

Audio：Asset（素材资产）的类型为音频。

GroupId string                Asset（素材资产）所属的 Asset Group（素材资产组合）的 Id。

Status string                  任务状态。

Active：素材资产（Asset）已处理完毕，可以使用。

Processing：素材资产（Asset）正在预处理，无法使用。

Failed：素材资产（Asset）处理失败。

Error object错误信息。

Error.Code string错误码。

Error.Message string错误信息。

CreateTime string创建时间。

UpdateTime string更新时间。

ProjectName string 资源所属的项目名称。

## ListAssets - 查询已上传的素材

`POST [http://118.196.64.1/api/v1/open/ListAssets](http://118.196.64.1/api/v1/open/ListAssets)`

`请求方式` `POST`

`Content-Type application/json`

### 请求参数

Filter object 必填​      搜索的过滤条件。​       

Filter.GroupType string 必填​    Asset Group（素材资产组合）的类型。

可选值：​   ◦  AIGC：虚拟人像。​          

Filter.Statuses array ​    任务状态。​  

◦  Active：素材资产（Asset）已处理完毕，可以使用。​   

◦  Processing：素材资产（Asset）正在预处理，无法使用。​   

◦  Failed：素材资产（Asset）处理失败。​          

Filter.Name string ​  Asset（素材资产）的名称，上限为64个字符。​       

PageNumber int (i64) 必填 搜索页码，可用于列表分页功能，从 1 开始。例如："page_number": 1，即返回第一页的搜索结果。​       

PageSize int (i64) 必填​每页搜索结果的数量，上限为100。​       

SortBy string​  用于排序的字段名称，默认值 createTime。

支持以下类型：​   

•  CreateTime：根据创建时间排序。​   

•  UpdateTime：根据更新时间排序。​   

•  GroupId：根据资产素材组的 Id 排序。​      

SortOrder string​   排序顺序，默认值 Desc。可选值：​   

•  Desc：降序​   

•  Asc：升序​    

返回参数​    

Items array[] ​   符合筛选条件的Asset（素材资产）数组。​       

Items.Id string​   Asset（素材资产）的 Id。​       

Items.name string​Asset（素材资产）的名称，上限为64个字符。​       

Items.URL string​ Asset（素材资产）的公共可访问地址。有效期为12小时，请及时保存。

Items.GroupId string Asset（素材资产）所属的 Asset Group（素材资产组合）的 Id。Items.AssetType string​Asset（素材资产）的类型，支持传入图像、音频、视频。

支持类型：​  

◦  Image：Asset（素材资产）的类型为图像。​   

◦  Video：Asset（素材资产）的类型为视频。​   

◦  Audio：Asset（素材资产）的类型为音频。​          

Items.Status string​    任务状态。​  

◦  Active：素材资产（Asset）已处理完毕，可以使用。​   

◦  Processing：素材资产（Asset）正在预处理，无法使用。​   

◦  Failed：素材资产（Asset）处理失败。​          

Items.Error object​    错误信息。​      

Items.Error.Code string​错误码。​       

tems.Error.Message string​ 错误信息。​          

Items.ProjectName string​  资源所属的项目名称。​       

Items.CreateTime string​    创建时间。​       

Items.UpdateTime string​   更新时间。​       

TotalCount int (i64)​        返回总数。​       

PageNumber int (i64)​      返回的页数。​       

PageSize int (i64)​      每页搜索结果的数量，上限为100。

## ListMediaAssetGroup - 查询公共素材

`POST [http://118.196.64.1/api/v1/open/ListMediaAssetGroup](http://118.196.64.1/api/v1/open/ListMediaAssetGroup)`

### 请求参数

Filter object 可选​      搜索的过滤条件     

Filter.Field string 可选​  字段名

Filter.Op: string，操作符，例如 "must"  
Filter. Conds: object，条件值  
Filter. Conds.StrValues: array，字符串值数组

PageNum: int，页码，从 1 开始（可选，默认 1）  
PageSize: int，每页数量（可选，默认 30）  
SortBy: string，排序字段，例如 "score"（可选，默认 "score"）  
SortOrder: string，排序顺序，可选值: "desc"/"asc"（可选，默认 "desc"）

示例如下：

{"pageNum":1,"pageSize":24,"sortBy":"score","sortOrder":"desc","filters":[{"Field":"metadata.gender","Op":"must","Conds":{"StrValues":["女","女性"]}},{"Field":"metadata.country","Op":"must","Conds":{"StrValues":["中国"]}},{"Field":"metadata.occupation","Op":"must","Conds":{"StrValues":["演员"]}},{"Field":"metadata.age","Op":"must","Conds":{"StrValues":["25","26","27","28","29","30","31","32","33","34","35"]}}]}

### 返回参数

TotalCount: int，返回的总数
Items: array，符合筛选条件的媒体资产组合数组AssetGroup

AssetGroup.SID  string 组ID

AssetGroup.Title  string 资产组的显示名称或标题

AssetGroup.Description  string  对资产组的文字描述

AssetGroup.Metadata object  元数据信息

AssetGroup.Score float   分数

AssetGroup.AdditionalInfo object 附件信息

AssetGroup.Content object 具体内容
PageNum: int，返回的页数
PageSize: int，每页数量