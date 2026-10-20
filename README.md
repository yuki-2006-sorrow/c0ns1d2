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

## 从零部署到线上（完整新手教程）

### 第一步：安装必要软件

你需要安装两个东西：**Git** 和 **Node.js**

1. **安装 Node.js**
   - 打开 https://nodejs.org/
   - 下载左边的 LTS 版本（推荐）
   - 双击安装，一路下一步

2. **安装 Git**
   - 打开 https://git-scm.com/download/win
   - 下载 64-bit Git for Windows Setup
   - 双击安装，一路下一步（默认选项就行）

3. **验证安装**
   - 按 `Win + R`，输入 `cmd`，回车
   - 输入 `node -v`，应该显示版本号（如 v22.x.x）
   - 输入 `git --version`，应该显示版本号
   - 都有就说明装好了

### 第二步：注册 GitHub 账号

1. 打开 https://github.com/
2. 点击 Sign up，用邮箱注册
3. 用户名建议用 c0ns1d2 或者你喜欢的名字
4. 注册完登录

### 第三步：把项目传到 GitHub

1. 把这个 c0ns1d2 文件夹放到你电脑上（比如桌面）
2. 打开文件夹，在地址栏输入 `cmd`，回车（会打开命令行，路径已经在这个文件夹里）
3. 依次输入以下命令（每行输完按回车）：

```bash
git init
git add .
git commit -m "初始提交"
```

4. 去 GitHub 网页，点击右上角 `+` → `New repository`
5. Repository name 填 `c0ns1d2`，选 Public，点 Create repository
6. 创建后，页面上会显示命令，找到 "…or push an existing repository from the command line" 那部分
7. 复制那两行命令，回到命令行粘贴执行（类似下面这样，URL 以你的为准）：

```bash
git remote add origin https://github.com/你的用户名/c0ns1d2.git
git push -u origin main
```

8. 刷新 GitHub 页面，应该能看到你的代码了

### 第四步：用 Cloudflare Pages 部署（免费，国内访问快）

1. 打开 https://pages.cloudflare.com/
2. 点击 Sign up，用邮箱注册（也可以直接用 GitHub 账号登录）
3. 登录后，点击 Create a project → Connect to Git
4. 授权 GitHub，选择你的 c0ns1d2 仓库
5. 构建设置：
   - Framework preset：选 `Astro`
   - Build command：`npm run build`
   - Build output directory：`dist`
6. 点击 Save and Deploy
7. 等待1-2分钟，部署完成！你会得到一个类似 `c0ns1d2.pages.dev` 的网址

### 第五步：绑定自己的域名 c0ns1d2.com

1. **买域名**
   - 推荐在阿里云（https://wanwang.aliyun.com/）或腾讯云买
   - 搜索 c0ns1d2，选 .com（约50-70元/年）或更便宜的后缀
   - 购买时需要实名认证，按提示操作

2. **在 Cloudflare 添加域名**
   - 登录 Cloudflare，点击 Add a domain
   - 输入你买的域名，点 Continue
   - 选 Free 套餐，点 Continue
   - Cloudflare 会给你两个 nameserver（类似 `xxx.ns.cloudflare.com`）

3. **修改域名 DNS**
   - 回到你买域名的地方（阿里云/腾讯云）
   - 找到域名管理 → DNS 修改/Nameserver 修改
   - 把默认的 nameserver 改成 Cloudflare 给你的那两个
   - 保存，等待生效（可能需要几分钟到几小时）

4. **在 Cloudflare Pages 绑定域名**
   - 回到 Cloudflare Pages，进入你的项目
   - 点 Custom domains → Set up a custom domain
   - 输入你的域名（如 c0ns1d2.com），点 Continue
   - 按提示完成验证
   - 等 DNS 生效后，访问 c0ns1d2.com 就能看到你的网站了！

### 第六步：以后更新内容

1. 在本地修改 `src/content/` 里的 Markdown 文件，或者添加图片
2. 打开命令行，在项目文件夹里执行：

```bash
git add .
git commit -m "添加了新事件"
git push
```

3. Cloudflare Pages 会自动检测到更新，重新部署（约1分钟）
4. 刷新网站就能看到新内容了

---

## 常见问题

**Q: 命令行是什么？怎么打开？**
A: 在文件夹地址栏输入 cmd 回车，或者按 Win+R 输入 cmd。黑色的窗口就是命令行，输入命令按回车执行。

**Q: git push 时要输入用户名密码？**
A: GitHub 现在不支持密码了，需要用 Personal Access Token。在 GitHub → Settings → Developer settings → Personal access tokens → Generate new token，勾选 repo 权限，生成后复制，当密码用。

**Q: 图片视频放哪里？**
A: 放到 `public/images/` 和 `public/videos/` 文件夹，然后在 Markdown 的 frontmatter 里引用。

**Q: 域名买了之后每年都要续费吗？**
A: 是的，域名是按年付费的。.com 一般50-70元/年。

**Q: Cloudflare Pages 真的免费吗？**
A: 是的，个人项目完全免费，带宽无限，构建次数每月500次（足够用了）。
