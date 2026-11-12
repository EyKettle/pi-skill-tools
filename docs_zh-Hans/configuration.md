# 配置指南

[English](../docs/configuration.md) | 中文

- [使用说明](usage.md)

该插件的配置存放在 Pi 原生配置文件中，即 `{agent_dir}/settings.json` 与 `{cwd}/.pi/settings.json`。

[历史回溯功能]: arch/skill-tree.md#历史回溯
[关闭指定技能发现路径]: architecture.md#禁用特定发现路径

## 配置项

> [!IMPORTANT]
> 技能加载树的兼容性不佳。
> 如果默认情况下，AI 会在加载技能后重复阅读，请考虑关闭技能加载树。

| 条目 | 类型 | 默认 | 作用 |
| --- | --- | --- | --- |
| `skills.history.enabled` | `boolean` | `true` | [历史回溯功能]总开关 |
| `skills.registry.disable` | `string[]` | `[]` | [关闭指定技能发现路径] |
| `skills.registry.default` | `string` | `"global"` | 创建技能时的默认写入路径 |
| `skills.registry.paths` | `Record<string, { writable: boolean; path: string }>` | `{}` | 注册额外的技能发现路径 |
| `skills.skillTree.enabled` | `boolean` | `true` | 技能加载树总开关 |

示例配置文件：

```json
{
  "skills": {
    "history": {
      "enabled": true
    },
    "skillTree": {
      "enabled": true
    },
    "registry": {
      "disable": ["package", "temp"],
      "default": "extra",
      "paths": {
        "extra": {
          "writable": true,
          "path": "/path/to/skill/folder"
        },
        "borrow": {
          "writable": false,
          "path": "/path/to/another/folder"
        }
      }
    }
  }
}
```

## 配置读取与生效

两份文件按表中的配置项合并，项目文件覆盖用户文件的同一配置项。
未提供的配置项沿用另一份文件；文件缺失、不可读取或不能解析为 JSON 对象时，视为未提供配置。
加载树总开关只接受布尔值，合并后的值类型不符时使用表中的默认值。

`skills.skillTree.enabled` 在该插件实例首次会话启动时，按真实会话目录读取并固定。
插件此时完成一次初始化，按该值注册工具、命令及引导，并仅在开启时装配加载树；初始化前不注册工具与命令，也不打开加载树存储。
初始化完成后，再次会话启动、树导航与普通配置重读不改变该实例的工具、命令及引导模式。
修改开关后须重启 Pi 或执行 `/reload`，重新初始化插件。
其他配置仍在会话启动、每轮代理开始和技能管理写操作后重新读取。
