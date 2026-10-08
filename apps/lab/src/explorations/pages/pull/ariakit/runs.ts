/** The GitHub address of a pull request, for the links that leave the app. */
export function getPullUrl(repository: string, number: number): string {
  return `https://github.com/${repository}/pull/${number}`;
}

/** The workflow list of the repository, where a failed capture is rerun. */
export function getWorkflowUrl(repository: string): string {
  return `https://github.com/${repository}/actions`;
}
