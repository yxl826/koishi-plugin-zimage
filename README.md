# koishi-plugin-zimage

基于魔搭社区 API 的 Koishi AI 画图插件，支持 Z-Image 系列模型。

## 功能特性

- 支持魔搭社区 Z-Image 和 Z-Image-Turbo 模型
- 支持多种图片尺寸选择
- 支持自定义生成步长
- 支持每日调用次数限制
- 支持自定义提示语
- 异步任务处理，自动轮询结果
- Docker 环境完美适配

## 食用教程

### 方法一：通过 Koishi 插件市场安装 （目前还无法通过此途径安装，建议使用方法二和三）

1. 打开 Koishi 控制台
2. 进入「插件市场」
3. 搜索 `zimage` 并安装

### 方法二：手动安装

先Fork本仓库
```bash
# 进入 Koishi 的 node_modules 目录
cd /path/to/koishi/node_modules

# 克隆插件
git clone https://github.com/你的用户名/koishi-plugin-zimage.git

# 进入目录并安装依赖
cd koishi-plugin-zimage
npm install

# 重启 Koishi
```

### 方法三：Docker 环境安装
先Fork本仓库
```bash
# 复制插件到容器
docker cp koishi-plugin-zimage <容器名>:/koishi/node_modules/

# 进入容器安装依赖
docker exec -it <容器名> sh
cd /koishi/node_modules/koishi-plugin-zimage
npm install
exit

# 重启容器
docker restart <容器名>
```

## 配置

### 必填配置

| 配置项 | 说明 | 示例 |
|--------|------|------|
| `apiKey` | 魔搭 API Key | `ms-xxxx-xxxx-xxxx-xxxxxxxxxxxx` |

### 生成配置

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `defaultModel` | 默认模型 | `z-image-turbo` |
| `defaultSize` | 默认尺寸 | `1024x1024` |
| `defaultSteps` | 默认步长 | `8` |

### 高级配置

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `dailyLimit` | 每日调用次数上限 (0为无限制) | `0` |
| `pollInterval` | 轮询间隔(毫秒) | `3000` |
| `maxPollTime` | 最大等待时间(毫秒) | `120000` |

### 提示语配置

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `msgGenerating` | 生成中提示语 | `在画了喵` |
| `msgError` | 生成失败提示语 | `发生错误了喵` |
| `msgLimitReached` | 次数用尽提示语 | `今天的画图次数用完啦喵，明天再来吧` |
| `msgNoPrompt` | 未输入提示词提示语 | `请输入描述喵，例如：画图 一只猫咪` |
| `msgSuccess` | 成功提示语后缀 | `喵` |

## 使用方法

### 基本命令

```
画图 <描述>              # 生成图片
画图 -m <模型> <描述>     # 指定模型
画图 -s <尺寸> <描述>     # 指定尺寸
画图 -t <步长> <描述>     # 指定步长
```

### 其他命令

```
画图模型 [名称]    # 查看或设置默认模型
画图尺寸 [尺寸]    # 查看或设置默认尺寸
画图步长 [数值]    # 查看或设置默认步长
画图状态          # 查看今日调用次数
画图帮助          # 查看帮助信息
```

### 可用模型

| 模型 | 说明 | 推荐步长 |
|------|------|----------|
| `z-image-turbo` | 快速模型，速度优先 | 8 |
| `z-image` | 标准模型，质量优先 | 20-50 |

### 可用尺寸

| 尺寸 | 方向 | 用途 |
|------|------|------|
| `1024x1024` | 正方形 | 通用 |
| `768x1344` | 竖版 | 手机壁纸 |
| `864x1152` | 竖版 | 手机壁纸 |
| `1344x768` | 横版 | 电脑壁纸 |
| `1152x864` | 横版 | 电脑壁纸 |
| `1440x720` | 宽屏 | 横幅/封面 |
| `720x1440` | 长竖版 | 手机长图 |

### 使用示例

```
画图 一只可爱的猫咪
画图 -m z-image 夕阳下的海边风景
画图 -s 1344x768 未来城市
画图 -m z-image -s 1440x720 -t 30 山水画
```

## 获取魔搭 API Key

1. 访问 [魔搭社区](https://modelscope.cn/) 并注册账号
2. 进入 [我的 AccessToken](https://modelscope.cn/my/myaccesstoken)
3. 创建或复制你的 API Key
4. API Key 格式：`ms-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`

## 配置示例

```yaml
~zimage:
  apiKey: ms-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
  defaultModel: z-image-turbo
  defaultSize: 1024x1024
  defaultSteps: 8
  dailyLimit: 100
  pollInterval: 3000
  maxPollTime: 120000
  msgGenerating: '在画了喵'
  msgError: '发生错误了喵'
  msgLimitReached: '今天的画图次数用完啦喵，明天再来吧'
  msgNoPrompt: '请输入描述喵，例如：画图 一只猫咪'
  msgSuccess: '喵'
```

## 常见问题

### Q: 提示 "Invalid model id"

确保模型名称正确，可用模型：`z-image-turbo`、`z-image`

### Q: 生成超时

可能是网络问题或服务器繁忙，可以尝试增加 `maxPollTime` 配置值。

### Q: 提示 API 错误

检查 API Key 是否正确，是否还有调用额度。

## 技术支持

- [魔搭社区](https://modelscope.cn/)
- [Koishi 文档](https://koishi.chat/)
- [Z-Image 模型](https://modelscope.cn/models/Tongyi-MAI/Z-Image-Turbo)

## 许可证

[MIT](./LICENSE)

## 致谢

- [魔搭社区 ModelScope](https://modelscope.cn/) - 提供 API 服务
- [Koishi](https://koishi.chat/) - 优秀的跨平台机器人框架
- [Z-Image](https://github.com/Tongyi-MAI/Z-Image) - 阿里通义图像生成模型
