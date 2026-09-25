// 8 distinct colors. Color is derived deterministically from the project
// name so the same project always gets the same color across Timeline and
// ProjectCards, and across sessions. Never use random colours for projects
// — see AGENTS.md's "Project color palette" fact.
export const PROJECT_COLOR_PALETTE: string[] = [
  "#E8A87C", // warm orange
  "#85C1E9", // soft blue
  "#82E0AA", // sage green
  "#F1948A", // coral
  "#BB8FCE", // lavender
  "#F8C471", // amber
  "#76D7C4", // teal
  "#AEB6BF", // neutral slate
];

export function getProjectColor(projectName: string | null): string {
  if (!projectName) return PROJECT_COLOR_PALETTE[7];
  let hash = 0;
  for (let i = 0; i < projectName.length; i++) {
    hash = projectName.charCodeAt(i) + ((hash << 5) - hash);
    hash |= 0;
  }
  return PROJECT_COLOR_PALETTE[Math.abs(hash) % PROJECT_COLOR_PALETTE.length];
}
