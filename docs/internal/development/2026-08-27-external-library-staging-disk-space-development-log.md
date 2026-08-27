# 2026-08-27 外部库解压临时目录与空间预检（Serpent-342ba9）

## 问题

导入/打开 BillfishPack 或 Eagle 归档时，Main 把整包解压到系统临时目录（Windows 上常为系统盘）。大包会把该盘写满；解压发生在用户选择 Serpent 保存位置之前；崩溃后可能留下 `serpent-external-library-*`。磁盘洁净纪律要求：解压前预检空间、生命周期内清理、异常退出有回收。

调研见 [外部库导入临时目录惯例](../research/2026-08-27-external-import-temp-directory.md)。成熟软件没有「永远系统 TEMP」的统一标准；大文件更接近「默认 TEMP/scratch，空间不够改到数据盘，应用自己清理」。产品决定采用该策略 B：默认系统临时目录可以，不够再落到资源库（或归档）所在盘。

## 实现

- 解压前读取 ZIP/BillfishPack/eaglepack 中央目录未压缩合计；RAR/7z 等按归档大小 ×3 估。所需空间 = 估值 + max(10%, 64 MiB)。
- 默认解压到 `os.tmpdir()`。该盘不足且 fallback 在**另一卷**时：
  - 打开/inspect：归档文件所在目录；
  - 导入到已打开库：该库父目录。
- 两卷都不够或 mkdtemp/`ENOSPC`：返回公开错误 `DISK_FULL`，不写一半。解压中途磁盘满同样映射为 `DISK_FULL`。归档损坏/穿越/非库根映射为 `INVALID_IMPORT_SOURCE` 或 `NOT_A_LIBRARY`，不再变成含糊的 `INTERNAL_ERROR`。
- 清理：成功/取消/失败都会 `rm`；Windows `EPERM`/`EBUSY`/`ENOTEMPTY` 有限次重试。删除失败不从待清理表丢掉。启动时扫描系统 TEMP 中的 `serpent-external-library-*`，并读取 userData 里的 staging 登记表回收上次崩溃残留。只删除该前缀目录。
- 公开错误不包含本机路径。

## 验证

```
npx vitest run --config vitest.config.ts tests/unit/disk-free-space.test.ts tests/unit/external-library-staging-store.test.ts tests/unit/external-library-archive.test.ts tests/worker/zip-import-stream.test.ts
```

4 files / 32 passed。覆盖：空间预检与换盘、同盘不换、两盘都不够、ZIP 未压缩合计、BillfishPack 解压清理、fallback 落盘、DISK_FULL 不写临时树、启动残留扫描跳过仍在用的目录。

真实大包、C 盘故意填满、Windows 句柄占用删除、packaged 未执行。

## 未验证

- 真实数 GB BillfishPack/Eagle 归档在系统盘空间不足时的 fallback 与文案。
- 启动回收在用户可见磁盘上的残留提示（当前仅日志；删除失败时用户看不到独立对话框）。
- Computer Use / packaged。
