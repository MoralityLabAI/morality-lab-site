import { el, clear } from '../dom';
import { Storyworld } from '../../Storyworld';
import { ScriptManager } from '../../ScriptManager';
import { BNumberConstant } from '../../BNumberConstant';
import { BNumberPointer } from '../../BNumberPointer';
import { ArithmeticNegationOperator } from '../../ArithmeticNegationOperator';
import { ProximityOperator } from '../../ProximityOperator';
import { AverageOperator } from '../../AverageOperator';
import { BlendOperator } from '../../BlendOperator';
import { MaximumOperator } from '../../MaximumOperator';
import { MinimumOperator } from '../../MinimumOperator';
import { NudgeOperator } from '../../NudgeOperator';
import { IfThenOperator } from '../../IfThenOperator';
import {
  BoolNode,
  ScriptNode,
  createDefaultBoolNode,
  createDefaultScriptNode,
  serializeScript,
  deserializeScript,
} from '../../scriptAst';

interface ModalOptions {
  storyworld: Storyworld;
  mode?: 'script' | 'bool';
  initialScript?: ScriptManager | null;
  initialAst?: ScriptNode | null;
  initialBoolAst?: BoolNode | null;
  onConfirm?: (script: ScriptManager, ast: ScriptNode) => void;
  onConfirmBool?: (ast: BoolNode) => void;
}

const scriptPaletteItems: ScriptNode['type'][] = [
  'Constant',
  'BNumberProperty',
  'ArithmeticNegation',
  'Proximity',
  'Average',
  'Blend',
  'Maximum',
  'Minimum',
  'Nudge',
  'IfThen',
];

const boolPaletteItems: BoolNode['type'][] = [
  'Constant',
  'SpoolActive',
];

const nodeLabels: Record<ScriptNode['type'], string> = {
  Constant: 'Constant',
  BNumberProperty: 'BNumber Property',
  ArithmeticNegation: 'Arithmetic Negation',
  Proximity: 'Proximity',
  Average: 'Average',
  Blend: 'Blend',
  Maximum: 'Maximum',
  Minimum: 'Minimum',
  Nudge: 'Nudge',
  IfThen: 'If Then',
};

function createNode(type: ScriptNode['type'], storyworld: Storyworld): ScriptNode {
  if (type === 'Constant') {
    return { type: 'Constant', value: 0 };
  }
  if (type === 'BNumberProperty') {
    const character = storyworld.characters[0];
    const property = storyworld.authored_properties[0];
    return {
      type: 'BNumberProperty',
      characterId: character?.id ?? '',
      propertyId: property?.id ?? '',
      perceivedCharacterId: '',
      perceivedCharacterId2: '',
    };
  }
  if (type === 'ArithmeticNegation') {
    return { type: 'ArithmeticNegation', child: createDefaultScriptNode() };
  }
  if (type === 'Proximity') {
    return { type: 'Proximity', left: createDefaultScriptNode(), right: createDefaultScriptNode() };
  }
  if (type === 'Average') {
    return { type: 'Average', left: createDefaultScriptNode(), right: createDefaultScriptNode() };
  }
  if (type === 'Blend') {
    return {
      type: 'Blend',
      left: createDefaultScriptNode(),
      right: createDefaultScriptNode(),
      weight: createDefaultScriptNode(),
    };
  }
  if (type === 'Maximum') {
    return { type: 'Maximum', left: createDefaultScriptNode(), right: createDefaultScriptNode() };
  }
  if (type === 'Minimum') {
    return { type: 'Minimum', left: createDefaultScriptNode(), right: createDefaultScriptNode() };
  }
  if (type === 'Nudge') {
    return { type: 'Nudge', base: createDefaultScriptNode(), nudge: createDefaultScriptNode() };
  }
  return {
    type: 'IfThen',
    condition: createDefaultBoolNode(),
    thenNode: createDefaultScriptNode(),
    elseNode: createDefaultScriptNode(),
  };
}

function astFromScript(script: ScriptManager | null, storyworld: Storyworld): ScriptNode {
  const existing = (script as any)?.ast_json;
  if (existing) {
    return deserializeScript(existing);
  }
  const root = script?.script_elements?.[0];
  if (!root) {
    return createDefaultScriptNode();
  }
  return convertElementToNode(root, storyworld);
}

