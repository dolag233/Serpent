// ---------------------------------------------------------------------------
// 统一命令注册表（REQ-COMMAND-001，切片 0015-A）
//
// createCommandRegistry 校验 id 唯一性并返回只读注册表；resolveMenu 把
// CommandDefinition 求值为菜单可直接渲染的 ResolvedMenuItem[]。
// 全部为纯函数，无副作用，仅依赖同目录的 command-types。
// ---------------------------------------------------------------------------

import { formatShortcut, GROUP_ORDER } from './command-types';
import type {
  CommandContext,
  CommandDefinition,
  ResolvedMenuItem,
} from './command-types';

// 泛型参数让消费方可以扩展 CommandContext（如单资产菜单的
// AssetCommandContext）而不损失 run/visible 的入参精度；默认 CommandContext
// 保持 0015-A 的调用点零改动。
export interface CommandRegistry<C extends CommandContext = CommandContext> {
  readonly get: (id: string) => CommandDefinition<C> | undefined;
  readonly list: () => readonly CommandDefinition<C>[];
  readonly resolveMenu: (ctx: C) => ResolvedMenuItem[];
}

export function createCommandRegistry<
  C extends CommandContext = CommandContext,
>(defs: readonly CommandDefinition<C>[]): CommandRegistry<C> {
  const byId = new Map<string, CommandDefinition<C>>();
  for (const def of defs) {
    if (byId.has(def.id)) {
      throw new Error(`Duplicate command id: "${def.id}"`);
    }
    byId.set(def.id, def);
  }
  // 冻结快照：注册后调用方再改动传入数组不影响注册表内容。
  const registered: readonly CommandDefinition<C>[] = Object.freeze([...defs]);

  return {
    get: (id) => byId.get(id),
    list: () => registered,
    resolveMenu: (ctx) => {
      const resolved: ResolvedMenuItem[] = [];
      for (const def of registered) {
        if (def.visible !== undefined && !def.visible(ctx)) {
          continue;
        }
        // disabledReason 是唯一的禁用来源：返回字符串即禁用，null/未定义即启用。
        const reason =
          def.disabledReason !== undefined ? def.disabledReason(ctx) : null;
        resolved.push({
          id: def.id,
          label: typeof def.title === 'function' ? def.title(ctx) : def.title,
          group: def.group,
          shortcutLabel:
            def.shortcut !== undefined
              ? formatShortcut(def.shortcut, ctx.platform)
              : null,
          disabled: reason !== null,
          disabledReason: reason,
        });
      }
      // 组序优先、组内保持注册顺序；显式携带注册下标比较，不依赖引擎 sort 稳定性。
      return resolved
        .map((item, index) => ({ item, index }))
        .sort(
          (a, b) =>
            GROUP_ORDER.indexOf(a.item.group) -
              GROUP_ORDER.indexOf(b.item.group) || a.index - b.index,
        )
        .map(({ item }) => item);
    },
  };
}
