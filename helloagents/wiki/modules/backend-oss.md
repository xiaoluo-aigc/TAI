# 后端模块：对象存储与素材（backend-oss）

## 作用
- 提供上传凭证/素材代理/视频帧等能力，为前端素材管理、项目缩略图、视频拆帧等提供支持。

## 关键文件
- `backend/src/oss/oss.service.ts`：OSS client、签名、public URL、允许域名白名单
- `backend/src/oss/uploads.controller.ts`：`/uploads/*`
- `backend/src/oss/assets.controller.ts`：`/assets/*`
- `backend/src/oss/video-frames.controller.ts`：`/video-frames/*`
- `backend/src/oss/video-gif.controller.ts`：`/video-gif/*`

## 配置项（节选）
- `OSS_REGION`、`OSS_BUCKET`
- `OSS_ACCESS_KEY_ID`、`OSS_ACCESS_KEY_SECRET`
- `OSS_CDN_HOST`（可选）、`OSS_ENDPOINT`（可选）
- `ALLOWED_PROXY_HOSTS`：额外允许代理的域名（逗号分隔）

## 注意事项
- `allowedPublicHosts()` 内置了部分常见 AI/静态资源域名白名单；是否需要更严格以产品要求为准。
- `POST /api/video-gif/convert` 走服务端 `ffprobe` + `ffmpeg` pipeline：先校验 `videoUrl` 与 host 白名单，再探测总时长，最后按 `fps` / `width` / `startSeconds` / `durationSeconds` 生成 GIF 并上传 OSS；运行环境必须安装 `ffprobe` 和 `ffmpeg`。