function convertElementToNode(element: any, storyworld: Storyworld): ScriptNode {
  if (element instanceof BNumberConstant) {
    return { type: 'Constant', value: element.get_value() };
  }
  if (element instanceof BNumberPointer) {
    const propertyId = element.keyring[0] ?? '';
    const characterId = element.character?.id ?? '';
    const perceivedCharacterId = element.keyring.length > 1 ? element.keyring[1] ?? '' : '';
    const perceivedCharacterId2 = element.keyring.length > 2 ? element.keyring[2] ?? '' : '';
    return { type: 'BNumberProperty', characterId, propertyId, perceivedCharacterId, perceivedCharacterId2 };
  }
  if (element instanceof ArithmeticNegationOperator) {
    const child = element.operands[0]
      ? convertElementToNode(element.operands[0], storyworld)
      : createDefaultScriptNode();
    return { type: 'ArithmeticNegation', child };
  }
  if (element instanceof ProximityOperator) {
    const left = element.operands[0]
      ? convertElementToNode(element.operands[0], storyworld)
      : createDefaultScriptNode();
    const right = element.operands[1]
      ? convertElementToNode(element.operands[1], storyworld)
      : createDefaultScriptNode();
    return { type: 'Proximity', left, right };
  }
  if (element instanceof AverageOperator) {
    const left = element.operands[0]
      ? convertElementToNode(element.operands[0], storyworld)
      : createDefaultScriptNode();
    const right = element.operands[1]
      ? convertElementToNode(element.operands[1], storyworld)
      : createDefaultScriptNode();
    return { type: 'Average', left, right };
  }
  if (element instanceof BlendOperator) {
    const left = element.operands[0]
      ? convertElementToNode(element.operands[0], storyworld)
      : createDefaultScriptNode();
    const right = element.operands[1]
      ? convertElementToNode(element.operands[1], storyworld)
      : createDefaultScriptNode();
    const weight = element.operands[2]
      ? convertElementToNode(element.operands[2], storyworld)
      : createDefaultScriptNode();
    return { type: 'Blend', left, right, weight };
  }
  if (element instanceof MaximumOperator) {
    const left = element.operands[0]
      ? convertElementToNode(element.operands[0], storyworld)
      : createDefaultScriptNode();
    const right = element.operands[1]
      ? convertElementToNode(element.operands[1], storyworld)
      : createDefaultScriptNode();
    return { type: 'Maximum', left, right };
  }
  if (element instanceof MinimumOperator) {
    const left = element.operands[0]
      ? convertElementToNode(element.operands[0], storyworld)
      : createDefaultScriptNode();
    const right = element.operands[1]
      ? convertElementToNode(element.operands[1], storyworld)
      : createDefaultScriptNode();
    return { type: 'Minimum', left, right };
  }
  if (element instanceof NudgeOperator) {
    const base = element.operands[0]
      ? convertElementToNode(element.operands[0], storyworld)
      : createDefaultScriptNode();
    const nudge = element.operands[1]
      ? convertElementToNode(element.operands[1], storyworld)
      : createDefaultScriptNode();
    return { type: 'Nudge', base, nudge };
  }
  if (element instanceof IfThenOperator) {
    const condition = element.condition
      ? convertBoolToNode(element.condition, storyworld)
      : createDefaultBoolNode();
    const thenNode = element.then_script
      ? convertElementToNode(element.then_script, storyworld)
      : createDefaultScriptNode();
    const elseNode = element.else_script
      ? convertElementToNode(element.else_script, storyworld)
      : createDefaultScriptNode();
    return { type: 'IfThen', condition, thenNode, elseNode };
  }
  return createDefaultScriptNode();
}

function scriptFromAst(ast: ScriptNode, storyworld: Storyworld): ScriptManager {
  const script = new ScriptManager();
  script.add_script_element(convertNodeToElement(ast, storyworld));
  (script as any).ast_json = serializeScript(ast);
  return script;
}

