# 0.3.6 Windows 打包挂起且未轮询（2026-11-13）

发布 0.3.6 的 Windows 打包没有按要求盯进程。`electron-forge make` 连上 GitHub 后约一小时没有新输出、没有 0.3.6 产物，也没有被判定为挂起。这是操作失败，不是打包器的正常耗时。

## 经过

1. `main` 已包含合并提交 `90ebfbd4` 和版本提交 `19cddf5c`（0.3.5 → 0.3.6），并已推送。GitHub Release `v0.3.6` 已创建。之后按要求改过正文，不在这次失败范围内。
2. 第一次 `npm run release:package` 失败。当时 shell 里留着 `HTTPS_PROXY=http://127.0.0.1:10808`。Forge 在 “Copying files” 报 `Client network socket disconnected before secure TLS connection was established`。这个代理只应用于 git / `gh` 上传，不能传给 Forge。
3. 第二次去掉代理后重新打包。本地时间 00:03，`out/Serpent-win32-x64/Serpent.exe` 为 225,784,832 字节，`resources/app.asar` 为 309,795,794 字节。终端日志停在 “Copying files / Preparing native dependencies / Finalizing package”，没有再刷新。
4. 进程树当时已经进入 `npm run release:make` → `electron-forge make`。make 进程与 `185.199.109.133:443` 保持 Established，累计 CPU 约 1.9 秒，工作集约 600 MB。`out/make/zip/win32/x64/` 里没有 `Serpent-win32-x64-0.3.6.zip`。这个状态从 00:03 附近维持到 01:09 被结束，约 66 分钟。
5. 期间没有短间隔轮询进程、网络连接和产物时间戳。日志不刷新被当成仍在复制。用户多次要求监控之后，这个进程仍挂着。
6. 01:09 结束的是这条发布脚本进程树。正在运行的开发态 `electron-forge start` 没有一起结束。
7. 随后用已有的 `out/Serpent-win32-x64` 执行 `electron-forge make --skip-package`，不再重新下载 Electron。01:10 得到 `out/make/zip/win32/x64/Serpent-win32-x64-0.3.6.zip`，407,755,799 字节。记录本文时 Inno Setup 仍在压缩，当时的 `out/make/inno/SerpentSetup.exe` 只有约 1.2 MB，是编译开始时清掉旧文件后的未完成文件，不能当作安装器。
8. 用户已要求这次不要上传。0.3.6 的 Windows 资产没有在这次恢复里上传。`main` 也还没有按发布手册合并回 `dolag_dev`。

## 原因

- 长任务只看了启动时的几行日志。Forge 把 package 和 make 的输出留在缓冲区里，进程已经进入 make，日志仍停在 package 的三行。
- 没有把「到 GitHub 的连接一直 Established、CPU 几乎不增加、目标 zip 不出现」当成挂起。
- 代理环境变量留在后续打包命令的 shell 里，第一次打包被错误地带去访问外网。
- 程序目录已经写出来之后，仍让 `electron-forge make` 再走一遍会访问网络的打包，而不是 `--skip-package`。

## 之后的打包

- 打包、make、Inno、上传各自开始后，每分钟查看一次：进程是否还在、CPU 或目标文件是否变化、有没有到外网的长时间无进度连接。同一日志行超过数分钟且产物大小不变，就视为挂起并停掉该进程树，不结束开发态应用。
- `HTTPS_PROXY` 只加在 git push 和 `gh` 那一次命令上，打包前从环境里拿掉。
- `out/Serpent-win32-x64/Serpent.exe` 与 `resources/app.asar` 已经是本次版本时，用 `electron-forge make --skip-package`，再跑 `npm run make:inno`。
- 在 Inno 打印 `Successful compile` 之前，不把 `SerpentSetup.exe` 的路径交给使用者。
