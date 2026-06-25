/**
 * ULW Interview plugin for opencode.
 *
 * Registers the bundled skills directory so opencode discovers the
 * ulw-interview skill (and its deterministic runtime) without requiring
 * manual config edits or symlinks.
 *
 * Install via opencode.json:
 *   "plugin": ["ulw-interview@git+https://github.com/DevNewbie1826/ulw-interview.git"]
 *
 * Or via CLI:
 *   opencode plugin "ulw-interview@git+https://github.com/DevNewbie1826/ulw-interview.git"
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const UlwInterviewPlugin = async () => {
  const skillsDir = path.resolve(__dirname, '../../skills');
  return {
    config: async (config) => {
      config.skills = config.skills ?? {};
      config.skills.paths = config.skills.paths ?? [];
      if (!config.skills.paths.includes(skillsDir)) {
        config.skills.paths.push(skillsDir);
      }
    },
  };
};

export default UlwInterviewPlugin;
