#!/usr/bin/env node

import { createHash, randomBytes } from 'node:crypto';
import { closeSync, existsSync, fstatSync, fsyncSync, lstatSync, linkSync, openSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RuntimeContractError, reduce } from './runtime.mjs';
import { MAX_DIRECTORY_BYTES, MAX_MARKDOWN_BYTES } from './state.mjs';

export const MAX_INPUT_BYTES = 1_048_576;

export class CliInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CliInputError';
  }
}

async function readRequest() {
  const chunks = [];
  let inputBytes = 0;
  for await (const chunk of process.stdin) {
    inputBytes += Buffer.byteLength(chunk);
    if (inputBytes > MAX_INPUT_BYTES) throw new CliInputError(`input exceeds ${MAX_INPUT_BYTES} bytes`);
    chunks.push(chunk);
  }
  const source = Buffer.concat(chunks).toString('utf8');
  try {
    const request = JSON.parse(source);
    if (typeof request !== 'object' || request === null || Array.isArray(request)) {
      throw new CliInputError('request must be a JSON object');
    }
    return request;
  } catch (error) {
    if (error instanceof CliInputError) throw error;
    throw new CliInputError(`invalid JSON: ${error.message}`);
  }
}

function specPath(directory, slug) {
  if (new TextEncoder().encode(directory).length > MAX_DIRECTORY_BYTES) {
    throw new CliInputError(`spec directory exceeds ${MAX_DIRECTORY_BYTES} bytes`);
  }
  if (typeof slug !== 'string' || slug.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new CliInputError('spec slug must be lowercase kebab-case and at most 64 characters');
  }
  if (typeof directory !== 'string' || !isAbsolute(directory)) {
    throw new CliInputError('spec directory must be absolute');
  }
  if (!existsSync(directory) || !lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()) {
    throw new CliInputError('spec directory must exist');
  }
  const path = join(directory, `${slug}.md`);
  if (existsSync(path)) throw new CliInputError('spec path already exists');
  return path;
}

function atomicallyPersist(effect) {
  if (new TextEncoder().encode(effect.markdown).length > MAX_MARKDOWN_BYTES) {
    throw new CliInputError(`markdown exceeds ${MAX_MARKDOWN_BYTES} bytes`);
  }
  const path = specPath(effect.directory, effect.slug);
  const temporaryPath = join(effect.directory, `.${effect.slug}.${process.pid}.${randomBytes(16).toString('hex')}.tmp`);
  let descriptor;
  try {
    descriptor = openSync(temporaryPath, 'wx');
    writeFileSync(descriptor, effect.markdown, 'utf8');
    fsyncSync(descriptor);
    const staged = fstatSync(descriptor);
    linkSync(temporaryPath, path);
    const published = statSync(path);
    if (published.dev !== staged.dev || published.ino !== staged.ino) {
      throw new CliInputError('temporary spec file changed before publication');
    }
    closeSync(descriptor);
    descriptor = undefined;
    unlinkSync(temporaryPath);
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
    if (error?.code === 'EEXIST') throw new CliInputError('spec path already exists');
    throw error;
  }
  return {
    type: 'persist_spec',
    path,
    sha256: createHash('sha256').update(effect.markdown, 'utf8').digest('hex'),
  };
}

export function materializeEffects(effects) {
  return effects.map((effect) => effect.type === 'persist_spec' ? atomicallyPersist(effect) : effect);
}

export async function runCli() {
  const request = await readRequest();
  const result = reduce(request.state, request.event);
  return { state: result.state, effects: materializeEffects(result.effects) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const result = await runCli();
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const message = error instanceof RuntimeContractError || error instanceof CliInputError
      ? error.message
      : 'runtime failure';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
