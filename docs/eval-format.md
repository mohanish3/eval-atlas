# Eval Set Format Reference

This document describes the format for eval set files used with the Evals Dashboard.

## Overview

An eval set is a JSON file containing an array of questions. The dashboard accepts:
- **JSON array format** (`.json`): a single file starting with `[`
- **JSONL format** (`.jsonl`): one JSON object per line (no commas between lines)

Upload the file from the New Run form. The dashboard validates the format on upload and shows an error if any item is malformed.

---

## Item Schema

Each item in the array is a JSON object with these fields:

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | Yes | Unique identifier within the eval set (e.g. `"q_001"`) |
| `question` | string | Yes | The question text shown to the model |
| `type` | `"multiple_choice"` or `"open_ended"` | Yes | Determines scoring method |
| `choices` | object | MC only | Map of letter to answer text (keys: A, B, C, D) |
| `correct_answer` | string | Yes | Letter key for MC (e.g. `"B"`); expected string for open-ended |
| `match_type` | `"exact"`, `"contains"`, or `"regex"` | Open-ended only | Defaults to `"contains"` if omitted |
| `category` | string | No | Enables per-category accuracy breakdown (e.g. `"agile"`) |

---

## Question Types

### Multiple Choice

The model receives the question and all choices. The scorer extracts the first letter (A-D) from the model's response.

**Example:**
```json
{
  "id": "q_001",
  "question": "What is the primary purpose of a PRD?",
  "type": "multiple_choice",
  "choices": {
    "A": "To track bugs",
    "B": "To describe what a product should do and why",
    "C": "To manage the sprint backlog",
    "D": "To document sales performance"
  },
  "correct_answer": "B",
  "category": "product-management"
}
```

**Scoring:** The scorer extracts the first letter A-D from the model's response. It handles:
- Bare letter: `"B"` → pass
- Letter with punctuation: `"B."` → pass
- Letter in sentence: `"The answer is B because..."` → pass
- Wrong letter: `"A"` → fail

---

### Open Ended

The model receives the question with no choices. The scorer compares the model's response to `correct_answer` using the `match_type` strategy.

**Match types:**

| `match_type` | Behaviour | Use when |
|---|---|---|
| `"contains"` (default) | `correct_answer` appears anywhere in model output (case-insensitive) | Key term must be present |
| `"exact"` | Model output equals `correct_answer` exactly (case-insensitive, trimmed) | Precise numeric or one-word answers |
| `"regex"` | `correct_answer` is a regex pattern tested against model output | Flexible pattern matching |

**Example (contains):**
```json
{
  "id": "q_002",
  "question": "What does MVP stand for and why do teams build one?",
  "type": "open_ended",
  "correct_answer": "minimum viable product",
  "match_type": "contains",
  "category": "product-management"
}
```

**Example (regex):**
```json
{
  "id": "q_003",
  "question": "What year was the Agile Manifesto published?",
  "type": "open_ended",
  "correct_answer": "2001",
  "match_type": "exact"
}
```

---

## Full Example File

The repo includes a working sample at `docs/sample-eval-set.json` with 20 questions across three categories: `product-management`, `agile`, and `general-reasoning`. Upload it directly from the New Run form to test the dashboard.

---

## Creating Your Own Eval Set with a Coding Agent

You can use Claude, Copilot, or any coding assistant to convert your existing question bank into this format. Give it this prompt:

```
Convert the following questions into a JSON array matching this schema exactly:
{
  "id": "unique_string",
  "question": "question text",
  "type": "multiple_choice" | "open_ended",
  "choices": { "A": "...", "B": "...", "C": "...", "D": "..." },  // MC only
  "correct_answer": "letter_for_MC_or_expected_string_for_open_ended",
  "match_type": "exact" | "contains" | "regex",  // open-ended only, default contains
  "category": "optional_category_string"
}

Rules:
- Every item must have id, question, type, correct_answer
- Multiple choice items must have choices (A-D keys) and correct_answer must be a letter A, B, C, or D
- Open-ended items must NOT have a choices field
- IDs must be unique strings
- Output valid JSON (parseable by JSON.parse)

Questions:
[paste your questions here]
```

---

## Validation Errors

If the dashboard rejects your file, check these common mistakes:

| Error | Fix |
|---|---|
| `"id" field missing` | Every item needs a unique `id` string |
| `"type" must be 'multiple_choice' or 'open_ended'` | Check for typos in the `type` field |
| `"choices" required for multiple_choice` | Add an A/B/C/D choices object |
| `"correct_answer" must be at least 1 character` | correct_answer cannot be empty |
| `"match_type" invalid` | Use `"exact"`, `"contains"`, or `"regex"` only |
| JSON parse error | Run your file through `JSON.parse()` in the browser console to find the syntax error |

---

## Tips for Better Evals

1. **Keep multiple-choice distractors plausible.** If the wrong answers are obviously wrong, every model passes and you learn nothing about quality differences.

2. **For open-ended, pick a specific key term** as `correct_answer` rather than a full sentence. Example: use `"velocity"` not `"Velocity is the number of story points completed per sprint"` — the latter is too strict and will fail correct responses that are worded differently.

3. **Use categories.** The dashboard shows per-category accuracy breakdown only when categories are present. If all questions are in one category or have no category, you only see overall accuracy.

4. **Start small.** A 10-question eval set that runs in 30 seconds is more useful for iteration than a 200-question set that takes 20 minutes. Add more questions once you've confirmed the models are being tested correctly.

5. **Test your regex patterns.** Before uploading, verify regex patterns with a quick browser console check: `new RegExp("your_pattern", "i").test("sample model output")`.
