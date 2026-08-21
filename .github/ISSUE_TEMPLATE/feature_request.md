name: Feature request
description: Suggest a new capability or improvement
labels: [enhancement]
body:
  - type: textarea
    id: problem
    attributes:
      label: What problem does this solve?
      description: The use case or pain point — what are you trying to do that YOLO makes hard today?
    validations:
      required: true
  - type: textarea
    id: solution
    attributes:
      label: What would the ideal solution look like?
    validations:
      required: true
  - type: dropdown
    id: area
    attributes:
      label: Which area does this touch?
      options:
        - extraction (rule / LLM pull)
        - storage (SQLite / FTS / snapshots)
        - memory tools & recall
        - reminders
        - UI (dashboard / sidebar / settings)
        - docs / DX
        - other
    validations:
      required: true
  - type: textarea
    id: alternatives
    attributes:
      label: Alternatives you have considered
