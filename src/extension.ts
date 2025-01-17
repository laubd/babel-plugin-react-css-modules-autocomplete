'use strict';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { CompletionItem } from 'vscode';

const SCHEMES = [
  { language: 'typescriptreact', scheme: 'file' },
  { language: 'javascriptreact', scheme: 'file' },
  { language: 'javascript', scheme: 'file' }
];

const QUOTES = ['"', "'", '`'];

export function getImportPaths(source: string) {
  const reg = /(import\s+|from\s+|require\(\s*)["'](.*?\.(s|pc|sc|c)ss)["']/g;
  let matched: RegExpExecArray | null;
  const paths: {
    path: string;
    position: number;
  }[] = [];
  while ((matched = reg.exec(source))) {
    paths.push({
      path: matched[2],
      position: matched.index
    });
  }
  return paths;
}

export function getAllStyleName(css: string) {
  const reg = /\.(-?[_a-zA-Z]+[_a-zA-Z0-9\-]*)([\w/:%#\$&\?\(\)~\.=\+\-]*[\s"']*?\))?/g;
  let matched: RegExpExecArray | null;
  const results: {
    styleName: string;
    position: number;
  }[] = [];
  const styleNames: string[] = [];
  while ((matched = reg.exec(css))) {
    const styleName = matched[1];
    if (matched[2] || styleNames.indexOf(styleName) !== -1) continue;
    styleNames.push(styleName);
    results.push({
      styleName,
      position: matched.index
    });
  }
  return results;
}

export function isStyleNameValue(target: string) {
  const propNamePosition = target.lastIndexOf('=');
  if (propNamePosition === -1) return false;
  return target.substr(propNamePosition - 9, 9) === 'styleName';
}

export function getNearestBeginningQuote(target: string) {
  const result = QUOTES.map(quote => ({
    position: target.lastIndexOf(quote),
    quote
  })).sort((a, b) => (a.position < b.position ? 1 : -1))[0];
  if (result.position === -1) return null;
  return result.quote;
}

export function getStyleNameAtPoint(target: string, point: number) {
  const reg = /-?[_a-zA-Z]+[_a-zA-Z0-9\-]*/g;
  let matched: RegExpExecArray | null;
  while ((matched = reg.exec(target))) {
    const styleName = matched[0];
    if (matched.index <= point && point <= matched.index + styleName.length) {
      return styleName;
    }
  }
  return null;
}

export function isInsideString(target: string, char?: string) {
  const propValuePosition = target.lastIndexOf('=');
  if (propValuePosition === -1) return false;
  const test = target.substr(propValuePosition);
  const quote = char || getNearestBeginningQuote(test);
  if (!quote) return false;
  const hits = test.split(quote).length;
  return hits >= 2 && hits % 2 === 0;
}

export function findPosition(haystack: string, needle: string): vscode.Position {
  let index = haystack.indexOf(needle);
  if (index === -1) return new vscode.Position(0, 0);
  let line = 0;
  while (index > 0) {
    const lineBreak = haystack.indexOf('\n') + 1;
    if (lineBreak === 0) break;
    haystack = haystack.substr(lineBreak);
    if (index < lineBreak) {
      break;
    } else {
      index -= lineBreak;
      line++;
    }
  }
  return new vscode.Position(line, index);
}

export async function getDefinitionsAsync(document: vscode.TextDocument) {
  return await Promise.all(
    getImportPaths(document.getText()).map(importPath =>
      new Promise<{ path: string; styleName: string; position: number }[]>(resolve => {
        const fullpath = path.resolve(path.dirname(document.uri.fsPath), importPath.path);
        const openedTextDocument = vscode.workspace.textDocuments.find(document => document.uri.fsPath === fullpath);
        const source = openedTextDocument ? openedTextDocument.getText() : fs.readFileSync(fullpath).toString('utf8');
        resolve(
          getAllStyleName(source).map(({ styleName, position }) => ({
            path: fullpath,
            styleName,
            position
          }))
        );
      }).catch(
        () =>
          [] as {
            path: string;
            styleName: string;
            position: number;
          }[]
      )
    )
  ).then(pathResults => pathResults.reduce((acc, results) => [...acc, ...results], []));
}

export async function provideCompletionItemsAsync(
  document: vscode.TextDocument,
  position: vscode.Position
): Promise<CompletionItem[]> {
  const line = document.getText(document.lineAt(position).range);
  const cursorChar = line[position.character - 1];
  if (cursorChar !== '"' && cursorChar !== "'" && cursorChar !== '`' && cursorChar !== ' ') return [];
  const target = line.substr(0, position.character);
  if (!isStyleNameValue(target) || !isInsideString(target)) return [];
  const definitions = await getDefinitionsAsync(document);
  return definitions.map(def => new CompletionItem(def.styleName, vscode.CompletionItemKind.Variable));
}

async function provideDefinition(
  document: vscode.TextDocument,
  position: vscode.Position,
  _: vscode.CancellationToken
): Promise<vscode.Location | null> {
  const line = document.getText(document.lineAt(position).range);
  const target = line.substr(0, position.character);
  if (!isStyleNameValue(target)) return null;
  const styleName = getStyleNameAtPoint(line, position.character);
  const definitions = await getDefinitionsAsync(document);
  const definition = definitions.find(def => def.styleName === styleName);
  if (!definition) return null;
  return new Promise<vscode.Location | null>(resolve =>
    fs.readFile(definition.path, (err, data) =>
      resolve(
        err
          ? null
          : new vscode.Location(
              vscode.Uri.file(definition.path),
              findPosition(data.toString('utf8'), `.${definition.styleName}`)
            )
      )
    )
  );
}

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      SCHEMES,
      {
        provideCompletionItems: provideCompletionItemsAsync
      },
      '"',
      "'",
      '`',
      ' '
    )
  );
  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(SCHEMES, {
      provideDefinition
    })
  );
}

export function deactivate() {}
