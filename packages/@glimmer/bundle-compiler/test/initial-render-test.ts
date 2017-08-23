import { Opaque, Resolver, Option, Dict, Recast, Simple, ProgramSymbolTable } from "@glimmer/interfaces";
import {
  TestDynamicScope,
  UserHelper,
  HelperReference,
  TestMacros,
  RenderDelegate,
  InitialRenderSuite,
  BasicComponents,
  AbstractTestEnvironment,
  renderSync,
  EmberishComponentTests,
  AbstractEmberishGlimmerComponentManager,
  rawModule,
  EmberishGlimmerComponent,
  EnvironmentOptions
} from "@glimmer/test-helpers";
import { BundleCompiler, CompilerDelegate, Specifier, SpecifierMap, specifierFor } from "@glimmer/bundle-compiler";
import { ComponentCapabilities, VMHandle, ICompilableTemplate } from "@glimmer/opcode-compiler";
import { Program, RuntimeProgram, WriteOnlyProgram, RuntimeConstants } from "@glimmer/program";
import { elementBuilder, LowLevelVM, TemplateIterator, RenderResult, Helper, Environment, WithStaticLayout, Bounds, ComponentManager, DOMTreeConstruction, DOMChanges } from "@glimmer/runtime";
import { UpdatableReference } from "@glimmer/object-reference";
import { dict, unreachable } from "@glimmer/util";
import { PathReference, CONSTANT_TAG, Tag } from "@glimmer/reference";

class BundledClientEnvironment extends AbstractTestEnvironment<Opaque> {
  protected program: Program<Opaque>;
  protected resolver: Resolver<Opaque>;

  constructor(options?: EnvironmentOptions) {
    if (!options) {
      let document = window.document;
      let appendOperations = new DOMTreeConstruction(document);
      let updateOperations = new DOMChanges(document as HTMLDocument);
      options = { appendOperations, updateOperations };
    }

    super(options);
  }
}

export class RuntimeResolver implements Resolver<Specifier> {
  constructor(private map: SpecifierMap, private modules: Modules) {}

  lookupHelper(_name: string, _meta: Opaque): Option<number> {
    throw new Error("Method not implemented.");
  }
  lookupModifier(_name: string, _meta: Opaque): Option<number> {
    throw new Error("Method not implemented.");
  }
  lookupComponent(_name: string, _meta: Opaque): Option<number> {
    throw new Error("Method not implemented.");
  }
  lookupPartial(_name: string, _meta: Opaque): Option<number> {
    throw new Error("Method not implemented.");
  }
  resolve<U>(specifier: number): U {
    let module = this.map.byHandle.get(specifier)!;
    return this.modules.get(module.module).get('default') as U;
  }

  getVMHandle(specifier: Specifier): number {
    return this.map.vmHandleBySpecifier.get(specifier) as Recast<VMHandle, number>;
  }
}

export type ModuleType = 'component' | 'helper' | 'modifier' | 'partial' | 'other';

export class Module {
  constructor(private dict: Dict<Opaque>, public type: ModuleType) {
    Object.freeze(this.dict);
  }

  has(key: string) {
    return key in this.dict;
  }

  get(key: string): Opaque {
    return this.dict[key];
  }
}

export class Modules {
  private registry = dict<Module>();

  has(name: string): boolean {
    return name in this.registry;
  }

  get(name: string): Module {
    return this.registry[name];
  }

  type(name: string): ModuleType {
    let module = this.registry[name];
    return module.type;
  }

  register(name: string, type: ModuleType, value: Dict<Opaque>) {
    this.registry[name] = new Module(value, type);
  }

  resolve(name: string, referer: Specifier): Option<string> {
    let local = referer.module && referer.module.replace(/^((.*)\/)?([^\/]*)$/, `$1${name}`);
    if (local && this.registry[local]) {
      return local;
    } else if (this.registry[name]) {
      return name;
    } else {
      return null;
    }
  }
}

