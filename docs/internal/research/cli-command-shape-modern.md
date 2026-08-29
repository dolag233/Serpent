# 现代 CLI 命令形状小调研

> 调研日期：2026-07-13
> 样本：Docker、GitHub CLI、AWS CLI、kubectl
> 来源：仅使用产品官方文档；只讨论 command / subcommand / resource 结构。

## 结论

成熟 CLI 中**动词数量多并不奇怪**；奇怪的是一条命令连续堆叠多个彼此独立的动作，且没有稳定语法说明每个词的角色。

```text
docker container inspect <container>
gh issue create
aws cloudformation create-change-set
kubectl get pods
```

这些命令都有多个词，但都只有一个主动作：`inspect`、`create`、`create-change-set`、`get`。其余词承担领域或资源定位。成熟 CLI 避免混乱的关键不是“最多两个词”，而是：

1. 固定语法槽位；每一层要么是资源，要么是唯一叶子动作。
2. 同类资源复用同一组动作、参数顺序、选择器和输出规则。
3. 关系操作使用子资源名表达关系，不增加空泛的 `manage`、`process` 等中间动词。
4. 人类输入可以有缩写或别名；agent、文档、日志与 schema 使用唯一规范命令。

## 四个样本

| CLI | 规范形状 | 示例 | 如何控制复杂度 |
|---|---|---|---|
| Docker | 对象 → 动作 | `docker container rm` | 按对象分组；保留少量历史短命令 |
| GitHub CLI | 业务资源 → 动作 | `gh issue create` | 顶层按 issue/pr/repo 等领域聚合 |
| AWS CLI | 服务 → operation | `aws cloudformation create-change-set` | 固定两层，复杂语义压入连字符 operation |
| kubectl | 通用动作 → TYPE → NAME | `kubectl get pods` | 所有动作复用统一资源定位语法 |

### Docker

Docker 把 `container`、`image`、`volume`、`network`、`context` 作为管理对象，再放置 `create`、`inspect`、`rm`、`pull` 等叶子动作。官方同时保留 `docker rm`、`docker pull` 等旧式扁平命令；`DOCKER_HIDE_LEGACY_COMMANDS` 可以隐藏这些旧命令，只显示按对象组织的管理命令。[Docker CLI reference](https://docs.docker.com/reference/cli/docker/)

这说明短命令适合做兼容或高频入口，但完整能力面仍需要稳定对象分组。Serpent 尚无兼容负担，应先建立唯一规范路径，不急于增加顶层快捷命令。

### GitHub CLI

GitHub CLI 顶层主要是 `issue`、`pr`、`repo`、`release`、`workflow`、`project` 等业务资源，下面使用领域动作：`gh issue create`、`gh pr review`、`gh repo sync`。[GitHub CLI manual](https://cli.github.com/manual/gh)

资源关系出现时，GitHub CLI 有 `gh repo deploy-key add` 这种“资源 → 子资源 → 动作”，也有 `gh project item-add` 这种连字符叶子。[`gh repo deploy-key`](https://cli.github.com/manual/gh_repo_deploy-key)、[`gh project`](https://cli.github.com/manual/gh_project) 后者限制了树深，却会形成两种风格。Serpent 是新 CLI，应统一使用可选子资源，不在 `add-assets`、`members add`、`asset-add` 之间漂移。

### AWS CLI

AWS 官方结构是 `aws <command> <subcommand> [options]`：顶层 command 通常对应 service，subcommand 是 operation，例如 `aws cloudformation create-change-set`。部分服务还有固定的 `wait` 中间层。[AWS CLI command structure](https://docs.aws.amazon.com/cli/latest/userguide/cli-usage-commandstructure.html)

这适合庞大的生成式 API，但会产生很长的连字符 operation。Serpent 的领域较小，没有必要为了强制固定两层，把关系操作压成 `collection-add-assets` 或 `asset-set-metadata`。

### kubectl

kubectl 的官方语法是 `kubectl [command] [TYPE] [NAME] [flags]`。`get`、`describe`、`delete`、`label`、`patch` 等大量通用动词复用同一个 `TYPE NAME` 资源槽。[kubectl command line tool](https://kubernetes.io/docs/reference/kubectl/)

动词优先适合“所有对象都服从统一 API resource 语法”的系统。Serpent 的 `asset import`、`tag assign`、`collection members add`、`library open` 参数形状差异明显，改成一组顶层 `add/remove/create` 会产生歧义，因此不推荐。

kubectl 的脚本约定还要求显式选择机器输出，并偏好完整资源引用而非隐式状态。[kubectl usage conventions](https://kubernetes.io/docs/reference/kubectl/conventions/) 对 Serpent，同样应把人类输入糖与 agent 稳定契约分开。

## 多动词判定

正常：只有最后一个词是动作，前面的词是资源层级。

```text
serpent asset metadata set ast_01 --rating 5
serpent asset tags assign ast_01 --tag tag_01
serpent collection members add col_01 --asset ast_01
```

应避免：多个词都像独立执行阶段。

```text
serpent asset import add ./hero.exr
serpent collection manage create "Portfolio"
serpent asset relink preview apply ast_01
```

`preview` 应统一表达为 `--dry-run`；确需两阶段执行时，应返回 plan ID，再由独立命令提交，而不是把 `preview apply` 串在一条命令中。

## Serpent 推荐语法

唯一规范形状：

```text
serpent [--library <id-or-path>] <resource> [subresource] <action> [options] [--] [targets...]
```

约束：

- 顶层资源使用单数规范名：`library`、`folder`、`asset`、`tag`、`collection`、`smart-collection`、`job`、`ai`。
- 最多允许一层 subresource；最后一词是唯一 action。
- 使用领域动作，不强求 CRUD：`import`、`trash`、`restore`、`relink`、`assign`、`analyze`。
- target 默认使用稳定 ID；路径、名称、ID 不靠猜测区分。
- agent 使用完整资源名、完整 long option、显式 library 与结构化输出；缩写仅作为人类输入糖。

代表性命令：

```text
serpent asset list --query "environment"
serpent asset import --folder fld_01 -- ./hero.exr
serpent asset metadata set ast_01 --rating 5
serpent asset tags assign ast_01 --tag tag_01
serpent tag create "Environment"
serpent collection members add col_01 --asset ast_01
serpent collection members remove col_01 --asset ast_01
```

最终规则可以概括为：

```text
资源 → 可选关系子资源 → 唯一叶子动作 → 选项与目标
```

它能稳定映射到 `asset.tags.assign`、`collection.members.add` 等 typed command ID；命令可以有三四个词，但不会成为一串含义不清的动作。
