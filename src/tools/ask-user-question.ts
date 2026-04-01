import readline from "node:readline";
import type { ToolResult } from "../types.js";
import type { ToolExecutionOptions } from "./index.js";

type QuestionOption = {
  label: string;
  description?: string;
};

type Question = {
  header?: string;
  question: string;
  options: QuestionOption[];
  multi_select?: boolean;
};

function promptUser(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer));
  });
}

function renderQuestion(question: Question, index: number): void {
  const heading = question.header ? `${question.header}: ${question.question}` : question.question;
  process.stderr.write(`\n[Question ${index + 1}] ${heading}\n`);
  question.options.forEach((option, optionIndex) => {
    const details = option.description ? ` — ${option.description}` : "";
    process.stderr.write(`  ${optionIndex + 1}. ${option.label}${details}\n`);
  });
  process.stderr.write(`  ${question.options.length + 1}. Other\n`);
}

function parseSelection(input: string, max: number, multiSelect: boolean): number[] | null {
  const parts = (multiSelect ? input.split(",") : [input])
    .map((part) => parseInt(part.trim(), 10))
    .filter((value) => !Number.isNaN(value));

  if (parts.length === 0) return null;
  if (parts.some((value) => value < 1 || value > max)) return null;
  return [...new Set(parts)];
}

export async function executeAskUserQuestion(args: {
  questions: Question[];
}, _projectCwd: string, _options: ToolExecutionOptions): Promise<ToolResult> {
  const questions = Array.isArray(args.questions) ? args.questions : [];
  if (questions.length === 0) {
    return { output: "ask_user_question requires at least one question.", error: true };
  }
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    return {
      output: "ask_user_question requires an interactive terminal.",
      error: true,
    };
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });

  try {
    const answers: string[] = [];

    for (let i = 0; i < questions.length; i++) {
      const question = questions[i]!;
      if (!question.question || !Array.isArray(question.options) || question.options.length < 2) {
        return {
          output: `Invalid question at index ${i}. Each question needs text and at least two options.`,
          error: true,
        };
      }

      renderQuestion(question, i);
      const selectionPrompt = question.multi_select
        ? "Choose one or more options (comma-separated): "
        : "Choose one option: ";

      let selectedLabels: string[] | null = null;
      while (!selectedLabels) {
        const answer = (await promptUser(rl, selectionPrompt)).trim();
        const selected = parseSelection(
          answer || "1",
          question.options.length + 1,
          !!question.multi_select,
        );
        if (!selected) {
          process.stderr.write("Invalid selection. Try again.\n");
          continue;
        }

        const labels: string[] = [];
        let invalid = false;
        for (const value of selected) {
          if (value === question.options.length + 1) {
            const other = (await promptUser(rl, "Other: ")).trim();
            if (!other) {
              process.stderr.write("Custom answer cannot be empty.\n");
              invalid = true;
              break;
            }
            labels.push(other);
            continue;
          }
          labels.push(question.options[value - 1]!.label);
        }

        if (!invalid) {
          selectedLabels = labels;
        }
      }

      answers.push(`- ${question.question} => ${selectedLabels.join(", ")}`);
    }

    return {
      output: `User answered your questions:\n${answers.join("\n")}`,
    };
  } finally {
    rl.close();
  }
}
