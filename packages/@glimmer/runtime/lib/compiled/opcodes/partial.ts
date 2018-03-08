import { VersionedPathReference } from '@glimmer/reference';
import { Op } from '@glimmer/vm';
import { APPEND_OPCODES } from '../../opcodes';
import { PartialDefinition } from '@glimmer/opcode-compiler';
import { assert, Dict } from "@glimmer/util";
import { check } from '@glimmer/debug';
import { Opaque } from "@glimmer/interfaces";
import { CheckReference } from './-debug-strip';
import { UNDEFINED_REFERENCE } from '../../references';
import { ProxyStackScope } from '../../environment';

APPEND_OPCODES.add(Op.InvokePartial, (vm, { op1: _meta, op2: _symbols, op3: _evalInfo }) => {
  let { constants, constants: { resolver }, stack } = vm;

  let name = check(stack.pop(), CheckReference).value();
  assert(typeof name === 'string', `Could not find a partial named "${String(name)}"`);

  let meta = constants.getSerializable(_meta);
  let outerSymbols = constants.getStringArray(_symbols);
  let evalInfo = constants.getArray(_evalInfo);

  let handle = resolver.lookupPartial(name as string, meta);

  assert(handle, `Could not find a partial named "${name}"`);

  let definition = resolver.resolve<PartialDefinition>(handle!);

  let { symbolTable, handle: vmHandle } = definition.getPartial();

  {
    let partialSymbols = symbolTable.symbols;
    let outerScope = vm.scope();

    let evalScope = outerScope.getEvalScope();

    // self is always first on the stack
    vm.stack.push(outerScope.getSelf());

    // point at the current $sp
    let fp = vm.stack.sp;

    // create a new partial map for this invocation
    let locals = Object.create(outerScope.getPartialMap()) as Dict<VersionedPathReference<Opaque>>;

    for (let i = 0; i < evalInfo.length; i++) {
      let slot = evalInfo[i];
      let name = outerSymbols[slot - 1];
      let ref  = outerScope.getSymbol(slot);
      locals[name] = ref;
    }

    if (evalScope) {
      for (let i = 0; i < partialSymbols.length; i++) {
        let name = partialSymbols[i];
        vm.stack.push(evalScope[name]);
      }
    } else {
      for (let i = 0; i < partialSymbols.length; i++) {
        vm.stack.push(UNDEFINED_REFERENCE);
      }
    }

    let scope = vm.pushScope(new ProxyStackScope(vm.stack, fp, vm.stack.sp));
    scope.bindEvalScope(evalScope);
    scope.bindPartialMap(locals);

    vm.pushFrame(); // sp += 2
    vm.call(vmHandle!);
  }
});