function convertNodeToElement(node: ScriptNode, storyworld: Storyworld): any {
  if (node.type === 'Constant') {
    return new BNumberConstant(node.value);
  }
  if (node.type === 'BNumberProperty') {
    const actor = storyworld.character_directory.get(node.characterId) ?? null;
    const keyring = [node.propertyId];
    if (node.perceivedCharacterId) {
      keyring.push(node.perceivedCharacterId);
    }
    if (node.perceivedCharacterId2) {
      keyring.push(node.perceivedCharacterId2);
    }
    return new BNumberPointer(actor, keyring);
  }
  if (node.type === 'ArithmeticNegation') {
    return new ArithmeticNegationOperator(convertNodeToElement(node.child, storyworld));
  }
  if (node.type === 'Proximity') {
    return new ProximityOperator(
      convertNodeToElement(node.left, storyworld),
      convertNodeToElement(node.right, storyworld)
    );
  }
  if (node.type === 'Average') {
    return new AverageOperator(
      convertNodeToElement(node.left, storyworld),
      convertNodeToElement(node.right, storyworld)
    );
  }
  if (node.type === 'Blend') {
    return new BlendOperator(
      convertNodeToElement(node.left, storyworld),
      convertNodeToElement(node.right, storyworld),
      convertNodeToElement(node.weight, storyworld)
    );
  }
  if (node.type === 'Maximum') {
    return new MaximumOperator(
      convertNodeToElement(node.left, storyworld),
      convertNodeToElement(node.right, storyworld)
    );
  }
  if (node.type === 'Minimum') {
    return new MinimumOperator(
      convertNodeToElement(node.left, storyworld),
      convertNodeToElement(node.right, storyworld)
    );
  }
  if (node.type === 'Nudge') {
    return new NudgeOperator(
      convertNodeToElement(node.base, storyworld),
      convertNodeToElement(node.nudge, storyworld)
    );
  }
  return new IfThenOperator(
    convertBoolToElement(node.condition, storyworld),
    convertNodeToElement(node.thenNode, storyworld),
    convertNodeToElement(node.elseNode, storyworld)
  );
}

function convertBoolToElement(node: BoolNode, storyworld: Storyworld): any {
  if (node.type === 'Constant') {
    return { type: 'Constant', value: node.value };
  }
  return { type: 'SpoolActive', spoolId: node.spoolId, storyworld };
}

function convertBoolToNode(node: any, storyworld: Storyworld): BoolNode {
  if (node?.type === 'Constant') {
    return { type: 'Constant', value: Boolean(node.value) };
  }
  if (node?.type === 'SpoolActive') {
    return { type: 'SpoolActive', spoolId: node.spoolId ?? '' };
  }
  const spool = storyworld.spools[0];
  return { type: 'SpoolActive', spoolId: spool?.id ?? '' };
}

function getNodeLabel(node: ScriptNode, storyworld: Storyworld): string {
  if (node.type === 'Constant') {
    return `Constant (${node.value.toFixed(2)})`;
  }
  if (node.type === 'BNumberProperty') {
    const character = storyworld.character_directory.get(node.characterId);
    const property = storyworld.authored_properties.find((prop) => prop.id === node.propertyId);
    const characterName = character?.char_name || 'Unknown';
    const propertyName = property?.property_name || 'Property';
    if (node.perceivedCharacterId) {
      const perceived = storyworld.character_directory.get(node.perceivedCharacterId);
      const perceivedName = perceived?.char_name || 'Unknown';
      if (node.perceivedCharacterId2) {
        const perceived2 = storyworld.character_directory.get(node.perceivedCharacterId2);
        const perceivedName2 = perceived2?.char_name || 'Unknown';
        return `${characterName} [${propertyName} -> ${perceivedName} -> ${perceivedName2}]`;
      }
      return `${characterName} [${propertyName} -> ${perceivedName}]`;
    }
    return `${characterName} [${propertyName}]`;
  }
  if (node.type === 'IfThen') {
    return 'If Then';
  }
  return nodeLabels[node.type];
}

type SelectedNode = { kind: 'script'; node: ScriptNode } | { kind: 'bool'; node: BoolNode };

