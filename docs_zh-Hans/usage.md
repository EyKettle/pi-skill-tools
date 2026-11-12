# 使用说明

[English](../docs/usage.md) | 中文

- [配置指南](configuration.md)

[技能 ID]: arch/tools.md#技能-id
[`skills.skillTree.enabled`]: configuration.md#配置项
[配置读取与生效]: configuration.md#配置读取与生效

## 手动管理技能加载树

| 命令 | 作用 |
| --- | --- |
| `/skill:loaded` | 查看已加载技能列表 |
| `/skill:import <id…>` | 加载 / 刷新指定技能 |
| `/skill:cancel <id…>` | 卸载已加载技能 |
| `/skill:clear` | 清空已加载技能 |

> [!TIP]
> 加载与卸载指令均支持 ID 列表。
> ID 即[技能 ID]，支持指向技能的相关文件。

[`skills.skillTree.enabled`] 为 `false` 时，上表的四个命令不注册。
修改开关后的生效步骤见[配置读取与生效]。
