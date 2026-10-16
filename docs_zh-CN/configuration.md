# 配置指南

[English](../docs/configuration.md) | 中文

- [使用说明](usage.md)

该插件的配置存放在 Pi 原生配置文件中，即 `{agent_dir}/settings.json` 与 `{cwd}/.pi/settings.json`。

## 配置项

| 条目 | 类型 | 默认 | 作用 |
| --- | --- | --- | --- |
| `skills.history.enabled` | `boolean` | `true` | [历史回溯功能](arch/skill-tree.md#历史回溯)总开关 |
| `skills.registry.disable` | `string[]` | `[]` | 关闭 Pi 内置技能发现路径 |
| `skills.registry.default` | `string` | `"global"` | 创建技能时的默认写入路径 |
| `skills.registry.paths` | `Record<string, { writable: boolean; path: string }>` | `{}` | 注册额外的技能发现路径 |

示例配置文件：

```json
{
  "skills": {
    "history": {
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
