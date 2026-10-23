# c0ns1d2 · 惊天魔盗团记忆库

个人记忆网站，基于 Astro 静态站点生成器。

## 项目结构

```
c0ns1d2/
├── src/
│   ├── pages/              # 页面路由
│   │   ├── index.astro     # 首页（星球可视化）
│   │   ├── events/         # 事件列表 + 详情
│   │   ├── people/         # 人物列表 + 详情
│   │   └── journal/        # 随笔列表 + 详情
│   ├── components/         # 组件（星球可视化等）
│   ├── content/            # 内容（Markdown）
│   │   ├── events/         # 22个事件
│   │   ├── people/         # 5个人物
│   │   └── journal/        # 随笔（待添加）
│   └── layouts/            # 布局模板
├── public/                 # 静态资源（图片、视频）
├── astro.config.mjs
└── package.json
```

## 本地开发

```bash
npm install
npm run dev      # 启动开发服务器 http://localhost:4321
npm run build    # 构建到 dist/
npm run preview  # 预览构建结果
```

## 添加新内容

### 添加事件
在 `src/content/events/` 新建 `.md` 文件：

```markdown
---
title: 事件标题
date: 2026-10-19
persons: [朱浩宇, 曾浩鑫]
tags: [聚餐, 高三]     # 自定义分类标签，一个事件可以有多个
category: other        # core / food / exam / other（决定星球颜色）
color: "#9b59b6"
size: 30
images:
  - /images/xxx.jpg
videos:
  - /videos/xxx.mp4
---

事件正文内容...
```

**关于分类标签（tags）：**
- 你自己决定怎么分类，网站会自动生成每个标签的页面
- 一个事件可以属于多个标签
- 导航栏的「分类」页面会展示所有标签和每个标签下的事件数
- 事件详情页里的标签可以点击，跳转到该分类

### 添加随笔
在 `src/content/journal/` 新建 `.md` 文件：

```markdown
---
title: 随笔标题
date: 2026-10-19
author: 朱浩宇
tags: [日常, 感想]
---

正文内容...
```

### 添加图片/视频
把文件放到 `public/images/` 或 `public/videos/`，然后在 Markdown 里用 `/images/xxx.jpg` 引用。

---
