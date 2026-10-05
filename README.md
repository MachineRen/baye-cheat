# 三国霸业 · 金手指（baye.bbkgames.com 版）

浏览器辅助工具页，适用于 **https://baye.bbkgames.com/index.html**（平衡版2.1三国战纪 / 平衡版2.1修罗模式）。

> 仅供个人学习研究，请勿用于破坏他人存档或对外传播修改后的存档。

## 与另一个仓库的区别

| 仓库 | 对应游戏 |
|---|---|
| `MachineRen/sgby-cheat` | 豆包应用「三国霸业」(https://4m2x6wry2s8z5.doubaoapps.com/app/app_17f1t3rbtp3/) |
| `MachineRen/baye-cheat`（本仓库） | https://baye.bbkgames.com |

两者**相互独立**，请勿混淆。

## 在线使用（当前版本 v1.20.0）

- 在线工具页（GitHub Pages）：https://machineren.github.io/baye-cheat/
- 打开游戏页后，按工具页指引生成书签，点击书签即可注入面板。
- 也可将 `baye-cheat-panel.js` 作为 Tampermonkey 用户脚本，以 `document-start` 注入。

## 本地文件结构

| 文件 | 作用 |
|---|---|
| `index.html` | 单文件工具页（面板源码 / 书签生成 / 在线改档全部内嵌） |
| `baye-cheat-panel.js` | 注入面板源文件，可独立托管 / 远程书签加载 |

## 推送

本机 `git push` 直连 github.com:443 常超时（沙箱代理对 CONNECT 返回 502），改用 REST API 兜底：

```bash
cd /Users/ren/WorkBuddy/2026-09-30-13-54-41
GH_TOKEN=xxx node baye-push.js                      # 默认推 index.html + baye-cheat-panel.js + README.md
GH_MSG="提交信息" GH_TOKEN=xxx node baye-push.js 文件…
```

- 脚本按 git blob sha1 比对，相同自动跳过
- Pages 构建约需 1–3 分钟，可用 `GET /repos/MachineRen/baye-cheat/pages/builds/latest` 轮询

> 构建标记：2026-10-05 15:44:45（v1.20.5 君主名修复重推）
