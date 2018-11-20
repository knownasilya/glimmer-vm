import { LinkedList, DESTROY, associate } from '@glimmer/util';
import Environment, { inTransaction } from '../environment';
import { DestroyableBounds, clear } from '../bounds';
import UpdatingVM, { ExceptionHandler } from './update';
import { UpdatingOpcode } from '../opcodes';
import { Simple } from '@glimmer/interfaces';
import { LiveBlock } from './element-builder';
import { asyncDestroy } from '../lifetime';

export default class RenderResult implements DestroyableBounds, ExceptionHandler {
  constructor(
    public env: Environment,
    private updating: LinkedList<UpdatingOpcode>,
    private bounds: LiveBlock,
    readonly drop: object
  ) {
    associate(this, drop);
  }

  rerender({ alwaysRevalidate = false } = { alwaysRevalidate: false }) {
    let { env, updating } = this;
    let vm = new UpdatingVM(env, { alwaysRevalidate });
    vm.execute(updating, this);
  }

  parentElement(): Simple.Element {
    return this.bounds.parentElement();
  }

  firstNode(): Simple.Node {
    return this.bounds.firstNode();
  }

  lastNode(): Simple.Node {
    return this.bounds.lastNode();
  }

  handleException() {
    throw 'this should never happen';
  }

  [DESTROY]() {
    clear(this.bounds);
  }

  // compat, as this is a user-exposed API
  destroy() {
    inTransaction(this.env, () => asyncDestroy(this, this.env));
  }
}