class BundlingDelegate implements CompilerDelegate {
  constructor(private components: Dict<CompileTimeComponent>, private modules: Modules, private compileTimeModules: Modules, private compile: (specifier: Specifier) => VMHandle) {}

  hasComponentInScope(componentName: string, referer: Specifier): boolean {
    let name = this.modules.resolve(componentName, referer);
    return name ? this.modules.type(name) === 'component' : false;
  }

  resolveComponentSpecifier(componentName: string, referer: Specifier): Specifier {
    return specifierFor(this.modules.resolve(componentName, referer)!, 'default');
  }

  getComponentCapabilities(specifier: Specifier): ComponentCapabilities {
    let component: string = specifier.module.split('/').pop()!;
    return this.components[component].capabilities;
  }

  getComponentLayout(specifier: Specifier): ICompilableTemplate<ProgramSymbolTable> {
    let compile = this.compile;
    let module = this.compileTimeModules.get(specifier.module)!;
    let table = module.get(specifier.name) as ProgramSymbolTable;

    return {
      symbolTable: table,
      compile(): VMHandle {
        return compile(specifier);
      }
    };
  }

  hasHelperInScope(helperName: string, referer: Specifier): boolean {
    let name = this.modules.resolve(helperName, referer);
    return name ? this.modules.type(name) === 'helper' : false;
  }

  resolveHelperSpecifier(helperName: string, referer: Specifier): Specifier {
    let path = this.modules.resolve(helperName, referer);
    return specifierFor(path!, 'default');
  }

  hasModifierInScope(_modifierName: string, _referer: Specifier): boolean {
    return false;
  }
  resolveModifierSpecifier(_modifierName: string, _referer: Specifier): Specifier {
    throw new Error("Method not implemented.");
  }
  hasPartialInScope(_partialName: string, _referer: Specifier): boolean {
    return false;
  }
  resolvePartialSpecifier(_partialName: string, _referer: Specifier): Specifier {
    throw new Error("Method not implemented.");
  }
}

export class BasicComponent {
  public element: Option<Simple.Element>;
  public bounds: Option<Bounds>;
}

const EMPTY_CAPABILITIES = {
  staticDefinitions: true,
  dynamicLayout: false,
  dynamicTag: false,
  prepareArgs: false,
  createArgs: false,
  attributeHook: false,
  elementHook: false
};

export class BasicComponentManager implements WithStaticLayout<BasicComponent, typeof BasicComponent, Specifier, RuntimeResolver> {
  getCapabilities(_definition: typeof BasicComponent) {
    return EMPTY_CAPABILITIES;
  }

  prepareArgs(): null {
    throw unreachable();
  }

  create(_env: Environment, _definition: Opaque): BasicComponent {
    let klass = BasicComponent;
    return new klass();
  }

  getLayout(): number {
    throw new Error('unimplemented');
  }

  getSelf(component: BasicComponent): PathReference<Opaque> {
    return new UpdatableReference(component);
  }

  getTag(): Tag {
    return CONSTANT_TAG;
  }

  didCreateElement(component: BasicComponent, element: Element): void {
    component.element = element;
  }

  didRenderLayout(component: BasicComponent, bounds: Bounds): void {
    component.bounds = bounds;
  }

  didCreate(): void { }

  update(): void { }

  didUpdateLayout(): void { }

  didUpdate(): void { }

  getDestructor(): null {
    return null;
  }
}

class BundledEmberishGlimmerComponentManager extends AbstractEmberishGlimmerComponentManager<Specifier, RuntimeResolver> {
  getLayout(): number {
    throw unreachable();
  }
}

const BASIC_MANAGER = new BasicComponentManager();
const EMBERISH_GLIMMER_COMPONENT_MANAGER = new BundledEmberishGlimmerComponentManager();

const EMBERISH_GLIMMER_CAPABILITIES = {
  ...EMPTY_CAPABILITIES,
  staticDefinitions: false,
  dynamicTag: true,
  createArgs: true,
  attributeHook: true
};

