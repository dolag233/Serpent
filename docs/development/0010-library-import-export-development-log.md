# Slice 0010 development log: library import/export

> Status: fixing
> Started: reconstructed 2026-07-13
> Last updated: 2026-07-13
> Record provenance: **流程偏差**——实现先于本文完成；记录由 `3aec6c3`/`2ffd226`、当前 diff 与测试重建。

## References and ranges

- Spec: `docs/implementation/0010-library-import-export-vertical-slice.md`
- Original review range: `8dc2470...cdc2247`
- Relevant commits: `3aec6c3`（folder）、`2ffd226`（ZIP）
- Re-review: current uncommitted working tree on 2026-07-13.

## Reconstructed implementation

- Folder and ZIP export use `better-sqlite3`'s SQLite Online Backup API, verify the snapshot with `quick_check`, and copy selected content while excluding regenerable/transient paths.
- Folder import supports validation plus copy/open-in-place.
- ZIP export uses streaming archiver with standard-ZIP preflight; ZIP import uses `yauzl` central-directory preflight plus entry streaming, then validates and opens the extracted library.
- Renderer exposes format choice, linked-content option and progress surfaces.

## Working-tree hardening

- Portable ZIP entry validation rejects traversal, absolute/drive/UNC-like names, NULs, ambiguous empty/dot segments and symlink entries.
- ZIP import enforces entry-count, per-entry/total uncompressed-size and compression-ratio limits before extraction; hostile-archive tests cover path escape, symlink, compression bomb and ownership cases.
- Folder trees reject symlinks rather than silently following/skipping unsafe entries; failure cleanup and destination ownership checks were strengthened.
- Worker 在首个进度事件中先公布 opaque operation ID；Renderer 可在原长请求完成前发出取消命令。
- 文件夹复制、ZIP 枚举/压缩与逐 entry 解压在边界让出事件循环并检查取消；取消只清理本操作拥有的半成品，清理失败进入持久诊断并作为失败返回。
- 文件夹和 ZIP 导出共用链接内容契约：勾选后把可用链接根加入同一 manifest，纳入进度、文件数、字节数与取消语义；同名根通过稳定 folder-id 后缀隔离。
- 同一资源库导出互斥；导入按 canonical source/destination 路径互斥，重叠操作返回并记录 `TRANSFER_IN_PROGRESS`。

## Verification record

- 2026-07-13 当前工作树全量：**713 passed / 1 skipped**；lint、typecheck、`git diff --check` 通过。该数字会在后续跨切片收口后重新生成，不作为最终固定结果。
- 新增真实流式 ZIP、压缩炸弹、路径锁、Online Backup、链接内容 folder/ZIP 测试。
- 早期工作树曾通过 package/startup；加入媒体二进制 promoted-source fail-closed gate 后，当前 release package 必须等不可变 HTTPS bundle 和 checksum receipt，不能沿用早期包作为最终证据。
	- Large-library soak test completed 2026-07-14 with 20k assets; no data loss or corruption found.
	- Packaged transfer-UI walkthrough and cross-platform manual round trip remain unexecuted.

## Remaining QA gap

- 单个超大文件或单个超大 ZIP entry 仍只能在该文件/entry 完成后响应取消；这是当前规格的边界粒度，不是字节级中断。
- Windows 流关闭、占用文件删除、长路径和跨平台 ZIP 往返仍需实机 QA。

Automated implementation gates are complete; this slice is not finally accepted until the remaining manual/platform QA is recorded.

## 2026-07-14: Large-library import/export soak test

Added `tests/worker/library-import-export-soak.test.ts` — a soak test that seeds 20,000 assets with varied metadata (5 extensions, 4 byte-size tiers, 365-day date spread, labels/ratings/favorites/descriptions, 10 tags, 5 collections), then performs full folder and ZIP export/import round trips, verifying:

- Asset count matches (20,000 exact).
- Field-level spot-check on 200 assets (relativeFilePath, byteSize, locationKind).
- Metadata spot-check on 50 assets (label, rating, favorite, description).
- All 10 tags and 5 collections preserved with matching names.
- Source library remains fully usable after both export operations.

**Size chosen**: 20,000 (not 100,000). The 0005 gate used 100k DB-only records for search performance, but the soak requires writing real files to disk and copying them during export. 20k provides meaningful coverage of both DB and filesystem paths without exceeding a reasonable test timeout on CI.

**Results**: Both folder and ZIP round trips pass. Folder export ~3.6s, folder import ~3.9s; ZIP export ~4.1s, ZIP import ~6.4s. All perf thresholds (<60s each) met with wide margin. No data loss, no corruption, no pathological slowdown detected.

**No 0010 bugs found**. The soak did not reveal any implementation defect in the export or import paths.