function getNodeByPath(root: ScriptNode, path: string[]): SelectedNode {
  let current: ScriptNode | BoolNode = root;
  let kind: 'script' | 'bool' = 'script';
  for (const key of path) {
    if (kind === 'script' && (current as ScriptNode).type === 'ArithmeticNegation' && key === 'child') {
      current = (current as ScriptNode).child;
    } else if (kind === 'script' && (current as ScriptNode).type === 'Proximity' && key === 'left') {
      current = (current as ScriptNode).left;
    } else if (kind === 'script' && (current as ScriptNode).type === 'Proximity' && key === 'right') {
      current = (current as ScriptNode).right;
    } else if (kind === 'script' && (current as ScriptNode).type === 'Average' && key === 'left') {
      current = (current as ScriptNode).left;
    } else if (kind === 'script' && (current as ScriptNode).type === 'Average' && key === 'right') {
      current = (current as ScriptNode).right;
    } else if (kind === 'script' && (current as ScriptNode).type === 'Blend' && key === 'left') {
      current = (current as ScriptNode).left;
    } else if (kind === 'script' && (current as ScriptNode).type === 'Blend' && key === 'right') {
      current = (current as ScriptNode).right;
    } else if (kind === 'script' && (current as ScriptNode).type === 'Blend' && key === 'weight') {
      current = (current as ScriptNode).weight;
    } else if (kind === 'script' && (current as ScriptNode).type === 'Maximum' && key === 'left') {
      current = (current as ScriptNode).left;
    } else if (kind === 'script' && (current as ScriptNode).type === 'Maximum' && key === 'right') {
      current = (current as ScriptNode).right;
    } else if (kind === 'script' && (current as ScriptNode).type === 'Minimum' && key === 'left') {
      current = (current as ScriptNode).left;
    } else if (kind === 'script' && (current as ScriptNode).type === 'Minimum' && key === 'right') {
      current = (current as ScriptNode).right;
    } else if (kind === 'script' && (current as ScriptNode).type === 'Nudge' && key === 'base') {
      current = (current as ScriptNode).base;
    } else if (kind === 'script' && (current as ScriptNode).type === 'Nudge' && key === 'nudge') {
      current = (current as ScriptNode).nudge;
    } else if (kind === 'script' && (current as ScriptNode).type === 'IfThen' && key === 'condition') {
      current = (current as ScriptNode).condition;
      kind = 'bool';
    } else if (kind === 'script' && (current as ScriptNode).type === 'IfThen' && key === 'thenNode') {
      current = (current as ScriptNode).thenNode;
    } else if (kind === 'script' && (current as ScriptNode).type === 'IfThen' && key === 'elseNode') {
      current = (current as ScriptNode).elseNode;
    }
  }
  return { kind, node: current as any };
}

function replaceNodeByPath(root: ScriptNode, path: string[], next: ScriptNode | BoolNode): ScriptNode {
  if (path.length === 0) {
    return next as ScriptNode;
  }
  const [key, ...rest] = path;
  if (root.type === 'ArithmeticNegation' && key === 'child') {
    return { ...root, child: replaceNodeByPath(root.child, rest, next) };
  }
  if (root.type === 'Proximity' && key === 'left') {
    return { ...root, left: replaceNodeByPath(root.left, rest, next) };
  }
  if (root.type === 'Proximity' && key === 'right') {
    return { ...root, right: replaceNodeByPath(root.right, rest, next) };
  }
  if (root.type === 'Average' && key === 'left') {
    return { ...root, left: replaceNodeByPath(root.left, rest, next) };
  }
  if (root.type === 'Average' && key === 'right') {
    return { ...root, right: replaceNodeByPath(root.right, rest, next) };
  }
  if (root.type === 'Blend' && key === 'left') {
    return { ...root, left: replaceNodeByPath(root.left, rest, next) };
  }
  if (root.type === 'Blend' && key === 'right') {
    return { ...root, right: replaceNodeByPath(root.right, rest, next) };
  }
  if (root.type === 'Blend' && key === 'weight') {
    return { ...root, weight: replaceNodeByPath(root.weight, rest, next) };
  }
  if (root.type === 'Maximum' && key === 'left') {
    return { ...root, left: replaceNodeByPath(root.left, rest, next) };
  }
  if (root.type === 'Maximum' && key === 'right') {
    return { ...root, right: replaceNodeByPath(root.right, rest, next) };
  }
  if (root.type === 'Minimum' && key === 'left') {
    return { ...root, left: replaceNodeByPath(root.left, rest, next) };
  }
  if (root.type === 'Minimum' && key === 'right') {
    return { ...root, right: replaceNodeByPath(root.right, rest, next) };
  }
  if (root.type === 'Nudge' && key === 'base') {
    return { ...root, base: replaceNodeByPath(root.base, rest, next) };
  }
  if (root.type === 'Nudge' && key === 'nudge') {
    return { ...root, nudge: replaceNodeByPath(root.nudge, rest, next) };
  }
  if (root.type === 'IfThen' && key === 'condition') {
    return { ...root, condition: next as BoolNode };
  }
  if (root.type === 'IfThen' && key === 'thenNode') {
    return { ...root, thenNode: replaceNodeByPath(root.thenNode, rest, next) };
  }
  if (root.type === 'IfThen' && key === 'elseNode') {
    return { ...root, elseNode: replaceNodeByPath(root.elseNode, rest, next) };
  }
  return root;
}

