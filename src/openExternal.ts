import { execFile } from 'node:child_process';

/** Open a URL or file with the platform default application when supported. */
export function openExternal(target: string): Promise<void> {
  return new Promise<void>((resolve) => {
    if (process.platform !== 'darwin') {
      resolve();
      return;
    }

    execFile('open', [target], () => resolve());
  });
}
