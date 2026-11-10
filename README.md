# 我的日程

用墨绿周历规划钢琴课、钢琴练习和无氧训练，记录每天的 6000 步与阅读。桌面可以直接看整周的时间轴，手机按日期浏览活动。日历支持当天、周和月，单项记录支持近 7 天、近 30 天或自选起止日期。

在周历时间轴点一个时间格，或沿同一天拖选多个 30 分钟格，即可打开预填时段的新增活动表单。手机可在「当天」展开「按时间规划」。

「挑战」可设置名称、开始日期和目标连续天数。每天单独打卡，也可补打或撤销。漏一天后从下一次打卡重新累计，任意一段连续打卡达到目标即达成挑战。

在「配置」中分别新增或编辑活动类型和打卡项目。固定 ID 用于关联日程和历史打卡，改名后各视图会显示新名称。活动可从七种日历配色中选择，新增打卡项目从创建当天开始计入统计。

工作日按北京时间的周一至周五计算。09:30–11:30 和 13:00–18:00 默认避开，活动与工作时段重叠时可以为这一条开启例外。活动属于一个日期，结束时间可设到当天 24:00。打卡可回填或取消，统计到北京时间的今天。

## 在本机运行

需要 Node.js 22.12+ 和 npm。在项目根目录运行：

```sh
npm ci
npm run dev
```

打开终端显示的地址。两项 Supabase 环境变量都留空时进入本地试用模式，试用数据保存在当前浏览器。连接 Supabase 后，手机和电脑可以用同一个 GitHub 账号登录，读写同一份数据。

## 配置 Supabase

1. 创建一个 [Supabase 项目](https://supabase.com/dashboard/projects)。在 SQL Editor 依次执行[基础迁移](supabase/migrations/20261110000000_create_planner.sql)、[挑战迁移](supabase/migrations/20261110010000_create_challenges.sql)、[配置迁移](supabase/migrations/20261110020000_create_item_catalog.sql)和[配色迁移](supabase/migrations/20261110030000_expand_activity_tones.sql)。已有项目按顺序补跑尚未执行的迁移。配置迁移沿用已有活动与打卡 ID。
2. 在 [GitHub OAuth Apps](https://github.com/settings/developers) 新建 OAuth App。Homepage URL 填将使用的站点地址，例如 `https://<你的用户名>.github.io/day-planner/`。Authorization callback URL 填 Supabase 的 GitHub provider 页面给出的地址，通常是 `https://<project-ref>.supabase.co/auth/v1/callback`。
3. 在 Supabase 的 **Authentication → Sign In / Providers** 启用 GitHub，填 Client ID 和 Client Secret。Client Secret 只保存在 Supabase。个人项目保留 GitHub 登录，关闭其他登录方式和匿名登录。
4. 在 **Authentication → URL Configuration** 将 Site URL 设为 GitHub Pages 站点地址。把带结尾斜杠的站点地址和实际用于本机调试的地址加入 Redirect URLs，例如 `http://localhost:5173/`。如果终端实际使用 `127.0.0.1` 或不同端口，也把那个完整地址加进去。
5. 把 [.env.example](.env.example) 复制为 `.env.local`，填写 Supabase 的 Project URL 和 Publishable Key，然后重启开发服务。

```dotenv
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

这两个值会用于浏览器中的 REST API 请求。数据权限由登录会话和数据库 RLS 控制，GitHub Client Secret、Supabase Secret Key 与 service_role 密钥留在服务端。

### 开通自己的账号

首次配置时开启 **Allow new users to sign up**，在本地页面点「使用 GitHub 登录」并确认授权。登录后在 **Supabase → Authentication → Users** 核对自己的 GitHub 账号，复制该用户的 UUID。然后在 SQL Editor 执行下方 SQL，把占位文字换成实际 UUID：

```sql
insert into planner_private.owner (user_id)
values ('你的 Supabase 用户 UUID'::uuid);
```

点「重新验证」或重新打开页面即可开始使用。回到 Authentication 设置关闭 **Allow new users to sign up**。`planner_private.owner` 只接受一个账号，RLS 会校验每条数据的所有者。

## 发布到 GitHub Pages

1. 把项目放入自己的公开 GitHub 仓库。在 **Settings → Pages** 把 Source 设为 **GitHub Actions**。
2. 在 **Settings → Secrets and variables → Actions → Variables** 添加 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_PUBLISHABLE_KEY` 两个仓库变量。
3. [部署工作流](.github/workflows/pages.yml) 会在默认分支更新时构建并发布。也可以在 **Actions → Deploy to GitHub Pages → Run workflow** 选择默认分支运行。构建产物在 `dist/`，使用相对资源路径，适配项目站点的仓库子路径。
4. 打开 Pages 显示的地址，分别用手机和电脑登录。可以先在一台设备打卡，再在另一台设备重新打开页面确认同步。

本地构建使用 `npm run build`，可用 `npm run preview` 检查构建产物。

[GitHub Pages 工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages) · [Supabase 的 GitHub 登录配置](https://supabase.com/docs/guides/auth/social-sign-in/auth-github) · [Supabase 跳转地址配置](https://supabase.com/docs/guides/auth/redirect-urls)