export function openScriptModal(options: ModalOptions): void {
  const { storyworld } = options;
  const rootMode = options.mode ?? 'script';
  let ast = rootMode === 'script'
    ? (options.initialAst ?? astFromScript(options.initialScript ?? null, storyworld))
    : createDefaultScriptNode();
  let boolRoot = rootMode === 'bool'
    ? (options.initialBoolAst ?? createDefaultBoolNode())
    : createDefaultBoolNode();
  let selectedPath: string[] = [];

  const overlay = el('div', { className: 'sw-modal-overlay' });
  const modal = el('div', { className: 'sw-modal' });
  const header = el('div', { className: 'sw-modal-header', text: 'Script Editor' });
  const body = el('div', { className: 'sw-modal-body' });
  const treePane = el('div', { className: 'sw-modal-pane sw-tree-pane' });
  const palettePane = el('div', { className: 'sw-modal-pane sw-palette-pane' });
  const footer = el('div', { className: 'sw-modal-footer' });
  const okButton = el('button', { text: 'OK' });
  const cancelButton = el('button', { text: 'Cancel' });
  footer.append(okButton, cancelButton);

  const renderTree = () => {
    clear(treePane);
    const list = el('ul', { className: 'sw-tree' });
    const renderNode = (node: ScriptNode | BoolNode, path: string[], kind: 'script' | 'bool') => {
      const li = el('li', { className: 'sw-tree-node' });
      const labelText = kind === 'script'
        ? getNodeLabel(node as ScriptNode, storyworld)
        : (node.type === 'SpoolActive' ? 'Spool Active' : `Bool Constant (${(node as BoolNode).value})`);
      const label = el('div', { className: 'sw-tree-label', text: labelText });
      if (path.join('.') === selectedPath.join('.')) {
        label.classList.add('selected');
      }
      label.addEventListener('click', () => {
        selectedPath = path;
        render();
      });
      li.appendChild(label);
      const children: { node: ScriptNode | BoolNode; key: string; kind: 'script' | 'bool' }[] = [];
      if (kind === 'script') {
        const scriptNode = node as ScriptNode;
        if (scriptNode.type === 'ArithmeticNegation') {
          children.push({ node: scriptNode.child, key: 'child', kind: 'script' });
        } else if (scriptNode.type === 'Proximity' || scriptNode.type === 'Average' || scriptNode.type === 'Maximum' || scriptNode.type === 'Minimum') {
          children.push({ node: scriptNode.left, key: 'left', kind: 'script' });
          children.push({ node: scriptNode.right, key: 'right', kind: 'script' });
        } else if (scriptNode.type === 'Blend') {
          children.push({ node: scriptNode.left, key: 'left', kind: 'script' });
          children.push({ node: scriptNode.right, key: 'right', kind: 'script' });
          children.push({ node: scriptNode.weight, key: 'weight', kind: 'script' });
        } else if (scriptNode.type === 'Nudge') {
          children.push({ node: scriptNode.base, key: 'base', kind: 'script' });
          children.push({ node: scriptNode.nudge, key: 'nudge', kind: 'script' });
        } else if (scriptNode.type === 'IfThen') {
          children.push({ node: scriptNode.condition, key: 'condition', kind: 'bool' });
          children.push({ node: scriptNode.thenNode, key: 'thenNode', kind: 'script' });
          children.push({ node: scriptNode.elseNode, key: 'elseNode', kind: 'script' });
        }
      }
      if (children.length > 0) {
        const childList = el('ul', { className: 'sw-tree' });
        for (const child of children) {
          childList.appendChild(renderNode(child.node, [...path, child.key], child.kind));
        }
        li.appendChild(childList);
      }
      return li;
    };
    if (rootMode === 'script') {
      list.appendChild(renderNode(ast, [], 'script'));
    } else {
      list.appendChild(renderNode(boolRoot, [], 'bool'));
    }
    treePane.appendChild(list);
  };

  const renderPalette = () => {
    clear(palettePane);
    const palette = el('div', { className: 'sw-palette' });
    const title = el('div', { className: 'sw-section-header', text: 'Operators' });
    palette.appendChild(title);
    const selection = rootMode === 'script'
      ? getNodeByPath(ast, selectedPath)
      : { kind: 'bool', node: boolRoot };
    if (selection.kind === 'script') {
      scriptPaletteItems.forEach((item) => {
        const button = el('button', { text: nodeLabels[item] });
        button.addEventListener('click', () => {
          const next = createNode(item, storyworld);
          ast = replaceNodeByPath(ast, selectedPath, next);
          render();
        });
        palette.appendChild(button);
      });
    } else {
      boolPaletteItems.forEach((item) => {
        const button = el('button', { text: item === 'Constant' ? 'Constant' : 'Spool Active' });
        button.addEventListener('click', () => {
          const next: BoolNode =
            item === 'Constant'
              ? { type: 'Constant', value: false }
              : { type: 'SpoolActive', spoolId: storyworld.spools[0]?.id ?? '' };
          if (rootMode === 'bool') {
            boolRoot = next;
          } else {
            ast = replaceNodeByPath(ast, selectedPath, next);
          }
          render();
        });
        palette.appendChild(button);
      });
    }

    const inspector = el('div', { className: 'sw-inspector' });
    if (selection.kind === 'script') {
      const selectedNode = selection.node;
      if (selectedNode.type === 'Constant') {
        const slider = el('input', { attrs: { type: 'range', min: '0', max: '1', step: '0.01' } }) as HTMLInputElement;
        const input = el('input', { attrs: { type: 'number', min: '0', max: '1', step: '0.01' } }) as HTMLInputElement;
        slider.value = String(selectedNode.value);
        input.value = String(selectedNode.value);
        const updateValue = (value: string) => {
          const numeric = Number(value);
          ast = replaceNodeByPath(ast, selectedPath, { ...selectedNode, value: numeric });
          slider.value = String(numeric);
          input.value = String(numeric);
          renderTree();
        };
        slider.addEventListener('input', () => updateValue(slider.value));
        input.addEventListener('input', () => updateValue(input.value));
        inspector.append(el('div', { className: 'sw-section-header', text: 'Constant' }), slider, input);
      } else if (selectedNode.type === 'BNumberProperty') {
        const characterSelect = el('select') as HTMLSelectElement;
        const propertySelect = el('select') as HTMLSelectElement;
        const perceivedSelect = el('select') as HTMLSelectElement;
        const perceivedSelect2 = el('select') as HTMLSelectElement;
        const perceivedHelp = el('div', { className: 'sw-help-text' });
        for (const character of storyworld.characters) {
          const opt = el('option', { text: character.char_name || character.id, attrs: { value: character.id } }) as HTMLOptionElement;
          if (character.id === selectedNode.characterId) opt.selected = true;
          characterSelect.appendChild(opt);
        }
        for (const prop of storyworld.authored_properties) {
          const opt = el('option', { text: prop.property_name || prop.id, attrs: { value: prop.id } }) as HTMLOptionElement;
          if (prop.id === selectedNode.propertyId) opt.selected = true;
          propertySelect.appendChild(opt);
        }
        const populatePerceivedOptions = (selectEl: HTMLSelectElement, selectedId: string) => {
          while (selectEl.firstChild) selectEl.removeChild(selectEl.firstChild);
          const noneOpt = el('option', { text: 'None', attrs: { value: '' } }) as HTMLOptionElement;
          if (!selectedId) noneOpt.selected = true;
          selectEl.appendChild(noneOpt);
          for (const character of storyworld.characters) {
            const opt = el('option', { text: character.char_name || character.id, attrs: { value: character.id } }) as HTMLOptionElement;
            if (character.id === selectedId) opt.selected = true;
            selectEl.appendChild(opt);
          }
        };
        const syncPerceivedAvailability = () => {
          const property = storyworld.authored_properties.find((prop) => prop.id === propertySelect.value);
          const depth = property?.depth ?? 0;
          const p1Enabled = depth >= 1;
          const p2Enabled = depth >= 2;
          perceivedSelect.disabled = !p1Enabled;
          perceivedSelect2.disabled = !p2Enabled;
          perceivedHelp.textContent = !p1Enabled
            ? 'pValues unavailable (property depth is 0).'
            : p2Enabled
              ? 'pValues and p2 available for this property.'
              : 'pValues available for this property.';
          if (!p1Enabled && selectedNode.perceivedCharacterId) {
            ast = replaceNodeByPath(ast, selectedPath, { ...selectedNode, perceivedCharacterId: '', perceivedCharacterId2: '' });
            renderTree();
          } else if (!p2Enabled && selectedNode.perceivedCharacterId2) {
            ast = replaceNodeByPath(ast, selectedPath, { ...selectedNode, perceivedCharacterId2: '' });
            renderTree();
          }
        };
        populatePerceivedOptions(perceivedSelect, selectedNode.perceivedCharacterId ?? '');
        populatePerceivedOptions(perceivedSelect2, selectedNode.perceivedCharacterId2 ?? '');
        syncPerceivedAvailability();
        characterSelect.addEventListener('change', () => {
          ast = replaceNodeByPath(ast, selectedPath, { ...selectedNode, characterId: characterSelect.value });
          renderTree();
        });
        propertySelect.addEventListener('change', () => {
          ast = replaceNodeByPath(ast, selectedPath, { ...selectedNode, propertyId: propertySelect.value });
          syncPerceivedAvailability();
          renderTree();
        });
        perceivedSelect.addEventListener('change', () => {
          ast = replaceNodeByPath(ast, selectedPath, { ...selectedNode, perceivedCharacterId: perceivedSelect.value });
          renderTree();
        });
        perceivedSelect2.addEventListener('change', () => {
          ast = replaceNodeByPath(ast, selectedPath, { ...selectedNode, perceivedCharacterId2: perceivedSelect2.value });
          renderTree();
        });
        inspector.append(
          el('div', { className: 'sw-section-header', text: 'BNumber Property' }),
          el('label', { text: 'Character' }),
          characterSelect,
          el('label', { text: 'Property' }),
          propertySelect,
          el('label', { text: 'Perceived Character' }),
          perceivedSelect,
          el('label', { text: 'Perceived Character 2' }),
          perceivedSelect2,
          perceivedHelp
        );
      } else {
        inspector.append(el('div', { className: 'sw-section-header', text: nodeLabels[selectedNode.type] }));
      }
    } else {
      const selectedNode = selection.node;
      if (selectedNode.type === 'Constant') {
        const checkbox = el('input', { attrs: { type: 'checkbox' } }) as HTMLInputElement;
        checkbox.checked = selectedNode.value;
        checkbox.addEventListener('change', () => {
          if (rootMode === 'bool') {
            boolRoot = { ...selectedNode, value: checkbox.checked };
          } else {
            ast = replaceNodeByPath(ast, selectedPath, { ...selectedNode, value: checkbox.checked });
          }
          renderTree();
        });
        inspector.append(el('div', { className: 'sw-section-header', text: 'Boolean Constant' }), checkbox);
      } else {
        const spoolSelect = el('select') as HTMLSelectElement;
        for (const spool of storyworld.spools) {
          const opt = el('option', { text: spool.name || spool.id, attrs: { value: spool.id } }) as HTMLOptionElement;
          if (spool.id === selectedNode.spoolId) opt.selected = true;
          spoolSelect.appendChild(opt);
        }
        spoolSelect.addEventListener('change', () => {
          if (rootMode === 'bool') {
            boolRoot = { ...selectedNode, spoolId: spoolSelect.value };
          } else {
            ast = replaceNodeByPath(ast, selectedPath, { ...selectedNode, spoolId: spoolSelect.value });
          }
          renderTree();
        });
        inspector.append(el('div', { className: 'sw-section-header', text: 'Spool Active' }), spoolSelect);
      }
    }

    palette.appendChild(inspector);
    palettePane.appendChild(palette);
  };

  const render = () => {
    renderTree();
    renderPalette();
  };

  okButton.addEventListener('click', () => {
    if (rootMode === 'script') {
      const script = scriptFromAst(ast, storyworld);
      options.onConfirm?.(script, ast);
    } else {
      options.onConfirmBool?.(boolRoot);
    }
    document.body.removeChild(overlay);
  });
  cancelButton.addEventListener('click', () => {
    document.body.removeChild(overlay);
  });

  body.append(treePane, palettePane);
  modal.append(header, body, footer);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  render();
}
