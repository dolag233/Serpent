# 2026-08-03 Beads 分支工单合并核查与恢复

## 结论

本次核查确认：Git 分支合并不会自动合并本地嵌入式 Dolt 中的工单。`.beads/embeddeddolt` 未纳入 Git，切换提交或分支时仍使用当前工作区的本地数据库；而 `.beads/issues.jsonl` 只是可提交的镜像，历史上并非始终是完整导出。因此，普通 `git merge` 既不能覆盖两个工作区的 Dolt 数据，也不能保证两份不完整 JSONL 自动形成工单并集。

用户提供的原始工作区快照中有 14 个工单在当前 Git 可追溯记录和 JSONL 快照中均找不到。本次已按用户给出的 ID、标题、优先级和状态恢复；由于原工作区的完整描述、依赖、负责人和验收字段不可从当前仓库取得，恢复记录已明确标记为不完整，未臆造这些字段。

## 核查范围与基线

- 当前分支：`codex/slice-002-asset-ingestion`
- 当前 HEAD：`4d8d666`
- 相关合并提交：`5e8dc22`（`merge: sync latest slice-002 ingestion branch`）
- 合并第一父提交：`f563fee`
- 合并第二父提交：`0038d282`
- 核查前工作区代码状态：干净；没有未提交的源代码修改

核查前本地 Dolt 统计为：总计 539，Open 37，In Progress 34，Blocked 6，Closed 467，Ready 31。

核查前的完整工单集合摘要：

```text
bd list --all --json | jq -S 'sort_by(.id)' | sha256sum
6b215daf088f73ad95e9f07b6974eafaf48ff47be07664acb280450dab5f99a8
```

当时 Git 中的 `.beads/issues.jsonl` 只有 229 行，且 `bd` 持续报告有 10 条 JSONL-only 记录未进入本地 Dolt：

```text
aoj0 c8yc ek9t jy9z ls2p oc6g rp7m sq4r v7jw xdmu
```

## 回退对照结果

按要求先记录当前状态，再将工作树切换到合并前的第一父提交 `f563fee`，执行相同的工单统计和集合摘要，随后回到 `4d8d666`。

回退后的本地 Dolt 仍为总计 539，集合摘要与当前 HEAD 相同。这证明 Git 回退没有切换本地嵌入式 Dolt，不能用“切换到合并前提交再执行 `bd`”来读取另一个分支的工单数据库。

对 Git 可追溯的 JSONL 进一步比较：`5e8dc22` 与第一父提交 `f563fee` 的 `.beads/issues.jsonl` 完全相同，均为 229 条；第二父提交 `0038d282` 为 227 条。因此该次合并本身没有直接删除全部缺失的序列帧工单。缺失工单没有出现在当前可追溯的 Git JSONL 历史中，符合它们只存在于另一个工作区本地 Dolt、但未导出或未提交的情况。

## 迁移与恢复

### 1. 恢复 Git JSONL 中缺失的 10 条记录

将当前 HEAD 的 `.beads/issues.jsonl` 作为输入，使用 `bd import - --json` 做增量 upsert，未重建或覆盖现有 Dolt。迁移后总数从 539 增加到 549，重复 ID 检查无结果，10 条 JSONL-only 记录全部进入本地 Dolt。

有 4 条记录因本地 Dolt 的 `updated_at` 更新，保留 Dolt 的较新状态/优先级，而不是用旧 JSONL 覆盖：`32p`、`eaf`、`hrc2`、`uye`。这 4 条随后又根据用户提供的原始工作区状态快照进行人工处理，见下文。

### 2. 按用户提供的原始工作区快照恢复 14 条记录

恢复的工单为：

```text
1y9r  2eg1  2w1a  50xn  6s02  8wus  bnah  jxnb
nplj  nzxh  udj5  ue5f  vijg  vwr7
```

这些记录写入了用户提供的标题、优先级、类型和状态。原快照显示为 In Progress 的记录保持 In Progress，显示为 Open 的 `1y9r`、`nplj`、`nzxh`、`udj5` 保持 Open。所有恢复记录的描述中注明：当前仅恢复快照中可靠可得的字段，完整描述、依赖、负责人和验收字段待取得原工作区导出后补齐。

### 3. 对照用户快照后处理 4 条状态冲突

用户提供的原始工作区快照与当前 Dolt 的状态/优先级冲突如下，已按用户快照恢复：

| 工单 | 用户快照 | 迁移前当前值 | 处理结果 |
|---|---|---|---|
| `32p` | In Progress / P0 | Closed / P1 | In Progress / P0 |
| `v6m3` | In Progress / P1 | Open / P2 | In Progress / P1 |
| `ac03` | In Progress / P3 | Open / P3 | In Progress / P3 |
| `uye` | Open / P2 | Closed / P2 | Open / P2 |

## 最终校验

迁移完成后运行 `bd export -o .beads/issues.jsonl`，生成完整 JSONL 镜像。最终本地 Dolt 统计为：总计 563，Open 43，In Progress 40，Blocked 6，Closed 479，Ready 37。

最终集合摘要：

```text
bd list --all --json | jq -S 'sort_by(.id)' | sha256sum
6bf0ea80e044bf747ae55b9a2877b11b7131d3640350cef7e84dc4457b2eaa3f
```

最终 `.beads/issues.jsonl` 为 563 行，摘要为：

```text
e6e65ff85c793aeabb7e060b94e0d092d97ae44a89ae5909c8ca9856c3f17c67
```

以下检查无输出，表示没有重复 ID，且完整导出的 JSONL 没有只存在于 JSONL、却未进入 Dolt 的记录：

```bash
bd list --all --json | jq -r .[].id | sort | uniq -d
comm -23 \
  <(jq -r .id .beads/issues.jsonl | sort) \
  <(bd list --all --json | jq -r .[].id | sort)
```

## 后续规则

本次流程已固化到 `AGENTS.md` 和 `docs/internal/agent-work-queue.md`：

- 合并前在两个分支分别记录提交、`bd stats` 和完整工单快照。
- 合并后按 ID 做并集，逐项处理更新时间、状态、优先级、标签、依赖和评论冲突。
- 现有 Dolt 只能增量 `bd import`，禁止用 `bd init --from-jsonl` 或覆盖式重建。
- 迁移后必须重新完整导出 `.beads/issues.jsonl`，并将工单镜像与代码一起提交。
- 没有原分支快照时，只能恢复可靠字段，不能从标题臆造描述和验收条件。

`Serpent-na2v` 是本次工作区内为 Dolt/JSONL 数据完整性维护而创建的内部维护工单，不属于用户提供的原始产品工单列表；本次保留它，并在后续完成真实跨工作区/远端快照验证后再关闭。
