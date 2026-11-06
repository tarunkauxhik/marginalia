export function starterQuestions(paths: string[]): string[] {
  const questions: string[] = [];
  const has = (pattern: RegExp) => paths.some((path) => pattern.test(path));

  if (has(/(^|\/)readme(\.|$)/i)) {
    questions.push("What is this repository for, according to its README?");
  }
  if (has(/(^|\/)package\.json$/i)) {
    questions.push("How does the project start, and which files define the main entry points?");
  }
  if (has(/(^|\/)pyproject\.toml$/i) || has(/(^|\/)setup\.py$/i)) {
    questions.push("Where is the public Python API, and how is the package laid out?");
  }
  if (has(/(^|\/)go\.mod$/i)) {
    questions.push("Where does the Go program start, and which packages does it call?");
  }
  if (has(/(^|\/)cargo\.toml$/i)) {
    questions.push("What does the crate expose, and where is the library or binary entry?");
  }
  questions.push("Which files should I read first to understand the layout?");
  questions.push("What are the main modules, and how do they depend on each other?");

  const unique: string[] = [];
  for (const question of questions) {
    if (!unique.includes(question)) unique.push(question);
  }
  return unique.slice(0, 4);
}