interface CompileTimeComponent {
  definition: Opaque;
  manager: ComponentManager<Opaque, Opaque>;
  template: string;
  capabilities: ComponentCapabilities;
}

class BundlingRenderDelegate implements RenderDelegate {
  protected env = new BundledClientEnvironment();
  protected modules = new Modules();
  protected compileTimeModules = new Modules();
  protected components = dict<CompileTimeComponent>();

  getInitialElement(): HTMLElement {
    return this.env.getAppendOperations().createElement('div') as HTMLElement;
  }

  registerComponent(type: "Glimmer" | "Curly" | "Dynamic" | "Basic" | "Fragment", name: string, layout: string): void {
    switch (type) {
      case "Basic":
        this.components[name] = {
          definition: class {},
          manager: BASIC_MANAGER,
          capabilities: EMPTY_CAPABILITIES,
          template: layout
        };
        return;
      case "Glimmer":
        this.components[name] = {
          definition: {
            name,
            specifier: specifierFor(`ui/components/${name}`, 'default'),
            capabilities: EMBERISH_GLIMMER_CAPABILITIES,
            ComponentClass: EmberishGlimmerComponent
          },
          capabilities: EMBERISH_GLIMMER_CAPABILITIES,
          manager: EMBERISH_GLIMMER_COMPONENT_MANAGER,
          template: layout
        };
        return;
      default:
        throw new Error(`Not implemented in the Bundle Compiler yet: ${type}`);
    }
  }

  registerHelper(name: string, helper: UserHelper): void {
    let glimmerHelper: Helper = (_vm, args) => new HelperReference(helper, args);

    this.modules.register(name, 'helper', { default: glimmerHelper });
  }

  renderTemplate(template: string, context: Dict<Opaque>, element: HTMLElement): RenderResult {
    let macros = new TestMacros();
    let delegate: BundlingDelegate = new BundlingDelegate(this.components, this.modules, this.compileTimeModules, specifier => {
      return compiler.compileSpecifier(specifier);
    });
    let program = new WriteOnlyProgram();
    let compiler = new BundleCompiler(delegate, { macros, program });

    let spec = specifierFor('ui/components/main', 'default');
    compiler.add(spec, template);

    let { components, modules, compileTimeModules } = this;
    Object.keys(components).forEach(key => {
      let component = components[key];
      let spec = specifierFor(`ui/components/${key}`, 'default');
      let block = compiler.add(spec, component.template);
      compileTimeModules.register(`ui/components/${key}`, 'other', {
        default: {
          hasEval: block.hasEval,
          symbols: block.symbols,
          referer: `ui/components/${key}`
        } as ProgramSymbolTable
      });
      modules.register(`ui/components/${key}`, 'component', { default: { definition: component.definition, manager: component.manager } });
    });

    compiler.compile();

    let handle = compiler.getSpecifierMap().vmHandleBySpecifier.get(spec)! as Recast<number, VMHandle>;
    let { env } = this;

    let cursor = { element, nextSibling: null };
    let builder = elementBuilder({ mode: 'client', env, cursor });
    let self = new UpdatableReference(context);
    let dynamicScope = new TestDynamicScope();
    let resolver = new RuntimeResolver(compiler.getSpecifierMap(), this.modules);
    let pool = program.constants.toPool();
    let runtimeProgram = new RuntimeProgram(new RuntimeConstants(resolver, pool), program.heap);

    let vm = LowLevelVM.initial(runtimeProgram, env, self, null, dynamicScope, builder, handle);
    let iterator = new TemplateIterator(vm);

    return renderSync(env, iterator);  }
}

// module("[Bundle Compiler] Rehydration Tests", Rehydration);
rawModule("[Bundle Compiler] Initial Render Tests", InitialRenderSuite, BundlingRenderDelegate);
rawModule("[Bundle Compiler] Basic Components", BasicComponents, BundlingRenderDelegate, { componentModule: true });
rawModule('[Bundle Compiler] Emberish Components', EmberishComponentTests, BundlingRenderDelegate, { componentModule: true });
