name: Bug report
description: Something is broken or behaving unexpectedly
labels: [bug]
body:
  - type: textarea
    id: what-happened
    attributes:
      label: What happened?
      description: A clear description of the bug, and what you expected instead.
    validations:
      required: true
  - type: textarea
    id: repro
    attributes:
      label: Steps to reproduce
      placeholder: |
        1. Start the host with the yolo patch (`pnpm dev:web`)
        2. Say "帮我8/30前完成X"
        3. Open the YOLO tab → ...
    validations:
      required: true
  - type: textarea
    id: env
    attributes:
      label: Environment
      placeholder: |
        OS: Windows 11 / macOS 15 / Ubuntu 24.04
        Node: 22.x
        dsh-plugin-yolo: 0.1.0
        deepseek-harness: v0.1.0-rc.x
    validations:
      required: true
  - type: textarea
    id: logs
    attributes:
      label: Relevant log output
      description: Terminal output around the failure (redact anything sensitive).
      render: shell
